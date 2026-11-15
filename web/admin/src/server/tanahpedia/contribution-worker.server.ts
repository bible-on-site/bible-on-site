import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { PoolConnection } from "mysql2/promise";
import { canonicalJson } from "~/lib/canonical-json";
import type {
	ContributionAgentProvider,
	ContributionAgentTask,
	RegisteredContributionAgent,
} from "~/lib/tanahpedia/contribution-agents";
import { CONTRIBUTION_API_VERSION } from "~/lib/tanahpedia/contribution-api";
import {
	type Contribution,
	type ContributionGeneration,
	record,
	textField,
	uuidField,
} from "~/lib/tanahpedia/contributions";
import { txQuery } from "../db";
import { buildContributionAgentBundle } from "./contribution-agent-bundle.server";
import {
	type AgentCatalogue,
	mergeAgentCatalogues,
	readContributionAgentInitialContext,
	readContributionAgentTool,
} from "./contribution-agent-context.server";
import {
	contributionAgentResultSchema,
	parseContributionAgentResult,
	pendingContributionAgentComments,
} from "./contribution-agent-output.server";
import {
	contributionAgentActionSchema,
	contributionAgentSystem,
} from "./contribution-agent-protocol";
import {
	getAssignedContributionAgent,
	getRegisteredContributionAgent,
	readContributionAgentBundle,
	touchContributionAgent,
} from "./contribution-agent-registry.server";
import {
	awsGenerate,
	contributionOutputSchema,
	createGeneratedContributionPrs,
	prepareContributionGeneration,
} from "./contribution-llm.server";
import {
	addEvent,
	applyContributionAgentRevision,
	queueAssignedContributionAgent,
} from "./contribution-service.server";
import {
	readContribution,
	saveContribution,
	withContributions,
} from "./contribution-store.server";

const LEASE_MS = 180000; // Existing 120s inference deadline plus transport; never extends an inference.
const MAX_ATTEMPTS = 3;
const LOCAL_AGENT_BUNDLE = buildContributionAgentBundle();
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

const AGENT_TASKS: ContributionAgentTask[] = [
	"issue_implementation",
	"pr_resolution",
];
function locallyImplementedAgent(agent: RegisteredContributionAgent): boolean {
	return (
		agent.bundle.protocolVersion === LOCAL_AGENT_BUNDLE.protocolVersion &&
		agent.bundle.apiVersion === LOCAL_AGENT_BUNDLE.apiVersion &&
		agent.bundleHash === LOCAL_AGENT_BUNDLE.hash &&
		agent.installedVersion === LOCAL_AGENT_BUNDLE.version &&
		agent.bundle.hash === agent.bundleHash &&
		agent.bundle.version === agent.installedVersion
	);
}
function versionedJob(job: ContributionGeneration): boolean {
	return Boolean(job.task || job.bundleHash || job.bundleVersion);
}
function locallyImplementedJob(job: ContributionGeneration): boolean {
	return (
		!versionedJob(job) ||
		Boolean(
			job.task &&
				AGENT_TASKS.includes(job.task) &&
				job.apiVersion === LOCAL_AGENT_BUNDLE.apiVersion &&
				job.bundleHash === LOCAL_AGENT_BUNDLE.hash &&
				job.bundleVersion === LOCAL_AGENT_BUNDLE.version,
		)
	);
}
const agentTask = (item: Contribution): ContributionAgentTask =>
	item.kind === "issue" ? "issue_implementation" : "pr_resolution";
const receiptHash = (value: unknown) => hash(canonicalJson(value));
interface ToolReceipt {
	name: string;
	arguments: Record<string, unknown>;
	hash: string;
}

function toolReceipts(raw: unknown): ToolReceipt[] {
	if (raw == null) return [];
	if (!Array.isArray(raw) || raw.length > 1000)
		throw new ContributionWorkerConflict("Invalid context receipts");
	return raw.map((value) => {
		const receipt = record(value);
		return {
			name: textField(receipt.name, "tool name", 64),
			arguments: record(receipt.arguments, "tool arguments"),
			hash: textField(receipt.hash, "receipt hash", 64),
		};
	});
}

