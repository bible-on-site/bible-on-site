import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import mysql, { type Connection } from "mysql2/promise";
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import type { ArticleRelationshipsMutationInput } from "~/lib/article-linking/merge";
import {
	CONTRIBUTION_API_VERSION,
	migrationBlocked,
} from "~/lib/tanahpedia/contribution-api";
import {
	type Contribution,
	type Contributor,
	reviewStatus,
} from "~/lib/tanahpedia/contributions";

const api = vi.hoisted(() => ({ write: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({
	createServerOnlyFn: (fn: unknown) => fn,
	createServerFn: () => ({
		validator: () => ({ handler: (fn: unknown) => fn }),
		handler: (fn: unknown) => fn,
	}),
}));
vi.mock("@tanstack/react-start/server-only", () => ({}));
vi.mock("~/server/article-relationships-api", () => ({
	articleApiConfigured: () => true,
	updateArticleRelationships: api.write,
}));
vi.mock("~/server/website-revalidate", () => ({
	revalidateWebsite: vi.fn().mockResolvedValue(undefined),
	pediaInvalidation: () => [],
	articleChange: (input: unknown) => ({
		changes: [{ kind: "article", ...(input as object) }],
	}),
	dedicationChange: (input: unknown) => ({
		changes: [{ kind: "dedication", ...(input as object) }],
	}),
}));
vi.mock("~/server/dedication-expiry", () => ({
	syncDedicationExpiry: vi.fn().mockResolvedValue(undefined),
	currentTargets: vi.fn(),
	mergeChanges: vi.fn(),
}));
vi.mock("~/server/tanahpedia/paths", () => ({
	pediaChangesForPersons: vi.fn().mockResolvedValue([]),
	pediaChangesForEntities: vi.fn().mockResolvedValue([]),
	pediaChangesForEntryIds: vi.fn().mockResolvedValue([]),
}));
const schema = `article_contribution_test_${randomUUID().replace(/-/g, "")}`;
let conn: Connection;
let db: typeof import("~/server/db");
let service: typeof import("~/server/tanahpedia/contribution-service.server");
let store: typeof import("~/server/tanahpedia/contribution-store.server");
let importer: typeof import("~/server/tanahpedia/contribution-article-import.server");
let statusSchema: typeof import("~/server/tanahpedia/contribution-article-import-schema.server");
let created = false;
let loseResponse = false;
const owner: Contributor = {
	id: "verified-owner",
	name: "doradsoft",
	kind: "human",
	isDoradsoft: true,
};
const human: Contributor = {
	id: "human",
	name: "Editor",
	kind: "human",
	isDoradsoft: false,
};
const evidence = [{ citation: "מקור בדיקה", quote: "", note: "", url: null }];
const command = {
	relationshipKey: "coveringSources",
	action: "add",
	target: { pasukCoordinates: [{ perekId: 2, pasuk: 3 }] },
};
const action = (item: Contribution, name: string) => ({
	id: item.id,
	version: item.version,
	action: name,
});
async function fresh(item: Contribution) {
	return store.withContributions((connection) =>
		store.readContribution(connection, item.id),
	);
}

function scopedConnection() {
	const configured = new URL(process.env.DB_URL as string);
	if (
		configured.pathname !== `/${schema}` ||
		!["localhost", "127.0.0.1", "[::1]"].includes(configured.hostname)
	)
		throw new Error("Fence probes require this disposable loopback database");
	return mysql.createConnection({
		host: configured.hostname,
		port: Number(configured.port || 3306),
		user: decodeURIComponent(configured.username),
		password: decodeURIComponent(configured.password),
		database: schema,
	});
}
async function proposed(commands: unknown[] = [command], actor = human) {
	return service.createContribution(
		{
			kind: "pr",
			title: "קישורי מאמר לבדיקה",
			description: "שינויי קשרים מובנים בלבד",
			evidence,
			changes: [{ kind: "article_links", targetId: "1", after: { commands } }],
		},
		actor,
	);
}
async function approved(item: Contribution) {
	return service.updateContribution(action(item, "approve"), owner);
}
async function merge(item: Contribution) {
	return service.mergeContribution(
		{ id: item.id, version: item.version },
		owner,
	);
}
async function legacy(
	extra: Partial<{
		relationship_key: string;
		action: string;
		target: Record<string, unknown>;
		status: string;
		reviewPatch: Record<string, unknown>;
		reviewer: string;
	}> = {},
) {
	const id = randomUUID();
	const [rows] = await conn.execute(
		"SELECT LOWER(HEX(content_hash)) AS hash FROM tanah_article WHERE id=1",
	);
	const hash = (rows as { hash: string }[])[0].hash;
	await conn.execute(
		"INSERT INTO tanah_article_link_proposal (id,run_id,article_id,relationship_key,action,target_json,target_label,evidence_json,legacy_status,dedupe_key,decision_key,generator,prompt_version,base_content_hash,review_patch_json,reviewer) VALUES (?,?,1,?,?,?,?,NULL,?,?,?,?,?,?,?,?)",
		[
			id,
			randomUUID(),
			extra.relationship_key ?? "coveringSources",
			extra.action ?? "add",
			JSON.stringify(extra.target ?? command.target),
			"בראשית ב ג",
			extra.status ?? "pending",
			randomUUID().replace(/-/g, "").padEnd(64, "0"),
			"same-decision".padEnd(64, "0"),
			"heuristic:v1",
			"v1",
			hash,
			extra.reviewPatch ? JSON.stringify(extra.reviewPatch) : null,
			extra.reviewer ?? null,
		],
	);
	return id;
}
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
		throw new Error(
			"Article contribution tests require disposable loopback MySQL",
		);
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
	await conn.query(`CREATE TABLE tanah_article (id MEDIUMINT NOT NULL PRIMARY KEY,name TEXT NOT NULL,abstract TEXT NULL,content MEDIUMTEXT NULL,perek_id INT NOT NULL,author_id INT NOT NULL,coverage_verified BOOLEAN NOT NULL DEFAULT FALSE,content_hash BINARY(16) GENERATED ALWAYS AS (UNHEX(MD5(CONCAT_WS(CHAR(1),IFNULL(name,''),IFNULL(abstract,''),IFNULL(content,''),perek_id,author_id)))) STORED) ENGINE=InnoDB;
 CREATE TABLE tanah_article_covering_source (article_id MEDIUMINT NOT NULL,perek_id INT NOT NULL,pasuk INT NOT NULL,PRIMARY KEY(article_id,perek_id,pasuk),FOREIGN KEY(article_id) REFERENCES tanah_article(id)) ENGINE=InnoDB;
 CREATE TABLE tanah_dedication (id INT NOT NULL PRIMARY KEY,subject VARCHAR(255) NOT NULL) ENGINE=InnoDB;
 CREATE TABLE tanah_article_dedication (article_id MEDIUMINT NOT NULL,dedication_id INT NOT NULL,expires_at DATETIME NULL,PRIMARY KEY(article_id,dedication_id),FOREIGN KEY(article_id) REFERENCES tanah_article(id),FOREIGN KEY(dedication_id) REFERENCES tanah_dedication(id)) ENGINE=InnoDB;
 CREATE TABLE tanah_sefer_dedication (sefer_id INT NOT NULL,dedication_id INT NOT NULL,expires_at DATETIME NULL,PRIMARY KEY(sefer_id,dedication_id)) ENGINE=InnoDB;
 CREATE TABLE tanah_moed (id INT NOT NULL PRIMARY KEY,name VARCHAR(255) NOT NULL) ENGINE=InnoDB;
 CREATE TABLE tanah_article_moed (article_id MEDIUMINT NOT NULL,moed_id INT NOT NULL,PRIMARY KEY(article_id,moed_id),FOREIGN KEY(article_id) REFERENCES tanah_article(id),FOREIGN KEY(moed_id) REFERENCES tanah_moed(id)) ENGINE=InnoDB;
 CREATE TABLE tanah_perek_view (id INT NOT NULL PRIMARY KEY,sefer_name VARCHAR(255) NOT NULL,additional_letter VARCHAR(2) NULL,perek_in_context INT NOT NULL,pasuk_count INT NULL) ENGINE=InnoDB;
 INSERT INTO tanah_perek_view VALUES (1,'בראשית',NULL,1,31),(2,'בראשית',NULL,2,25);
 INSERT INTO tanah_dedication VALUES (9,'הקדשת בדיקה');INSERT INTO tanah_moed VALUES (3,'מועד בדיקה');`);
	configured.pathname = `/${schema}`;
	configured.searchParams.set("ssl-mode", "DISABLED");
	vi.stubEnv("DB_URL", configured.href);
	db = await import("~/server/db");
	store = await import("~/server/tanahpedia/contribution-store.server");
	service = await import("~/server/tanahpedia/contribution-service.server");
	importer = await import(
		"~/server/tanahpedia/contribution-article-import.server"
	);
	await store.ensureContributionSchema();
	const pipeline = await import("~/server/article-link-pipeline");
	await pipeline.ensureLinkSchema();
	statusSchema = await import(
		"~/server/tanahpedia/contribution-article-import-schema.server"
	);
	await Promise.all([
		statusSchema.ensureArticleLinkStatusFence(),
		statusSchema.ensureArticleLinkStatusFence(),
	]);
	await importer.ensureArticleLinkPromotionSchema();
});
beforeEach(async () => {
	await conn.query(
		"DELETE FROM tanahpedia_article_link_import;DELETE FROM tanahpedia_article_link_import_lock;DELETE FROM tanahpedia_contribution;DELETE FROM tanah_article_link_checkpoint;DELETE FROM tanah_article_link_proposal;DELETE FROM tanah_article_covering_source;DELETE FROM tanah_article_moed;DELETE FROM tanah_article_dedication;DELETE FROM tanah_sefer_dedication;DELETE FROM tanah_article;INSERT INTO tanah_article(id,name,abstract,content,perek_id,author_id) VALUES (1,'מאמר בדיקה',NULL,'<p>מקור בדיקה</p>',1,7),(2,'מאמר אחר',NULL,'<p>מקור אחר</p>',1,7)",
	);
	loseResponse = false;
	api.write.mockReset();
	api.write.mockImplementation(
		async (articleId: number, input: ArticleRelationshipsMutationInput) => {
			await db.transaction(async (connection) => {
				const row = await db.txQueryOne<{
					contentHash: string;
					coverageVerified: number;
				}>(
					connection,
					"SELECT LOWER(HEX(content_hash)) AS contentHash,coverage_verified AS coverageVerified FROM tanah_article WHERE id=? FOR UPDATE",
					[articleId],
				);
				if (
					!row ||
					row.contentHash !== input.expectedContentHash ||
					Boolean(row.coverageVerified) !== input.expectedCoverageVerified
				)
					throw new Error("API rejected stale row");
				const coords = await db.txQuery(
					connection,
					"SELECT perek_id AS perekId,pasuk FROM tanah_article_covering_source WHERE article_id=? ORDER BY perek_id,pasuk",
					[articleId],
				);
				expect(coords).toEqual(input.expectedCoveringSources);
				const moadim = await db.txQuery<{ moed_id: number }>(
					connection,
					"SELECT moed_id FROM tanah_article_moed WHERE article_id=? ORDER BY moed_id",
					[articleId],
				);
				expect(moadim.map((m) => m.moed_id)).toEqual(input.expectedMoedIds);
				await db.txExecute(
					connection,
					"UPDATE tanah_article SET perek_id=?,coverage_verified=? WHERE id=?",
					[input.perekId, input.coverageVerified, articleId],
				);
				await db.txExecute(
					connection,
					"DELETE FROM tanah_article_covering_source WHERE article_id=?",
					[articleId],
				);
				for (const c of input.coveringSources ?? [])
					await db.txExecute(
						connection,
						"INSERT INTO tanah_article_covering_source VALUES (?,?,?)",
						[articleId, c.perekId, c.pasuk],
					);
				await db.txExecute(
					connection,
					"DELETE FROM tanah_article_moed WHERE article_id=?",
					[articleId],
				);
				for (const id of input.moedIds ?? [])
					await db.txExecute(
						connection,
						"INSERT INTO tanah_article_moed VALUES (?,?)",
						[articleId, id],
					);
			});
			if (loseResponse) {
				loseResponse = false;
				throw new Error("Injected lost HTTP response after API commit");
			}
			return {};
		},
	);
});
afterAll(async () => {
	await db?.pool.end();
	if (created) await conn.query(`DROP DATABASE \`${schema}\``);
	await conn?.end();
	vi.unstubAllEnvs();
});

