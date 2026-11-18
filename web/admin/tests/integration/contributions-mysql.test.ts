import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import mysql, {
	type Connection,
	type PoolConnection,
	type RowDataPacket,
} from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { canonicalJson } from "~/lib/canonical-json";
import { DEFAULT_LOCAL_AGENT_ID } from "~/lib/tanahpedia/contribution-agents";
import { CONTRIBUTION_API_VERSION } from "~/lib/tanahpedia/contribution-api";
import {
	CONTRIBUTION_RECORDS,
	type ContributionRecordKind,
} from "~/lib/tanahpedia/contribution-records";
import type {
	ChangeInput,
	ChangeState,
	Contribution,
	Contributor,
} from "~/lib/tanahpedia/contributions";
import {
	contributionHasEffect,
	reviewStatus,
} from "~/lib/tanahpedia/contributions";
import {
	FAMILY_PARENT_CHILD_RELATIONSHIP_TYPES,
	FAMILY_PARENT_ROLES,
	FAMILY_UNION_END_REASONS,
	FAMILY_UNION_TYPES,
} from "~/server/tanahpedia/family-api-spec";

vi.mock("@tanstack/react-start/server-only", () => ({}));
vi.mock("@tanstack/react-start", () => ({
	createServerOnlyFn: (fn: unknown) => fn,
	createServerFn: () => ({
		validator: () => ({ handler: (fn: unknown) => fn }),
		handler: (fn: unknown) => fn,
	}),
}));
vi.mock("~/server/website-revalidate", () => ({
	revalidateWebsite: vi.fn().mockResolvedValue(undefined),
	pediaInvalidation: vi.fn().mockReturnValue([{ type: "pedia" }]),
}));
vi.mock("~/server/tanahpedia/paths", () => ({
	pediaChangesForPersons: vi.fn().mockResolvedValue([]),
	pediaChangesForEntities: vi.fn().mockResolvedValue([]),
	pediaChangesForEntryIds: vi.fn().mockResolvedValue([]),
}));

const schema = `contribution_test_${randomUUID().replace(/-/g, "")}`;
const alice: Contributor = {
	id: "alice",
	name: "Alice",
	kind: "human",
	isDoradsoft: false,
};
const owner: Contributor = {
	id: "owner",
	name: "doradsoft",
	kind: "human",
	isDoradsoft: true,
};
const bot: Contributor = {
	id: "local:test-model",
	name: "test-model",
	kind: "local_llm",
	isDoradsoft: false,
};
const evidence = [
	{ citation: "מקור בדיקה", quote: "ציטוט לבדיקה בלבד", url: null, note: "" },
];
let conn: Connection;
let service: typeof import("~/server/tanahpedia/contribution-service.server");
let store: typeof import("~/server/tanahpedia/contribution-store.server");
let db: typeof import("~/server/db");
let worker: typeof import("~/server/tanahpedia/contribution-worker.server");
let registry: typeof import("~/server/tanahpedia/contribution-agent-registry.server");
let created = false;
const recordRefs: Record<string, string | number> = {};
let otherEntry: string;
const ids = {
	person: randomUUID(),
	parent: randomUUID(),
	entity: randomUUID(),
	parentEntity: randomUUID(),
	place: randomUUID(),
	placeEntity: randomUUID(),
};

