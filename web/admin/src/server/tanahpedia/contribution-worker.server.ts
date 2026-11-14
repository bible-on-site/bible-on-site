import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { CONTRIBUTION_API_VERSION } from "~/lib/tanahpedia/contribution-api";
import {
	type Contribution,
	record,
	textField,
	uuidField,
} from "~/lib/tanahpedia/contributions";
import { txQuery } from "../db";
import {
	createGeneratedContributionPrs,
	prepareContributionGeneration,
} from "./contribution-llm.server";
import {
	readContribution,
	saveContribution,
	withContributions,
} from "./contribution-store.server";

const LEASE_MS = 180000; // Existing 120s inference deadline plus transport; never extends an inference.
const MAX_ATTEMPTS = 3;
const hash = (value: string) =>
	createHash("sha256").update(value).digest("hex");
type Prepared = Awaited<ReturnType<typeof prepareContributionGeneration>>;
const contextHash = (context: Prepared) =>
	hash(
		JSON.stringify({
			system: context.system,
			user: context.user,
			schema: context.schema,
		}),
	);

export class ContributionWorkerConflict extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ContributionWorkerConflict";
	}
}

function leaseInput(raw: unknown) {
	const input = record(raw);
	const token = textField(input.token, "worker lease", 64);
	if (!/^[a-f0-9]{64}$/.test(token))
		throw new ContributionWorkerConflict("Invalid worker lease");
	return {
		issueId: uuidField(input.issueId, "issueId"),
		jobId: uuidField(input.jobId, "jobId"),
		token,
		version: input.version,
		apiVersion: input.apiVersion,
	};
}
type Lease = ReturnType<typeof leaseInput>;
function ownsLease(item: Contribution, lease: Lease): boolean {
	const job = item.generation;
	return Boolean(
		job &&
			job.id === lease.jobId &&
			job.leaseHash?.length === 64 &&
			timingSafeEqual(
				Buffer.from(job.leaseHash),
				Buffer.from(hash(lease.token)),
			),
	);
}
function requireRunningLease(item: Contribution, lease: Lease): void {
	const job = item.generation;
	if (
		!ownsLease(item, lease) ||
		!job ||
		job.status !== "running" ||
		item.kind !== "issue" ||
		item.state !== "open" ||
		item.assignee.kind !== "local_llm"
	)
		throw new ContributionWorkerConflict(
			"This worker no longer owns an active local-generation job",
		);
	if (
		job.apiVersion !== CONTRIBUTION_API_VERSION ||
		lease.apiVersion !== CONTRIBUTION_API_VERSION
	)
		throw new ContributionWorkerConflict(
			"API changed during generation. Request generation again.",
		);
	if (job.claimedVersion !== lease.version || item.version !== lease.version)
		throw new ContributionWorkerConflict(
			"The issue changed during generation. Request generation again.",
		);
	const expires = Date.parse(job.leaseExpiresAt ?? "");
	if (!Number.isFinite(expires) || expires <= Date.now())
		throw new ContributionWorkerConflict("The local worker lease expired");
}

/** Locks only one eligible issue; other workers skip it. A lost worker can be
 * replaced after its lease expires, without duplicating any proposal writes. */
