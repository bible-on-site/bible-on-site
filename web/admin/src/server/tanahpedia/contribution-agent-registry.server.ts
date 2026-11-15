import { randomUUID } from "node:crypto";
import type { PoolConnection } from "mysql2/promise";
import { canonicalJson } from "~/lib/canonical-json";
import {
	compareContributionAgentVersions,
	contributionAgentBundleUpgrade,
} from "~/lib/tanahpedia/contribution-agent-versions";
import {
	type ContributionAgentBundle,
	type ContributionAgentProvider,
	type ContributionAgentSummary,
	DEFAULT_AWS_AGENT_ID,
	DEFAULT_LOCAL_AGENT_ID,
	type RegisteredContributionAgent,
} from "~/lib/tanahpedia/contribution-agents";
import {
	type Assignee,
	record,
	textField,
	uuidField,
} from "~/lib/tanahpedia/contributions";
import { txExecute, txQuery, txQueryOne } from "../db";
import { buildContributionAgentBundle } from "./contribution-agent-bundle.server";
import { withContributions } from "./contribution-store.server";

interface AgentRow {
	id: string;
	version: number;
	data: RegisteredContributionAgent | string;
}

function decode(row: AgentRow): RegisteredContributionAgent {
	const data = typeof row.data === "string" ? JSON.parse(row.data) : row.data;
	return { ...data, id: row.id, version: Number(row.version) };
}

function provider(value: unknown): ContributionAgentProvider {
	if (value !== "local_llm" && value !== "aws_llm")
		throw new Error("Invalid agent provider");
	return value;
}

function model(value: unknown): string | null {
	if (value == null) return null;
	const name = textField(value, "agent model", 255);
	for (const character of name) {
		const code = character.charCodeAt(0);
		if (
			!(code >= 48 && code <= 57) &&
			!(code >= 65 && code <= 90) &&
			!(code >= 97 && code <= 122) &&
			!"._:/@-".includes(character)
		) {
			throw new Error("Invalid agent model identifier");
		}
	}
	return name;
}

function defaultModel(kind: ContributionAgentProvider): string | null {
	return kind === "local_llm"
		? process.env.LOCAL_LLM_MODEL?.trim() || "qwen3:8b"
		: process.env.BEDROCK_MODEL_ID?.trim() || null;
}

function summary(
	agent: RegisteredContributionAgent,
	latest = buildContributionAgentBundle(),
): ContributionAgentSummary {
	const { bundle: _bundle, ...rest } = agent;
	const policy = contributionAgentBundleUpgrade(
		{ version: agent.installedVersion, hash: agent.bundleHash },
		latest,
	);
	return {
		...rest,
		latestVersion:
			compareContributionAgentVersions(agent.installedVersion, latest.version) >
			0
				? agent.installedVersion
				: latest.version,
		updateAvailable: policy === "upgrade",
	};
}

async function storeBundle(
	conn: PoolConnection,
	bundle: ContributionAgentBundle,
): Promise<void> {
	await txExecute(
		conn,
		"INSERT IGNORE INTO tanahpedia_contribution_agent_bundle (hash, version, data) VALUES (?, ?, ?)",
		[bundle.hash, bundle.version, canonicalJson(bundle)],
	);
}

async function latestAvailableBundle(
	conn: PoolConnection,
): Promise<ContributionAgentBundle> {
	let latest = buildContributionAgentBundle();
	await storeBundle(conn, latest);
	const rows = await txQuery<{ data: string | ContributionAgentBundle }>(
		conn,
		"SELECT data FROM tanahpedia_contribution_agent_bundle ORDER BY created_at, hash",
	);
	for (const row of rows) {
		const candidate: ContributionAgentBundle =
			typeof row.data === "string" ? JSON.parse(row.data) : row.data;
		if (contributionAgentBundleUpgrade(latest, candidate) === "upgrade")
			latest = candidate;
	}
	return latest;
}

function registration(
	id: string,
	name: string,
	kind: ContributionAgentProvider,
	configuredModel: string | null,
	bundle: ContributionAgentBundle,
	enabled = true,
): RegisteredContributionAgent {
	const now = new Date().toISOString();
	return {
		id,
		version: 1,
		name,
		provider: kind,
		model: configuredModel,
		enabled,
		installedVersion: bundle.version,
		bundleHash: bundle.hash,
		bundle,
		createdAt: now,
		updatedAt: now,
		lastSeenAt: null,
		runtimeVersion: null,
	};
}