beforeAll(async () => {
	const configured = new URL(
		process.env.CONTRIBUTION_MYSQL_TEST_DB_URL ??
			process.env.BULLETIN_MYSQL_TEST_DB_URL ??
			"mysql://root:test_123@localhost:3306/",
	);
	if (
		configured.protocol !== "mysql:" ||
		!["localhost", "127.0.0.1", "[::1]"].includes(configured.hostname)
	)
		throw new Error("Contribution integration tests require loopback MySQL");
	conn = await mysql.createConnection({
		host: configured.hostname,
		port: Number(configured.port || 3306),
		user: decodeURIComponent(configured.username),
		password: decodeURIComponent(configured.password),
		multipleStatements: true,
	});
	await conn.query(
		`CREATE DATABASE \`${schema}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
	);
	created = true;
	await conn.query(`USE \`${schema}\``);
	// Only these canonical tables participate in the workflow. Creating the whole
	// corpus schema here caused unnecessary DDL contention with the E2E bootstrap.
	const needed = new Set([
		"tanahpedia_entity",
		"tanahpedia_entry",
		"tanahpedia_entry_revision",
		"tanahpedia_entry_entity",
		"tanahpedia_person",
		"tanahpedia_person_name",
		"tanahpedia_person_sex",
		"tanahpedia_person_birth_date",
		"tanahpedia_person_death_date",
		"tanahpedia_lookup_name_type",
		"tanahpedia_person_parent_child",
		"tanahpedia_lookup_parent_child_type",
		"tanahpedia_lookup_parent_role",
		"tanahpedia_person_union",
		"tanahpedia_lookup_union_type",
		"tanahpedia_lookup_union_end_reason",
		"tanahpedia_place",
		"tanahpedia_place_identification",
		"tanahpedia_event",
		"tanahpedia_war",
		"tanahpedia_animal",
		"tanahpedia_object",
		"tanahpedia_temple_tool",
		"tanahpedia_plant",
		"tanahpedia_astronomical_object",
		"tanahpedia_saying",
		"tanahpedia_sefer",
		"tanahpedia_prophecy",
		"tanahpedia_nation",
	]);
	for (const spec of Object.values(CONTRIBUTION_RECORDS))
		needed.add(spec.table);
	for (const table of [
		"tanahpedia_god",
		"tanahpedia_source_group",
		"tanahpedia_tanah_source",
		"tanahpedia_non_tanah_source",
		"tanahpedia_entry_synonym",
		"tanahpedia_entry_synonym_disambiguation",
		"tanah_sefer",
		"tanah_perek",
		"tanah_additional",
		"tanah_perek_date",
		"parshan",
		"perush",
	])
		needed.add(table);
	const canonical = readFileSync(
		new URL("../../../../data/mysql/tanahpedia_structure.sql", import.meta.url),
		"utf8",
	);
	const referenceDDL = ["tanah_static_structure.sql", "perushim_structure.sql"]
		.map((file) =>
			readFileSync(
				new URL(`../../../../data/mysql/${file}`, import.meta.url),
				"utf8",
			),
		)
		.join("\n");
	await conn.query("SET FOREIGN_KEY_CHECKS = 0");
	for (const match of (canonical + referenceDDL).matchAll(
		/CREATE TABLE (?:IF NOT EXISTS )?`([^`]+)` \([\s\S]*?\) ENGINE[^;]*;/g,
	)) {
		// nosemgrep: javascript.lang.security.audit.db.formatted-sql-string, node-mysql-sqli -- DDL comes only from fixed repository schema files in a disposable loopback database.
		if (needed.delete(match[1])) await conn.query(match[0]);
	}
	if (needed.size)
		throw new Error(
			`Canonical workflow tables missing: ${[...needed].join(", ")}`,
		);
	const chapterView = referenceDDL.match(
		/CREATE VIEW `tanah_perek_view` AS[\s\S]*?;/,
	)?.[0];
	if (!chapterView) throw new Error("Missing canonical chapter view");
	// nosemgrep: javascript.lang.security.audit.db.formatted-sql-string, node-mysql-sqli -- fixed canonical view parsed from the repository schema, never request data.
	await conn.query(chapterView);
	await conn.query("SET FOREIGN_KEY_CHECKS = 1");
	for (const [table, names] of [
		[
			"tanahpedia_lookup_parent_child_type",
			FAMILY_PARENT_CHILD_RELATIONSHIP_TYPES,
		],
		["tanahpedia_lookup_parent_role", FAMILY_PARENT_ROLES],
		["tanahpedia_lookup_union_type", FAMILY_UNION_TYPES],
		["tanahpedia_lookup_union_end_reason", FAMILY_UNION_END_REASONS],
		["tanahpedia_lookup_name_type", ["MAIN", "ADDITIONAL", "NICKNAME"]],
	] as const)
		for (const name of names)
			await conn.execute(`INSERT INTO ${table} (id, name) VALUES (?, ?)`, [
				randomUUID(),
				name,
			]);
	await conn.execute(
		"INSERT INTO tanahpedia_entity (id, entity_type, name) VALUES (?, 'PERSON', 'ילד בדיקה'), (?, 'PERSON', 'הורה בדיקה'), (?, 'PLACE', 'מקום בדיקה')",
		[ids.entity, ids.parentEntity, ids.placeEntity],
	);
	await conn.execute(
		"INSERT INTO tanahpedia_person (id, entity_id) VALUES (?, ?), (?, ?)",
		[ids.person, ids.entity, ids.parent, ids.parentEntity],
	);
	await conn.execute(
		"INSERT INTO tanahpedia_place (id, entity_id) VALUES (?, ?)",
		[ids.place, ids.placeEntity],
	);

	Object.assign(recordRefs, {
		person: ids.person,
		place: ids.place,
		entity: ids.entity,
		perek: 1,
		tanah_sefer: 1,
		perush: 1,
	});
	await conn.query(
		"INSERT INTO tanah_sefer (id,name,perek_id_from,perek_id_to) VALUES (1,'בראשית',1,1); INSERT INTO tanah_perek (id,perek,pasuk_count) VALUES (1,1,31); INSERT INTO parshan (id,name) VALUES (1,'פרשן בדיקה'); INSERT INTO perush (id,name,parshan_id) VALUES (1,'פירוש בדיקה',1)",
	);
	for (const kind of [
		"nation",
		"event",
		"war",
		"animal",
		"plant",
		"astronomical_object",
		"sefer",
		"saying",
		"prophecy",
	]) {
		const entity = randomUUID(),
			id = randomUUID();
		recordRefs[kind] = id;
		await conn.execute(
			"INSERT INTO tanahpedia_entity (id,entity_type,name) VALUES (?,?,?)",
			[entity, kind.toUpperCase(), `יישות בדיקה ${kind}`],
		);
		if (kind === "war" || kind === "prophecy") {
			const parent = randomUUID(),
				parentKind = kind === "war" ? "event" : "saying",
				key = kind === "war" ? "event_id" : "saying_id";
			await conn.execute(
				`INSERT INTO tanahpedia_${parentKind} (id,entity_id) VALUES (?,?)`,
				[parent, entity],
			);
			await conn.execute(
				`INSERT INTO tanahpedia_${kind} (id,entity_id,${key}) VALUES (?,?,?)`,
				[id, entity, parent],
			);
		} else
			await conn.execute(
				`INSERT INTO tanahpedia_${kind} (id,entity_id) VALUES (?,?)`,
				[id, entity],
			);
	}
	recordRefs.source_nation = randomUUID();
	const sourceNationEntity = randomUUID();
	await conn.execute(
		"INSERT INTO tanahpedia_entity (id,entity_type,name) VALUES (?,'NATION','עם מקור בדיקה')",
		[sourceNationEntity],
	);
	await conn.execute(
		"INSERT INTO tanahpedia_nation (id,entity_id) VALUES (?,?)",
		[recordRefs.source_nation, sourceNationEntity],
	);
	const rolePerson = randomUUID(),
		roleEntity = randomUUID();
	await conn.execute(
		"INSERT INTO tanahpedia_entity (id,entity_type,name) VALUES (?,'PERSON','מלך בדיקה')",
		[roleEntity],
	);
	await conn.execute(
		"INSERT INTO tanahpedia_person (id,entity_id) VALUES (?,?)",
		[rolePerson, roleEntity],
	);
	recordRefs.king_role = randomUUID();
	recordRefs.person_name = randomUUID();
	recordRefs.war_side = randomUUID();
	recordRefs.god = randomUUID();
	recordRefs.entry = randomUUID();
	otherEntry = randomUUID();
	await conn.execute(
		"INSERT INTO tanahpedia_person_role_king (id,person_id) VALUES (?,?)",
		[recordRefs.king_role, rolePerson],
	);
	await conn.execute(
		"INSERT INTO tanahpedia_person_name (id,person_id,name,name_type_id) SELECT ?,?,'מלך בדיקה',id FROM tanahpedia_lookup_name_type WHERE name='MAIN'",
		[recordRefs.person_name, rolePerson],
	);
	await conn.execute(
		"INSERT INTO tanahpedia_war_side (id,war_id,side_number) VALUES (?,?,99)",
		[recordRefs.war_side, recordRefs.war],
	);
	await conn.execute("INSERT INTO tanahpedia_god (id) VALUES (?)", [
		recordRefs.god,
	]);
	await conn.execute(
		"INSERT INTO tanahpedia_entry (id,title,unique_name,content) VALUES (?,'ערך בדיקה','ערך-בדיקה','<p>fixture</p>'),(?,'ערך אחר','ערך-אחר','<p>fixture</p>')",
		[recordRefs.entry, otherEntry],
	);
	configured.pathname = `/${schema}`;
	configured.searchParams.set("ssl-mode", "DISABLED");
	vi.stubEnv("DB_URL", configured.href);
	db = await import("~/server/db");
	service = await import("~/server/tanahpedia/contribution-service.server");
	store = await import("~/server/tanahpedia/contribution-store.server");
	await store.ensureContributionSchema();
	registry = await import(
		"~/server/tanahpedia/contribution-agent-registry.server"
	);
});

describe("pre-upgrade workstation generation with actual MySQL transactions", () => {
	async function queued() {
		worker ??= await import("~/server/tanahpedia/contribution-worker.server");
		const item = await service.createContribution(
			{
				kind: "issue",
				title: "בקשה להפקת מטא-נתונים",
				description: "נדרש ערך חדש עם מטא-נתונים בלבד, ללא גוף טקסט.",
				assignee: { kind: "unassigned" },
				evidence,
			},
			alice,
		);
		// Reproduce an assignment persisted by the old release, which had no
		// automatic task/bundle metadata. Modern assignments use the v2 cases.
		const legacy = await store.withContributions(async (tx) => {
			const saved = await store.readContribution(tx, item.id, true);
			saved.assignee = { kind: "local_llm" };
			service.addEvent(saved, alice, "assigned", "Local LLM");
			return store.saveContribution(tx, saved);
		});
		return service.updateContribution(
			{ id: item.id, version: legacy.version, action: "queue_generation" },
			alice,
		);
	}
	async function claim(id: string) {
		const job = await worker.claimContributionGeneration({
			workerId: "local-test-workstation",
			issueId: id,
		});
		if (!job) throw new Error("Expected queued generation job");
		return job;
	}
	function completion(
		job: Awaited<ReturnType<typeof claim>>,
		output?: unknown,
	) {
		const uniqueName = `worker-${randomUUID()}`;
		return {
			issueId: job.issueId,
			jobId: job.id,
			token: job.token,
			version: job.version,
			apiVersion: job.apiVersion,
			model: "doradsoft",
			content: canonicalJson(
				output ?? {
					pullRequests: [
						{
							title: "ערך ממקור",
							description: "הצעה לסקירה בלבד",
							evidenceIndexes: [0],
							changes: [
								{
									kind: "entry",
									after: {
										title: "שם בדיקה",
										uniqueName,
										entityType: "PERSON",
										displayName: "שם בדיקה",
									},
								},
							],
						},
					],
				},
			),
		};
	}
	it("leases a queued issue once, creates only reviewable PRs and makes completion replay-safe", async () => {
		const item = await queued();
		const claims = await Promise.all([
			worker.claimContributionGeneration({ workerId: "one", issueId: item.id }),
			worker.claimContributionGeneration({ workerId: "two", issueId: item.id }),
		]);
		const job = claims.find(Boolean);
		if (!job) throw new Error("No worker won the claim");
		expect(claims.filter(Boolean)).toHaveLength(1);
		const input = completion(job);
		const result = await worker.completeContributionGeneration(input);
		expect(result.prIds).toHaveLength(1);
		expect(await worker.completeContributionGeneration(input)).toEqual(result);
		const pr = await store.withContributions((tx) =>
			store.readContribution(tx, result.prIds[0]),
		);
		expect(pr.author).toMatchObject({
			kind: "local_llm",
			name: "doradsoft",
			isDoradsoft: false,
		});
		expect(pr.provenance?.provider).toBe("local_llm_worker");
		await expect(
			service.mergeContribution({ id: pr.id, version: pr.version }, alice),
		).rejects.toThrow("Approval");
		const uniqueName = pr.changes[0].after?.uniqueName;
		if (typeof uniqueName !== "string")
			throw new Error("Generated entry unique name missing");
		const [entries] = await conn.execute<RowDataPacket[]>(
			"SELECT id FROM tanahpedia_entry WHERE unique_name=?",
			[uniqueName],
		);
		expect(entries).toHaveLength(0);
		const source = await store.withContributions((tx) =>
			store.readContribution(tx, item.id),
		);
		expect(source.generation).toMatchObject({
			status: "completed",
			prIds: result.prIds,
			attempts: 1,
		});
		expect(source.generation?.leaseHash).not.toBe(job.token);
		const [prs] = await conn.execute<RowDataPacket[]>(
			"SELECT id FROM tanahpedia_contribution WHERE issue_id=?",
			[item.id],
		);
		expect(prs).toHaveLength(1);
	});
	it("rejects an invalid batch atomically and records a recoverable failure", async () => {
		const item = await queued(),
			job = await claim(item.id);
		await expect(
			worker.completeContributionGeneration(
				completion(job, {
					pullRequests: [
						{
							title: "הצעה",
							description: "בדיקה",
							evidenceIndexes: [7],
							changes: [],
						},
					],
				}),
			),
		).rejects.toThrow("evidence");
		const saved = await store.withContributions((tx) =>
			store.readContribution(tx, item.id),
		);
		expect(saved.generation?.status).toBe("failed");
		const [prs] = await conn.execute<RowDataPacket[]>(
			"SELECT id FROM tanahpedia_contribution WHERE issue_id=?",
			[item.id],
		);
		expect(prs).toHaveLength(0);
	});
	it("cancels stale work when a human edits or reassigns its source", async () => {
		for (const action of ["edit", "assign"]) {
			const item = await queued(),
				job = await claim(item.id);
			if (action === "edit")
				await service.editContribution(
					{
						id: item.id,
						version: job.version,
						title: "נוסח מתוקן",
						description: item.description,
						evidence: item.evidence,
					},
					alice,
				);
			else
				await service.updateContribution(
					{
						id: item.id,
						version: job.version,
						action: "assign",
						assignee: { kind: "human", id: "alice", name: "Alice" },
					},
					alice,
				);
			await expect(
				worker.completeContributionGeneration(completion(job)),
			).rejects.toThrow("no longer owns");
			const saved = await store.withContributions((tx) =>
				store.readContribution(tx, item.id),
			);
			expect(saved.generation?.status).toBe(
				action === "edit" ? "queued" : "cancelled",
			);
			if (action === "edit") {
				expect(saved.generation?.task).toBe("issue_implementation");
				expect(saved.generation?.id).not.toBe(job.id);
			}
		}
	});
	it("reclaims an expired lease and refuses a late result from its former owner", async () => {
		const item = await queued(),
			old = await claim(item.id);
		await store.withContributions(async (tx) => {
			const source = await store.readContribution(tx, item.id, true);
			if (!source.generation) throw new Error("Job missing");
			source.generation.leaseExpiresAt = "2000-01-01T00:00:00.000Z";
			await store.saveContribution(tx, source);
		});
		const replacement = await claim(item.id);
		expect(replacement.token).not.toBe(old.token);
		await expect(
			worker.completeContributionGeneration(completion(old)),
		).rejects.toThrow("no longer owns");
		const result = await worker.completeContributionGeneration(
			completion(replacement),
		);
		expect(result.prIds).toHaveLength(1);
	});
	it("bounds disconnected-worker attempts and allows a new explicit request", async () => {
		const item = await queued();
		await claim(item.id);
		await store.withContributions(async (tx) => {
			const source = await store.readContribution(tx, item.id, true);
			if (!source.generation) throw new Error("Job missing");
			source.generation.attempts = 3;
			source.generation.leaseExpiresAt = "2000-01-01T00:00:00.000Z";
			await store.saveContribution(tx, source);
		});
		expect(
			await worker.claimContributionGeneration({
				workerId: "replacement",
				issueId: item.id,
			}),
		).toBeNull();
		const failed = await store.withContributions((tx) =>
			store.readContribution(tx, item.id),
		);
		expect(failed.generation?.status).toBe("failed");
		const retry = await service.updateContribution(
			{ id: item.id, version: failed.version, action: "queue_generation" },
			alice,
		);
		expect(retry.generation?.id).not.toBe(failed.generation?.id);
		expect(await claim(item.id)).toBeTruthy();
	});
});

describe("assignment-driven agents with actual MySQL transactions", () => {
	async function outdatedAgents() {
		const specifications = [
			{
				provider: "local_llm",
				model: "fixture-local:8b",
				enabled: true,
				version: 4,
				release: "tanahpedia-agents-v1",
				seen: "2026-11-01T01:02:03.000Z",
				runtime: "local-fixture",
			},
			{
				provider: "aws_llm",
				model: "vendor.fixture:0",
				enabled: false,
				version: 9,
				release: "tanahpedia-agents-v2",
				seen: "2026-11-02T04:05:06.000Z",
				runtime: "aws-fixture",
			},
		] as const;
		return Promise.all(
			specifications.map(async (specification) => {
				const installed = await registry.installRegisteredContributionAgent({
					name: `Release fixture ${randomUUID()}`,
					provider: specification.provider,
					model: specification.model,
					enabled: specification.enabled,
				});
				const persisted = await store.withContributions((tx) =>
					registry.getRegisteredContributionAgent(tx, installed.id),
				);
				const { hash: _hash, ...declaration } = persisted.bundle;
				const payload = { ...declaration, version: specification.release };
				const bundle = {
					...payload,
					hash: createHash("sha256")
						.update(canonicalJson(payload))
						.digest("hex"),
				};
				const previous = {
					...persisted,
					version: specification.version,
					installedVersion: bundle.version,
					bundleHash: bundle.hash,
					bundle,
					lastSeenAt: specification.seen,
					runtimeVersion: specification.runtime,
				};
				await conn.execute(
					"INSERT IGNORE INTO tanahpedia_contribution_agent_bundle (hash,version,data) VALUES (?,?,?)",
					[bundle.hash, bundle.version, JSON.stringify(bundle)],
				);
				await conn.execute(
					"UPDATE tanahpedia_contribution_agent SET version=?,data=? WHERE id=?",
					[previous.version, JSON.stringify(previous), previous.id],
				);
				return previous;
			}),
		);
	}
	async function installedAgent() {
		return registry.installRegisteredContributionAgent({
			name: `Fixture agent ${randomUUID()}`,
			provider: "local_llm",
			model: "fixture-model",
			enabled: true,
		});
	}
	async function assignedIssue() {
		worker ??= await import("~/server/tanahpedia/contribution-worker.server");
		const agent = await installedAgent();
		const item = await service.createContribution(
			{
				kind: "issue",
				title: `Agent issue ${randomUUID()}`,
				description: "Implement typed metadata only",
				evidence,
				assignee: { kind: "local_llm", agentId: agent.id },
			},
			alice,
		);
		return { item, agent };
	}
	async function claim(item: Contribution) {
		worker ??= await import("~/server/tanahpedia/contribution-worker.server");
		const value = await worker.claimContributionGeneration({
			workerId: "v2-mysql-fixture",
			protocolVersion: 2,
			supportedTasks: ["issue_implementation", "pr_resolution"],
			issueId: item.id,
			runtimeVersion: "fixture-v2",
		});
		if (!value || !("protocolVersion" in value) || value.protocolVersion !== 2)
			throw new Error("Expected a v2 assigned-agent claim");
		return value;
	}
	function identity(job: Awaited<ReturnType<typeof claim>>) {
		return {
			issueId: job.issueId,
			jobId: job.id,
			version: job.version,
			token: job.token,
			apiVersion: job.apiVersion,
			protocolVersion: 2,
			model: "forged-owner-name",
		};
	}
	const result = (
		summary: string,
		commentId?: string,
		draft?: Record<string, unknown>,
	) =>
		canonicalJson({
			outcome: draft ? "revised" : "unchanged",
			summary,
			responses: commentId
				? [{ commentId, status: "addressed", body: summary }]
				: [],
			...(draft ? { draft } : {}),
		});
	async function isolatedEntity() {
		const id = randomUUID();
		await conn.execute(
			"INSERT INTO tanahpedia_entity (id,entity_type,name) VALUES (?,'PERSON',?)",
			[id, `Current ${id}`],
		);
		return id;
	}
	function graphGate() {
		let enter = () => {},
			release = () => {};
		const reached = new Promise<void>((resolve) => {
			enter = resolve;
		});
		const pending = new Promise<void>((resolve) => {
			release = resolve;
		});
		return { enter, release, reached, pending };
	}
	async function linkedGraph(kind: "issue" | "pr") {
		const agent = await installedAgent();
		let issue = await service.createContribution(
			{
				kind: "issue",
				title: `Graph issue ${randomUUID()}`,
				description: "Implement a new independently evidenced facet",
				evidence,
			},
			alice,
		);
		const makePr = async (assigned: boolean) =>
			service.createContribution(
				{
					kind: "pr",
					issueId: issue.id,
					title: `Graph PR ${randomUUID()}`,
					description: "Original graph proposal",
					evidence,
					assignee: assigned
						? { kind: "local_llm", agentId: agent.id }
						: { kind: "unassigned" },
					changes: [
						{
							kind: "metadata",
							targetId: await isolatedEntity(),
							after: { displayName: "Proposed graph value" },
						},
					],
				},
				alice,
			);
		const sibling = await makePr(false);
		let subject: Contribution;
		if (kind === "pr") subject = await makePr(true);
		else {
			issue = await service.updateContribution(
				{
					id: issue.id,
					version: issue.version,
					action: "assign",
					assignee: { kind: "local_llm", agentId: agent.id },
				},
				alice,
			);
			subject = issue;
		}
		return { issue, subject, sibling, agent };
	}
	function editDiscussion(item: Contribution, version = item.version) {
		return service.editContribution(
			{
				id: item.id,
				version,
				title: item.title,
				description: "Concurrent human edit",
				evidence: item.evidence,
				assignee: item.assignee,
				closeIssue: item.closeIssue,
				changes: item.changes.map(({ kind, targetId, after }) => ({
					kind,
					targetId,
					after,
				})),
			},
			alice,
		);
	}
	async function assertPinnedContribution(id: string) {
		const probe = await db.pool.getConnection();
		try {
			await probe.beginTransaction();
			await expect(
				probe.execute(
					"SELECT id FROM tanahpedia_contribution WHERE id=? FOR UPDATE NOWAIT",
					[id],
				),
			).rejects.toMatchObject({ code: "ER_LOCK_NOWAIT" });
		} finally {
			await probe.rollback();
			probe.release();
		}
	}
	function implementation(uniqueName: string) {
		return canonicalJson({
			outcome: "implemented",
			summary: "Created an independent draft for review",
			responses: [],
			pullRequests: [
				{
					title: "Graph implementation",
					description: "Metadata only, no canonical writes",
					evidenceIndexes: [0],
					changes: [
						{
							kind: "entry",
							after: {
								title: "Graph fixture",
								uniqueName,
								entityType: "PERSON",
								displayName: "Graph fixture",
							},
						},
					],
				},
			],
		});
	}
	function referenceLock(
		probe: PoolConnection,
		point: {
			kind:
				| "entity"
				| "person_name"
				| "person"
				| "perek"
				| "tanah_sefer"
				| "tanah_additional"
				| "parent_child";
			id: string | number;
		},
	) {
		switch (point.kind) {
			case "entity":
				return probe.execute(
					"SELECT id FROM tanahpedia_entity WHERE id=? FOR UPDATE NOWAIT",
					[point.id],
				);
			case "person_name":
				return probe.execute(
					"SELECT id FROM tanahpedia_person_name WHERE id=? FOR UPDATE NOWAIT",
					[point.id],
				);
			case "person":
				return probe.execute(
					"SELECT id FROM tanahpedia_person WHERE id=? FOR UPDATE NOWAIT",
					[point.id],
				);
			case "perek":
				return probe.execute(
					"SELECT id FROM tanah_perek WHERE id=? FOR UPDATE NOWAIT",
					[point.id],
				);
			case "tanah_sefer":
				return probe.execute(
					"SELECT id FROM tanah_sefer WHERE id=? FOR UPDATE NOWAIT",
					[point.id],
				);
			case "tanah_additional":
				return probe.execute(
					"SELECT id FROM tanah_additional WHERE id=? FOR UPDATE NOWAIT",
					[point.id],
				);
			case "parent_child":
				return probe.execute(
					"SELECT id FROM tanahpedia_person_parent_child WHERE id=? FOR UPDATE NOWAIT",
					[point.id],
				);
		}
	}
	async function referenceFixture(
		kind: "entity" | "person_name" | "perek" | "alternative",
	) {
		if (kind === "entity") {
			const id = await isolatedEntity();
			return {
				kind,
				id,
				probes: [
					{
						kind: "entity" as const,
						id,
					},
				],
				change: (tx: Connection | PoolConnection) =>
					tx.execute("UPDATE tanahpedia_entity SET name=? WHERE id=?", [
						"Changed after preparation",
						id,
					]),
				cleanup: () =>
					conn.execute("DELETE FROM tanahpedia_entity WHERE id=?", [id]),
			};
		}
		if (kind === "person_name") {
			const entity = await isolatedEntity(),
				person = randomUUID(),
				id = randomUUID();
			await conn.execute(
				"INSERT INTO tanahpedia_person(id,entity_id) VALUES(?,?)",
				[person, entity],
			);
			await conn.execute(
				"INSERT INTO tanahpedia_person_name(id,person_id,name,name_type_id) SELECT ?,?,'Fixture name',id FROM tanahpedia_lookup_name_type WHERE name='MAIN'",
				[id, person],
			);
			return {
				kind,
				id,
				probes: [
					{
						kind: "person_name" as const,
						id,
					},
					{
						kind: "person" as const,
						id: person,
					},
					{
						kind: "entity" as const,
						id: entity,
					},
				],
				change: (tx: Connection | PoolConnection) =>
					tx.execute("UPDATE tanahpedia_entity SET name=? WHERE id=?", [
						"Changed joined owner",
						entity,
					]),
				cleanup: async () => {
					await conn.execute("DELETE FROM tanahpedia_person_name WHERE id=?", [
						id,
					]);
					await conn.execute("DELETE FROM tanahpedia_person WHERE id=?", [
						person,
					]);
					await conn.execute("DELETE FROM tanahpedia_entity WHERE id=?", [
						entity,
					]);
				},
			};
		}
		if (kind === "perek") {
			const id = 990001,
				sefer = 99001,
				additional = 99002;
			await conn.execute(
				"INSERT INTO tanah_sefer(id,name,perek_id_from,perek_id_to) VALUES(?,'ספר בדיקה',?,?)",
				[sefer, id, id],
			);
			await conn.execute(
				"INSERT INTO tanah_perek(id,perek,pasuk_count) VALUES(?,1,1)",
				[id],
			);
			await conn.execute(
				"INSERT INTO tanah_additional(id,sefer_id,letter,tanach_us_name,perek_from,perek_to) VALUES(?,?,'ב','fixture',?,?)",
				[additional, sefer, id, id],
			);
			return {
				kind,
				id,
				probes: [
					{
						kind: "perek" as const,
						id,
					},
					{
						kind: "tanah_sefer" as const,
						id: sefer,
					},
					{
						kind: "tanah_additional" as const,
						id: additional,
					},
				],
				change: (tx: Connection | PoolConnection) =>
					tx.execute("UPDATE tanah_sefer SET name=? WHERE id=?", [
						"שם ספר מעודכן",
						sefer,
					]),
				cleanup: async () => {
					await conn.execute("DELETE FROM tanah_perek WHERE id=?", [id]);
					await conn.execute("DELETE FROM tanah_additional WHERE id=?", [
						additional,
					]);
					await conn.execute("DELETE FROM tanah_sefer WHERE id=?", [sefer]);
				},
			};
		}
		const id = randomUUID(),
			witness = randomUUID();
		await conn.execute(
			"INSERT INTO tanahpedia_person_parent_child(id,parent_id,child_id,relationship_type_id,parent_role_id,alt_group_id) SELECT ?,?,?,t.id,r.id,? FROM tanahpedia_lookup_parent_child_type t JOIN tanahpedia_lookup_parent_role r WHERE t.name='BIOLOGICAL' AND r.name='FATHER'",
			[witness, ids.parent, ids.person, id],
		);
		return {
			kind,
			id,
			probes: [
				{
					kind: "parent_child" as const,
					id: witness,
				},
			],
			change: (tx: Connection | PoolConnection) =>
				tx.execute(
					"UPDATE tanahpedia_person_parent_child SET alt_group_id=? WHERE id=?",
					[randomUUID(), witness],
				),
			cleanup: () =>
				conn.execute("DELETE FROM tanahpedia_person_parent_child WHERE id=?", [
					witness,
				]),
		};
	}
	it("persists registry declarations once per hash and rejects concurrent configuration updates", async () => {
		const installed = await installedAgent();
		const persisted = await store.withContributions((tx) =>
			registry.getRegisteredContributionAgent(tx, installed.id),
		);
		const bundle = await store.withContributions((tx) =>
			registry.readContributionAgentBundle(tx, installed.bundleHash),
		);
		expect(persisted.bundle).toEqual(bundle);
		expect(bundle.tools.some((tool) => tool.name === "related")).toBe(true);
		const updated = await registry.updateRegisteredContributionAgent({
			id: installed.id,
			version: installed.version,
			action: "configure",
			name: "Updated fixture agent",
			model: "other-fixture-model",
		});
		expect(updated.version).toBe(installed.version + 1);
		expect(
			await store.withContributions((tx) =>
				registry.readContributionAgentBundle(tx, installed.bundleHash),
			),
		).toEqual(bundle);
		await expect(
			registry.updateRegisteredContributionAgent({
				id: installed.id,
				version: installed.version,
				action: "configure",
				name: "Stale name",
			}),
		).rejects.toThrow("configuration changed");
		const [bundles] = await conn.execute<RowDataPacket[]>(
			"SELECT hash FROM tanahpedia_contribution_agent_bundle WHERE hash=?",
			[installed.bundleHash],
		);
		expect(bundles).toHaveLength(1);
	});
	it("upgrades multiple distinct registrations in one CAS batch and stores JSON objects while preserving configuration and heartbeat", async () => {
		const previous = await outdatedAgents();
		const execute = vi.spyOn(db, "txExecute");
		try {
			expect(
				(await registry.refreshRegisteredContributionAgents()).updated,
			).toBe(2);
			const batches = execute.mock.calls.filter((call) =>
				call[1].startsWith("UPDATE tanahpedia_contribution_agent SET"),
			);
			expect(batches).toHaveLength(1);
			expect(batches[0][1]).toContain("version = CASE id");
			for (const before of previous) {
				const [rows] = await conn.execute<RowDataPacket[]>(
					"SELECT version,JSON_TYPE(data) AS data_type,data FROM tanahpedia_contribution_agent WHERE id=?",
					[before.id],
				);
				expect(rows[0].data_type).toBe("OBJECT");
				const after =
					typeof rows[0].data === "string"
						? JSON.parse(rows[0].data)
						: rows[0].data;
				expect(rows[0].version).toBe(before.version + 1);
				expect(after).toMatchObject({
					version: before.version + 1,
					name: before.name,
					provider: before.provider,
					model: before.model,
					enabled: before.enabled,
					lastSeenAt: before.lastSeenAt,
					runtimeVersion: before.runtimeVersion,
					createdAt: before.createdAt,
				});
				expect(after.bundleHash).not.toBe(before.bundleHash);
				expect(after.bundle.hash).toBe(after.bundleHash);
				expect(after.bundle.version).toBe(after.installedVersion);
			}
		} finally {
			execute.mockRestore();
		}
	});
	it("rolls back every registration in a release batch when one expected version is lost", async () => {
		const previous = await outdatedAgents();
		const execute = db.txExecute;
		let intercepted = false;
		const race = vi
			.spyOn(db, "txExecute")
			.mockImplementation(async (...args) => {
				if (
					args[1].startsWith(
						"UPDATE tanahpedia_contribution_agent SET version = CASE",
					)
				) {
					intercepted = true;
					// Inject real version drift inside the transaction after validation,
					// so one SQL predicate misses and the other update must roll back.
					await args[0].execute(
						"UPDATE tanahpedia_contribution_agent SET version=version+1 WHERE id=?",
						[previous[0].id],
					);
				}
				return execute(...args);
			});
		try {
			await expect(
				registry.refreshRegisteredContributionAgents(),
			).rejects.toThrow("release update conflicted");
			expect(intercepted).toBe(true);
			for (const before of previous) {
				const saved = await store.withContributions((tx) =>
					registry.getRegisteredContributionAgent(tx, before.id),
				);
				expect(saved).toEqual(before);
			}
		} finally {
			race.mockRestore();
			// Keep later integration cases on the implemented current declaration.
			await registry.refreshRegisteredContributionAgents();
		}
	});
	it("claims compatible work behind twenty unsupported queued requests without changing skipped jobs", async () => {
		worker ??= await import("~/server/tanahpedia/contribution-worker.server");
		const agent = await installedAgent();
		// This suite owns its disposable schema. Temporarily hide earlier cases'
		// requests so this unfiltered claim measures only the ordered fixture.
		const [pending] = await conn.execute<RowDataPacket[]>(
			"SELECT id,data FROM tanahpedia_contribution WHERE state='open' AND JSON_UNQUOTE(JSON_EXTRACT(data,'$.assignee.kind'))='local_llm' AND JSON_UNQUOTE(JSON_EXTRACT(data,'$.generation.status')) IN ('queued','running')",
		);
		const created: string[] = [];
		try {
			for (const row of pending)
				await conn.execute(
					"UPDATE tanahpedia_contribution SET data=JSON_SET(data,'$.generation.status','cancelled') WHERE id=?",
					[row.id],
				);
			const unsupported: Contribution[] = [];
			for (let index = 0; index < 20; index++) {
				const kind = index % 2 === 0 ? "issue" : "pr";
				const item = await service.createContribution(
					{
						kind,
						title: `Unsupported fixture ${index}`,
						description:
							"Older saved declaration awaiting release reconciliation",
						evidence,
						assignee: { kind: "local_llm", agentId: agent.id },
						...(kind === "pr"
							? {
									changes: [
										{
											kind: "metadata",
											targetId: await isolatedEntity(),
											after: { displayName: `Proposed ${index}` },
										},
									],
								}
							: {}),
					},
					alice,
				);
				created.push(item.id);
				unsupported.push(item);
				await conn.execute(
					"UPDATE tanahpedia_contribution SET data=JSON_SET(data,'$.generation.bundleHash',?,'$.generation.bundleVersion',?) WHERE id=?",
					["b".repeat(64), "tanahpedia-agents-v1", item.id],
				);
			}
			const compatible = await service.createContribution(
				{
					kind: "issue",
					title: "Twenty-first compatible request",
					description: "Current declaration",
					evidence,
					assignee: { kind: "local_llm", agentId: agent.id },
				},
				alice,
			);
			created.push(compatible.id);
			const ids = unsupported.map((item) => item.id);
			const select = `SELECT id,version,data FROM tanahpedia_contribution WHERE id IN (${ids.map(() => "?").join(",")}) ORDER BY number`;
			const [before] = await conn.execute<RowDataPacket[]>(select, ids);
			const claimed = await worker.claimContributionGeneration({
				protocolVersion: 2,
				supportedTasks: ["issue_implementation", "pr_resolution"],
				workerId: "starvation-fixture",
			});
			expect(claimed).toMatchObject({
				issueId: compatible.id,
				protocolVersion: 2,
			});
			const [after] = await conn.execute<RowDataPacket[]>(select, ids);
			expect(after).toEqual(before);
			expect((await fresh(compatible)).generation).toMatchObject({
				status: "running",
				attempts: 1,
			});
		} finally {
			if (created.length)
				await conn.execute(
					`UPDATE tanahpedia_contribution SET state='closed',data=JSON_SET(data,'$.state','closed','$.generation.status','cancelled') WHERE id IN (${created.map(() => "?").join(",")})`,
					created,
				);
			for (const row of pending)
				await conn.execute(
					"UPDATE tanahpedia_contribution SET data=? WHERE id=?",
					[
						typeof row.data === "string" ? row.data : JSON.stringify(row.data),
						row.id,
					],
				);
		}
	});
	it("serializes concurrent startup default seeding and refresh without lock-upgrade deadlock or config changes", async () => {
		await registry.listContributionAgents();
		const [before] = await conn.execute<RowDataPacket[]>(
			"SELECT id,version,data FROM tanahpedia_contribution_agent ORDER BY id",
		);
		let firstConnection: PoolConnection | undefined;
		let entered = () => {},
			release = () => {},
			secondEntered = () => {};
		const reached = new Promise<void>((resolve) => {
			entered = resolve;
		});
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const secondSeeding = new Promise<void>((resolve) => {
			secondEntered = resolve;
		});
		const query = db.txQuery,
			execute = db.txExecute;
		const pause = vi
			.spyOn(db, "txQuery")
			.mockImplementation(
				async <T>(
					tx: PoolConnection,
					sql: string,
					params?: unknown[],
				): Promise<T[]> => {
					if (
						!firstConnection &&
						sql.includes(
							"FROM tanahpedia_contribution_agent ORDER BY id FOR UPDATE",
						)
					) {
						firstConnection = tx;
						entered();
						await gate;
					}
					return query<T>(tx, sql, params);
				},
			);
		const observe = vi.spyOn(db, "txExecute").mockImplementation((...args) => {
			const executing = execute(...args);
			if (
				firstConnection &&
				args[0] !== firstConnection &&
				args[1].includes("INTO tanahpedia_contribution_agent (")
			)
				secondEntered();
			return executing;
		});
		const first = registry.refreshRegisteredContributionAgents();
		let second:
			| ReturnType<typeof registry.refreshRegisteredContributionAgents>
			| undefined;
		let completed:
			| Promise<PromiseSettledResult<Awaited<typeof first>>[]>
			| undefined;
		try {
			await Promise.race([
				reached,
				first.then(() => {
					throw new Error("First refresh skipped its row-lock barrier");
				}),
			]);
			second = registry.refreshRegisteredContributionAgents();
			completed = Promise.allSettled([first, second]);
			await Promise.race([
				secondSeeding,
				second.then(() => {
					throw new Error("Second refresh skipped default seeding");
				}),
			]);
			const probe = await db.pool.getConnection();
			try {
				await probe.beginTransaction();
				// Seeding must already own an exclusive lock. INSERT IGNORE instead
				// retained compatible shared locks, then deadlocked at the two upgrades.
				await expect(
					probe.execute(
						"SELECT id FROM tanahpedia_contribution_agent WHERE id=? FOR SHARE NOWAIT",
						[DEFAULT_LOCAL_AGENT_ID],
					),
				).rejects.toMatchObject({ code: "ER_LOCK_NOWAIT" });
			} finally {
				await probe.rollback();
				probe.release();
			}
			release();
			const results = await completed;
			for (const result of results) {
				expect(result.status).toBe("fulfilled");
				if (result.status === "fulfilled")
					expect(result.value).toMatchObject({ updated: 0 });
			}
			const [after] = await conn.execute<RowDataPacket[]>(
				"SELECT id,version,data FROM tanahpedia_contribution_agent ORDER BY id",
			);
			expect(after).toEqual(before);
		} finally {
			release();
			await (completed ??
				Promise.allSettled([first, ...(second ? [second] : [])]));
			pause.mockRestore();
			observe.mockRestore();
		}
	});
	it("returns typed current-call feedback over HTTP after real lease checks without any writes", async () => {
		const { item } = await assignedIssue(),
			job = await claim(item);
		const environment = await import("~/server/environment.server");
		const local = vi
			.spyOn(environment, "skipAuthEnabled")
			.mockReturnValue(true);
		const { handleContributionWorkerRequest } = await import(
			"~/server/tanahpedia/contribution-worker-http.server"
		);
		const snapshot = async () => {
			const [items] = await conn.query<RowDataPacket[]>(
				"SELECT id,version,data FROM tanahpedia_contribution ORDER BY id",
			);
			const [agents] = await conn.query<RowDataPacket[]>(
				"SELECT id,version,data FROM tanahpedia_contribution_agent ORDER BY id",
			);
			const [entities] = await conn.query<RowDataPacket[]>(
				"SELECT id,name FROM tanahpedia_entity ORDER BY id",
			);
			return { items, agents, entities };
		};
		const before = await snapshot();
		const request = (body: unknown) =>
			handleContributionWorkerRequest(
				new Request("http://127.0.0.1/api/contributions/worker/context", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(body),
				}),
			);
		const invalid = {
			...identity(job),
			name: "record",
			arguments: { kind: "target:article_links", id: item.id },
		};
		try {
			const rejected = await request(invalid);
			expect(rejected.status).toBe(200);
			expect(await rejected.json()).toEqual({
				error: {
					type: "invalid_tool_arguments",
					code: "invalid_article_id",
					message:
						"Use the numeric article ID from currentRecords or an article lookup. A PR or discussion UUID is not an article ID.",
				},
			});
			const badFields = await request({
				...identity(job),
				name: "history",
				arguments: { sql: "private SQL" },
			});
			expect(badFields.status).toBe(200);
			expect(await badFields.json()).toEqual({
				error: {
					type: "invalid_tool_arguments",
					code: "invalid_arguments",
					message:
						"The read tool arguments are invalid. Use only its declared fields, kinds and page limits.",
				},
			});
			const revoked = await request({ ...invalid, token: "0".repeat(64) });
			expect(revoked.status).toBe(409);
			expect(await revoked.text()).not.toContain("invalid_tool_arguments");
			const forged = await request({
				...invalid,
				receipts: [
					{
						name: "record",
						arguments: { kind: "target:article_links", id: item.id },
						hash: "a".repeat(64),
					},
				],
			});
			expect(forged.status).toBe(400);
			expect(await forged.text()).not.toContain("invalid_tool_arguments");
			const missing = await request({
				...identity(job),
				name: "record",
				arguments: { kind: "entity", id: randomUUID() },
			});
			expect(missing.status).toBe(200);
			expect(await missing.json()).toMatchObject({
				data: { record: null },
				receipt: { hash: expect.any(String) },
				schema: expect.any(Object),
			});
			expect(await snapshot()).toEqual(before);
			expect(
				(
					await store.withContributions((tx) =>
						store.readContribution(tx, item.id),
					)
				).generation?.status,
			).toBe("running");
		} finally {
			local.mockRestore();
		}
	});
	it("creates a source-backed issue proposal under the registered identity through v2 reads and completion", async () => {
		const { item, agent } = await assignedIssue(),
			entityId = await isolatedEntity(),
			job = await claim(item);
		const read = await worker.readContributionWorkerContext({
			...identity(job),
			name: "record",
			arguments: { kind: "entity", id: entityId },
		});
		const input = {
			...identity(job),
			receipts: [read.receipt],
			content: canonicalJson({
				outcome: "implemented",
				summary: "Prepared for human review",
				responses: [],
				pullRequests: [
					{
						title: "Proposed metadata",
						description: "Source-backed fixture",
						evidenceIndexes: [0],
						changes: [
							{
								kind: "metadata",
								targetId: entityId,
								after: { displayName: "Reviewed proposal value" },
							},
						],
					},
				],
			}),
		};
		const receipt = await worker.completeContributionGeneration(input);
		expect(receipt.prIds).toHaveLength(1);
		expect(await worker.completeContributionGeneration(input)).toEqual(receipt);
		const proposal = await store.withContributions((tx) =>
			store.readContribution(tx, receipt.prIds[0]),
		);
		expect(proposal.author).toMatchObject({
			id: `agent:${agent.id}`,
			name: agent.name,
			kind: "local_llm",
			isDoradsoft: false,
		});
		expect(proposal.provenance).toMatchObject({
			provider: "contribution_agent",
			model: "fixture-model",
			promptVersion: agent.installedVersion,
		});
		expect(reviewStatus(proposal)).toBe("required");
		const [rows] = await conn.execute<RowDataPacket[]>(
			"SELECT name FROM tanahpedia_entity WHERE id=?",
			[entityId],
		);
		expect(rows[0].name).toBe(`Current ${entityId}`);
	});
	it("refreshes a raced queued configuration atomically before spending one lease attempt", async () => {
		const { item, agent } = await assignedIssue(),
			originalJob = item.generation?.id;
		const configured = await registry.updateRegisteredContributionAgent({
			id: agent.id,
			version: agent.version,
			action: "configure",
			model: "new-fixture-model",
		});
		const job = await claim(item),
			saved = await fresh(item);
		expect(job.id).not.toBe(originalJob);
		expect(job.model).toBe("new-fixture-model");
		expect(saved.generation).toMatchObject({
			agentVersion: configured.version,
			attempts: 1,
			status: "running",
			triggerEventIds: [item.events[0].id],
		});
	});
	it("keeps missing-evidence clarification as a completed observation instead of creating empty proposals", async () => {
		const { item } = await assignedIssue();
		const edited = await service.editContribution(
			{
				id: item.id,
				version: item.version,
				title: item.title,
				description: item.description,
				evidence: [],
			},
			alice,
		);
		const job = await claim(edited);
		await worker.completeContributionGeneration({
			...identity(job),
			content: canonicalJson({
				outcome: "clarification",
				summary: "Please supply a source",
				responses: [],
			}),
		});
		expect((await fresh(item)).generation).toMatchObject({
			status: "needs_input",
			result: { outcome: "clarification", changed: false },
		});
		const [rows] = await conn.execute<RowDataPacket[]>(
			"SELECT id FROM tanahpedia_contribution WHERE issue_id=?",
			[item.id],
		);
		expect(rows).toHaveLength(0);
	});
	it("holds the configured agent row from final validation until the same-PR revision commits", async () => {
		const agent = await installedAgent(),
			entityId = await isolatedEntity();
		const pr = await service.createContribution(
			{
				kind: "pr",
				title: "Config-lock fixture",
				description: "Before",
				evidence,
				changes: [
					{
						kind: "metadata",
						targetId: entityId,
						after: { displayName: "Proposed" },
					},
				],
				assignee: { kind: "local_llm", agentId: agent.id },
			},
			owner,
		);
		const job = await claim(pr);
		let entered = () => {},
			release = () => {};
		const reached = new Promise<void>((resolve) => {
				entered = resolve;
			}),
			gate = new Promise<void>((resolve) => {
				release = resolve;
			});
		const apply = service.applyContributionAgentRevision;
		const paused = vi
			.spyOn(service, "applyContributionAgentRevision")
			.mockImplementationOnce(async (...args) => {
				entered();
				await gate;
				return apply(...args);
			});
		const completing = worker.completeContributionGeneration({
			...identity(job),
			content: result("Validated old configuration", undefined, {
				description: "After",
			}),
		});
		try {
			await Promise.race([
				reached,
				completing.then(() => {
					throw new Error("Completion skipped the revision barrier");
				}),
			]);
			const probe = await db.pool.getConnection();
			try {
				await probe.beginTransaction();
				await expect(
					probe.execute(
						"SELECT id FROM tanahpedia_contribution_agent WHERE id=? FOR UPDATE NOWAIT",
						[agent.id],
					),
				).rejects.toMatchObject({ code: "ER_LOCK_NOWAIT" });
			} finally {
				await probe.rollback();
				probe.release();
			}
			const configuring = registry.updateRegisteredContributionAgent({
				id: agent.id,
				version: agent.version,
				action: "configure",
				model: "configuration-after-commit",
			});
			release();
			const [, configured] = await Promise.all([completing, configuring]);
			expect(configured.version).toBe(agent.version + 1);
			const saved = await fresh(pr);
			expect(saved.description).toBe("After");
			expect(saved.generation).toMatchObject({
				agentVersion: agent.version,
				status: "completed",
				model: "fixture-model",
			});
		} finally {
			release();
			paused.mockRestore();
			await completing.catch(() => {});
		}
	});
	it.each(["issue", "pr"] as const)(
		"holds linked issue and sibling PR dependencies after final %s validation until commit",
		async (kind) => {
			const graph = await linkedGraph(kind),
				job = await claim(graph.subject),
				gate = graphGate();
			const revise = service.applyContributionAgentRevision,
				create = service.createContribution;
			const pause =
				kind === "pr"
					? vi
							.spyOn(service, "applyContributionAgentRevision")
							.mockImplementationOnce(async (...args) => {
								gate.enter();
								await gate.pending;
								return revise(...args);
							})
					: vi
							.spyOn(service, "createContribution")
							.mockImplementationOnce(async (...args) => {
								gate.enter();
								await gate.pending;
								return create(...args);
							});
			const uniqueName = `graph-${randomUUID()}`;
			const completing = worker.completeContributionGeneration({
				...identity(job),
				content:
					kind === "pr"
						? result("Validated linked graph", undefined, {
								description: "Model revised graph proposal",
							})
						: implementation(uniqueName),
			});
			let edits: Promise<PromiseSettledResult<Contribution>[]> | undefined;
			try {
				await Promise.race([
					gate.reached,
					completing.then(() => {
						throw new Error("Completion skipped its post-validation barrier");
					}),
				]);
				await assertPinnedContribution(graph.issue.id);
				await assertPinnedContribution(graph.sibling.id);
				edits = Promise.allSettled([
					editDiscussion(
						graph.issue,
						kind === "issue" ? job.version : graph.issue.version,
					),
					editDiscussion(graph.sibling),
				]);
				gate.release();
				const completed = await completing;
				const edited = await edits;
				expect(edited[1].status).toBe("fulfilled");
				if (kind === "pr") expect(edited[0].status).toBe("fulfilled");
				else {
					expect(edited[0].status).toBe("rejected");
					if (edited[0].status === "rejected")
						expect(edited[0].reason.message).toContain("changed");
				}
				const saved = await fresh(graph.subject);
				expect(saved.generation?.status).toBe("completed");
				if (kind === "pr") {
					expect(saved.description).toBe("Model revised graph proposal");
					expect(saved.revision).toBe(2);
				} else {
					expect(completed.prIds).toHaveLength(1);
					const [rows] = await conn.execute<RowDataPacket[]>(
						"SELECT id FROM tanahpedia_entry WHERE unique_name=?",
						[uniqueName],
					);
					expect(rows).toHaveLength(0);
				}
			} finally {
				gate.release();
				pause.mockRestore();
				await Promise.allSettled([completing, ...(edits ? [edits] : [])]);
			}
		},
	);
	it("serializes simultaneous same-issue PR completions and rejects the stale graph without deadlock", async () => {
		const graph = await linkedGraph("pr");
		const sibling = await service.updateContribution(
			{
				id: graph.sibling.id,
				version: graph.sibling.version,
				action: "assign",
				assignee: { kind: "local_llm", agentId: graph.agent.id },
			},
			alice,
		);
		const firstJob = await claim(graph.subject),
			secondJob = await claim(sibling),
			gate = graphGate(),
			secondGate = graphGate();
		const context = await import(
				"~/server/tanahpedia/contribution-agent-context.server"
			),
			lock = context.lockContributionAgentContext,
			revise = service.applyContributionAgentRevision;
		const observe = vi
			.spyOn(context, "lockContributionAgentContext")
			.mockImplementation((...args) => {
				const locking = lock(...args);
				if (args[1].id === sibling.id) secondGate.enter();
				return locking;
			});
		const pause = vi
			.spyOn(service, "applyContributionAgentRevision")
			.mockImplementationOnce(async (...args) => {
				gate.enter();
				await gate.pending;
				return revise(...args);
			});
		const first = worker.completeContributionGeneration({
			...identity(firstJob),
			content: result("First graph revision", undefined, {
				description: "First completed graph revision",
			}),
		});
		let second:
			| ReturnType<typeof worker.completeContributionGeneration>
			| undefined;
		let both:
			| Promise<PromiseSettledResult<Awaited<typeof first>>[]>
			| undefined;
		try {
			await Promise.race([
				gate.reached,
				first.then(() => {
					throw new Error("First completion skipped its barrier");
				}),
			]);
			second = worker.completeContributionGeneration({
				...identity(secondJob),
				content: result("Second graph revision", undefined, {
					description: "Stale second graph revision",
				}),
			});
			both = Promise.allSettled([first, second]);
			await Promise.race([
				secondGate.reached,
				second.then(() => {
					throw new Error("Second completion skipped the graph lock");
				}),
			]);
			gate.release();
			const completed = await both;
			expect(completed[0].status).toBe("fulfilled");
			expect(completed[1].status).toBe("rejected");
			if (completed[1].status === "rejected") {
				expect(completed[1].reason.code).not.toBe("ER_LOCK_DEADLOCK");
				expect(completed[1].reason.message).toContain("context changed");
			}
			expect((await fresh(graph.subject)).description).toBe(
				"First completed graph revision",
			);
			expect((await fresh(sibling)).description).toBe(
				"Original graph proposal",
			);
		} finally {
			gate.release();
			await (both ?? Promise.allSettled([first, ...(second ? [second] : [])]));
			pause.mockRestore();
			observe.mockRestore();
		}
	});
	it("completes two different issues with empty sibling sets without a range-gap insertion deadlock", async () => {
		const firstGraph = await assignedIssue(),
			secondGraph = await assignedIssue();
		const jobs = await Promise.all([
				claim(firstGraph.item),
				claim(secondGraph.item),
			]),
			gate = graphGate();
		const create = service.createContribution;
		let reached = 0;
		const pause = vi
			.spyOn(service, "createContribution")
			.mockImplementation(async (...args) => {
				if (args[1].kind === "local_llm") {
					reached++;
					if (reached === 2) gate.enter();
					await gate.pending;
				}
				return create(...args);
			});
		const completions = jobs.map((job) =>
			worker.completeContributionGeneration({
				...identity(job),
				content: implementation(`empty-graph-${randomUUID()}`),
			}),
		);
		const completed = Promise.allSettled(completions);
		try {
			await Promise.race([
				gate.reached,
				...completions.map((completion) =>
					completion.then(() => {
						throw new Error(
							"Implementation skipped its final creation barrier",
						);
					}),
				),
			]);
			gate.release();
			for (const entry of await completed) {
				expect(entry.status).toBe("fulfilled");
				if (entry.status === "fulfilled")
					expect(entry.value.prIds).toHaveLength(1);
			}
			expect((await fresh(firstGraph.item)).generation?.status).toBe(
				"completed",
			);
			expect((await fresh(secondGraph.item)).generation?.status).toBe(
				"completed",
			);
		} finally {
			gate.release();
			await completed;
			pause.mockRestore();
		}
	});
	it.each(["entity", "person_name", "perek", "alternative"] as const)(
		"pins authoritative %s reference rows after final receipt validation through proposal creation",
		async (kind) => {
			const reference = await referenceFixture(kind),
				{ item } = await assignedIssue(),
				job = await claim(item),
				gate = graphGate();
			const read = await worker.readContributionWorkerContext({
				...identity(job),
				name: "record",
				arguments: { kind, id: reference.id },
			});
			const create = service.createContribution;
			const pause = vi
				.spyOn(service, "createContribution")
				.mockImplementationOnce(async (...args) => {
					gate.enter();
					await gate.pending;
					return create(...args);
				});
			const completing = worker.completeContributionGeneration({
				...identity(job),
				receipts: [read.receipt],
				content: implementation(`reference-${randomUUID()}`),
			});
			try {
				await Promise.race([
					gate.reached,
					completing.then(() => {
						throw new Error("Completion skipped the final reference barrier");
					}),
				]);
				const probe = await db.pool.getConnection();
				try {
					await probe.beginTransaction();
					for (const point of reference.probes)
						await expect(referenceLock(probe, point)).rejects.toMatchObject({
							code: "ER_LOCK_NOWAIT",
						});
				} finally {
					await probe.rollback();
					probe.release();
				}
				gate.release();
				expect((await completing).prIds).toHaveLength(1);
			} finally {
				gate.release();
				await completing.catch(() => {});
				pause.mockRestore();
				await reference.cleanup();
			}
		},
	);
	it.each([
		["entity", "record"],
		["person_name", "record"],
		["perek", "record"],
		["alternative", "record"],
		["entity", "search"],
		["perek", "search"],
	] as const)(
		"rejects a fresh %s %s change committed after the final transaction snapshot but before its locking read",
		async (kind, toolName) => {
			const reference = await referenceFixture(kind),
				{ item } = await assignedIssue(),
				job = await claim(item);
			const args =
				toolName === "record"
					? { kind, id: reference.id }
					: { kind, query: String(reference.id), limit: 10 };
			const read = await worker.readContributionWorkerContext({
				...identity(job),
				name: toolName,
				arguments: args,
			});
			const writer = await db.pool.getConnection();
			await writer.beginTransaction();
			await reference.change(writer);
			const context = await import(
					"~/server/tanahpedia/contribution-agent-context.server"
				),
				original = context.readContributionAgentTool;
			let committed = false;
			const commitAfterSnapshot = vi
				.spyOn(context, "readContributionAgentTool")
				.mockImplementation(async (...params) => {
					if (params[4] && params[2] === toolName && !committed) {
						await writer.commit();
						committed = true;
					}
					return original(...params);
				});
			try {
				await expect(
					worker.completeContributionGeneration({
						...identity(job),
						receipts: [read.receipt],
						content: implementation(`stale-reference-${randomUUID()}`),
					}),
				).rejects.toThrow("tool-read record");
				expect(committed).toBe(true);
				expect((await fresh(item)).generation?.status).toBe("failed");
				const [created] = await conn.execute<RowDataPacket[]>(
					"SELECT id FROM tanahpedia_contribution WHERE issue_id=?",
					[item.id],
				);
				expect(created).toHaveLength(0);
			} finally {
				commitAfterSnapshot.mockRestore();
				await writer.rollback();
				writer.release();
				await reference.cleanup();
			}
		},
	);
	it("rejects a verse-bound-only change after the final snapshot before its current perek reread", async () => {
		const reference = await referenceFixture("perek"),
			{ item } = await assignedIssue(),
			job = await claim(item);
		await conn.execute("UPDATE tanah_perek SET pasuk_count=2 WHERE id=?", [
			reference.id,
		]);
		const read = await worker.readContributionWorkerContext({
			...identity(job),
			name: "search",
			arguments: { kind: "perek", query: "ספר בדיקה ב א ב" },
		});
		expect(read.data).toMatchObject({
			items: [{ id: reference.id, name: "ספר בדיקה ב א" }],
			total: 1,
		});
		const writer = await db.pool.getConnection();
		await writer.beginTransaction();
		await writer.execute("UPDATE tanah_perek SET pasuk_count=1 WHERE id=?", [
			reference.id,
		]);
		const context = await import(
				"~/server/tanahpedia/contribution-agent-context.server"
			),
			original = context.readContributionAgentTool;
		let committed = false;
		const commitAfterSnapshot = vi
			.spyOn(context, "readContributionAgentTool")
			.mockImplementation(async (...params) => {
				if (params[4] && params[2] === "search" && !committed) {
					await writer.commit();
					committed = true;
				}
				return original(...params);
			});
		try {
			await expect(
				worker.completeContributionGeneration({
					...identity(job),
					receipts: [read.receipt],
					content: implementation(`stale-verse-bound-${randomUUID()}`),
				}),
			).rejects.toThrow("tool-read record");
			expect(committed).toBe(true);
			expect((await fresh(item)).generation?.status).toBe("failed");
			const [created] = await conn.execute<RowDataPacket[]>(
				"SELECT id FROM tanahpedia_contribution WHERE issue_id=?",
				[item.id],
			);
			expect(created).toHaveLength(0);
		} finally {
			commitAfterSnapshot.mockRestore();
			await writer.rollback();
			writer.release();
			await reference.cleanup();
		}
	});
	it("fails closed immediately when an authoritative reference is busy during final validation", async () => {
		const reference = await referenceFixture("entity"),
			{ item } = await assignedIssue(),
			job = await claim(item);
		const read = await worker.readContributionWorkerContext({
			...identity(job),
			name: "record",
			arguments: { kind: "entity", id: reference.id },
		});
		const writer = await db.pool.getConnection();
		try {
			await writer.beginTransaction();
			await reference.change(writer);
			await expect(
				worker.completeContributionGeneration({
					...identity(job),
					receipts: [read.receipt],
					content: implementation(`busy-reference-${randomUUID()}`),
				}),
			).rejects.toMatchObject({ code: "ER_LOCK_NOWAIT" });
			expect((await fresh(item)).generation?.status).toBe("failed");
			const [created] = await conn.execute<RowDataPacket[]>(
				"SELECT id FROM tanahpedia_contribution WHERE issue_id=?",
				[item.id],
			);
			expect(created).toHaveLength(0);
		} finally {
			await writer.rollback();
			writer.release();
			await reference.cleanup();
		}
	});
	it("commits assignment and its queued task together, while invalid registry assignments roll back creation", async () => {
		const { item, agent } = await assignedIssue();
		expect((await fresh(item)).generation).toMatchObject({
			status: "queued",
			task: "issue_implementation",
			agentId: agent.id,
			agentVersion: agent.version,
			bundleHash: agent.bundleHash,
			triggerEventIds: [item.events[0].id],
		});
		expect(
			await worker.claimContributionGeneration({
				workerId: "old-protocol",
				issueId: item.id,
			}),
		).toBeNull();
		const title = `Rollback agent issue ${randomUUID()}`;
		await expect(
			service.createContribution(
				{
					kind: "issue",
					title,
					description: "Must roll back",
					evidence,
					assignee: { kind: "local_llm", agentId: randomUUID() },
				},
				alice,
			),
		).rejects.toThrow("not found");
		const [rows] = await conn.execute<RowDataPacket[]>(
			"SELECT id FROM tanahpedia_contribution WHERE title=?",
			[title],
		);
		expect(rows).toHaveLength(0);
	});
	it("lets one v2 worker lease an assignment and receipts unchanged prior work without duplicate PRs", async () => {
		const { item } = await assignedIssue();
		const existing = await createPr(
			[metadata(`Existing proposal ${randomUUID()}`)],
			bot,
			item.id,
		);
		const claims = await Promise.all([
			worker.claimContributionGeneration({
				workerId: "first",
				issueId: item.id,
				protocolVersion: 2,
				supportedTasks: ["issue_implementation"],
			}),
			worker.claimContributionGeneration({
				workerId: "second",
				issueId: item.id,
				protocolVersion: 2,
				supportedTasks: ["issue_implementation"],
			}),
		]);
		expect(claims.filter(Boolean)).toHaveLength(1);
		const job = claims.find(
			(value) =>
				value && "protocolVersion" in value && value.protocolVersion === 2,
		);
		if (!job || !("protocolVersion" in job))
			throw new Error("No v2 worker won the claim");
		const related = await worker.readContributionWorkerContext({
			...identity(job),
			name: "related",
			arguments: { section: "items", limit: 1 },
		});
		expect(related.data).toMatchObject({
			total: 1,
			items: [{ id: existing.id }],
		});
		const input = {
			...identity(job),
			receipts: [related.receipt],
			content: result("Existing proposal already covers this issue"),
		};
		expect(await worker.completeContributionGeneration(input)).toEqual({
			prIds: [],
		});
		expect(await worker.completeContributionGeneration(input)).toEqual({
			prIds: [],
		});
		const saved = await fresh(item);
		expect(saved.generation).toMatchObject({
			status: "completed",
			result: { outcome: "unchanged", changed: false },
		});
		expect(
			saved.events.filter((event) => event.kind === "agent_response"),
		).toHaveLength(1);
		const [rows] = await conn.execute<RowDataPacket[]>(
			"SELECT id FROM tanahpedia_contribution WHERE issue_id=?",
			[item.id],
		);
		expect(rows.map((row) => row.id)).toEqual([existing.id]);
	});
	it("atomically queues one concurrent human comment, revokes the old lease and revises that same PR", async () => {
		const agent = await installedAgent(),
			entityId = await isolatedEntity();
		let pr = await service.createContribution(
			{
				kind: "pr",
				title: "Original agent PR",
				description: "Original description",
				evidence,
				changes: [
					{
						kind: "metadata",
						targetId: entityId,
						after: { displayName: "Proposed value" },
					},
				],
				assignee: { kind: "local_llm", agentId: agent.id },
			},
			owner,
		);
		const old = await claim(pr);
		const comments = await Promise.allSettled(
			["First feedback", "Concurrent feedback"].map((body) =>
				service.updateContribution(
					{ id: pr.id, version: old.version, action: "comment", body },
					alice,
				),
			),
		);
		expect(
			comments.filter((entry) => entry.status === "fulfilled"),
		).toHaveLength(1);
		expect(
			comments.filter((entry) => entry.status === "rejected"),
		).toHaveLength(1);
		pr = await fresh(pr);
		const comment = pr.events.filter((event) => event.kind === "comment");
		expect(comment).toHaveLength(1);
		expect(pr.generation).toMatchObject({
			status: "queued",
			trigger: "comment",
			triggerEventIds: expect.arrayContaining([comment[0].id]),
		});
		expect(pr.generation?.id).not.toBe(old.id);
		await expect(
			worker.completeContributionGeneration({
				...identity(old),
				content: result("Stale result"),
			}),
		).rejects.toThrow("no longer owns");
		expect((await fresh(pr)).generation?.status).toBe("queued");
		const job = await claim(pr),
			input = {
				...identity(job),
				content: result("Feedback addressed", comment[0].id, {
					description: "Corrected description",
				}),
			};
		await worker.completeContributionGeneration(input);
		await worker.completeContributionGeneration(input);
		pr = await fresh(pr);
		expect(pr).toMatchObject({
			title: "Original agent PR",
			description: "Corrected description",
			revision: 2,
			revisionAuthor: {
				id: `agent:${agent.id}`,
				kind: "local_llm",
				isDoradsoft: false,
			},
			assignee: { agentId: agent.id },
		});
		expect(pr.revisionHistory).toHaveLength(1);
		expect(
			pr.events.filter((event) => event.kind === "agent_response"),
		).toHaveLength(1);
		expect(pr.events.find((event) => event.id === comment[0].id)).toEqual(
			comment[0],
		);
		expect(reviewStatus(pr)).toBe("required");
		const [rows] = await conn.execute<RowDataPacket[]>(
			"SELECT name FROM tanahpedia_entity WHERE id=?",
			[entityId],
		);
		expect(rows[0].name).toBe(`Current ${entityId}`);
	});
	it.each(["identical", "clobbered"])(
		"enforces a status request's exact fields on an owner-authored PR (%s draft)",
		async (mode) => {
			const agent = await installedAgent(),
				entityId = await isolatedEntity();
			let pr = await service.createContribution(
				{
					kind: "pr",
					title: "שאלת מצב",
					description: "תיאור מקורי.  \nנשאר בדיוק.",
					evidence,
					changes: [
						{
							kind: "metadata",
							targetId: entityId,
							after: { displayName: "Proposed" },
						},
					],
					assignee: { kind: "local_llm", agentId: agent.id },
				},
				owner,
			);
			const original = structuredClone(pr);
			pr = await service.updateContribution(
				{
					id: pr.id,
					version: pr.version,
					action: "comment",
					body: "מה חסר? יש לשמר בדיוק את התיאור, הראיות ורצף השינויים.",
				},
				alice,
			);
			const comment = pr.events.find((event) => event.kind === "comment");
			if (!comment) throw new Error("Missing status feedback");
			const job = await claim(pr);
			const completion = worker.completeContributionGeneration({
				...identity(job),
				content: result("נבדק", comment.id, {
					description:
						mode === "identical"
							? original.description
							: "Copied issue background",
					evidenceIndexes: [0],
					changes: original.changes.map(({ kind, targetId, after }) => ({
						kind,
						targetId,
						after,
					})),
				}),
			});
			if (mode === "clobbered")
				await expect(completion).rejects.toThrow(
					"preserving the current description",
				);
			else await completion;
			const saved = await fresh(pr);
			expect(saved.description).toBe(original.description);
			expect(saved.evidence).toEqual(original.evidence);
			expect(saved.changes).toEqual(original.changes);
			expect(saved.revision).toBe(original.revision);
			expect(reviewStatus(saved)).toBe("exempt");
			expect(saved.generation?.status).toBe(
				mode === "identical" ? "completed" : "failed",
			);
		},
	);
	it("retains an approved revision after a no-op pass and never queues model-authored comments", async () => {
		const agent = await installedAgent(),
			entityId = await isolatedEntity();
		let pr = await service.createContribution(
			{
				kind: "pr",
				title: "Approved no-op PR",
				description: "Unchanged",
				evidence,
				changes: [
					{
						kind: "metadata",
						targetId: entityId,
						after: { displayName: "Proposed" },
					},
				],
				assignee: { kind: "local_llm", agentId: agent.id },
			},
			bot,
		);
		pr = await service.updateContribution(
			{ id: pr.id, version: pr.version, action: "approve" },
			owner,
		);
		pr = await service.updateContribution(
			{
				id: pr.id,
				version: pr.version,
				action: "comment",
				body: "Please confirm",
			},
			alice,
		);
		await expect(
			service.mergeContribution({ id: pr.id, version: pr.version }, owner),
		).rejects.toThrow("assigned agent pass");
		const comment = pr.events.find((event) => event.kind === "comment");
		if (!comment) throw new Error("Feedback missing");
		const job = await claim(pr);
		await worker.completeContributionGeneration({
			...identity(job),
			content: result("Confirmed unchanged", comment.id),
		});
		pr = await fresh(pr);
		expect(pr.revision).toBe(1);
		expect(reviewStatus(pr)).toBe("approved");
		const completedJob = pr.generation?.id;
		pr = await service.updateContribution(
			{
				id: pr.id,
				version: pr.version,
				action: "comment",
				body: "Model response",
			},
			bot,
		);
		expect(pr.generation).toMatchObject({
			id: completedJob,
			status: "completed",
		});
	});
	it("rejects an authoritative tool record changed after observation without creating proposals", async () => {
		const { item } = await assignedIssue(),
			entityId = await isolatedEntity(),
			job = await claim(item);
		const read = await worker.readContributionWorkerContext({
			...identity(job),
			name: "record",
			arguments: { kind: "entity", id: entityId },
		});
		await conn.execute(
			"UPDATE tanahpedia_entity SET name='Changed after read' WHERE id=?",
			[entityId],
		);
		const content = canonicalJson({
			outcome: "implemented",
			summary: "Must reject stale record",
			responses: [],
			pullRequests: [
				{
					title: "Metadata",
					description: "Source-backed",
					evidenceIndexes: [0],
					changes: [
						{
							kind: "metadata",
							targetId: entityId,
							after: { displayName: "Do not save" },
						},
					],
				},
			],
		});
		await expect(
			worker.completeContributionGeneration({
				...identity(job),
				receipts: [read.receipt],
				content,
			}),
		).rejects.toThrow("tool-read record");
		expect((await fresh(item)).generation?.status).toBe("failed");
		const [rows] = await conn.execute<RowDataPacket[]>(
			"SELECT id FROM tanahpedia_contribution WHERE issue_id=?",
			[item.id],
		);
		expect(rows).toHaveLength(0);
	});
});

afterAll(async () => {
	await db?.pool.end();
	if (created) await conn.query(`DROP DATABASE \`${schema}\``);
	await conn?.end();
	vi.unstubAllEnvs();
});

