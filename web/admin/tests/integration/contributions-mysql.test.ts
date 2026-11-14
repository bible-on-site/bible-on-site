import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import mysql, { type Connection, type RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Contribution, Contributor } from "~/lib/tanahpedia/contributions";

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
let created = false;
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
	const canonical = readFileSync(
		new URL("../../../../data/mysql/tanahpedia_structure.sql", import.meta.url),
		"utf8",
	);
	await conn.query("SET FOREIGN_KEY_CHECKS = 0");
	for (const match of canonical.matchAll(
		/CREATE TABLE `([^`]+)` \([\s\S]*?\) ENGINE[^;]*;/g,
	)) {
		if (needed.delete(match[1])) await conn.query(match[0]);
	}
	if (needed.size)
		throw new Error(
			`Canonical workflow tables missing: ${[...needed].join(", ")}`,
		);
	await conn.query("SET FOREIGN_KEY_CHECKS = 1");
	for (const [table, names] of [
		[
			"tanahpedia_lookup_parent_child_type",
			["BIOLOGICAL", "ADOPTIVE", "STEP", "FOSTER"],
		],
		["tanahpedia_lookup_parent_role", ["FATHER", "MOTHER"]],
		["tanahpedia_lookup_union_type", ["MARRIAGE", "PILEGESH", "BETROTHAL"]],
		["tanahpedia_lookup_union_end_reason", ["DEATH", "DIVORCE"]],
		["tanahpedia_lookup_name_type", ["MAIN"]],
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
	configured.pathname = `/${schema}`;
	configured.searchParams.set("ssl-mode", "DISABLED");
	vi.stubEnv("DB_URL", configured.href);
	db = await import("~/server/db");
	service = await import("~/server/tanahpedia/contribution-service.server");
	store = await import("~/server/tanahpedia/contribution-store.server");
	await store.ensureContributionSchema();
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
			(await store.listContributions()).find((item) => item.id === issue.id)
				?.events,
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
						latitude: 31.77812,
						longitude: 35.23543,
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
		expect(pr.changes[0].before?.latitude).toBe(31.77812);
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
			item.apiVersion = 3;
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
			version: 1,
			adapters: [
				{ from: 3, to: 2, id: "bridge", convert: (p) => p },
				{ from: 2, to: 1, id: "latest", convert: (p) => p },
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