async function findAgent(
	conn: PoolConnection,
	id: string,
	lock = false,
): Promise<RegisteredContributionAgent | null> {
	const row = await txQueryOne<AgentRow>(
		conn,
		`SELECT id, version, data FROM tanahpedia_contribution_agent WHERE id = ?${lock ? " FOR UPDATE" : ""}`,
		[id],
	);
	return row ? decode(row) : null;
}

async function ensureDefaults(
	conn: PoolConnection,
): Promise<ContributionAgentBundle> {
	const bundle = await latestAvailableBundle(conn);
	for (const agent of [
		registration(
			DEFAULT_LOCAL_AGENT_ID,
			"Local LLM",
			"local_llm",
			process.env.LOCAL_LLM_MODEL?.trim() || "qwen3:8b",
			bundle,
		),
		registration(
			DEFAULT_AWS_AGENT_ID,
			"AWS LLM",
			"aws_llm",
			process.env.BEDROCK_MODEL_ID?.trim() || null,
			bundle,
		),
	]) {
		await txExecute(
			conn,
			// A duplicate INSERT IGNORE holds a shared row lock. Two startup
			// refreshes would then deadlock while upgrading those locks FOR UPDATE.
			// This no-op upsert acquires an exclusive lock without changing settings.
			"INSERT INTO tanahpedia_contribution_agent (id, version, data) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE id = id",
			[agent.id, agent.version, JSON.stringify(agent)],
		);
	}
	return bundle;
}

export async function getRegisteredContributionAgent(
	conn: PoolConnection,
	id: string,
	lock = false,
): Promise<RegisteredContributionAgent> {
	const agentId = uuidField(id, "agentId");
	let agent = await findAgent(conn, agentId, lock);
	if (
		!agent &&
		[DEFAULT_LOCAL_AGENT_ID, DEFAULT_AWS_AGENT_ID].includes(agentId)
	) {
		await ensureDefaults(conn);
		agent = await findAgent(conn, agentId, lock);
	}
	if (!agent) throw new Error("Registered agent not found");
	return agent;
}

export async function getAssignedContributionAgent(
	conn: PoolConnection,
	assignee: Assignee,
	lock = false,
): Promise<RegisteredContributionAgent> {
	if (assignee.kind !== "local_llm" && assignee.kind !== "aws_llm")
		throw new Error("This item has no agent assignee");
	const id =
		assignee.agentId ??
		(assignee.kind === "local_llm"
			? DEFAULT_LOCAL_AGENT_ID
			: DEFAULT_AWS_AGENT_ID);
	const agent = await getRegisteredContributionAgent(conn, id, lock);
	if (agent.provider !== assignee.kind)
		throw new Error("Agent provider does not match the assignee");
	return agent;
}

export async function readContributionAgentBundle(
	conn: PoolConnection,
	hash: string,
): Promise<ContributionAgentBundle> {
	if (
		typeof hash !== "string" ||
		hash.length !== 64 ||
		[...hash].some((c) => !"0123456789abcdef".includes(c))
	) {
		throw new Error("Invalid agent bundle hash");
	}
	const row = await txQueryOne<{ data: string | ContributionAgentBundle }>(
		conn,
		"SELECT data FROM tanahpedia_contribution_agent_bundle WHERE hash = ?",
		[hash],
	);
	if (!row) throw new Error("Agent instruction/tool bundle not found");
	return typeof row.data === "string" ? JSON.parse(row.data) : row.data;
}

export async function touchContributionAgent(
	conn: PoolConnection,
	id: string,
	runtimeVersion: string,
): Promise<void> {
	await txExecute(
		conn,
		"UPDATE tanahpedia_contribution_agent SET data = JSON_SET(data, '$.lastSeenAt', ?, '$.runtimeVersion', ?) WHERE id = ?",
		[
			new Date().toISOString(),
			textField(runtimeVersion, "agent runtime version", 100),
			uuidField(id, "agentId"),
		],
	);
}

export async function listContributionAgents(): Promise<
	ContributionAgentSummary[]
> {
	return withContributions(async (conn) => {
		const latest = await ensureDefaults(conn);
		return (
			await txQuery<AgentRow>(
				conn,
				"SELECT id, version, data FROM tanahpedia_contribution_agent ORDER BY created_at, id",
			)
		).map((row) => summary(decode(row), latest));
	});
}