async function fresh(item: Contribution): Promise<Contribution> {
	return store.withContributions((transaction) =>
		store.readContribution(transaction, item.id),
	);
}
async function createPr(changes: unknown[], actor = bot, issueId?: string) {
	return service.createContribution(
		{
			kind: "pr",
			title: "הצעה לבדיקה",
			description: "שינוי מובנה לבדיקה",
			evidence,
			changes,
			issueId,
		},
		actor,
	);
}
function metadata(name: string) {
	return {
		kind: "metadata",
		targetId: ids.entity,
		after: { displayName: name },
	};
}

describe("canonical agent chapter lookup with actual MySQL", () => {
	async function reader() {
		const item = await service.createContribution(
			{
				kind: "issue",
				title: "בדיקת מקורות",
				description: "בדיקת חיפוש בלבד",
				evidence,
			},
			alice,
		);
		const context = await import(
			"~/server/tanahpedia/contribution-agent-context.server"
		);
		return (name: "search" | "record", args: Record<string, unknown>) =>
			store.withContributions((tx) =>
				context.readContributionAgentTool(tx, item, name, {
					kind: "perek",
					...args,
				}),
			);
	}
	it("returns one canonical chapter identity for Hebrew, Arabic and complete legacy verse references", async () => {
		const read = await reader();
		const record = await read("record", { id: 1 });
		expect(record.data).toMatchObject({ record: { id: 1, name: "בראשית א" } });
		for (const query of [
			"בראשית א",
			"בראשית 1",
			"בְּרֵאשִׁית א׳",
			"בראשית א כו",
			"בראשית א:26",
			"בראשית א, כו-כח",
		]) {
			const result = await read("search", { query });
			expect(result.data).toMatchObject({
				items: [{ id: 1, name: "בראשית א" }],
				total: 1,
				nextCursor: null,
			});
			expect((result.data as { records: unknown[] }).records).toEqual(
				(record.data as { records: unknown[] }).records,
			);
		}
		for (const query of [
			"בראשית אא",
			"בראשית א לב",
			"בראשית 0",
			"בראשית פרק",
			"בראשית א פסוק",
		]) {
			expect((await read("search", { query })).data).toMatchObject({
				items: [],
				total: 0,
				nextCursor: null,
			});
		}
	});
	it("keeps split-book identities and ambiguous chapter results distinct across pages", async () => {
		await conn.execute(
			"INSERT INTO tanah_sefer (id,name,perek_id_from,perek_id_to) VALUES (8000,'שמואל',800001,800004)",
		);
		await conn.execute(
			"INSERT INTO tanah_perek (id,perek,pasuk_count) VALUES (800001,1,28),(800002,2,36),(800003,1,27),(800004,2,32)",
		);
		await conn.execute(
			"INSERT INTO tanah_additional (id,sefer_id,letter,tanach_us_name,perek_from,perek_to) VALUES (8001,8000,'א','test-a',800001,800002),(8002,8000,'ב','test-b',800003,800004)",
		);
		try {
			const read = await reader();
			const first = await read("search", { query: "שמואל 1", limit: 1 });
			expect(first.data).toMatchObject({
				items: [{ id: 800001, name: "שמואל א א" }],
				total: 2,
				nextCursor: 1,
			});
			expect(
				(await read("search", { query: "שמואל 1", limit: 1, cursor: 1 })).data,
			).toMatchObject({
				items: [{ id: 800003, name: "שמואל ב א" }],
				total: 2,
				nextCursor: null,
			});
			expect((await read("search", { query: "שמואל א" })).data).toMatchObject({
				items: [
					{ id: 800001, name: "שמואל א א" },
					{ id: 800002, name: "שמואל א ב" },
				],
				total: 2,
			});
			expect(
				(await read("search", { query: "שמואל ב א כז" })).data,
			).toMatchObject({ items: [{ id: 800003, name: "שמואל ב א" }], total: 1 });
			expect(
				(await read("search", { query: "שמואל ב א כח" })).data,
			).toMatchObject({ items: [], total: 0 });
			expect((await read("record", { id: 800003 })).data).toMatchObject({
				record: { id: 800003, name: "שמואל ב א" },
			});
			expect((await read("search", { query: "800003" })).data).toMatchObject({
				items: [{ id: 800003, name: "שמואל ב א" }],
				total: 1,
			});
			expect(
				(await read("search", { query: "שמואל 1", cursor: 2 })).data,
			).toMatchObject({ items: [], total: 2, nextCursor: null });
		} finally {
			await conn.execute(
				"DELETE FROM tanah_additional WHERE id IN (8001,8002)",
			);
			await conn.execute(
				"DELETE FROM tanah_perek WHERE id BETWEEN 800001 AND 800004",
			);
			await conn.execute("DELETE FROM tanah_sefer WHERE id=8000");
		}
	});
});

