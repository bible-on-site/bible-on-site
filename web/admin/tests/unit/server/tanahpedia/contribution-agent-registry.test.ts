import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	DEFAULT_AWS_AGENT_ID,
	DEFAULT_LOCAL_AGENT_ID,
	type RegisteredContributionAgent,
} from "~/lib/tanahpedia/contribution-agents";

const mocks = vi.hoisted(() => ({
	one: vi.fn(),
	rows: vi.fn(),
	bundleRows: vi.fn(),
	execute: vi.fn(),
	conn: {},
	bundle: {
		protocolVersion: 2,
		version: "tanahpedia-agents-v2",
		hash: "a".repeat(64),
		apiVersion: 4,
		system: "instructions",
		operationGuide: [],
		tools: [],
	},
}));
vi.mock("~/server/db", () => ({
	txQueryOne: mocks.one,
	txQuery: (...args: unknown[]) =>
		String(args[1]).includes("FROM tanahpedia_contribution_agent_bundle")
			? mocks.bundleRows(...args)
			: mocks.rows(...args),
	txExecute: mocks.execute,
}));
vi.mock("~/server/tanahpedia/contribution-store.server", () => ({
	withContributions: (fn: (conn: object) => unknown) => fn(mocks.conn),
}));
vi.mock("~/server/tanahpedia/contribution-agent-bundle.server", () => ({
	buildContributionAgentBundle: () => structuredClone(mocks.bundle),
}));

import {
	getAssignedContributionAgent,
	getRegisteredContributionAgent,
	installRegisteredContributionAgent,
	listContributionAgents,
	readContributionAgentBundle,
	refreshRegisteredContributionAgents,
	touchContributionAgent,
	updateRegisteredContributionAgent,
} from "~/server/tanahpedia/contribution-agent-registry.server";

function agent(
	overrides: Partial<RegisteredContributionAgent> = {},
): RegisteredContributionAgent {
	return {
		id: DEFAULT_LOCAL_AGENT_ID,
		version: 3,
		name: "Local reviewer",
		provider: "local_llm",
		model: "qwen3:8b",
		enabled: true,
		installedVersion: mocks.bundle.version,
		bundleHash: mocks.bundle.hash,
		bundle: structuredClone(
			mocks.bundle,
		) as RegisteredContributionAgent["bundle"],
		createdAt: "2026-11-15T00:00:00Z",
		updatedAt: "2026-11-15T00:00:00Z",
		lastSeenAt: null,
		runtimeVersion: null,
		...overrides,
	};
}
const row = (value = agent(), serialized = false) => ({
	id: value.id,
	version: value.version,
	data: serialized ? JSON.stringify(value) : value,
});

