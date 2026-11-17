import type { Contributor } from "~/lib/tanahpedia/contributions";
import { query } from "../db";
import { getAssignedContributionAgent } from "./contribution-agent-registry.server";
import {
	ensureContributionSchema,
	readContribution,
	saveContribution,
	withContributions,
} from "./contribution-store.server";

type WorkResult = { status: "idle" | "completed" | "failed" };

/** One server process drains AWS work serially. Database leases coordinate
 * replicas; a failed job is never retried by this drain loop. */
export function createContributionAgentRuntime(
	run: () => Promise<WorkResult>,
	log: (message: string) => void = console.error,
) {
	let pending: Promise<void> | undefined;
	let stopped = false;
	const kick = () => {
		if (pending || stopped) return;
		pending = (async () => {
			while (!stopped && (await run()).status === "completed") {
				// A successful completion may release the next durable job.
			}
		})()
			.catch((error: unknown) => {
				log(
					`Contribution agent runtime failed: ${error instanceof Error ? error.message : "unknown error"}`,
				);
			})
			.finally(() => {
				pending = undefined;
			});
	};
	const timer = setInterval(kick, 30000);
	timer.unref?.();
	return {
		kick,
		settled: () => pending ?? Promise.resolve(),
		stop: () => {
			stopped = true;
			clearInterval(timer);
		},
	};
}

let runtime: ReturnType<typeof createContributionAgentRuntime> | undefined;

export function ensureContributionAgentRuntimeStarted(): void {
	if (runtime) return;
	runtime = createContributionAgentRuntime(async () => {
		const { runAwsContributionAgentTask } = await import(
			"./contribution-worker.server"
		);
		return runAwsContributionAgentTask();
	});
	runtime.kick();
}

export function notifyContributionAgentWork(): void {
	runtime?.kick();
}

const deploymentActor: Contributor = {
	id: "system:agent-release",
	name: "Agent release",
	kind: "system",
	isDoradsoft: false,
};

/** Backfill existing assignments and revoke stale active configuration leases.
 * Completed implementations stay complete, preventing duplicate issue PRs. */
export async function reconcileContributionAgentAssignments(
	agentId?: string,
): Promise<{ scanned: number; queued: number }> {
	await ensureContributionSchema();
	const [{ lastNumber }] = await query<{ lastNumber: number }>(
		"SELECT COALESCE(MAX(number), 0) AS lastNumber FROM tanahpedia_contribution",
	);
	let cursor = 0,
		scanned = 0,
		queued = 0;
	while (cursor < Number(lastNumber)) {
		const rows = await query<{ id: string; number: number }>(
			"SELECT id, number FROM tanahpedia_contribution WHERE state = 'open' AND JSON_UNQUOTE(JSON_EXTRACT(data, '$.assignee.kind')) IN ('local_llm','aws_llm') AND number > ? AND number <= ? ORDER BY number LIMIT 100",
			[cursor, Number(lastNumber)],
		);
		if (!rows.length) break;
		for (const row of rows) {
			const changed = await withContributions(async (conn) => {
				const item = await readContribution(conn, row.id, true);
				if (
					item.state !== "open" ||
					(item.assignee.kind !== "local_llm" &&
						item.assignee.kind !== "aws_llm")
				)
					return false;
				const agent = await getAssignedContributionAgent(conn, item.assignee);
				if (agentId && agent.id !== agentId) return false;
				const job = item.generation;
				const active = job && ["queued", "running"].includes(job.status);
				const stale =
					job?.task &&
					(job.agentId !== agent.id ||
						job.bundleHash !== agent.bundleHash ||
						job.agentVersion !== agent.version);
				const needsConfiguration =
					job?.status === "needs_input" && Boolean(agentId);
				if (
					job &&
					!(active && (stale || !agent.enabled || !agent.model)) &&
					!needsConfiguration
				)
					return false;
				const { queueAssignedContributionAgent } = await import(
					"./contribution-service.server"
				);
				await queueAssignedContributionAgent(
					conn,
					item,
					deploymentActor,
					"assignment",
				);
				await saveContribution(conn, item);
				return true;
			});
			scanned++;
			if (changed) queued++;
		}
		cursor = Number(rows[rows.length - 1].number);
	}
	notifyContributionAgentWork();
	return { scanned, queued };
}