/** Internal provider selection is not accepted from the workstation HTTP body. */
export async function claimContributionAgentWork(
	raw: unknown,
	provider: ContributionAgentProvider,
) {
	const input = record(raw),
		workerId = textField(input.workerId, "workerId", 128);
	if (
		input.protocolVersion !== 2 ||
		!Array.isArray(input.supportedTasks) ||
		!input.supportedTasks.length ||
		input.supportedTasks.some((task) => !AGENT_TASKS.includes(task))
	)
		throw new ContributionWorkerConflict(
			"Unsupported worker protocol or task capabilities",
		);
	const tasks = input.supportedTasks as ContributionAgentTask[];
	const issueId =
		input.issueId == null ? null : uuidField(input.issueId, "issueId");
	return withContributions(async (conn) => {
		const incompatibleIds: string[] = [];
		for (let examined = 0; examined < 20; examined++) {
			const rows = await txQuery<{ id: string }>(
				conn,
				`SELECT id FROM tanahpedia_contribution WHERE state='open'
			AND JSON_UNQUOTE(JSON_EXTRACT(data,'$.assignee.kind'))=?
			AND ((kind='issue' AND ?=1) OR (kind='pr' AND ?=1))
			AND (JSON_UNQUOTE(JSON_EXTRACT(data,'$.generation.status'))='queued'
			OR (JSON_UNQUOTE(JSON_EXTRACT(data,'$.generation.status'))='running' AND JSON_UNQUOTE(JSON_EXTRACT(data,'$.generation.leaseExpiresAt'))<=?))
			${issueId ? "AND id=?" : ""}
			${incompatibleIds.length ? `AND id NOT IN (${incompatibleIds.map(() => "?").join(",")})` : ""}
			ORDER BY number LIMIT 1 FOR UPDATE SKIP LOCKED`,
				[
					provider,
					Number(tasks.includes("issue_implementation")),
					Number(tasks.includes("pr_resolution")),
					new Date().toISOString(),
					...(issueId ? [issueId] : []),
					...incompatibleIds,
				],
			);
			if (!rows.length) return null;
			const item = await readContribution(conn, rows[0].id, true),
				job = item.generation;
			if (!job) throw new ContributionWorkerConflict("Agent request missing");
			const agent = await getAssignedContributionAgent(conn, item.assignee);
			if (
				agent.provider !== provider ||
				!locallyImplementedAgent(agent) ||
				!locallyImplementedJob(job)
			) {
				if (incompatibleIds.includes(item.id)) return null;
				incompatibleIds.push(item.id);
				continue;
			}
			if (
				!agent.enabled ||
				!agent.model ||
				(job.agentId && job.agentId !== agent.id) ||
				(job.bundleHash && job.bundleHash !== agent.bundleHash) ||
				(job.agentVersion && job.agentVersion !== agent.version)
			) {
				await queueAssignedContributionAgent(
					conn,
					item,
					{
						id: "system:agent-claim",
						name: "Agent configuration",
						kind: "system",
						isDoradsoft: false,
					},
					"assignment",
					job.triggerEventIds ?? [],
				);
				await saveContribution(conn, item);
				continue;
			}
			if (job.attempts >= MAX_ATTEMPTS) {
				job.status = "failed";
				job.error =
					"The worker repeatedly disconnected. Assign or retry the item again.";
				await saveContribution(conn, item);
				continue;
			}
			const context = await readContributionAgentInitialContext(conn, item);
			const token = randomBytes(32).toString("hex");
			Object.assign(job, {
				status: "running",
				attempts: job.attempts + 1,
				worker: workerId,
				apiVersion: CONTRIBUTION_API_VERSION,
				leaseHash: hash(token),
				leaseExpiresAt: new Date(Date.now() + LEASE_MS).toISOString(),
				claimedVersion: item.version + 1,
				error: null,
				task: agentTask(item),
				provider,
				agentId: agent.id,
				agentVersion: agent.version,
				bundleVersion: agent.installedVersion,
				bundleHash: agent.bundleHash,
				contextHash: context.hash,
			});
			await saveContribution(conn, item);
			await touchContributionAgent(
				conn,
				agent.id,
				typeof input.runtimeVersion === "string"
					? textField(input.runtimeVersion, "runtimeVersion", 128)
					: "protocol-2",
			);
			return {
				id: job.id,
				issueId: item.id,
				contributionId: item.id,
				version: item.version,
				apiVersion: job.apiVersion,
				token,
				protocolVersion: 2,
				task: job.task,
				agentId: agent.id,
				bundleVersion: agent.installedVersion,
				bundleHash: agent.bundleHash,
				model: agent.model,
				contextHash: context.hash,
				user: canonicalJson(context.data),
				schema: contributionAgentActionSchema(
					agent.bundle,
					contributionAgentResultSchema(item, context.catalogue),
				),
			};
		}
		return null;
	});
}