describe("durable issue assignment", () => {
	it.each([
		...FAMILY_PARENT_CHILD_RELATIONSHIP_TYPES.map((type) => [
			"parent_child",
			type,
		]),
		...FAMILY_UNION_TYPES.map((type) => ["union", type]),
	])("applies the defined family relationship %s:%s", async (kind, type) => {
		const targetId = randomUUID();
		const after =
			kind === "parent_child"
				? {
						parentId: ids.parent,
						childId: ids.person,
						relationshipType: type,
						parentRole: "FATHER",
					}
				: { person1Id: ids.parent, person2Id: ids.person, unionType: type };
		const pr = await createPr([{ kind, targetId, after }], owner);
		await service.mergeContribution({ id: pr.id, version: pr.version }, owner);
		const sql =
			kind === "parent_child"
				? "SELECT t.name FROM tanahpedia_person_parent_child r JOIN tanahpedia_lookup_parent_child_type t ON t.id=r.relationship_type_id WHERE r.id=?"
				: "SELECT t.name FROM tanahpedia_person_union r JOIN tanahpedia_lookup_union_type t ON t.id=r.union_type_id WHERE r.id=?";
		const [rows] = await conn.execute<RowDataPacket[]>(sql, [targetId]);
		expect(rows[0].name).toBe(type);
	});
	it("searches the displayed Hebrew unassigned label", async () => {
		const issue = await service.createContribution(
			{
				kind: "issue",
				title: "Hebrew assignment search",
				description: "Fixture",
			},
			alice,
		);
		const page = await store.listContributions({
			kind: "issue",
			state: "open",
			q: "ללא שיוך",
		});
		expect(page.items.some((item) => item.id === issue.id)).toBe(true);
		expect(
			page.items.every((item) => item.assignee.kind === "unassigned"),
		).toBe(true);
	});
	it("pages and searches older open discussions independently of newer closed history", async () => {
		const old = await service.createContribution(
			{
				kind: "issue",
				title: `old-${randomUUID()}`,
				description: "unique earlier discussion",
				assignee: { kind: "local_llm" },
			},
			alice,
		);
		const rows = Array.from({ length: 501 }, (_, index) => {
			const item = {
				...old,
				id: randomUUID(),
				number: 0,
				state: "closed",
				title: `newer closed ${index}`,
			};
			return [item.id, "issue", "closed", item.title, 1, JSON.stringify(item)];
		});
		await conn.query(
			"INSERT INTO tanahpedia_contribution (id,kind,state,title,version,data) VALUES ?",
			[rows],
		);
		const found = await store.listContributions({
			kind: "issue",
			state: "open",
			q: old.title,
			assignee: "local_llm",
		});
		expect(found.items.map((item) => item.id)).toEqual([old.id]);
		expect(found.counts).toMatchObject({ open: 1, closed: 0, all: 1 });
		const seen = new Set<string>();
		let before: number | undefined;
		do {
			const page = await store.listContributions({
				kind: "issue",
				state: "closed",
				q: "newer closed",
				before,
			});
			for (const item of page.items) {
				expect(seen.has(item.id)).toBe(false);
				seen.add(item.id);
			}
			before = page.nextCursor ?? undefined;
		} while (before);
		expect(seen.size).toBe(501);
	});
	it("synchronizes person readers on rename and rejects independently changed MAIN names", async () => {
		const nameId = randomUUID();
		await conn.execute(
			"INSERT INTO tanahpedia_person_name (id,person_id,name,name_type_id) SELECT ?,?,'Previous main name',id FROM tanahpedia_lookup_name_type WHERE name='MAIN'",
			[nameId, ids.person],
		);
		let pr = await createPr([metadata("Updated person")], owner);
		expect(pr.changes[0].personNames).toEqual([
			{ id: nameId, name: "Previous main name" },
		]);
		await conn.execute(
			"UPDATE tanahpedia_person_name SET name='Concurrent name' WHERE id=?",
			[nameId],
		);
		await expect(
			service.mergeContribution({ id: pr.id, version: pr.version }, owner),
		).rejects.toThrow("main names changed");
		pr = await service.editContribution(
			{
				id: pr.id,
				version: pr.version,
				title: pr.title,
				description: pr.description,
				evidence: pr.evidence,
				changes: [metadata("Updated person")],
			},
			owner,
		);
		await service.mergeContribution({ id: pr.id, version: pr.version }, owner);
		const { getPerson, getPersons } = await import(
			"~/server/tanahpedia/persons"
		);
		expect(await getPerson({ data: ids.person })).toMatchObject({
			name: "Updated person",
		});
		expect(
			(await getPersons()).find((person) => person.id === ids.person)?.name,
		).toBe("Updated person");
	});
	it.each(["deployment", "read", "merge"])(
		"automatically upgrades an approved v1 person rename via %s without renewed review",
		async (path) => {
			let pr = await createPr([metadata(`Legacy upgraded person ${path}`)]);
			await store.withContributions(async (tx) => {
				const item = await store.readContribution(tx, pr.id, true);
				item.apiVersion = 1;
				delete item.changes[0].personNames;
				await store.saveContribution(tx, item);
			});
			pr = await fresh(pr);
			pr = await service.updateContribution(
				{ id: pr.id, version: pr.version, action: "approve" },
				owner,
			);
			const approved = structuredClone(pr.events),
				revision = pr.revision,
				original = structuredClone(pr.changes);
			const { migrateOpenContributionPrs, readCurrentContribution } =
				await import("~/server/tanahpedia/contribution-migrations.server");
			if (path === "deployment") await migrateOpenContributionPrs();
			else if (path === "read")
				await store.withContributions((tx) =>
					readCurrentContribution(tx, pr.id),
				);
			else
				await service.mergeContribution(
					{ id: pr.id, version: pr.version },
					owner,
				);
			pr = await fresh(pr);
			expect(pr.apiVersion).toBe(CONTRIBUTION_API_VERSION);
			expect(pr.apiMigration?.status).toBe("succeeded");
			expect(pr.events.slice(0, approved.length)).toEqual(approved);
			expect(pr.revision).toBe(revision);
			expect(JSON.parse(pr.apiMigration?.sequence ?? "null")).toEqual(original);
			expect(pr.changes[0].personNames?.length).toBeGreaterThan(0);
			if (pr.state !== "merged")
				expect(
					(
						await service.mergeContribution(
							{ id: pr.id, version: pr.version },
							owner,
						)
					).state,
				).toBe("merged");
		},
	);
	it("commits a gray migration failure even when a direct merge is rejected", async () => {
		let pr = await createPr([metadata("Late incompatible proposal")]);
		pr = await service.updateContribution(
			{ id: pr.id, version: pr.version, action: "approve" },
			owner,
		);
		await store.withContributions(async (tx) => {
			const old = await store.readContribution(tx, pr.id, true);
			old.apiVersion = 999;
			await store.saveContribution(tx, old);
		});
		const original = await fresh(pr);
		await expect(
			service.mergeContribution(
				{ id: original.id, version: original.version },
				owner,
			),
		).rejects.toThrow("Couldn't migrate");
		const failed = await fresh(pr);
		expect(failed.apiMigration?.status).toBe("failed");
		expect(failed.changes).toEqual(original.changes);
		expect(failed.events).toEqual(original.events);
		expect(failed.revision).toBe(original.revision);
		expect(failed.state).toBe("open");
		expect(failed.version).toBe(original.version + 1);
		await service.updateContribution(
			{ id: failed.id, version: failed.version, action: "close" },
			owner,
		);
	});
	it("prepares and merges person renames concurrently with the same lock order", async () => {
		const pr = await createPr([metadata("Concurrent merge")], owner);
		const { prepareChanges, readChangeState } = await import(
			"~/server/tanahpedia/contribution-changes.server"
		);
		let release: () => void = () => {},
			entered: () => void = () => {};
		const held = new Promise<void>((resolve) => {
				release = resolve;
			}),
			locked = new Promise<void>((resolve) => {
				entered = resolve;
			});
		const preparing = store.withContributions(async (tx) => {
			await readChangeState(tx, "metadata", ids.entity);
			entered();
			await held;
			return prepareChanges(tx, [
				{
					kind: "metadata",
					targetId: ids.entity,
					after: { displayName: "Concurrent draft" },
				},
			]);
		});
		await locked;
		const merging = service.mergeContribution(
			{ id: pr.id, version: pr.version },
			owner,
		);
		try {
			await vi.waitFor(async () => {
				const [waits] = await conn.execute<RowDataPacket[]>(
					"SELECT requesting.OBJECT_NAME FROM performance_schema.data_lock_waits waits JOIN performance_schema.data_locks requesting ON requesting.ENGINE_LOCK_ID=waits.REQUESTING_ENGINE_LOCK_ID WHERE requesting.OBJECT_SCHEMA=? AND requesting.OBJECT_NAME='tanahpedia_entity'",
					[schema],
				);
				expect(waits.length).toBeGreaterThan(0);
			});
		} finally {
			release();
		}
		const [prepared, merged] = await Promise.all([preparing, merging]);
		expect(prepared[0].personNames?.length).toBeGreaterThan(0);
		expect(merged.state).toBe("merged");
	});
	it("persists all four assignee kinds and records a stable discussion number", async () => {
		let issue = await service.createContribution(
			{ kind: "issue", title: "פנייה", description: "תיאור" },
			alice,
		);
		expect(issue.number).toBeGreaterThan(0);
		expect(issue.assignee.kind).toBe("unassigned");
		for (const assignee of [
			{ kind: "human", id: "bob", name: "Bob" },
			{ kind: "aws_llm" },
			{ kind: "local_llm" },
			{ kind: "unassigned" },
		]) {
			issue = await service.updateContribution(
				{ id: issue.id, version: issue.version, action: "assign", assignee },
				alice,
			);
			expect((await fresh(issue)).assignee).toEqual(assignee);
		}
		const events =
			(await store.listContributions({ relatedTo: issue.id })).items.find(
				(item) => item.id === issue.id,
			)?.events ?? [];
		expect(events.filter((event) => event.kind === "assigned")).toHaveLength(4);
		expect(
			events.filter((event) => event.kind === "generation_queued"),
		).toHaveLength(2);
		expect(events).toHaveLength(7);
	});
	it("rejects stale actions and preserves discussion history", async () => {
		const issue = await service.createContribution(
			{ kind: "issue", title: "פנייה", description: "תיאור" },
			alice,
		);
		const changed = await service.updateContribution(
			{
				id: issue.id,
				version: issue.version,
				action: "comment",
				body: "הקשר חדש",
			},
			owner,
		);
		await expect(
			service.updateContribution(
				{ id: issue.id, version: issue.version, action: "close" },
				alice,
			),
		).rejects.toThrow("Reload");
		expect((await fresh(changed)).events.at(-1)?.body).toBe("הקשר חדש");
	});
});