beforeEach(() => {
	vi.clearAllMocks();
	mocks.one.mockResolvedValue(row());
	mocks.rows.mockResolvedValue([]);
	mocks.bundleRows.mockResolvedValue([]);
	mocks.execute.mockResolvedValue({ affectedRows: 1 });
	vi.stubEnv("LOCAL_LLM_MODEL", "");
	vi.stubEnv("BEDROCK_MODEL_ID", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("registered agent configuration and immutable declarations", () => {
	it("lists registrations without shipping static bundles, retaining authoritative versions and update availability", async () => {
		mocks.rows.mockResolvedValue([
			row(
				agent({
					bundleHash: "b".repeat(64),
					installedVersion: "tanahpedia-agents-v1",
				}),
				true,
			),
			row(
				agent({ id: DEFAULT_AWS_AGENT_ID, provider: "aws_llm", model: null }),
			),
		]);
		const list = await listContributionAgents();
		expect(list).toHaveLength(2);
		expect(list[0]).toMatchObject({
			version: 3,
			latestVersion: mocks.bundle.version,
			updateAvailable: true,
		});
		expect(list[1]).toMatchObject({
			provider: "aws_llm",
			model: null,
			updateAvailable: false,
		});
		expect(list[0]).not.toHaveProperty("bundle");
		expect(
			mocks.execute.mock.calls.filter((call) =>
				call[1].includes("ON DUPLICATE KEY UPDATE id = id"),
			),
		).toHaveLength(2);
	});
	it.each([
		["local_llm", null, "qwen3:8b"],
		["aws_llm", null, null],
		["local_llm", "custom/agent:Q4_K_M", "custom/agent:Q4_K_M"],
		["aws_llm", "us.vendor.model:0", "us.vendor.model:0"],
	])(
		"installs %s configuration with its model/default",
		async (provider, model, expected) => {
			const installed = await installRegisteredContributionAgent({
				name: "סוכן",
				provider,
				model,
			});
			expect(installed).toMatchObject({
				name: "סוכן",
				provider,
				model: expected,
				enabled: true,
				version: 1,
				installedVersion: mocks.bundle.version,
			});
			expect(installed.id).toMatch(/^[0-9a-f-]{36}$/);
			expect(mocks.execute.mock.calls[0][1]).toContain("agent_bundle");
			expect(mocks.execute.mock.calls[1][1]).toContain(
				"INSERT INTO tanahpedia_contribution_agent ",
			);
		},
	);
	it("uses configured provider defaults without exposing credentials", async () => {
		vi.stubEnv("LOCAL_LLM_MODEL", "local:latest");
		vi.stubEnv("BEDROCK_MODEL_ID", "configured:model");
		expect(
			(
				await installRegisteredContributionAgent({
					name: "Local",
					provider: "local_llm",
					model: null,
					enabled: false,
				})
			).model,
		).toBe("local:latest");
		expect(
			(
				await installRegisteredContributionAgent({
					name: "AWS",
					provider: "aws_llm",
					model: null,
				})
			).model,
		).toBe("configured:model");
	});
	it.each([
		{ name: "", provider: "local_llm", model: "qwen3:8b" },
		{ name: "Agent", provider: "human", model: "model" },
		{ name: "Agent", provider: "local_llm", model: "bad model" },
		{ name: "Agent", provider: "local_llm", model: "bad;command" },
		{ name: "Agent", provider: "local_llm", model: "mod\nel" },
		{ name: "Agent", provider: "local_llm", model: 123 },
		{ name: "Agent", provider: "local_llm", model: "model", enabled: "true" },
	])("rejects invalid installation before storage: %j", async (input) => {
		await expect(installRegisteredContributionAgent(input)).rejects.toThrow();
		expect(mocks.execute).not.toHaveBeenCalled();
	});
	it("reads native/string JSON but trusts scalar row identity/version", async () => {
		mocks.one.mockResolvedValue({
			id: DEFAULT_LOCAL_AGENT_ID,
			version: 7,
			data: JSON.stringify(agent({ version: 1 })),
		});
		expect(
			await getRegisteredContributionAgent(
				mocks.conn as never,
				DEFAULT_LOCAL_AGENT_ID,
			),
		).toMatchObject({ version: 7, id: DEFAULT_LOCAL_AGENT_ID });
	});
	it("lazily registers built-ins while preserving any existing configuration", async () => {
		mocks.one.mockResolvedValueOnce(null).mockResolvedValueOnce(row());
		expect(
			(
				await getRegisteredContributionAgent(
					mocks.conn as never,
					DEFAULT_LOCAL_AGENT_ID,
				)
			).model,
		).toBe("qwen3:8b");
		expect(
			mocks.execute.mock.calls.every(
				(call) =>
					call[1].startsWith("INSERT IGNORE") ||
					call[1].endsWith("ON DUPLICATE KEY UPDATE id = id"),
			),
		).toBe(true);
	});
	it("rejects missing agents and invalid IDs", async () => {
		mocks.one.mockResolvedValue(null);
		await expect(
			getRegisteredContributionAgent(
				mocks.conn as never,
				"10000000-0000-4000-8000-000000000001",
			),
		).rejects.toThrow("not found");
		await expect(
			getRegisteredContributionAgent(
				mocks.conn as never,
				DEFAULT_LOCAL_AGENT_ID,
			),
		).rejects.toThrow("not found");
		await expect(
			getRegisteredContributionAgent(mocks.conn as never, "bad"),
		).rejects.toThrow();
	});
	it("resolves legacy defaults and explicit registrations without crossing providers", async () => {
		expect(
			(
				await getAssignedContributionAgent(mocks.conn as never, {
					kind: "local_llm",
				})
			).id,
		).toBe(DEFAULT_LOCAL_AGENT_ID);
		mocks.one.mockResolvedValue(
			row(agent({ id: DEFAULT_AWS_AGENT_ID, provider: "aws_llm" })),
		);
		expect(
			(
				await getAssignedContributionAgent(mocks.conn as never, {
					kind: "aws_llm",
					agentId: DEFAULT_AWS_AGENT_ID,
				})
			).provider,
		).toBe("aws_llm");
		await expect(
			getAssignedContributionAgent(mocks.conn as never, { kind: "local_llm" }),
		).rejects.toThrow("provider");
		await expect(
			getAssignedContributionAgent(mocks.conn as never, {
				kind: "human",
				id: "owner",
				name: "Owner",
			}),
		).rejects.toThrow("no agent");
	});
	it("loads retained bundles by hash and rejects missing or malformed identities", async () => {
		mocks.one
			.mockResolvedValueOnce({ data: JSON.stringify(mocks.bundle) })
			.mockResolvedValueOnce({ data: mocks.bundle })
			.mockResolvedValueOnce(null);
		expect(
			await readContributionAgentBundle(mocks.conn as never, mocks.bundle.hash),
		).toEqual(mocks.bundle);
		expect(
			await readContributionAgentBundle(mocks.conn as never, mocks.bundle.hash),
		).toEqual(mocks.bundle);
		await expect(
			readContributionAgentBundle(mocks.conn as never, mocks.bundle.hash),
		).rejects.toThrow("not found");
		for (const hash of ["bad", "g".repeat(64), "A".repeat(64)])
			await expect(
				readContributionAgentBundle(mocks.conn as never, hash),
			).rejects.toThrow("Invalid");
	});
	it("heartbeat changes runtime metadata without invalidating configuration versions", async () => {
		await touchContributionAgent(
			mocks.conn as never,
			DEFAULT_LOCAL_AGENT_ID,
			"worker-v2",
		);
		const call = mocks.execute.mock.calls[0];
		expect(call[1]).toContain("JSON_SET");
		expect(call[1]).not.toContain("version =");
		expect(call[2][1]).toBe("worker-v2");
	});
	it("updates model/configuration with an optimistic lock, preserving instructions", async () => {
		const updated = await updateRegisteredContributionAgent({
			id: DEFAULT_LOCAL_AGENT_ID,
			version: 3,
			action: "configure",
			name: "New",
			model: "other:8b",
			enabled: false,
		});
		expect(updated).toMatchObject({
			version: 4,
			name: "New",
			model: "other:8b",
			enabled: false,
			bundleHash: mocks.bundle.hash,
		});
		expect(
			mocks.execute.mock.calls
				.find((call) => call[1].startsWith("UPDATE"))?.[2]
				.slice(-2),
		).toEqual([DEFAULT_LOCAL_AGENT_ID, 3]);
	});
	it("null configuration chooses the provider default and an unchanged save keeps the active version", async () => {
		expect(
			(
				await updateRegisteredContributionAgent({
					id: DEFAULT_LOCAL_AGENT_ID,
					version: 3,
					action: "configure",
					model: null,
				})
			).version,
		).toBe(3);
		expect(
			mocks.execute.mock.calls.some((call) => call[1].startsWith("UPDATE")),
		).toBe(false);
	});
	it("upgrades declarations while retaining old bundle rows and all model choices", async () => {
		mocks.one.mockResolvedValue(
			row(
				agent({
					bundleHash: "b".repeat(64),
					installedVersion: "tanahpedia-agents-v1",
				}),
			),
		);
		expect(
			await updateRegisteredContributionAgent({
				id: DEFAULT_LOCAL_AGENT_ID,
				version: 3,
				action: "upgrade",
			}),
		).toMatchObject({
			version: 4,
			bundleHash: mocks.bundle.hash,
			model: "qwen3:8b",
		});
		expect(mocks.execute.mock.calls[0][1]).toContain("INSERT IGNORE");
		expect(
			mocks.execute.mock.calls.some((call) => call[1].includes("DELETE")),
		).toBe(false);
	});
	it("idempotent latest upgrade retains its configuration version", async () => {
		expect(
			(
				await updateRegisteredContributionAgent({
					id: DEFAULT_LOCAL_AGENT_ID,
					version: 3,
					action: "upgrade",
				})
			).version,
		).toBe(3);
		expect(mocks.execute).toHaveBeenCalledTimes(1);
	});
	it("rejects stale/missing configurations, malformed changes and lost compare-and-set", async () => {
		await expect(
			updateRegisteredContributionAgent({
				id: DEFAULT_LOCAL_AGENT_ID,
				version: 1,
				action: "configure",
			}),
		).rejects.toThrow("changed");
		await expect(
			updateRegisteredContributionAgent({
				id: DEFAULT_LOCAL_AGENT_ID,
				version: 3,
				action: "delete",
			}),
		).rejects.toThrow("action");
		await expect(
			updateRegisteredContributionAgent({
				id: DEFAULT_LOCAL_AGENT_ID,
				version: 3,
				action: "configure",
				enabled: 1,
			}),
		).rejects.toThrow("enabled");
		mocks.one.mockResolvedValueOnce(null);
		await expect(
			updateRegisteredContributionAgent({
				id: DEFAULT_LOCAL_AGENT_ID,
				version: 3,
				action: "upgrade",
			}),
		).rejects.toThrow("not found");
		mocks.execute.mockResolvedValue({ affectedRows: 0 });
		await expect(
			updateRegisteredContributionAgent({
				id: DEFAULT_LOCAL_AGENT_ID,
				version: 3,
				action: "configure",
				name: "New",
			}),
		).rejects.toThrow("changed");
	});
	it("CD refreshes only outdated declarations and preserves provider/model/state", async () => {
		mocks.rows.mockResolvedValue([
			row(),
			row(
				agent({
					id: DEFAULT_AWS_AGENT_ID,
					provider: "aws_llm",
					model: "selected:model",
					bundleHash: "b".repeat(64),
					installedVersion: "tanahpedia-agents-v1",
					enabled: false,
				}),
			),
		]);
		expect(await refreshRegisteredContributionAgents()).toEqual({
			updated: 1,
			unchanged: 1,
		});
		const update = mocks.execute.mock.calls.find((call) =>
			call[1].startsWith("UPDATE"),
		);
		expect(JSON.parse(update?.[2][3])).toMatchObject({
			provider: "aws_llm",
			model: "selected:model",
			enabled: false,
			version: 4,
			bundleHash: mocks.bundle.hash,
		});
	});
	it("batches multiple release upgrades with independent expected versions in one write", async () => {
		const old = {
			installedVersion: "tanahpedia-agents-v1",
			bundleHash: "b".repeat(64),
		};
		mocks.rows.mockResolvedValue([
			row(agent(old)),
			row(
				agent({
					...old,
					id: DEFAULT_AWS_AGENT_ID,
					version: 7,
					provider: "aws_llm",
					model: "chosen:model",
					enabled: false,
				}),
			),
		]);
		mocks.execute.mockImplementation(async (_conn, sql) => ({
			affectedRows: sql.startsWith("UPDATE") ? 2 : 1,
		}));
		expect(await refreshRegisteredContributionAgents()).toEqual({
			updated: 2,
			unchanged: 0,
		});
		const writes = mocks.execute.mock.calls.filter((call) =>
			call[1].startsWith("UPDATE"),
		);
		expect(writes).toHaveLength(1);
		const args = writes[0][2];
		expect(args.slice(0, 4)).toEqual([
			DEFAULT_LOCAL_AGENT_ID,
			4,
			DEFAULT_AWS_AGENT_ID,
			8,
		]);
		expect(JSON.parse(args[7])).toMatchObject({
			model: "chosen:model",
			enabled: false,
			version: 8,
			bundleHash: mocks.bundle.hash,
		});
		expect(args.slice(8)).toEqual([
			DEFAULT_LOCAL_AGENT_ID,
			3,
			DEFAULT_AWS_AGENT_ID,
			7,
		]);
	});
	it("fails a deployment refresh when an expected registration write does not commit", async () => {
		mocks.rows.mockResolvedValue([
			row(
				agent({
					bundleHash: "b".repeat(64),
					installedVersion: "tanahpedia-agents-v1",
				}),
			),
		]);
		mocks.execute.mockImplementation(async (_conn, sql) => ({
			affectedRows: sql.startsWith("UPDATE") ? 0 : 1,
		}));
		await expect(refreshRegisteredContributionAgents()).rejects.toThrow(
			"conflicted",
		);
	});
	it("older processes retain newer registrations and install from the newest retained release", async () => {
		const newer = {
			...mocks.bundle,
			version: "tanahpedia-agents-v4",
			apiVersion: 5,
			tools: [
				{
					name: "article_text",
					description: "Read current article pages",
					inputSchema: { type: "object" },
				},
			],
			hash: "c".repeat(64),
		};
		mocks.bundleRows.mockResolvedValue([
			{ data: JSON.stringify(newer) },
			{ data: mocks.bundle },
		]);
		mocks.rows.mockResolvedValue([
			row(agent({ installedVersion: newer.version, bundleHash: newer.hash })),
		]);
		expect(await refreshRegisteredContributionAgents()).toEqual({
			updated: 0,
			unchanged: 1,
		});
		expect(
			mocks.execute.mock.calls.some((call) => call[1].startsWith("UPDATE")),
		).toBe(false);
		expect(
			await installRegisteredContributionAgent({
				name: "New",
				provider: "local_llm",
				model: null,
			}),
		).toMatchObject({
			installedVersion: newer.version,
			latestVersion: newer.version,
			bundleHash: newer.hash,
		});
		mocks.one.mockResolvedValue(
			row(agent({ installedVersion: newer.version, bundleHash: newer.hash })),
		);
		expect(
			await updateRegisteredContributionAgent({
				id: DEFAULT_LOCAL_AGENT_ID,
				version: 3,
				action: "upgrade",
			}),
		).toMatchObject({
			version: 3,
			installedVersion: newer.version,
			updateAvailable: false,
		});
	});
	it("a newer declaration hidden by an older read snapshot still cannot downgrade the locked registration", async () => {
		mocks.one.mockResolvedValue(
			row(
				agent({
					installedVersion: "tanahpedia-agents-v3",
					bundleHash: "c".repeat(64),
				}),
			),
		);
		expect(
			await updateRegisteredContributionAgent({
				id: DEFAULT_LOCAL_AGENT_ID,
				version: 3,
				action: "upgrade",
			}),
		).toMatchObject({
			version: 3,
			latestVersion: "tanahpedia-agents-v3",
			updateAvailable: false,
		});
		expect(
			mocks.execute.mock.calls.some((call) => call[1].startsWith("UPDATE")),
		).toBe(false);
	});
	it("conflicting bytes for a reused release version fail before changing registrations", async () => {
		mocks.bundleRows.mockResolvedValue([
			{ data: { ...mocks.bundle, hash: "b".repeat(64) } },
		]);
		await expect(refreshRegisteredContributionAgents()).rejects.toThrow(
			"reused",
		);
		await expect(
			installRegisteredContributionAgent({
				name: "New",
				provider: "local_llm",
				model: null,
			}),
		).rejects.toThrow("reused");
		expect(
			mocks.execute.mock.calls.some((call) => call[1].startsWith("UPDATE")),
		).toBe(false);
	});
	it("final lease validation can retain its registration row lock through the content transaction", async () => {
		await getAssignedContributionAgent(
			mocks.conn as never,
			{ kind: "local_llm" },
			true,
		);
		expect(mocks.one.mock.calls[0][1]).toContain("FOR UPDATE");
	});
});