async function prepareAgentLease(
	conn: PoolConnection,
	raw: unknown,
	lock = false,
) {
	const input = record(raw),
		lease = leaseInput(raw),
		item = await readContribution(conn, lease.issueId, lock);
	requireRunningLease(item, lease);
	const job = item.generation;
	if (!job?.agentId || !job.bundleHash || job.task !== agentTask(item))
		throw new ContributionWorkerConflict("The agent task changed");
	if (!locallyImplementedJob(job))
		throw new ContributionWorkerConflict(
			"This server does not implement the saved agent bundle or API",
		);
	const agent = await getAssignedContributionAgent(conn, item.assignee, lock);
	if (!locallyImplementedAgent(agent))
		throw new ContributionWorkerConflict(
			"This server does not implement the installed agent bundle or API",
		);
	if (
		!agent.enabled ||
		agent.id !== job.agentId ||
		agent.provider !== job.provider ||
		agent.bundleHash !== job.bundleHash ||
		agent.installedVersion !== job.bundleVersion ||
		agent.version !== job.agentVersion
	)
		throw new ContributionWorkerConflict(
			"The assigned agent configuration or bundle changed during execution",
		);
	const initial = await readContributionAgentInitialContext(conn, item);
	if (initial.hash !== job.contextHash)
		throw new ContributionWorkerConflict(
			"The contribution or its context changed during execution",
		);
	const receipts = toolReceipts(input.receipts),
		catalogues: AgentCatalogue[] = [initial.catalogue];
	for (const receipt of receipts) {
		if (!agent.bundle.tools.some((tool) => tool.name === receipt.name))
			throw new ContributionWorkerConflict("Unsupported agent tool");
		const result = await readContributionAgentTool(
			conn,
			item,
			receipt.name,
			receipt.arguments,
		);
		if (receiptHash(result) !== receipt.hash)
			throw new ContributionWorkerConflict(
				"A tool-read record or discussion changed during execution",
			);
		catalogues.push(result.catalogue);
	}
	return {
		item,
		job,
		agent,
		lease,
		catalogue: mergeAgentCatalogues(...catalogues),
		receipts,
	};
}

export async function getContributionWorkerBundle(raw: unknown) {
	const input = record(raw),
		bundleHash = textField(input.hash, "bundle hash", 64);
	if (!/^[a-f0-9]{64}$/.test(bundleHash))
		throw new ContributionWorkerConflict("Invalid bundle hash");
	return withContributions((conn) =>
		readContributionAgentBundle(conn, bundleHash),
	);
}