export async function installRegisteredContributionAgent(
	raw: unknown,
): Promise<ContributionAgentSummary> {
	const input = record(raw);
	const name = textField(input.name, "agent name", 120);
	const kind = provider(input.provider),
		configuredModel = model(input.model) ?? defaultModel(kind);
	if (input.enabled !== undefined && typeof input.enabled !== "boolean")
		throw new Error("Invalid enabled flag");
	return withContributions(async (conn) => {
		const bundle = await latestAvailableBundle(conn);
		const agent = registration(
			randomUUID(),
			name,
			kind,
			configuredModel,
			bundle,
			input.enabled !== false,
		);
		await txExecute(
			conn,
			"INSERT INTO tanahpedia_contribution_agent (id, version, data) VALUES (?, ?, ?)",
			[agent.id, agent.version, JSON.stringify(agent)],
		);
		return summary(agent, bundle);
	});
}

export async function updateRegisteredContributionAgent(
	raw: unknown,
): Promise<ContributionAgentSummary> {
	const input = record(raw),
		id = uuidField(input.id, "agentId");
	if (input.action !== "upgrade" && input.action !== "configure")
		throw new Error("Invalid agent update action");
	return withContributions(async (conn) => {
		// All writers acquire immutable bundle keys before agent rows, including
		// deployment/default seeding. The inverse order can deadlock on first CD.
		const available = await latestAvailableBundle(conn);
		const agent = await findAgent(conn, id, true);
		if (!agent) throw new Error("Registered agent not found");
		if (!Number.isSafeInteger(input.version) || input.version !== agent.version)
			throw new Error(
				"The agent configuration changed. Reload before retrying.",
			);
		const before = canonicalJson({
			name: agent.name,
			model: agent.model,
			enabled: agent.enabled,
			bundleHash: agent.bundleHash,
		});
		if (input.action === "configure") {
			if (input.name !== undefined)
				agent.name = textField(input.name, "agent name", 120);
			if (input.model !== undefined)
				agent.model = model(input.model) ?? defaultModel(agent.provider);
			if (input.enabled !== undefined) {
				if (typeof input.enabled !== "boolean")
					throw new Error("Invalid enabled flag");
				agent.enabled = input.enabled;
			}
		} else if (
			contributionAgentBundleUpgrade(
				{ version: agent.installedVersion, hash: agent.bundleHash },
				available,
			) === "upgrade"
		) {
			agent.bundle = available;
			agent.installedVersion = agent.bundle.version;
			agent.bundleHash = agent.bundle.hash;
		}
		if (
			before ===
			canonicalJson({
				name: agent.name,
				model: agent.model,
				enabled: agent.enabled,
				bundleHash: agent.bundleHash,
			})
		)
			return summary(agent, available);
		const previous = agent.version;
		agent.version++;
		agent.updatedAt = new Date().toISOString();
		const changed = await txExecute(
			conn,
			"UPDATE tanahpedia_contribution_agent SET version = ?, data = ? WHERE id = ? AND version = ?",
			[agent.version, JSON.stringify(agent), agent.id, previous],
		);
		if (changed.affectedRows !== 1)
			throw new Error(
				"The agent configuration changed. Reload before retrying.",
			);
		return summary(agent, available);
	});
}

/** Deployment refreshes immutable declarations; provider/model choices are kept. */
export async function refreshRegisteredContributionAgents(): Promise<{
	updated: number;
	unchanged: number;
}> {
	return withContributions(async (conn) => {
		const latest = await ensureDefaults(conn);
		let updated = 0,
			unchanged = 0;
		const rows = await txQuery<AgentRow>(
			conn,
			"SELECT id, version, data FROM tanahpedia_contribution_agent ORDER BY id FOR UPDATE",
		);
		for (const row of rows) {
			const agent = decode(row);
			if (
				contributionAgentBundleUpgrade(
					{ version: agent.installedVersion, hash: agent.bundleHash },
					latest,
				) !== "upgrade"
			) {
				unchanged++;
				continue;
			}
			agent.bundle = latest;
			agent.bundleHash = latest.hash;
			agent.installedVersion = latest.version;
			agent.version++;
			agent.updatedAt = new Date().toISOString();
			const changed = await txExecute(
				conn,
				"UPDATE tanahpedia_contribution_agent SET version = ?, data = ? WHERE id = ? AND version = ?",
				[agent.version, JSON.stringify(agent), agent.id, row.version],
			);
			if (changed.affectedRows !== 1)
				throw new Error(
					"Agent release update conflicted; retry the deployment",
				);
			updated++;
		}
		return { updated, unchanged };
	});
}