describe("reviewed transactional PR merging", () => {
	it.each([
		["WAR", "tanahpedia_event", "tanahpedia_war", "event_id"],
		["TEMPLE_TOOL", "tanahpedia_object", "tanahpedia_temple_tool", "object_id"],
		["PROPHECY", "tanahpedia_saying", "tanahpedia_prophecy", "saying_id"],
	])(
		"creates a consistent derived %s entry root",
		async (entityType, parentTable, table, parentKey) => {
			const uniqueName = `derived-${randomUUID()}`;
			const pr = await createPr(
				[
					{
						kind: "entry",
						after: {
							title: "ערך נגזר",
							uniqueName,
							entityType,
							displayName: "יישות נגזרת",
						},
					},
				],
				owner,
			);
			await service.mergeContribution(
				{ id: pr.id, version: pr.version },
				owner,
			);
			const [rows] = await conn.execute<RowDataPacket[]>(
				`SELECT e.content, d.id, parent.id parent_id FROM tanahpedia_entry e JOIN tanahpedia_entry_entity ee ON ee.entry_id=e.id JOIN ${table} d ON d.entity_id=ee.entity_id JOIN ${parentTable} parent ON parent.id=d.${parentKey} WHERE e.unique_name=?`,
				[uniqueName],
			);
			expect(rows).toHaveLength(1);
			expect(rows[0].content).toBe("<p></p>");
			expect(rows[0].parent_id).toBeTruthy();
		},
	);
	it("blocks non-owner reviews and model merges before approval", async () => {
		const pr = await createPr([metadata("שם חדש")]);
		await expect(
			service.updateContribution(
				{ id: pr.id, version: pr.version, action: "approve" },
				alice,
			),
		).rejects.toThrow("Only doradsoft");
		await expect(
			service.mergeContribution({ id: pr.id, version: pr.version }, alice),
		).rejects.toThrow("Approval");
		expect((await fresh(pr)).state).toBe("open");
	});
	it("applies an approved PR and closes its linked issue in the same transaction", async () => {
		const issue = await service.createContribution(
			{ kind: "issue", title: "תיקון שם", description: "תיאור", evidence },
			alice,
		);
		let pr = await createPr([metadata("שם מאושר")], bot, issue.id);
		pr = await service.updateContribution(
			{ id: pr.id, version: pr.version, action: "approve" },
			owner,
		);
		const merged = await service.mergeContribution(
			{ id: pr.id, version: pr.version },
			alice,
		);
		expect(merged.state).toBe("merged");
		expect((await fresh(issue)).state).toBe("closed");
		const [rows] = await conn.execute<RowDataPacket[]>(
			"SELECT name FROM tanahpedia_entity WHERE id = ?",
			[ids.entity],
		);
		expect(rows[0].name).toBe("שם מאושר");
		await expect(
			service.mergeContribution(
				{ id: merged.id, version: merged.version },
				owner,
			),
		).rejects.toThrow("open PR");
	});
	it("invalidates approval when the PR content changes", async () => {
		let pr = await createPr([metadata("שם מוצע")]);
		pr = await service.updateContribution(
			{ id: pr.id, version: pr.version, action: "approve" },
			owner,
		);
		pr = await service.editContribution(
			{
				id: pr.id,
				version: pr.version,
				title: pr.title,
				description: "תיאור מעודכן",
				evidence,
				changes: [metadata("שם שונה")],
			},
			alice,
		);
		expect(pr.revision).toBe(2);
		await expect(
			service.mergeContribution({ id: pr.id, version: pr.version }, owner),
		).rejects.toThrow("Approval");
		expect(
			pr.events.some(
				(event) => event.kind === "approved" && event.revision === 1,
			),
		).toBe(true);
	});
	it("rejects a stale target and preserves the newer live state", async () => {
		let pr = await createPr([metadata("שינוי מיושן")]);
		pr = await service.updateContribution(
			{ id: pr.id, version: pr.version, action: "approve" },
			owner,
		);
		await conn.execute(
			"UPDATE tanahpedia_entity SET name = 'שינוי ממקור אחר' WHERE id = ?",
			[ids.entity],
		);
		await expect(
			service.mergeContribution({ id: pr.id, version: pr.version }, owner),
		).rejects.toThrow("Conflict");
		expect((await fresh(pr)).state).toBe("open");
		const [rows] = await conn.execute<RowDataPacket[]>(
			"SELECT name FROM tanahpedia_entity WHERE id = ?",
			[ids.entity],
		);
		expect(rows[0].name).toBe("שינוי ממקור אחר");
	});
	it("merges owner-authored PRs without another review", async () => {
		const pr = await createPr([metadata("שינוי המחבר")], owner);
		expect(
			(
				await service.mergeContribution(
					{ id: pr.id, version: pr.version },
					owner,
				)
			).state,
		).toBe("merged");
	});
	it("rolls back earlier operations when a later operation fails", async () => {
		const taken = `duplicate-${randomUUID()}`;
		const valid = `new-${randomUUID()}`;
		const pr = await createPr(
			[
				{
					kind: "entry",
					targetId: "10000000-0000-4000-8000-000000000001",
					after: {
						title: "חדש",
						uniqueName: valid,
						entityType: "PERSON",
						displayName: "איש חדש",
					},
				},
				{
					kind: "entry",
					targetId: "20000000-0000-4000-8000-000000000002",
					after: {
						title: "התנגשות",
						uniqueName: taken,
						entityType: "PLACE",
						displayName: "מקום חדש",
					},
				},
			],
			owner,
		);
		// The address is free when reviewed, then an independent writer claims it.
		await conn.execute(
			"INSERT INTO tanahpedia_entry (id, unique_name, title, content) VALUES (?, ?, 'Existing', '<p></p>')",
			[randomUUID(), taken],
		);
		await expect(
			service.mergeContribution({ id: pr.id, version: pr.version }, owner),
		).rejects.toThrow();
		const [entries] = await conn.execute<RowDataPacket[]>(
			"SELECT id FROM tanahpedia_entry WHERE unique_name = ?",
			[valid],
		);
		expect(entries).toHaveLength(0);
		const [entities] = await conn.execute<RowDataPacket[]>(
			"SELECT id FROM tanahpedia_entity WHERE name = 'איש חדש'",
		);
		expect(entities).toHaveLength(0);
		expect((await fresh(pr)).state).toBe("open");
	});
	it("rejects a new creation at an already occupied canonical address under database collation", async () => {
		const name = `Canonical-${randomUUID()}`;
		const id = randomUUID();
		await conn.execute(
			"INSERT INTO tanahpedia_entry (id,unique_name,title,content) VALUES (?,?,'Existing','<p></p>')",
			[id, name],
		);
		await expect(
			createPr([
				{
					kind: "entry",
					after: {
						title: "Replacement",
						uniqueName: name.toUpperCase(),
						entityType: "PERSON",
						displayName: "Replacement",
					},
				},
			]),
		).rejects.toThrow("already belongs to an existing entry");
		const [rows] = await conn.execute<RowDataPacket[]>(
			"SELECT title FROM tanahpedia_entry WHERE id=?",
			[id],
		);
		expect(rows[0].title).toBe("Existing");
	});
	it("creates an audited entry shell and typed root without prose", async () => {
		const uniqueName = `shell-${randomUUID()}`;
		const pr = await createPr(
			[
				{
					kind: "entry",
					after: {
						title: "ערך לבדיקה",
						uniqueName,
						entityType: "PERSON",
						displayName: "איש לבדיקה",
					},
				},
			],
			owner,
		);
		await service.mergeContribution({ id: pr.id, version: pr.version }, owner);
		const [entries] = await conn.execute<RowDataPacket[]>(
			"SELECT e.content, r.status, p.id person_id, n.name FROM tanahpedia_entry e JOIN tanahpedia_entry_revision r ON r.entry_id=e.id JOIN tanahpedia_entry_entity ee ON ee.entry_id=e.id JOIN tanahpedia_person p ON p.entity_id=ee.entity_id JOIN tanahpedia_person_name n ON n.person_id=p.id WHERE e.unique_name=?",
			[uniqueName],
		);
		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({
			content: "<p></p>",
			status: "APPLIED",
			name: "איש לבדיקה",
		});
	});
	it("creates, updates and deletes family relationships with lossless metadata", async () => {
		const targetId = randomUUID();
		let pr = await createPr(
			[
				{
					kind: "parent_child",
					targetId,
					after: {
						parentId: ids.parent,
						childId: ids.person,
						relationshipType: "BIOLOGICAL",
						parentRole: "FATHER",
						birthOrder: 2,
						sourceCitation: "בראשית א א",
						altGroupId: null,
					},
				},
			],
			owner,
		);
		await service.mergeContribution({ id: pr.id, version: pr.version }, owner);
		const [rows] = await conn.execute<RowDataPacket[]>(
			"SELECT birth_order,source_citation FROM tanahpedia_person_parent_child WHERE id=?",
			[targetId],
		);
		expect(rows[0]).toMatchObject({
			birth_order: 2,
			source_citation: "בראשית א א",
		});
		pr = await createPr(
			[
				{
					kind: "parent_child",
					targetId,
					after: {
						parentId: ids.parent,
						childId: ids.person,
						relationshipType: "ADOPTIVE",
						parentRole: "FATHER",
						birthOrder: 3,
						sourceCitation: "בראשית ב א",
					},
				},
			],
			owner,
		);
		await service.mergeContribution({ id: pr.id, version: pr.version }, owner);
		pr = await createPr(
			[{ kind: "parent_child", targetId, after: null }],
			owner,
		);
		await service.mergeContribution({ id: pr.id, version: pr.version }, owner);
		expect(
			(
				await conn.execute<RowDataPacket[]>(
					"SELECT id FROM tanahpedia_person_parent_child WHERE id=?",
					[targetId],
				)
			)[0],
		).toHaveLength(0);
	});
	it("preserves union citations and place decimals through update and deletion", async () => {
		const unionId = randomUUID(),
			placeId = randomUUID();
		let pr = await createPr(
			[
				{
					kind: "union",
					targetId: unionId,
					after: {
						person1Id: ids.parent,
						person2Id: ids.person,
						unionType: "MARRIAGE",
						unionOrder: 1,
						endReason: "DEATH",
						sourceCitation: "מקור",
						personSourceCitation: "מקור לאיש",
					},
				},
				{
					kind: "place",
					targetId: placeId,
					after: {
						placeId: ids.place,
						modernName: "מקום",
						latitude: 31.77812345678,
						longitude: -35.23543987654,
					},
				},
			],
			owner,
		);
		await service.mergeContribution({ id: pr.id, version: pr.version }, owner);
		const [rows] = await conn.execute<RowDataPacket[]>(
			"SELECT person_source_citation FROM tanahpedia_person_union WHERE id=?",
			[unionId],
		);
		expect(rows[0].person_source_citation).toBe("מקור לאיש");
		const [coordinates] = await conn.execute<RowDataPacket[]>(
			"SELECT latitude, longitude FROM tanahpedia_place_identification WHERE id=?",
			[placeId],
		);
		expect(Number(coordinates[0].latitude)).toBe(pr.changes[1].after?.latitude);
		expect(Number(coordinates[0].longitude)).toBe(
			pr.changes[1].after?.longitude,
		);
		pr = await createPr(
			[
				{
					kind: "place",
					targetId: placeId,
					after: {
						placeId: ids.place,
						modernName: "מקום מתוקן",
						latitude: 31.8,
						longitude: 35.2,
					},
				},
			],
			owner,
		);
		expect(pr.changes[0].before?.latitude).toBe(31.77812346);
		await service.mergeContribution({ id: pr.id, version: pr.version }, owner);
		pr = await createPr(
			[
				{ kind: "union", targetId: unionId, after: null },
				{ kind: "place", targetId: placeId, after: null },
			],
			owner,
		);
		await service.mergeContribution({ id: pr.id, version: pr.version }, owner);
	});
	it("keeps records intact when schema creation is repeated", async () => {
		const before = await store.listContributions();
		const migration = readFileSync(
			new URL(
				"../../../../data/mysql/tanahpedia_contribution_upgrade.sql",
				import.meta.url,
			),
			"utf8",
		);
		await conn.query(migration);
		await conn.query(migration);
		await conn.query(store.CONTRIBUTION_SCHEMA);
		await conn.query(store.CONTRIBUTION_SCHEMA);
		expect(await store.listContributions()).toEqual(before);
	});
	it("persists API failures and transitive recovery without invalidating an owner approval", async () => {
		const { migrateOpenContributionPrs } = await import(
			"~/server/tanahpedia/contribution-migrations.server"
		);
		let pr = await createPr([metadata("שם אחרי שדרוג")]);
		pr = await service.updateContribution(
			{ id: pr.id, version: pr.version, action: "approve" },
			owner,
		);
		await store.withContributions(async (tx) => {
			const item = await store.readContribution(tx, pr.id, true);
			item.apiVersion = CONTRIBUTION_API_VERSION + 2;
			await store.saveContribution(tx, item);
		});
		const original = await store.withContributions((tx) =>
			store.readContribution(tx, pr.id),
		);
		expect((await migrateOpenContributionPrs()).failed).toBeGreaterThan(0);
		const failed = await store.withContributions((tx) =>
			store.readContribution(tx, pr.id),
		);
		expect(failed.apiMigration?.status).toBe("failed");
		expect(failed.changes).toEqual(original.changes);
		expect(failed.events).toEqual(original.events);
		expect(failed.revision).toBe(original.revision);
		await expect(
			service.mergeContribution(
				{ id: failed.id, version: failed.version },
				owner,
			),
		).rejects.toThrow("Couldn't migrate");
		await migrateOpenContributionPrs({
			version: CONTRIBUTION_API_VERSION,
			adapters: [
				{
					from: CONTRIBUTION_API_VERSION + 2,
					to: CONTRIBUTION_API_VERSION + 1,
					id: "bridge",
					convert: (p) => p,
				},
				{
					from: CONTRIBUTION_API_VERSION + 1,
					to: CONTRIBUTION_API_VERSION,
					id: "latest",
					convert: (p) => p,
				},
			],
		});
		const recovered = await store.withContributions((tx) =>
			store.readContribution(tx, pr.id),
		);
		expect(recovered.apiMigration?.status).toBe("succeeded");
		expect(recovered.apiMigrationHistory).toHaveLength(2);
		expect(recovered.events).toEqual(original.events);
		expect(recovered.revision).toBe(original.revision);
		expect(
			(
				await service.mergeContribution(
					{ id: recovered.id, version: recovered.version },
					owner,
				)
			).state,
		).toBe("merged");
	});
});