export async function readContributionWorkerContext(raw: unknown) {
	return withContributions(async (conn) => {
		const input = record(raw),
			prepared = await prepareAgentLease(conn, raw),
			name = textField(input.name, "tool name", 64),
			args = record(input.arguments, "tool arguments");
		if (!prepared.agent.bundle.tools.some((tool) => tool.name === name))
			throw new ContributionWorkerConflict("Unsupported agent tool");
		const result = await readContributionAgentTool(
			conn,
			prepared.item,
			name,
			args,
		);
		const receipt = { name, arguments: args, hash: receiptHash(result) };
		const catalogue = mergeAgentCatalogues(
			prepared.catalogue,
			result.catalogue,
		);
		return {
			data: result.data,
			receipt,
			schema: contributionAgentActionSchema(
				prepared.agent.bundle,
				contributionAgentResultSchema(prepared.item, catalogue),
			),
		};
	});
}

export async function completeContributionAgentWork(
	raw: unknown,
): Promise<{ prIds: string[] }> {
	const input = record(raw),
		lease = leaseInput(raw),
		content = textField(input.content, "model output", 100000),
		outputHash = receiptHash({
			content,
			receipts: toolReceipts(input.receipts),
		});
	const replay = (item: Contribution) =>
		ownsLease(item, lease) &&
		["completed", "needs_input"].includes(item.generation?.status ?? "") &&
		item.generation?.outputHash === outputHash;
	try {
		const prepared = await withContributions(async (conn) => {
			const item = await readContribution(conn, lease.issueId);
			if (replay(item)) return { replay: item.generation?.prIds ?? [] };
			return { context: await prepareAgentLease(conn, raw) };
		});
		if (prepared.replay) return { prIds: prepared.replay };
		const context = prepared.context;
		if (!context) throw new ContributionWorkerConflict("Agent context missing");
		const result = parseContributionAgentResult(
			content,
			context.item,
			context.catalogue,
		);
		const actor = {
			id: `agent:${context.agent.id}`,
			name: context.agent.name,
			kind: context.agent.provider,
			isDoradsoft: false,
		};
		const finish = (item: Contribution, changed: boolean, prIds: string[]) => {
			const job = item.generation;
			if (!job) throw new ContributionWorkerConflict("Agent task missing");
			addEvent(item, actor, "agent_response", result.summary);
			const event = item.events[item.events.length - 1];
			event.responses = result.responses;
			event.run = {
				jobId: job.id,
				agentId: context.agent.id,
				bundleVersion: context.agent.installedVersion,
				model: context.agent.model ?? "worker-selected",
			};
			Object.assign(job, {
				status:
					result.outcome === "clarification" ? "needs_input" : "completed",
				outputHash,
				model: context.agent.model ?? textField(input.model, "model", 255),
				prIds,
				error: null,
				result: {
					outcome: result.outcome,
					summary: result.summary,
					addressedCommentIds: result.responses
						.filter((response) => response.status === "addressed")
						.map((response) => response.commentId),
					pendingCommentIds: pendingContributionAgentComments(item),
					revision: item.revision,
					changed,
				},
			});
		};
		if (result.outcome === "implemented") {
			const initial = {
				issue: context.item,
				provider: context.agent.provider,
				modelCatalogue: context.catalogue,
				schema: contributionOutputSchema(
					context.catalogue,
					context.item.evidence.length,
				),
				system: context.agent.bundle.system,
				user: "",
			};
			const prs = await createGeneratedContributionPrs(
				initial,
				{
					content: canonicalJson({ pullRequests: result.pullRequests }),
					model: context.agent.model ?? textField(input.model, "model", 255),
				},
				{
					provenanceProvider: "contribution_agent",
					actor,
					promptVersion: context.agent.installedVersion,
					beforeCreate: async (conn) => {
						await prepareAgentLease(conn, raw, true);
					},
					afterCreate: (_conn, item, prs) =>
						finish(
							item,
							true,
							prs.map((pr) => pr.id),
						),
				},
			);
			return { prIds: prs.map((pr) => pr.id) };
		}
		return await withContributions(async (conn) => {
			const item = await readContribution(conn, lease.issueId, true);
			if (replay(item)) return { prIds: item.generation?.prIds ?? [] };
			await prepareAgentLease(conn, raw, true);
			const changed = result.draft
				? await applyContributionAgentRevision(conn, item, result.draft, actor)
				: false;
			finish(item, changed, []);
			await saveContribution(conn, item);
			return { prIds: [] };
		});
	} catch (error) {
		const receipt = await withContributions(async (conn) => {
			const item = await readContribution(conn, lease.issueId);
			return replay(item) ? { prIds: item.generation?.prIds ?? [] } : null;
		});
		if (receipt) return receipt;
		await failContributionGeneration(
			raw,
			error instanceof Error && "code" in error
				? "Agent storage unavailable. Retry the item."
				: error instanceof Error
					? error.message
					: "Invalid agent output",
		);
		throw error;
	}
}