describe("Article link contribution transactions", () => {
	it.each(["HTTP relationship write", "independent dedication transaction"])(
		"waits out old %s before its metadata fence and invalidates reused prepared status metadata",
		async (path) => {
			await conn.query(
				"CREATE TABLE legacy_apply_fence_probe (id INT NOT NULL PRIMARY KEY,status VARCHAR(12) NOT NULL DEFAULT 'pending') ENGINE=InnoDB",
			);
			await conn.query(
				"INSERT INTO legacy_apply_fence_probe VALUES(1,'approved'),(2,'approved')",
			);
			const old = await scopedConnection(),
				migration = await scopedConnection();
			const statement =
				"SELECT * FROM legacy_apply_fence_probe WHERE id=? FOR UPDATE";
			let renaming: Promise<unknown> | undefined;
			try {
				const before = (await old.execute(statement, [2]))[0] as {
					status?: string;
					legacy_status?: string;
				}[];
				expect(before[0].status).toBe("approved");
				await old.beginTransaction();
				await old.execute(statement, [1]);
				const thread = (
					await migration.query("SELECT CONNECTION_ID() AS id")
				)[0] as { id: number }[];
				let renamed = false;
				renaming = migration
					.execute(
						statusSchema.ARTICLE_LINK_STATUS_RENAME.replace(
							"tanah_article_link_proposal",
							"legacy_apply_fence_probe",
						),
					)
					.then((result) => {
						renamed = true;
						return result;
					});
				await vi.waitFor(async () => {
					const processes = await db.query<{ state: string }>(
						"SELECT STATE AS state FROM information_schema.PROCESSLIST WHERE ID=?",
						[thread[0].id],
					);
					expect(processes[0]?.state).toContain("metadata lock");
				});
				if (path === "HTTP relationship write")
					await db.execute("UPDATE tanah_article SET perek_id=2 WHERE id=1");
				else
					await db.transaction((connection) =>
						db.txExecute(
							connection,
							"INSERT INTO tanah_article_dedication(article_id,dedication_id,expires_at) VALUES(1,9,NULL)",
						),
					);
				await old.execute(
					"UPDATE legacy_apply_fence_probe SET status='applied' WHERE id=1",
				);
				expect(renamed).toBe(false);
				await old.commit();
				await renaming;
				const intermediate = (await old.execute(statement, [2]))[0] as {
					status?: string;
					legacy_status?: string;
				}[];
				expect(intermediate[0]).toMatchObject({ legacy_status: "approved" });
				expect(intermediate[0]).not.toHaveProperty("status");
				await expect(
					old.execute(
						"UPDATE legacy_apply_fence_probe SET status='approved' WHERE id=2",
					),
				).rejects.toThrow(/unknown column/i);
				await migration.execute(
					statusSchema.ARTICLE_LINK_STATUS_READ_COMPATIBILITY.replace(
						"tanah_article_link_proposal",
						"legacy_apply_fence_probe",
					),
				);
				const after = (await old.execute(statement, [2]))[0] as {
					status?: string;
					legacy_status?: string;
				}[];
				expect(after[0]).toMatchObject({
					legacy_status: "approved",
					status: "stale",
				});
				await expect(
					old.execute(
						"UPDATE legacy_apply_fence_probe SET status='approved' WHERE id=2",
					),
				).rejects.toThrow(/generated column/i);
				const completed = (await old.execute(statement, [1]))[0] as {
					status?: string;
					legacy_status?: string;
				}[];
				expect(completed[0]).toMatchObject({
					legacy_status: "applied",
					status: "applied",
				});
			} finally {
				await old.rollback();
				await renaming?.catch(() => undefined);
				await old.end();
				await migration.end();
				await conn.query("DROP TABLE legacy_apply_fence_probe");
			}
		},
	);
	it("resumes a physical-only fence after interruption and tolerates concurrent read-compatibility initialization", async () => {
		await conn.execute(
			"ALTER TABLE tanah_article_link_proposal DROP COLUMN status, ALGORITHM=INPLACE, LOCK=NONE",
		);
		const id = await legacy({ status: "approved" });
		await Promise.all([
			statusSchema.ensureArticleLinkStatusFence(),
			statusSchema.ensureArticleLinkStatusFence(),
		]);
		await statusSchema.ensureArticleLinkStatusFence();
		expect(
			(
				await db.query<{ status: string; legacy_status: string }>(
					"SELECT status,legacy_status FROM tanah_article_link_proposal WHERE id=?",
					[id],
				)
			)[0],
		).toEqual({ status: "stale", legacy_status: "approved" });
	});
	it("fences old approval from an older repeatable-read snapshot", async () => {
		const id = await legacy();
		const old = await mysql.createConnection(
			process.env.DB_URL?.replace("?ssl-mode=DISABLED", "") as string,
		);
		try {
			await old.beginTransaction();
			await old.execute(
				"SELECT COUNT(*) AS origins FROM tanahpedia_article_link_import",
			);
			await store.withContributions((c) =>
				importer.promoteLegacyArticleLinkProposals(c, 1),
			);
			await expect(
				old.execute(
					"UPDATE tanah_article_link_proposal SET status='approved',review_notes='old snapshot' WHERE id=?",
					[id],
				),
			).rejects.toThrow(/generated column/i);
		} finally {
			await old.rollback();
			await old.end();
		}
	});
	it("also denies old approvals for newly generated unmapped drafts during a rollback", async () => {
		const id = await legacy();
		await expect(
			conn.execute(
				"UPDATE tanah_article_link_proposal SET status='approved' WHERE id=?",
				[id],
			),
		).rejects.toThrow(/generated column/i);
		expect(
			(
				await db.query<{ status: string }>(
					"SELECT status FROM tanah_article_link_proposal WHERE id=?",
					[id],
				)
			)[0].status,
		).toBe("pending");
		expect(
			await store.withContributions((c) =>
				importer.promoteLegacyArticleLinkProposals(c, 1),
			),
		).toHaveLength(1);
	});
	it("fences old-server review/apply SQL after promotion while retaining the exact original lifecycle", async () => {
		const id = await legacy({ status: "approved", reviewer: "legacy-editor" });
		await store.withContributions((c) =>
			importer.promoteLegacyArticleLinkProposals(c, 1),
		);
		expect(
			(
				await db.query<{ status: string }>(
					"SELECT status FROM tanah_article_link_proposal WHERE id=?",
					[id],
				)
			)[0].status,
		).toBe("stale");
		await expect(
			conn.execute(
				"UPDATE tanah_article_link_proposal SET status='approved',reviewer='old-server' WHERE id=?",
				[id],
			),
		).rejects.toThrow(/generated column/i);
		await expect(
			conn.execute(
				"UPDATE tanah_article_link_proposal SET status='applied' WHERE id=?",
				[id],
			),
		).rejects.toThrow(/generated column/i);
		const saved = await db.query<{
			original: { status: string; reviewer: string };
		}>(
			"SELECT original FROM tanahpedia_article_link_import WHERE proposal_id=?",
			[id],
		);
		expect(saved[0].original).toMatchObject({
			status: "approved",
			reviewer: "legacy-editor",
		});
		expect(api.write).not.toHaveBeenCalled();
	});
	it("replays the additive production schema upgrade without changing legacy history or PR identity", async () => {
		const id = await legacy();
		const ids = await store.withContributions((c) =>
			importer.promoteLegacyArticleLinkProposals(c, 1),
		);
		const upgrade = readFileSync(
			new URL(
				"../../../../data/mysql/tanahpedia_contribution_upgrade.sql",
				import.meta.url,
			),
			"utf8",
		);
		await conn.query(upgrade);
		await conn.query(upgrade);
		expect((await importer.legacyArticleLinkContribution(id))?.id).toBe(ids[0]);
		expect(
			await db.query("SELECT id FROM tanah_article_link_proposal WHERE id=?", [
				id,
			]),
		).toHaveLength(1);
	});
	it("creates a typed reviewable PR without writing canonical content and requires doradsoft", async () => {
		const item = await proposed();
		expect(item.apiVersion).toBe(CONTRIBUTION_API_VERSION);
		expect(reviewStatus(item)).toBe("required");
		await expect(merge(item)).rejects.toThrow(/approval/i);
		expect(api.write).not.toHaveBeenCalled();
		expect(
			await db.query("SELECT * FROM tanah_article_covering_source"),
		).toEqual([]);
		await expect(
			service.updateContribution(action(item, "approve"), human),
		).rejects.toThrow("Only doradsoft");
	});
	it("merges through one external canonical write then atomically edits dedicated expiry targets and PR state", async () => {
		await conn.query(
			"INSERT INTO tanah_article_dedication VALUES(2,9,'2028-01-01 00:00:00');INSERT INTO tanah_sefer_dedication VALUES(1,9,'2029-01-01 00:00:00')",
		);
		const pending = await approved(
			await proposed([
				{
					...command,
					target: { pasukCoordinates: [{ perekId: 2, pasuk: 4 }] },
				},
			]),
		);
		const item = await approved(
			await proposed([
				command,
				{
					relationshipKey: "primaryPerek",
					action: "replace",
					target: { perekId: 2 },
				},
				{
					relationshipKey: "dedicationAssignments",
					action: "add",
					target: { dedicationId: 9, expiresAt: "2027-12-01 00:00:00" },
				},
				{ relationshipKey: "moadim", action: "add", target: { moedIds: [3] } },
			]),
		);
		const result = await merge(item);
		expect(result.state).toBe("merged");
		expect(result.articleLinkMerge).toBeUndefined();
		expect(api.write).toHaveBeenCalledTimes(1);
		expect(
			(
				await db.query<{ expiresAt: string }>(
					"SELECT CAST(expires_at AS CHAR) AS expiresAt FROM tanah_article_dedication WHERE article_id=1",
				)
			)[0].expiresAt,
		).toBe("2027-12-01 00:00:00");
		expect(
			(
				await db.query<{ expiresAt: string }>(
					"SELECT CAST(expires_at AS CHAR) AS expiresAt FROM tanah_article_dedication WHERE article_id=2",
				)
			)[0].expiresAt,
		).toBe("2028-01-01 00:00:00");
		expect(
			(
				await db.query<{ expiresAt: string }>(
					"SELECT CAST(expires_at AS CHAR) AS expiresAt FROM tanah_sefer_dedication",
				)
			)[0].expiresAt,
		).toBe("2029-01-01 00:00:00");
		const rebased = await fresh(pending);
		expect(rebased.revision).toBe(pending.revision + 1);
		expect(reviewStatus(rebased)).toBe("required");
		expect(rebased.changes[0].before?.perekId).toBe(2);
	});
	it("recovers a committed API write after its HTTP response is lost without a duplicate call", async () => {
		const item = await approved(await proposed());
		loseResponse = true;
		await expect(merge(item)).rejects.toThrow("lost HTTP response");
		const pending = await fresh(item);
		expect(pending.state).toBe("open");
		expect(pending.articleLinkMerge?.revision).toBe(item.revision);
		expect(reviewStatus(pending)).toBe("approved");
		expect((await merge(pending)).state).toBe("merged");
		expect(api.write).toHaveBeenCalledTimes(1);
	});
	it("retains recovery intent when the local marker fails after the API commit, rolling back dedication edits", async () => {
		const item = await approved(
			await proposed([
				command,
				{
					relationshipKey: "dedicationAssignments",
					action: "add",
					target: { dedicationId: 9, expiresAt: null },
				},
			]),
		);
		await conn.query(
			"CREATE TRIGGER fail_article_merge_marker BEFORE UPDATE ON tanahpedia_contribution FOR EACH ROW BEGIN IF NEW.state='merged' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Injected local marker interruption'; END IF; END",
		);
		try {
			await expect(merge(item)).rejects.toThrow(
				"Injected local marker interruption",
			);
		} finally {
			await conn.query("DROP TRIGGER fail_article_merge_marker");
		}
		const pending = await fresh(item);
		expect(pending.articleLinkMerge).toBeTruthy();
		expect(
			await db.query(
				"SELECT * FROM tanah_article_dedication WHERE article_id=1",
			),
		).toEqual([]);
		expect((await merge(pending)).state).toBe("merged");
		expect(api.write).toHaveBeenCalledTimes(1);
		expect(
			await db.query(
				"SELECT * FROM tanah_article_dedication WHERE article_id=1",
			),
		).toHaveLength(1);
	});
	it("repairs interrupted content in the same PR through a fresh authored diff and review", async () => {
		const item = await approved(await proposed());
		loseResponse = true;
		await expect(merge(item)).rejects.toThrow("lost HTTP response");
		const pending = await fresh(item);
		const edited = await service.editContribution(
			{
				id: item.id,
				version: pending.version,
				title: pending.title,
				description: "Recovered partial merge",
				evidence,
				changes: [
					{
						kind: "article_links",
						targetId: "1",
						after: {
							commands: [
								{
									...command,
									target: { pasukCoordinates: [{ perekId: 2, pasuk: 5 }] },
								},
							],
						},
					},
				],
			},
			human,
		);
		expect(edited.id).toBe(item.id);
		expect(edited.articleLinkMerge).toBeUndefined();
		expect(edited.revision).toBe(item.revision + 1);
		expect(reviewStatus(edited)).toBe("required");
		await expect(merge(edited)).rejects.toThrow(/approval/i);
		expect(api.write).toHaveBeenCalledTimes(1);
	});
	it("rejects a changed canonical source before reserving intent or invoking an API", async () => {
		const item = await approved(await proposed());
		await conn.execute(
			"UPDATE tanah_article SET content='<p>changed source</p>' WHERE id=1",
		);
		await expect(merge(item)).rejects.toThrow("source text changed");
		expect((await fresh(item)).articleLinkMerge).toBeUndefined();
		expect(api.write).not.toHaveBeenCalled();
	});
	it("automatically handles new human feedback after an interrupted API merge without losing agent work", async () => {
		const item = await approved(await proposed());
		loseResponse = true;
		await expect(merge(item)).rejects.toThrow("lost HTTP response");
		const pending = await fresh(item);
		pending.assignee = { kind: "local_llm" };
		const assigned = await store.withContributions((c) =>
			store.saveContribution(c, pending),
		);
		const commented = await service.updateContribution(
			{ ...action(assigned, "comment"), body: "Please add the missing source" },
			human,
		);
		expect(commented.articleLinkMerge).toBeUndefined();
		expect(commented.changes[0].before?.coveringSources).toEqual([
			{ perekId: 2, pasuk: 3 },
		]);
		expect(commented.revision).toBe(item.revision + 1);
		expect(reviewStatus(commented)).toBe("required");
		expect(commented.generation).toMatchObject({
			status: "queued",
			task: "pr_resolution",
			trigger: "comment",
		});
		expect(
			commented.events.some(
				(event) =>
					event.kind === "rebased" &&
					event.body.includes(pending.articleLinkMerge?.id as string),
			),
		).toBe(true);
		await expect(merge(commented)).rejects.toThrow("assigned agent pass");
		expect(api.write).toHaveBeenCalledTimes(1);
	});
	it("retains unchanged approval but queues accepted feedback when the failed API attempt had no effect", async () => {
		const item = await approved(await proposed());
		api.write.mockRejectedValueOnce(new Error("API unavailable"));
		await expect(merge(item)).rejects.toThrow("API unavailable");
		const pending = await fresh(item);
		pending.assignee = { kind: "local_llm" };
		const assigned = await store.withContributions((c) =>
			store.saveContribution(c, pending),
		);
		const commented = await service.updateContribution(
			{ ...action(assigned, "comment"), body: "Check this evidence" },
			human,
		);
		expect(commented.articleLinkMerge).toBeUndefined();
		expect(commented.revision).toBe(item.revision);
		expect(reviewStatus(commented)).toBe("approved");
		expect(commented.generation?.status).toBe("queued");
		await expect(merge(commented)).rejects.toThrow("assigned agent pass");
	});
	it("imports concurrent legacy batches once while preserving distinct identities and review patches", async () => {
		const first = await legacy({
			reviewPatch: { pasukCoordinates: [{ perekId: 2, pasuk: 4 }] },
			status: "approved",
			reviewer: "doradsoft",
		});
		const second = await legacy();
		const results = await Promise.all([
			store.withContributions((c) =>
				importer.promoteLegacyArticleLinkProposals(c, 1),
			),
			store.withContributions((c) =>
				importer.promoteLegacyArticleLinkProposals(c, 1),
			),
		]);
		expect(results.flat()).toHaveLength(1);
		const pr = await store.withContributions((c) =>
			store.readContribution(c, results.flat()[0]),
		);
		expect(await importer.articleLinkContributionIds([1])).toEqual([pr.id]);
		expect(pr.legacyArticleLinks?.proposalIds.sort()).toEqual(
			[first, second].sort(),
		);
		expect(reviewStatus(pr)).toBe("required");
		const saved = await db.query<{ original: Record<string, unknown> }>(
			"SELECT original FROM tanahpedia_article_link_import WHERE proposal_id=?",
			[first],
		);
		expect(saved[0].original).toMatchObject({
			reviewer: "doradsoft",
			target_json: command.target,
			review_patch_json: { pasukCoordinates: [{ perekId: 2, pasuk: 4 }] },
		});
		expect(api.write).not.toHaveBeenCalled();
	});
	it("rolls back a newly created PR when persisting an origin marker fails and retries without a hole", async () => {
		await legacy();
		await conn.query(
			"CREATE TRIGGER fail_article_import BEFORE INSERT ON tanahpedia_article_link_import FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Injected import marker interruption'",
		);
		try {
			await expect(
				store.withContributions((c) =>
					importer.promoteLegacyArticleLinkProposals(c, 1),
				),
			).rejects.toThrow("Injected import marker interruption");
		} finally {
			await conn.query("DROP TRIGGER fail_article_import");
		}
		expect(await db.query("SELECT * FROM tanahpedia_contribution")).toEqual([]);
		expect(
			await store.withContributions((c) =>
				importer.promoteLegacyArticleLinkProposals(c, 1),
			),
		).toHaveLength(1);
	});
	it("preserves applied/rejected history and blocked unsupported drafts without API replay", async () => {
		await legacy({ status: "applied" });
		await legacy({ status: "rejected" });
		await legacy({ relationship_key: "author", target: { authorId: 8 } });
		const ids = await store.withContributions((c) =>
			importer.promoteLegacyArticleLinkProposals(c, 1),
		);
		const items = await Promise.all(
			ids.map((id) =>
				store.withContributions((c) => store.readContribution(c, id)),
			),
		);
		expect(items.map((i) => i.state).sort()).toEqual([
			"closed",
			"merged",
			"open",
		]);
		expect(
			migrationBlocked(items.find((i) => i.state === "open") as Contribution),
		).toBe(true);
		expect(api.write).not.toHaveBeenCalled();
	});
	it("recovers a gray sequence before repairing obsolete structured evidence in the same PR", async () => {
		const id = await legacy({
			relationship_key: "author",
			target: { authorId: 8 },
		});
		await conn.execute(
			"UPDATE tanah_article_link_proposal SET evidence_json=? WHERE id=?",
			[JSON.stringify([{ quote: "missing", spanStart: 0, spanEnd: 7 }]), id],
		);
		const [prId] = await store.withContributions((c) =>
			importer.promoteLegacyArticleLinkProposals(c, 1),
		);
		const gray = await store.withContributions((c) =>
			store.readContribution(c, prId),
		);
		expect(migrationBlocked(gray)).toBe(true);
		const recovered = await service.recoverContributionSequence(
			{
				id: prId,
				version: gray.version,
				apiVersion: CONTRIBUTION_API_VERSION,
				sequence: [
					{
						kind: "article_links",
						targetId: "1",
						after: { commands: [command] },
					},
				],
			},
			human,
		);
		expect(migrationBlocked(recovered)).toBe(false);
		expect(recovered.domainConflict).toContain("one exact quote");
		const repaired = await service.editContribution(
			{
				id: prId,
				version: recovered.version,
				title: recovered.title,
				description: recovered.description,
				evidence,
				changes: [
					{
						kind: "article_links",
						targetId: "1",
						after: { commands: [command] },
					},
				],
			},
			human,
		);
		expect(repaired.id).toBe(prId);
		expect(repaired.domainConflict).toBeUndefined();
		expect(reviewStatus(repaired)).toBe("required");
		expect(api.write).not.toHaveBeenCalled();
	});
});