describe("all category contribution operations against canonical MySQL", () => {
	async function mergeChanges(changes: unknown[]) {
		const pr = await service.createContribution(
			{
				kind: "pr",
				description: "נתוני בדיקה בלבד",
				title: "שינוי מובנה לבדיקה",
				evidence,
				changes,
			},
			owner,
		);
		await service.mergeContribution({ id: pr.id, version: pr.version }, owner);
		return pr;
	}
	async function current(kind: ChangeInput["kind"], id: string) {
		const { readChangeState } = await import(
			"~/server/tanahpedia/contribution-changes.server"
		);
		return store.withContributions((tx) => readChangeState(tx, kind, id));
	}
	function example(kind: ContributionRecordKind): ChangeState {
		return Object.fromEntries(
			Object.entries(CONTRIBUTION_RECORDS[kind].fields).map(([key, f]) => [
				key,
				f.reference === "alternative"
					? null
					: f.type === "reference"
						? recordRefs[
								key === "sourceNationId" ? "source_nation" : (f.reference ?? "")
							]
						: f.type === "date"
							? 57840101
							: f.type === "integer"
								? 1
								: f.type === "boolean"
									? true
									: f.type === "enum"
										? (f.options?.[0] ?? "")
										: f.type === "blob"
											? "models/test.glb"
											: f.nullable
												? null
												: "תיאור בדיקה",
			]),
		);
	}
	it.each(Object.keys(CONTRIBUTION_RECORDS) as ContributionRecordKind[])(
		"merges and reads back %s without modifying unrelated columns",
		async (kind) => {
			const spec = CONTRIBUTION_RECORDS[kind],
				after = example(kind);
			const pr = await mergeChanges([
				{
					kind,
					...(spec.updateOnly
						? {
								targetId:
									kind === "entry_title" ? recordRefs.entry : recordRefs.saying,
							}
						: {}),
					after,
				},
			]);
			const id = pr.changes[0].targetId;
			expect(await current(kind, id)).toEqual(after);
			let updated: ChangeState | undefined;
			if (Object.hasOwn(spec.fields, "altGroupId"))
				updated = { ...after, altGroupId: randomUUID() };
			else if (kind === "war_side") updated = { ...after, sideNumber: 2 };
			else if (kind === "saying_date") updated = { sayingDate: 57840202 };
			else if (kind === "entry_title") updated = { title: "כותרת מתוקנת" };
			else if (kind === "entry_entity")
				updated = { ...after, entityId: ids.parentEntity };
			else if (kind === "entity_source") updated = { ...after, pasukNumber: 2 };
			if (updated) {
				await mergeChanges([{ kind, targetId: id, after: updated }]);
				expect(await current(kind, id)).toEqual(updated);
			}
			if (!spec.updateOnly) {
				await mergeChanges([{ kind, targetId: id, after: null }]);
				expect(await current(kind, id)).toBeNull();
			} else {
				const [rows] = await conn.query<RowDataPacket[]>(
					kind === "entry_title"
						? "SELECT content FROM tanahpedia_entry WHERE id=?"
						: "SELECT content FROM tanahpedia_saying WHERE id=?",
					[id],
				);
				expect(rows[0].content).toBe(
					kind === "entry_title" ? "<p>fixture</p>" : null,
				);
				await expect(
					service.createContribution(
						{
							kind: "pr",
							description: "נתוני בדיקה בלבד",
							title: "Forbidden",
							evidence,
							changes: [{ kind, targetId: id, after: null }],
						},
						owner,
					),
				).rejects.toThrow("deletion");
			}
		},
	);
	async function titleFixture(content: string | null) {
		const id = randomUUID(),
			uniqueName = `Cafe\u0301-${randomUUID()}`;
		await conn.execute(
			"INSERT INTO tanahpedia_entry (id,title,unique_name,content) VALUES (?,'Before',?,?)",
			[id, uniqueName, content],
		);
		return { id, uniqueName, content };
	}
	it.each([null, "", "<p>Current body</p>"])(
		"records title history and preserves the exact body/address (%s)",
		async (content) => {
			const entry = await titleFixture(content);
			const pr = await mergeChanges([
				{ kind: "entry_title", targetId: entry.id, after: { title: "After" } },
			]);
			const [rows] = await conn.execute<RowDataPacket[]>(
				"SELECT title,unique_name,content FROM tanahpedia_entry WHERE id=?",
				[entry.id],
			);
			expect(rows[0]).toEqual({
				title: "After",
				unique_name: entry.uniqueName,
				content,
			});
			const [history] = await conn.execute<RowDataPacket[]>(
				"SELECT proposed_title,proposed_unique_name,proposed_content,status,source FROM tanahpedia_entry_revision WHERE entry_id=?",
				[entry.id],
			);
			expect(history).toHaveLength(1);
			expect(history[0]).toMatchObject({
				proposed_title: "After",
				proposed_unique_name: entry.uniqueName,
				proposed_content: content,
				status: "APPLIED",
				source: `contribution-pr:${pr.number}`,
			});
			const revisions = await import("~/server/tanahpedia/revisions");
			await expect(
				store.withContributions((tx) =>
					revisions.saveEntryRevisioned(tx, {
						id: entry.id,
						title: "Before",
						unique_name: entry.uniqueName,
						content: "<p>Stale editor</p>",
						baseRevisionId: null,
					}),
				),
			).rejects.toThrow("REVISION_CONFLICT");
		},
	);
	it("preserves prose edited while a title-only PR waits and advances its current revision head", async () => {
		const entry = await titleFixture("<p>Original</p>");
		const pending = await service.createContribution(
			{
				kind: "pr",
				title: "Pending title",
				description: "נתוני בדיקה בלבד",
				evidence,
				changes: [
					{
						kind: "entry_title",
						targetId: entry.id,
						after: { title: "After" },
					},
				],
			},
			owner,
		);
		const revisions = await import("~/server/tanahpedia/revisions");
		const prose = await store.withContributions((tx) =>
			revisions.saveEntryRevisioned(tx, {
				id: entry.id,
				title: "Before",
				unique_name: `current-body-${entry.id}`,
				content: "<p>New current prose</p>",
				baseRevisionId: null,
			}),
		);
		await service.mergeContribution(
			{ id: pending.id, version: pending.version },
			owner,
		);
		const [rows] = await conn.execute<RowDataPacket[]>(
			"SELECT title,unique_name,content FROM tanahpedia_entry WHERE id=?",
			[entry.id],
		);
		expect(rows[0]).toEqual({
			title: "After",
			unique_name: `current-body-${entry.id}`,
			content: "<p>New current prose</p>",
		});
		const [head] = await conn.execute<RowDataPacket[]>(
			"SELECT proposed_content,base_revision_id FROM tanahpedia_entry_revision WHERE entry_id=? AND base_revision_id=?",
			[entry.id, prose.headRevisionId],
		);
		expect(head).toHaveLength(1);
		expect(head[0].proposed_content).toBe("<p>New current prose</p>");
	});
	it("rolls back title revisions along with the PR when a later role operation fails", async () => {
		const entry = await titleFixture("<p>Unchanged</p>");
		await mergeChanges([
			{ kind: "prophet_role", after: { personId: ids.parent } },
		]);
		const pending = await service.createContribution(
			{
				kind: "pr",
				title: "Atomic title revision",
				description: "נתוני בדיקה בלבד",
				evidence,
				changes: [
					{
						kind: "entry_title",
						targetId: entry.id,
						after: { title: "After" },
					},
					{ kind: "prophet_role", after: { personId: ids.parent } },
				],
			},
			owner,
		);
		await expect(
			service.mergeContribution(
				{ id: pending.id, version: pending.version },
				owner,
			),
		).rejects.toThrow("Duplicate");
		const [rows] = await conn.execute<RowDataPacket[]>(
			"SELECT title,content FROM tanahpedia_entry WHERE id=?",
			[entry.id],
		);
		expect(rows[0]).toEqual({ title: "Before", content: "<p>Unchanged</p>" });
		const [history] = await conn.execute<RowDataPacket[]>(
			"SELECT id FROM tanahpedia_entry_revision WHERE entry_id=?",
			[entry.id],
		);
		expect(history).toHaveLength(0);
		expect((await fresh(pending)).state).toBe("open");
	});
	it("rejects unique collisions instead of overwriting another unreviewed role", async () => {
		const role = await mergeChanges([
			{ kind: "prophet_role", after: { personId: ids.person } },
		]);
		const duplicate = await service.createContribution(
			{
				kind: "pr",
				description: "נתוני בדיקה בלבד",
				title: "Duplicate role",
				evidence,
				changes: [{ kind: "prophet_role", after: { personId: ids.person } }],
			},
			owner,
		);
		await expect(
			service.mergeContribution(
				{ id: duplicate.id, version: duplicate.version },
				owner,
			),
		).rejects.toThrow(/Duplicate/);
		expect((await fresh(duplicate)).state).toBe("open");
		expect(await current("prophet_role", role.changes[0].targetId)).toEqual({
			personId: ids.person,
		});
	});
	it("keeps dependent reigns intact until their removal is explicitly reviewed", async () => {
		const role = String(recordRefs.king_role),
			reign = await mergeChanges([
				{
					kind: "king_reign",
					after: {
						kingRoleId: role,
						nationId: recordRefs.nation,
						startDate: 57840101,
						endDate: null,
						altGroupId: null,
					},
				},
			]);
		const deletion = await service.createContribution(
			{
				kind: "pr",
				description: "נתוני בדיקה בלבד",
				title: "Remove role",
				evidence,
				changes: [{ kind: "king_role", targetId: role, after: null }],
			},
			owner,
		);
		await expect(
			service.mergeContribution(
				{ id: deletion.id, version: deletion.version },
				owner,
			),
		).rejects.toThrow("dependent facts");
		expect(
			await current("king_reign", reign.changes[0].targetId),
		).not.toBeNull();
		await mergeChanges([
			{ kind: "king_role", targetId: role, after: null },
			{ kind: "king_reign", targetId: reign.changes[0].targetId, after: null },
		]);
		expect(await current("king_role", role)).toBeNull();
	});
	it.each(["parent_child", "union", "place"] as const)(
		"requires explicit source removal before deleting a cited %s",
		async (kind) => {
			const after =
				kind === "parent_child"
					? {
							parentId: ids.parent,
							childId: ids.person,
							relationshipType: "FOSTER",
							parentRole: "FATHER",
							altGroupId: randomUUID(),
						}
					: kind === "union"
						? {
								person1Id: ids.parent,
								person2Id: ids.person,
								unionType: "BETROTHAL",
								altGroupId: randomUUID(),
							}
						: {
								placeId: ids.place,
								modernName: "זיהוי עם מקור",
								latitude: 31,
								longitude: 35,
								altGroupId: randomUUID(),
							};
			const target = await mergeChanges([{ kind, after }]);
			const targetId = target.changes[0].targetId;
			const source = await mergeChanges([
				{
					kind: "source_reference",
					after: {
						targetKind: kind === "place" ? "place_identification" : kind,
						targetId,
						sourceType: "other",
						sourceText: "מקור מפורש למחיקה",
					},
				},
			]);
			const deletion = await service.createContribution(
				{
					kind: "pr",
					title: "Remove cited fact",
					description: "נתוני בדיקה בלבד",
					evidence,
					changes: [{ kind, targetId, after: null }],
				},
				owner,
			);
			await expect(
				service.mergeContribution(
					{ id: deletion.id, version: deletion.version },
					owner,
				),
			).rejects.toThrow("source references");
			expect(await current(kind, targetId)).not.toBeNull();
			expect(
				await current("source_reference", source.changes[0].targetId),
			).not.toBeNull();
			await mergeChanges([
				{ kind, targetId, after: null },
				{
					kind: "source_reference",
					targetId: source.changes[0].targetId,
					after: null,
				},
			]);
			expect(await current(kind, targetId)).toBeNull();
			expect(
				await current("source_reference", source.changes[0].targetId),
			).toBeNull();
		},
	);
	it.each(["same", "case", "accent"])(
		"rejects repeated alias names under MySQL collation (%s)",
		async (variation) => {
			const name = `Café-${randomUUID()}`;
			const second =
				variation === "case"
					? name.toUpperCase()
					: variation === "accent"
						? name.replace("é", "e")
						: name;
			await expect(
				service.createContribution(
					{
						kind: "pr",
						title: "Duplicate aliases",
						description: "נתוני בדיקה בלבד",
						evidence,
						changes: [name, second].map((name, index) => ({
							kind: "alias_mapping",
							after: {
								name,
								targets: [
									{
										entryId: index ? otherEntry : String(recordRefs.entry),
										label: "",
									},
								],
							},
						})),
					},
					owner,
				),
			).rejects.toThrow("alias name can only appear once");
		},
	);
	it("rejects repeated aliases saved before validation was introduced without writing destinations", async () => {
		const name = `Legacy-${randomUUID()}`;
		const proposal = await service.createContribution(
			{
				kind: "pr",
				title: "Legacy alias sequence",
				description: "נתוני בדיקה בלבד",
				evidence,
				changes: [name, `${name}-other`].map((name, index) => ({
					kind: "alias_mapping",
					after: {
						name,
						targets: [
							{
								entryId: index ? otherEntry : String(recordRefs.entry),
								label: "",
							},
						],
					},
				})),
			},
			owner,
		);
		await store.withContributions(async (tx) => {
			const stored = await store.readContribution(tx, proposal.id, true);
			if (!stored.changes[1].after) throw new Error("Missing alias fixture");
			stored.changes[1].after.name = name.toUpperCase();
			await store.saveContribution(tx, stored);
		});
		const saved = await fresh(proposal);
		await expect(
			service.mergeContribution(
				{ id: saved.id, version: saved.version },
				owner,
			),
		).rejects.toThrow("alias name can only appear once");
		for (const change of saved.changes)
			expect(await current("alias_mapping", change.targetId)).toBeNull();
		expect((await fresh(proposal)).state).toBe("open");
	});
	it("edits alias routing in the same PR and detects concurrent label changes", async () => {
		const name = `כינוי-${randomUUID()}`,
			entryId = String(recordRefs.entry);
		const pr = await mergeChanges([
			{
				kind: "alias_mapping",
				after: { name, targets: [{ entryId, label: "" }] },
			},
		]);
		const id = pr.changes[0].targetId;
		const after = {
			name,
			targets: [
				{ entryId, label: "ראשון" },
				{ entryId: otherEntry, label: "אחר" },
			].sort((a, b) => a.entryId.localeCompare(b.entryId)),
		};
		await mergeChanges([{ kind: "alias_mapping", targetId: id, after }]);
		expect(await current("alias_mapping", id)).toEqual(after);
		const { specialContributionTargets } = await import(
			"~/server/tanahpedia/contribution-specials.server"
		);
		const targets = await store.withContributions(specialContributionTargets);
		const aliases = targets.filter(
			(target) => target.kind === "alias_mapping" && target.label === name,
		);
		expect(aliases).toHaveLength(1);
		expect(aliases[0]).toMatchObject({
			kind: "alias_mapping",
			label: name,
			after,
		});
		expect(await current("alias_mapping", aliases[0].id)).toEqual(after);
		const proposal = await service.createContribution(
			{
				kind: "pr",
				description: "נתוני בדיקה בלבד",
				title: "Alias review",
				evidence,
				changes: [
					{
						kind: "alias_mapping",
						targetId: id,
						after: { name, targets: [{ entryId, label: "" }] },
					},
				],
			},
			owner,
		);
		await conn.execute(
			"UPDATE tanahpedia_entry_synonym_disambiguation d JOIN tanahpedia_entry_synonym s ON s.id=d.synonym_id SET d.disambiguation_label='changed' WHERE s.name=?",
			[name],
		);
		await expect(
			service.mergeContribution(
				{ id: proposal.id, version: proposal.version },
				owner,
			),
		).rejects.toThrow("Conflict");
		await mergeChanges([{ kind: "alias_mapping", targetId: id, after: null }]);
		expect(await current("alias_mapping", id)).toBeNull();
		await expect(
			service.createContribution(
				{
					kind: "pr",
					description: "נתוני בדיקה בלבד",
					title: "Collision",
					evidence,
					changes: [
						{
							kind: "alias_mapping",
							after: { name: "ערך-בדיקה", targets: [{ entryId, label: "" }] },
						},
					],
				},
				owner,
			),
		).rejects.toThrow("canonical");
	});
	it("rejects new-entry proposals that shadow an existing alias under database collation", async () => {
		const name = `Alias-${randomUUID()}`;
		await mergeChanges([
			{
				kind: "alias_mapping",
				after: {
					name,
					targets: [{ entryId: String(recordRefs.entry), label: "" }],
				},
			},
		]);
		await expect(
			service.createContribution(
				{
					kind: "pr",
					title: "New entry collision",
					description: "נתוני בדיקה בלבד",
					evidence,
					changes: [
						{
							kind: "entry",
							after: {
								title: "ערך בדיקה",
								uniqueName: name.toUpperCase(),
								displayName: "ערך בדיקה",
								entityType: "PLACE",
							},
						},
					],
				},
				owner,
			),
		).rejects.toThrow("existing alias");
	});
	it("rebases creation into edits when a later alias resolves its name, requiring fresh owner review", async () => {
		await conn.execute(
			"INSERT INTO tanahpedia_entry_entity (id,entry_id,entity_id) VALUES (?,?,?)",
			[randomUUID(), recordRefs.entry, ids.entity],
		);
		const [original] = await conn.execute<RowDataPacket[]>(
			"SELECT title,unique_name,content FROM tanahpedia_entry WHERE id=?",
			[recordRefs.entry],
		);
		const name = `Late-alias-${randomUUID()}`;
		const proposal = await service.createContribution(
			{
				kind: "pr",
				title: "Concurrent URL collision",
				description: "נתוני בדיקה בלבד",
				evidence,
				changes: [
					{
						kind: "entry",
						after: {
							title: "ערך בדיקה",
							uniqueName: name,
							displayName: "ערך בדיקה",
							entityType: "PERSON",
						},
					},
				],
			},
			owner,
		);
		const alias = await mergeChanges([
			{
				kind: "alias_mapping",
				after: {
					name,
					targets: [{ entryId: String(recordRefs.entry), label: "" }],
				},
			},
		]);
		const pending = await fresh(proposal);
		expect(pending.changes.map((c) => c.kind)).toEqual([
			"entry_title",
			"metadata",
		]);
		expect(pending.changes[0]).toMatchObject({
			targetId: recordRefs.entry,
			before: { title: original[0].title },
			after: { title: "ערך בדיקה" },
		});
		expect(pending.changes[1].targetId).toBe(ids.entity);
		expect(pending.evidence).toEqual(proposal.evidence);
		expect(
			pending.events.find((e) => e.kind === "rebased")?.snapshot?.changes,
		).toEqual(proposal.changes);
		expect(reviewStatus(pending)).toBe("required");
		await expect(
			service.mergeContribution(
				{ id: pending.id, version: pending.version },
				owner,
			),
		).rejects.toThrow("Approval");
		const approved = await service.updateContribution(
			{ id: pending.id, version: pending.version, action: "approve" },
			owner,
		);
		await service.mergeContribution(
			{ id: approved.id, version: approved.version },
			owner,
		);
		expect(
			(await current("alias_mapping", alias.changes[0].targetId))?.targets,
		).toEqual([{ entryId: String(recordRefs.entry), label: "" }]);
		expect(await current("entry", proposal.changes[0].targetId)).toBeNull();
		const [existing] = await conn.execute<RowDataPacket[]>(
			"SELECT title,unique_name,content FROM tanahpedia_entry WHERE id=?",
			[recordRefs.entry],
		);
		expect(existing[0]).toMatchObject({
			title: "ערך בדיקה",
			unique_name: original[0].unique_name,
			content: original[0].content,
		});
		expect((await fresh(proposal)).state).toBe("merged");
	});
	it("rolls back a sequence creating an alias and a new entry at the same address", async () => {
		const name = `Same-PR-address-${randomUUID()}`;
		const proposal = await service.createContribution(
			{
				kind: "pr",
				title: "Atomic URL collision",
				description: "נתוני בדיקה בלבד",
				evidence,
				changes: [
					{
						kind: "entry",
						after: {
							title: "ערך בדיקה",
							uniqueName: name,
							displayName: "ערך בדיקה",
							entityType: "PLACE",
						},
					},
					{
						kind: "alias_mapping",
						after: {
							name,
							targets: [{ entryId: String(recordRefs.entry), label: "" }],
						},
					},
				],
			},
			owner,
		);
		await expect(
			service.mergeContribution(
				{ id: proposal.id, version: proposal.version },
				owner,
			),
		).rejects.toThrow("existing alias");
		for (const change of proposal.changes)
			expect(await current(change.kind, change.targetId)).toBeNull();
	});
	async function pendingCreation(
		name: string,
		entityType: "PERSON" | "PLACE" = "PERSON",
	) {
		return service.createContribution(
			{
				kind: "pr",
				title: "Pending creation resolution",
				description: "נתוני בדיקה בלבד",
				evidence,
				changes: [
					{
						kind: "entry",
						after: {
							title: "כותרת מבוקשת",
							uniqueName: name,
							displayName: "שם מבוקש",
							entityType,
						},
					},
				],
			},
			owner,
		);
	}
	it("rebases creation when another PR creates the same canonical address", async () => {
		const name = `Created-in-parallel-${randomUUID()}`;
		const pending = await pendingCreation(name);
		const actual = await mergeChanges([
			{
				kind: "entry",
				after: {
					title: "כותרת קיימת",
					uniqueName: name,
					displayName: "שם קיים",
					entityType: "PERSON",
				},
			},
		]);
		const refreshed = await fresh(pending);
		expect(refreshed.changes[0]).toMatchObject({
			kind: "entry_title",
			targetId: actual.changes[0].targetId,
			before: { title: "כותרת קיימת" },
			after: { title: "כותרת מבוקשת" },
		});
		expect(refreshed.changes[1]).toMatchObject({
			kind: "metadata",
			before: { displayName: "שם קיים" },
			after: { displayName: "שם מבוקש" },
		});
		expect(reviewStatus(refreshed)).toBe("required");
		expect(refreshed.revisionAuthor?.kind).toBe("system");
		await service.updateContribution(
			{ id: refreshed.id, version: refreshed.version, action: "close" },
			owner,
		);
	});
	it("locks a resolved entry before its entity when a concurrent title merge holds that entry", async () => {
		const name = `Resolution-lock-${randomUUID()}`;
		const actual = await mergeChanges([
			{
				kind: "entry",
				after: {
					title: "Lock target",
					uniqueName: `${name}-canonical`,
					displayName: "Lock entity",
					entityType: "PLACE",
				},
			},
		]);
		const entryId = actual.changes[0].targetId;
		const [links] = await conn.execute<RowDataPacket[]>(
			"SELECT entity_id FROM tanahpedia_entry_entity WHERE entry_id=?",
			[entryId],
		);
		await mergeChanges([
			{
				kind: "alias_mapping",
				after: { name, targets: [{ entryId, label: "" }] },
			},
		]);
		const { prepareChanges } = await import(
			"~/server/tanahpedia/contribution-changes.server"
		);
		await conn.beginTransaction();
		await conn.execute(
			"SELECT id FROM tanahpedia_entry WHERE id=? FOR UPDATE",
			[entryId],
		);
		const preparing = store.withContributions((tx) =>
			prepareChanges(
				tx,
				[
					{
						kind: "entry",
						targetId: randomUUID(),
						after: {
							title: "Proposed",
							uniqueName: name,
							displayName: "Proposed entity",
							entityType: "PLACE",
						},
					},
				],
				{ refresh: true },
			),
		);
		let prepared: Awaited<ReturnType<typeof prepareChanges>> | undefined;
		try {
			await vi.waitFor(async () => {
				const [waits] = await conn.execute<RowDataPacket[]>(
					"SELECT requesting.OBJECT_NAME FROM performance_schema.data_lock_waits waits JOIN performance_schema.data_locks requesting ON requesting.ENGINE_LOCK_ID=waits.REQUESTING_ENGINE_LOCK_ID WHERE requesting.OBJECT_SCHEMA=? AND requesting.OBJECT_NAME='tanahpedia_entry'",
					[schema],
				);
				expect(waits.length).toBeGreaterThan(0);
			});
			await expect(
				conn.execute(
					"SELECT id FROM tanahpedia_entity WHERE id=? FOR UPDATE NOWAIT",
					[links[0].entity_id],
				),
			).resolves.toBeDefined();
		} finally {
			await conn.rollback();
			prepared = await preparing;
		}
		expect(prepared.map((c) => c.kind)).toEqual(["entry_title", "metadata"]);
	});
	it("retains a pending creation for manual recovery when its new alias is ambiguous", async () => {
		const name = `Ambiguous-creation-${randomUUID()}`;
		const pending = await pendingCreation(name);
		await mergeChanges([
			{
				kind: "alias_mapping",
				after: {
					name,
					targets: [
						{ entryId: String(recordRefs.entry), label: "ראשון" },
						{ entryId: otherEntry, label: "אחר" },
					],
				},
			},
		]);
		const refreshed = await fresh(pending);
		expect(refreshed.domainConflict).toContain("ambiguous alias");
		expect(refreshed.changes).toEqual(pending.changes);
		expect(refreshed.evidence).toEqual(pending.evidence);
		expect(reviewStatus(refreshed)).toBe("required");
		await service.updateContribution(
			{ id: refreshed.id, version: refreshed.version, action: "close" },
			owner,
		);
	});
	it("blocks conversion when the resolved entry has no compatible entity", async () => {
		const name = `Incompatible-creation-${randomUUID()}`;
		const pending = await pendingCreation(name, "PLACE");
		await mergeChanges([
			{
				kind: "alias_mapping",
				after: {
					name,
					targets: [{ entryId: String(recordRefs.entry), label: "" }],
				},
			},
		]);
		const refreshed = await fresh(pending);
		expect(refreshed.domainConflict).toContain("one PLACE entity");
		expect(refreshed.changes).toEqual(pending.changes);
		await expect(
			service.mergeContribution(
				{ id: refreshed.id, version: refreshed.version },
				owner,
			),
		).rejects.toThrow("one PLACE entity");
		await service.updateContribution(
			{ id: refreshed.id, version: refreshed.version, action: "close" },
			owner,
		);
	});
	it("atomically transfers an alias address only with its complete reviewed removal", async () => {
		const name = `Explicit-transfer-${randomUUID()}`;
		const alias = await mergeChanges([
			{
				kind: "alias_mapping",
				after: {
					name,
					targets: [{ entryId: String(recordRefs.entry), label: "" }],
				},
			},
		]);
		const transferred = await mergeChanges([
			{
				kind: "entry",
				after: {
					title: "ערך בדיקה",
					uniqueName: name,
					displayName: "ערך בדיקה",
					entityType: "PLACE",
				},
			},
			{
				kind: "alias_mapping",
				targetId: alias.changes[0].targetId,
				after: null,
			},
		]);
		expect(transferred.changes[1].before?.targets).toEqual([
			{ entryId: String(recordRefs.entry), label: "" },
		]);
		expect(
			await current("alias_mapping", alias.changes[0].targetId),
		).toBeNull();
		expect(
			(await current("entry", transferred.changes[0].targetId))?.uniqueName,
		).toBe(name);
	});
	it("can remove a legacy shadowed alias without changing its canonical entry", async () => {
		const name = `Legacy-shadow-${randomUUID()}`;
		const alias = await mergeChanges([
			{
				kind: "alias_mapping",
				after: {
					name,
					targets: [{ entryId: String(recordRefs.entry), label: "" }],
				},
			},
		]);
		const canonical = randomUUID();
		await conn.execute(
			"INSERT INTO tanahpedia_entry (id,unique_name,title,content) VALUES (?,?,'Legacy canonical','<p></p>')",
			[canonical, name],
		);
		await mergeChanges([
			{
				kind: "alias_mapping",
				targetId: alias.changes[0].targetId,
				after: null,
			},
		]);
		expect(
			await current("alias_mapping", alias.changes[0].targetId),
		).toBeNull();
		expect((await current("entry", canonical))?.uniqueName).toBe(name);
	});
	it("moves only the reviewed source and preserves its old shared group's other citation", async () => {
		const after = {
			targetKind: "entity",
			targetId: ids.entity,
			sourceType: "other",
			perekId: null,
			pasukNumber: null,
			perushId: null,
			sourceText: "מקור בדיקה",
		};
		const pr = await mergeChanges([{ kind: "source_reference", after }]),
			id = pr.changes[0].targetId;
		expect(await current("source_reference", id)).toEqual(after);
		const [rows] = await conn.query<RowDataPacket[]>(
			"SELECT source_group_id FROM tanahpedia_non_tanah_source WHERE id=?",
			[id],
		);
		const sibling = randomUUID(),
			group = rows[0].source_group_id;
		await conn.execute(
			"INSERT INTO tanahpedia_non_tanah_source (id,source_group_id,source_text) VALUES (?,?,'מקור נוסף')",
			[sibling, group],
		);
		const moved = {
			targetKind: "place",
			targetId: ids.place,
			sourceType: "tanah",
			perekId: 1,
			pasukNumber: 2,
			perushId: 1,
			sourceText: null,
		};
		await mergeChanges([
			{ kind: "source_reference", targetId: id, after: moved },
		]);
		expect(await current("source_reference", id)).toEqual(moved);
		expect(await current("source_reference", sibling)).toEqual({
			...after,
			sourceText: "מקור נוסף",
		});
		const { specialContributionTargets } = await import(
			"~/server/tanahpedia/contribution-specials.server"
		);
		const targets = await store.withContributions(specialContributionTargets);
		expect(targets).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ kind: "source_reference", id, after: moved }),
				expect.objectContaining({
					kind: "source_reference",
					id: sibling,
					label: "מקור נוסף",
					after: { ...after, sourceText: "מקור נוסף" },
				}),
			]),
		);
		await mergeChanges([
			{ kind: "source_reference", targetId: id, after: null },
		]);
		expect(await current("source_reference", id)).toBeNull();
		expect(await current("source_reference", sibling)).not.toBeNull();
		await expect(
			service.createContribution(
				{
					kind: "pr",
					description: "נתוני בדיקה בלבד",
					title: "Invalid verse",
					evidence,
					changes: [
						{ kind: "source_reference", after: { ...moved, pasukNumber: 32 } },
					],
				},
				owner,
			),
		).rejects.toThrow("verse");
	});
	it("rolls back every category write when a later operation conflicts with a unique key", async () => {
		const existing = await mergeChanges([
			{
				kind: "animal_kind",
				after: { animalId: recordRefs.animal, kind: "CHAYA", altGroupId: null },
			},
		]);
		const nameId = randomUUID();
		const pr = await service.createContribution(
			{
				kind: "pr",
				description: "נתוני בדיקה בלבד",
				title: "Atomic cross-category merge",
				evidence,
				changes: [
					{
						kind: "person_name",
						targetId: nameId,
						after: {
							personId: ids.person,
							name: "Rollback",
							nameType: "ADDITIONAL",
							altGroupId: null,
						},
					},
					{
						kind: "animal_kind",
						after: {
							animalId: recordRefs.animal,
							kind: "OF",
							altGroupId: null,
						},
					},
				],
			},
			owner,
		);
		await expect(
			service.mergeContribution({ id: pr.id, version: pr.version }, owner),
		).rejects.toThrow(/Duplicate/);
		expect(await current("person_name", nameId)).toBeNull();
		expect((await fresh(pr)).state).toBe("open");
		expect(
			(await current("animal_kind", existing.changes[0].targetId))?.kind,
		).toBe("CHAYA");
	});
});