/** Background AWS work uses the identical leases, read receipts and completion transaction. */
export async function runAwsContributionAgentTask() {
	const claim = await claimContributionAgentWork(
		{
			workerId: "admin-bedrock",
			runtimeVersion: "protocol-2",
			protocolVersion: 2,
			supportedTasks: AGENT_TASKS,
		},
		"aws_llm",
	);
	if (!claim) return { status: "idle" as const };
	const identity = {
		issueId: claim.issueId,
		jobId: claim.id,
		token: claim.token,
		version: claim.version,
		apiVersion: claim.apiVersion,
		protocolVersion: 2,
	};
	try {
		const bundle = await getContributionWorkerBundle({
			hash: claim.bundleHash,
		});
		const agent = await withContributions((conn) =>
			getRegisteredContributionAgent(conn, claim.agentId),
		);
		const signal = AbortSignal.timeout(120000),
			turns: unknown[] = [],
			receipts: ToolReceipt[] = [];
		let schema = claim.schema;
		while (true) {
			const generated = await awsGenerate(
				contributionAgentSystem(bundle),
				canonicalJson({
					task: claim.task,
					context: JSON.parse(claim.user),
					turns,
				}),
				schema,
				{ ...(agent.model ? { model: agent.model } : {}), signal },
			);
			signal.throwIfAborted();
			const action = record(JSON.parse(generated.content));
			if (action.action === "complete") {
				const result = await completeContributionAgentWork({
					...identity,
					receipts,
					content: canonicalJson(action.result),
					model: generated.model,
				});
				return {
					status: "completed" as const,
					contributionId: claim.issueId,
					...result,
				};
			}
			if (action.action !== "tool") throw new Error("Invalid agent action");
			const read = await readContributionWorkerContext({
				...identity,
				receipts,
				name: action.name,
				arguments: action.arguments,
			});
			receipts.push(read.receipt);
			schema = read.schema;
			turns.push({ request: action, response: read.data });
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : "AWS agent failed";
		await failContributionGeneration({
			...identity,
			error: message.slice(0, 1000),
		});
		return {
			status: "failed" as const,
			contributionId: claim.issueId,
			error: message,
		};
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
		item.state !== "open" ||
		!["local_llm", "aws_llm"].includes(item.assignee.kind)
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
	if (record(raw).protocolVersion === 2)
		return claimContributionAgentWork(raw, "local_llm");
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
			 AND JSON_LENGTH(JSON_EXTRACT(data, '$.evidence')) > 0
			 AND JSON_EXTRACT(data, '$.generation.task') IS NULL
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
		if (!locallyImplementedJob(item.generation)) return false;
		if (versionedJob(item.generation)) {
			if (
				item.assignee.kind !== "local_llm" &&
				item.assignee.kind !== "aws_llm"
			)
				return false;
			const agent = await getAssignedContributionAgent(
				conn,
				item.assignee,
				true,
			);
			if (
				!locallyImplementedAgent(agent) ||
				!agent.enabled ||
				!agent.model ||
				agent.id !== item.generation.agentId ||
				agent.version !== item.generation.agentVersion ||
				agent.provider !== item.generation.provider
			)
				return false;
		}
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
	if (input.protocolVersion === 2) return completeContributionAgentWork(raw);
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
