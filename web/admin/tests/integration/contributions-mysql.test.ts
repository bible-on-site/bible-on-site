import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import mysql, { type Connection, type RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { canonicalJson } from "~/lib/canonical-json";
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
		/CREATE TABLE `([^`]+)` \([\s\S]*?\) ENGINE[^;]*;/g,
	)) {
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
});

describe("workstation generation with actual MySQL transactions", () => {
	async function queued() {
		worker ??= await import("~/server/tanahpedia/contribution-worker.server");
		const item = await service.createContribution(
			{
				kind: "issue",
				title: "בקשה להפקת מטא-נתונים",
				description: "נדרש ערך חדש עם מטא-נתונים בלבד, ללא גוף טקסט.",
				assignee: { kind: "local_llm" },
				evidence,
			},
			alice,
		);
		return service.updateContribution(
			{ id: item.id, version: item.version, action: "queue_generation" },
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
			expect(
				(
					await store.withContributions((tx) =>
						store.readContribution(tx, item.id),
					)
				).generation?.status,
			).toBe("cancelled");
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
	it("automatically upgrades an approved v1 person rename and keeps its approval usable", async () => {
		let pr = await createPr([metadata("Legacy upgraded person")]);
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
		const { migrateOpenContributionPrs } = await import(
			"~/server/tanahpedia/contribution-migrations.server"
		);
		await migrateOpenContributionPrs();
		pr = await fresh(pr);
		expect(pr.apiVersion).toBe(CONTRIBUTION_API_VERSION);
		expect(pr.apiMigration?.status).toBe("succeeded");
		expect(pr.events).toEqual(approved);
		expect(pr.revision).toBe(revision);
		expect(JSON.parse(pr.apiMigration?.sequence ?? "null")).toEqual(original);
		expect(pr.changes[0].personNames?.length).toBeGreaterThan(0);
		expect(
			(
				await service.mergeContribution(
					{ id: pr.id, version: pr.version },
					owner,
				)
			).state,
		).toBe("merged");
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
		expect(
			(await store.listContributions({ relatedTo: issue.id })).items.find(
				(item) => item.id === issue.id,
			)?.events,
		).toHaveLength(5);
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
		await conn.execute(
			"INSERT INTO tanahpedia_entry (id, unique_name, title, content) VALUES (?, ?, 'Existing', '<p></p>')",
			[randomUUID(), taken],
		);
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
			item.apiVersion = 4;
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
				{ from: 4, to: 3, id: "bridge", convert: (p) => p },
				{
					from: 3,
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
					...(spec.updateOnly ? { targetId: recordRefs.saying } : {}),
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
					"SELECT content FROM tanahpedia_saying WHERE id=?",
					[id],
				);
				expect(rows[0].content).toBeNull();
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