describe("post-merge sequence refresh and renewed owner review", () => {
	it("edits evidence and a remaining change while retaining satisfied updates and deletions", async () => {
		const identification = await proposed(
			[
				{
					kind: "place",
					after: {
						placeId: ids.place,
						modernName: "זיהוי למחיקה",
						latitude: 30,
						longitude: 34,
					},
				},
			],
			owner,
		);
		await merge(identification);
		const displayName = `כינוי חדש-${randomUUID()}`;
		const shared = [
			{ kind: "metadata", targetId: ids.entity, after: { displayName } },
			{
				kind: "place",
				targetId: identification.changes[0].targetId,
				after: null,
			},
		];
		const pending = await proposed([
			...shared,
			{
				kind: "person_name",
				after: {
					personId: ids.person,
					nameType: "ADDITIONAL",
					name: "כינוי לפני עריכה",
				},
			},
		]);
		await merge(await proposed(shared, owner));
		const refreshed = await fresh(pending);
		expect(refreshed.changes.filter(contributionHasEffect)).toHaveLength(1);
		const edited = await service.editContribution(
			{
				id: refreshed.id,
				version: refreshed.version,
				title: refreshed.title,
				description: "תיאור מתוקן",
				evidence: [{ ...evidence[0], note: "ראיה חדשה" }],
				changes: refreshed.changes.map((c) => ({
					kind: c.kind,
					targetId: c.targetId,
					after:
						c.kind === "person_name"
							? { ...c.after, name: "כינוי אחרי עריכה" }
							: c.after,
				})),
			},
			alice,
		);
		expect(edited.evidence[0].note).toBe("ראיה חדשה");
		expect(edited.changes.filter(contributionHasEffect)).toHaveLength(1);
		expect(reviewStatus(edited)).toBe("required");
		const merged = await merge(await approved(edited));
		expect(
			[...merged.events].reverse().find((e) => e.kind === "merged")?.body,
		).toContain("1");
		const name = merged.changes.find((c) => c.kind === "person_name");
		if (!name) throw new Error("Missing remaining name change");
		const [names] = await conn.execute<RowDataPacket[]>(
			"SELECT name FROM tanahpedia_person_name WHERE id=?",
			[name.targetId],
		);
		expect(names[0].name).toBe("כינוי אחרי עריכה");
	});
	async function proposed(changes: unknown[], actor = alice) {
		return service.createContribution(
			{
				kind: "pr",
				title: "בדיקת רענון רצף",
				description: "תוכן בדיקה מקומי",
				evidence,
				changes,
			},
			actor,
		);
	}
	async function approved(item: Contribution) {
		return service.updateContribution(
			{ id: item.id, version: item.version, action: "approve" },
			owner,
		);
	}
	async function merge(item: Contribution) {
		return service.mergeContribution(
			{ id: item.id, version: item.version },
			owner,
		);
	}
	it("refreshes pending old values, preserves proposed new values and requires owner review again", async () => {
		const pending = await approved(
			await proposed([
				{
					kind: "metadata",
					targetId: ids.parentEntity,
					after: { displayName: "Pending value" },
				},
			]),
		);
		const original = structuredClone(pending.changes);
		const trigger = await merge(
			await proposed(
				[
					{
						kind: "metadata",
						targetId: ids.parentEntity,
						after: { displayName: "Merged value" },
					},
				],
				owner,
			),
		);
		const rebased = await fresh(pending);
		expect(rebased.changes[0].before).toEqual({ displayName: "Merged value" });
		expect(rebased.changes[0].after).toEqual({ displayName: "Pending value" });
		expect(rebased.revision).toBe(pending.revision + 1);
		expect(reviewStatus(rebased)).toBe("required");
		expect(
			rebased.events.find((e) => e.kind === "rebased")?.snapshot?.changes,
		).toEqual(original);
		expect(rebased.evidence).toEqual(pending.evidence);
		await expect(merge(rebased)).rejects.toThrow("Approval");
		const { refreshPendingContributionBases } = await import(
			"~/server/tanahpedia/contribution-rebases.server"
		);
		await refreshPendingContributionBases(trigger);
		expect((await fresh(rebased)).version).toBe(rebased.version);
		expect((await merge(await approved(rebased))).state).toBe("merged");
	});
	it("makes an already-satisfied sequence an explicit no-op and removes the owner's earlier exemption", async () => {
		const pending = await proposed(
			[
				{
					kind: "metadata",
					targetId: ids.parentEntity,
					after: { displayName: "Already applied" },
				},
			],
			owner,
		);
		await merge(
			await proposed(
				[
					{
						kind: "metadata",
						targetId: ids.parentEntity,
						after: { displayName: "Already applied" },
					},
				],
				owner,
			),
		);
		const rebased = await fresh(pending);
		expect(contributionHasEffect(rebased.changes[0])).toBe(false);
		expect(reviewStatus(rebased)).toBe("required");
		await expect(merge(rebased)).rejects.toThrow("Approval");
		const merged = await merge(await approved(rebased));
		expect(merged.events.filter((e) => e.kind === "merged").at(-1)?.body).toBe(
			"0 שינויים הוחלו",
		);
	});
	it("refreshes a structured cited claim while retaining the evidence text, and detects a later direct edit", async () => {
		const fact = await merge(
			await proposed(
				[
					{
						kind: "person_birth_date",
						after: {
							personId: ids.person,
							birthDate: 57840101,
							altGroupId: null,
						},
					},
				],
				owner,
			),
		);
		const factId = fact.changes[0].targetId;
		const citation = await approved(
			await proposed([
				{
					kind: "source_reference",
					after: {
						targetKind: "person_birth_date",
						targetId: factId,
						sourceType: "other",
						sourceText: "מקור בדיקה",
						perekId: null,
						pasukNumber: null,
						perushId: null,
					},
				},
			]),
		);
		expect(citation.changes[0].sourceTarget?.state.birthDate).toBe(57840101);
		await merge(
			await proposed(
				[
					{
						kind: "person_birth_date",
						targetId: factId,
						after: {
							personId: ids.person,
							birthDate: 57840202,
							altGroupId: null,
						},
					},
				],
				owner,
			),
		);
		const refreshed = await fresh(citation);
		expect(refreshed.changes[0].sourceTarget?.state.birthDate).toBe(57840202);
		expect(refreshed.changes[0].after).toEqual(citation.changes[0].after);
		expect(refreshed.evidence).toEqual(citation.evidence);
		expect(reviewStatus(refreshed)).toBe("required");
		const reviewed = await approved(refreshed);
		await conn.execute(
			"UPDATE tanahpedia_person_birth_date SET birth_date=57840303 WHERE id=?",
			[factId],
		);
		await expect(merge(reviewed)).rejects.toThrow("cited fact changed");
	});
	it("migrates a v2 structured source through the v3 adapter without discarding its approval", async () => {
		const fact = await merge(
			await proposed(
				[
					{
						kind: "person_birth_date",
						after: {
							personId: ids.person,
							birthDate: 57840101,
							altGroupId: null,
						},
					},
				],
				owner,
			),
		);
		const pr = await approved(
			await proposed([
				{
					kind: "source_reference",
					after: {
						targetKind: "person_birth_date",
						targetId: fact.changes[0].targetId,
						sourceType: "other",
						sourceText: "מקור בדיקה",
						perekId: null,
						pasukNumber: null,
						perushId: null,
					},
				},
			]),
		);
		await store.withContributions(async (tx) => {
			const old = await store.readContribution(tx, pr.id, true);
			old.apiVersion = 2;
			delete old.changes[0].sourceTarget;
			await store.saveContribution(tx, old);
		});
		const before = await fresh(pr),
			{ migrateOpenContributionPrs } = await import(
				"~/server/tanahpedia/contribution-migrations.server"
			);
		await migrateOpenContributionPrs();
		const migrated = await fresh(pr);
		expect(migrated.apiVersion).toBe(CONTRIBUTION_API_VERSION);
		expect(migrated.revision).toBe(before.revision);
		expect(migrated.events).toEqual(before.events);
		expect(reviewStatus(migrated)).toBe("approved");
		expect(migrated.changes[0].sourceTarget?.state.birthDate).toBe(57840101);
		expect((await merge(migrated)).state).toBe("merged");
	});
	it("preserves a source proposal when its cited fact disappears, and clears the conflict on an authored repair", async () => {
		const fact = await merge(
			await proposed(
				[
					{
						kind: "person_death_cause",
						after: {
							personId: ids.person,
							deathCause: "בדיקה",
							altGroupId: null,
						},
					},
				],
				owner,
			),
		);
		const citation = await proposed([
			{
				kind: "source_reference",
				after: {
					targetKind: "person_death_cause",
					targetId: fact.changes[0].targetId,
					sourceType: "other",
					sourceText: "מקור בדיקה",
					perekId: null,
					pasukNumber: null,
					perushId: null,
				},
			},
		]);
		await merge(
			await proposed(
				[
					{
						kind: "person_death_cause",
						targetId: fact.changes[0].targetId,
						after: null,
					},
				],
				owner,
			),
		);
		const blocked = await fresh(citation);
		expect(blocked.domainConflict).toContain("target does not exist");
		expect(blocked.changes).toEqual(citation.changes);
		await expect(merge(blocked)).rejects.toThrow("Refresh");
		const repaired = await service.editContribution(
			{
				id: blocked.id,
				version: blocked.version,
				title: blocked.title,
				description: blocked.description,
				evidence: blocked.evidence,
				changes: [
					{
						kind: "source_reference",
						targetId: blocked.changes[0].targetId,
						after: {
							...blocked.changes[0].after,
							targetKind: "entity",
							targetId: ids.entity,
						},
					},
				],
			},
			owner,
		);
		expect(repaired.domainConflict).toBeUndefined();
		expect((await merge(repaired)).state).toBe("merged");
	});
	it.each([true, false])(
		"reconciles a deferred comparison after API recovery; content changed: %s",
		async (changed) => {
			const pending = await approved(
				await proposed([metadata(`Deferred proposed ${randomUUID()}`)]),
			);
			const migrations = await import(
				"~/server/tanahpedia/contribution-migrations.server"
			);
			await store.withContributions(async (tx) => {
				const old = await store.readContribution(tx, pending.id, true);
				old.apiVersion = 999;
				await store.saveContribution(tx, old);
			});
			await migrations.migrateOpenContributionPrs();
			const gray = await fresh(pending);
			const trigger = await merge(
				await proposed(
					changed
						? [metadata(`Deferred current ${randomUUID()}`)]
						: [
								{
									kind: "place",
									after: {
										placeId: ids.place,
										modernName: `Unrelated ${randomUUID()}`,
										latitude: 31,
										longitude: 35,
										altGroupId: null,
									},
								},
							],
					owner,
				),
			);
			const waiting = await fresh(pending);
			expect(waiting.changes).toEqual(gray.changes);
			expect(waiting.revision).toBe(gray.revision);
			expect(waiting.events).toEqual(gray.events);
			expect(waiting.deferredContentMerge?.id).toBe(trigger.id);
			if (changed) {
				await merge(
					await proposed(
						[
							{
								kind: "place",
								after: {
									placeId: ids.place,
									modernName: `Later unrelated ${randomUUID()}`,
									latitude: 32,
									longitude: 35,
									altGroupId: null,
								},
							},
						],
						owner,
					),
				);
				expect((await fresh(pending)).version).toBe(waiting.version);
			}
			const contract = {
				version: CONTRIBUTION_API_VERSION,
				adapters: [
					{
						from: 999,
						to: CONTRIBUTION_API_VERSION,
						id: "recover-test-contract",
						convert: (payload: unknown) => payload,
					},
				],
			};
			if (changed) {
				const changes = await import(
					"~/server/tanahpedia/contribution-changes.server"
				);
				const failure = vi
					.spyOn(changes, "prepareChanges")
					.mockRejectedValueOnce(
						Object.assign(new Error("Injected deferred storage failure"), {
							code: "ER_SERVER_SHUTDOWN",
						}),
					);
				try {
					await expect(
						migrations.migrateOpenContributionPrs(contract),
					).rejects.toThrow("Injected deferred storage failure");
				} finally {
					failure.mockRestore();
				}
				const interrupted = await fresh(pending);
				expect(interrupted.deferredContentMerge).toEqual(
					waiting.deferredContentMerge,
				);
				expect(interrupted.apiVersion).toBe(999);
			}
			await migrations.migrateOpenContributionPrs(contract);
			const recovered = await fresh(pending);
			expect(recovered.apiMigration?.status).toBe("succeeded");
			expect(recovered.deferredContentMerge).toBeUndefined();
			expect(recovered.changes[0].after).toEqual(gray.changes[0].after);
			if (changed) {
				expect(recovered.changes[0].before).not.toEqual(gray.changes[0].before);
				expect(reviewStatus(recovered)).toBe("required");
				expect(recovered.revisionAuthor?.kind).toBe("system");
			} else {
				expect(recovered.revision).toBe(gray.revision);
				expect(reviewStatus(recovered)).toBe("approved");
			}
			await service.updateContribution(
				{ id: recovered.id, version: recovered.version, action: "close" },
				owner,
			);
		},
	);
	it.each(["read", "merge"])(
		"reconciles deferred content on a late API upgrade through %s",
		async (path) => {
			const pending = await approved(
				await proposed([metadata(`Late deferred proposed ${randomUUID()}`)]),
			);
			await store.withContributions(async (tx) => {
				const old = await store.readContribution(tx, pending.id, true);
				old.apiVersion = 3;
				await store.saveContribution(tx, old);
			});
			await merge(
				await proposed(
					[metadata(`Late deferred current ${randomUUID()}`)],
					owner,
				),
			);
			const waiting = await fresh(pending);
			expect(waiting.deferredContentMerge).toBeDefined();
			if (path === "read") {
				const { readCurrentContribution } = await import(
					"~/server/tanahpedia/contribution-migrations.server"
				);
				await store.withContributions((tx) =>
					readCurrentContribution(tx, pending.id),
				);
			} else await expect(merge(waiting)).rejects.toThrow("Approval");
			const recovered = await fresh(pending);
			expect(recovered.apiVersion).toBe(CONTRIBUTION_API_VERSION);
			expect(recovered.deferredContentMerge).toBeUndefined();
			expect(recovered.changes[0].before).not.toEqual(
				waiting.changes[0].before,
			);
			expect(reviewStatus(recovered)).toBe("required");
			await service.updateContribution(
				{ id: recovered.id, version: recovered.version, action: "close" },
				owner,
			);
		},
	);
	it("merges an approved deferred PR as a no-op when its API adapter removes all operations", async () => {
		const pending = await approved(
			await proposed([metadata(`Removed proposed ${randomUUID()}`)]),
		);
		await store.withContributions(async (tx) => {
			const old = await store.readContribution(tx, pending.id, true);
			old.apiVersion = 999;
			old.domainConflict = "Obsolete operation target";
			await store.saveContribution(tx, old);
		});
		const currentName = `Current after removal ${randomUUID()}`;
		await merge(await proposed([metadata(currentName)], owner));
		const waiting = await fresh(pending);
		expect(waiting.deferredContentMerge).toBeDefined();
		const { migrateOpenContributionPrs } = await import(
			"~/server/tanahpedia/contribution-migrations.server"
		);
		await migrateOpenContributionPrs({
			version: CONTRIBUTION_API_VERSION,
			adapters: [
				{
					from: 999,
					to: CONTRIBUTION_API_VERSION,
					id: "remove-obsolete-operations",
					convert: () => [],
				},
			],
		});
		const recovered = await fresh(pending);
		expect(recovered.changes).toEqual([]);
		expect(recovered.domainConflict).toBeUndefined();
		expect(recovered.deferredContentMerge).toBeUndefined();
		expect(recovered.revision).toBe(waiting.revision);
		expect(reviewStatus(recovered)).toBe("approved");
		expect((await merge(recovered)).state).toBe("merged");
		const [rows] = await conn.execute<RowDataPacket[]>(
			"SELECT name FROM tanahpedia_entity WHERE id=?",
			[ids.entity],
		);
		expect(rows[0].name).toBe(currentName);
	});
	it("durably resumes a post-commit refresh failure without applying the content merge twice", async () => {
		const pending = await proposed([
			{
				kind: "metadata",
				targetId: ids.parentEntity,
				after: { displayName: "After retry" },
			},
		]);
		const queued = await proposed(
			[
				{
					kind: "metadata",
					targetId: ids.parentEntity,
					after: { displayName: "Trigger retry" },
				},
			],
			owner,
		);
		const jobs = await import(
				"~/server/tanahpedia/contribution-rebases.server"
			),
			spy = vi
				.spyOn(jobs, "resumePendingContributionRebases")
				.mockRejectedValueOnce(new Error("Injected storage interruption")),
			logged = vi.spyOn(console, "error").mockImplementation(() => {});
		const merged = await (async () => {
			try {
				return await merge(queued);
			} finally {
				spy.mockRestore();
				logged.mockRestore();
			}
		})();
		expect((await fresh(merged)).rebasePending).toBe(true);
		expect((await fresh(pending)).changes).toEqual(pending.changes);
		await jobs.resumePendingContributionRebases();
		const completed = await fresh(merged);
		expect(completed.rebasePending).toBeUndefined();
		expect(completed.events.filter((e) => e.kind === "merged")).toHaveLength(1);
		expect((await fresh(pending)).changes[0].before).toEqual({
			displayName: "Trigger retry",
		});
	});
});