export async function claimContributionGeneration(raw: unknown) {
	const input = record(raw),
		workerId = textField(input.workerId, "workerId", 128);
	const issueId =
		input.issueId == null ? null : uuidField(input.issueId, "issueId");
	return withContributions(async (conn) => {
		for (let examined = 0; examined < 20; examined++) {
			const rows = await txQuery<{ id: string }>(
				conn,
				`SELECT id FROM tanahpedia_contribution WHERE kind = 'issue' AND state = 'open'
			 AND JSON_UNQUOTE(JSON_EXTRACT(data, '$.assignee.kind')) = 'local_llm'
			 AND (JSON_UNQUOTE(JSON_EXTRACT(data, '$.generation.status')) = 'queued'
			 OR (JSON_UNQUOTE(JSON_EXTRACT(data, '$.generation.status')) = 'running' AND JSON_UNQUOTE(JSON_EXTRACT(data, '$.generation.leaseExpiresAt')) <= ?))
			 ${issueId ? "AND id = ?" : ""} ORDER BY number LIMIT 1 FOR UPDATE SKIP LOCKED`,
				[new Date().toISOString(), ...(issueId ? [issueId] : [])],
			);
			if (!rows.length) return null;
			const item = await readContribution(conn, rows[0].id, true),
				job = item.generation;
			if (!job)
				throw new ContributionWorkerConflict("Generation request missing");
			if (job.attempts >= MAX_ATTEMPTS) {
				job.status = "failed";
				job.error =
					"The local worker repeatedly disconnected. Request generation again.";
				await saveContribution(conn, item);
				continue;
			}
			const token = randomBytes(32).toString("hex");
			job.status = "running";
			job.attempts++;
			job.worker = workerId;
			job.apiVersion = CONTRIBUTION_API_VERSION;
			job.leaseHash = hash(token);
			job.leaseExpiresAt = new Date(Date.now() + LEASE_MS).toISOString();
			job.claimedVersion = item.version + 1;
			job.error = null;
			// The prepared context is independent of this internal job metadata.
			const context = await prepareContributionGeneration(
				{ id: item.id, version: item.version },
				conn,
			);
			job.contextHash = contextHash(context);
			await saveContribution(conn, item);
			return {
				id: job.id,
				issueId: item.id,
				version: item.version,
				apiVersion: job.apiVersion,
				token,
				system: context.system,
				user: context.user,
				schema: context.schema,
			};
		}
		return null;
	});
}

export async function failContributionGeneration(
	raw: unknown,
	reason?: string,
): Promise<boolean> {
	const lease = leaseInput(raw),
		input = record(raw);
	const message = textField(reason ?? input.error, "generation error", 2000);
	return withContributions(async (conn) => {
		const item = await readContribution(conn, lease.issueId, true);
		if (!ownsLease(item, lease) || item.generation?.status !== "running")
			return false;
		item.generation.status = "failed";
		item.generation.error = message;
		await saveContribution(conn, item);
		return true;
	});
}

/** Output is validated on the server against the exact issue/context version.
 * The workstation never supplies authority, base values, labels, or API calls. */
export async function completeContributionGeneration(
	raw: unknown,
): Promise<{ prIds: string[] }> {
	const input = record(raw),
		lease = leaseInput(raw);
	const result = {
		content: textField(input.content, "model output", 100000),
		model: textField(input.model, "model", 255),
	};
	const outputHash = hash(JSON.stringify(result));
	try {
		const prepared = await withContributions(async (conn) => {
			const item = await readContribution(conn, lease.issueId);
			if (ownsLease(item, lease) && item.generation?.status === "completed") {
				if (item.generation.outputHash !== outputHash)
					throw new ContributionWorkerConflict(
						"Completed job output does not match this replay",
					);
				return { replay: item.generation.prIds };
			}
			requireRunningLease(item, lease);
			const context = await prepareContributionGeneration(
				{ id: item.id, version: item.version },
				conn,
			);
			if (item.generation?.contextHash !== contextHash(context))
				throw new ContributionWorkerConflict(
					"The generation catalogue changed. Request generation again.",
				);
			return { context };
		});
		if (prepared.replay) return { prIds: prepared.replay };
		if (!prepared.context)
			throw new ContributionWorkerConflict("Generation context missing");
		const prs = await createGeneratedContributionPrs(prepared.context, result, {
			provenanceProvider: "local_llm_worker",
			beforeCreate: (_conn, item) => requireRunningLease(item, lease),
			afterCreate: (_conn, item, prs) => {
				const job = item.generation;
				if (!job)
					throw new ContributionWorkerConflict("Generation request missing");
				job.status = "completed";
				job.model = result.model;
				job.prIds = prs.map((pr) => pr.id);
				job.outputHash = outputHash;
				job.error = null;
			},
		});
		return { prIds: prs.map((pr) => pr.id) };
	} catch (error) {
		// A concurrent identical completion may have won the issue lock. Its
		// receipt is reusable even if the acknowledgement was lost in transit.
		const replay = await withContributions(async (conn) => {
			const item = await readContribution(conn, lease.issueId);
			return ownsLease(item, lease) &&
				item.generation?.status === "completed" &&
				item.generation.outputHash === outputHash
				? item.generation.prIds
				: null;
		});
		if (replay) return { prIds: replay };
		await failContributionGeneration(
			raw,
			error instanceof Error && "code" in error
				? "Generation storage unavailable. Request generation again."
				: error instanceof Error
					? error.message
					: "Invalid local model output",
		);
		throw error;
	}
}
