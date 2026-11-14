import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
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

vi.mock("@tanstack/react-start/server-only", () => ({}));
// Keep the database, transactions and dependency lookup real. Only the outgoing
// website request is replaced so this suite never contacts a deployed service.
vi.mock("~/server/website-revalidate", () => ({ revalidateWebsite: vi.fn() }));

import { revalidateWebsite } from "~/server/website-revalidate";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const schema = `external_refs_native_${randomBytes(10).toString("hex")}`;
const abraham = randomUUID();
const other = randomUUID();
const seededUrl = "https://www.wikidata.org/wiki/Q9181";
let admin: Connection | undefined;
let created = false;
let db: typeof import("~/server/db");
let references: typeof import("~/server/tanahpedia/external-references.server");

/** Apply the repository SQL through the real deployment parser, without AWS. */
function statements(name: string): string[] {
	const code = `
import importlib, json, pathlib, sys
sys.path.insert(0, sys.argv[1])
helpers = importlib.import_module("devops.deploy.data-deploy.test_lambda_parser").LAMBDA
sql = (pathlib.Path(sys.argv[1]) / "data/mysql" / sys.argv[2]).read_text(encoding="utf-8")
print(json.dumps(helpers.parse_statements(helpers.preprocess_sql(sql))))
`;
	return JSON.parse(
		execFileSync(process.env.PYTHON ?? "python", ["-c", code, root, name], {
			encoding: "utf8",
			timeout: 5000,
			stdio: ["ignore", "pipe", "pipe"],
		}),
	);
}

async function migrate(name: string): Promise<void> {
	const connection = await db.pool.getConnection();
	try {
		for (const statement of statements(name)) {
			// nosemgrep: node-mysql-sqli -- SQL comes only from fixed repository migration files through the deployment parser
			await connection.query(statement);
		}
	} finally {
		connection.release();
	}
}

async function stored(entityId = abraham, source = "WIKIDATA") {
	return db.queryOne<{ url: string }>(
		`SELECT url FROM external_reference
		 WHERE subject_kind = 'TANAHPEDIA_ENTITY' AND subject_id = ? AND source = ?`,
		[entityId, source],
	);
}

function set(
	url: string,
	expectedUrl: string | null = null,
	entityId = abraham,
) {
	return references.setEntityExternalReference({
		entityId,
		source: "WIKIDATA",
		url,
		expectedUrl,
	});
}

function remove(expectedUrl: string) {
	return references.removeEntityExternalReference({
		entityId: abraham,
		source: "WIKIDATA",
		expectedUrl,
	});
}

beforeAll(async () => {
	// Reuse the existing native-MySQL CI job's explicitly configured account.
	const configured = process.env.BULLETIN_MYSQL_TEST_DB_URL;
	if (!configured)
		throw new Error("Native reference tests need BULLETIN_MYSQL_TEST_DB_URL");
	const url = new URL(configured);
	if (
		url.protocol !== "mysql:" ||
		!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
		Number(url.port || 3306) !== 3306
	)
		throw new Error(
			"Native reference tests require loopback MySQL on port 3306",
		);
	admin = await mysql.createConnection({
		host: url.hostname,
		port: 3306,
		user: decodeURIComponent(url.username),
		password: decodeURIComponent(url.password),
	});
	await admin.query(
		`CREATE DATABASE \`${schema}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
	);
	created = true;
	url.pathname = `/${schema}`;
	url.search = "?ssl-mode=DISABLED";
	vi.stubEnv("DB_URL", url.toString());
	db = await import("~/server/db");
	references = await import("~/server/tanahpedia/external-references.server");
	// Minimal unrelated domain tables let the real dependency lookup run.
	await db.execute(
		"CREATE TABLE tanahpedia_entity (id VARCHAR(36) PRIMARY KEY, entity_type VARCHAR(32), name VARCHAR(255)) ENGINE=InnoDB",
	);
	await db.execute(
		"CREATE TABLE tanahpedia_entry (id VARCHAR(36) PRIMARY KEY, unique_name VARCHAR(255)) ENGINE=InnoDB",
	);
	await db.execute(
		"CREATE TABLE tanahpedia_entry_entity (entry_id VARCHAR(36), entity_id VARCHAR(36)) ENGINE=InnoDB",
	);
	await db.execute(
		"CREATE TABLE tanahpedia_entity_tanah_source (entity_id VARCHAR(36), perek_id INT) ENGINE=InnoDB",
	);
	await db.execute(
		"CREATE TABLE parshan (id INT PRIMARY KEY, name VARCHAR(255)) ENGINE=InnoDB",
	);
	await migrate("external_reference_structure.sql");
});

afterAll(async () => {
	if (db) await db.pool.end();
	if (admin) {
		try {
			if (created && /^external_refs_native_[a-f0-9]{20}$/.test(schema)) {
				await admin.query(`DROP DATABASE \`${schema}\``);
			}
		} finally {
			await admin.end();
		}
	}
	vi.unstubAllEnvs();
});

beforeEach(async () => {
	vi.mocked(revalidateWebsite).mockReset().mockResolvedValue(true);
	for (const table of [
		"external_reference",
		"external_reference_seed",
		"tanahpedia_entry_entity",
		"tanahpedia_entry",
		"tanahpedia_entity_tanah_source",
		"tanahpedia_entity",
		"parshan",
	]) {
		// nosemgrep: node-mysql-sqli -- table is selected only from this fixed test-owned list
		await db.execute(`DELETE FROM ${table}`);
	}
	await db.execute(
		"INSERT INTO tanahpedia_entity VALUES (?, 'PERSON', 'אברהם'), (?, 'PLACE', 'מקום')",
		[abraham, other],
	);
	await db.execute(
		"INSERT INTO tanahpedia_entry VALUES ('entry-one', 'אברהם'), ('entry-two', 'אברם')",
	);
	await db.execute(
		"INSERT INTO tanahpedia_entry_entity VALUES ('entry-one', ?), ('entry-two', ?)",
		[abraham, abraham],
	);
	await db.execute(
		"INSERT INTO tanahpedia_entity_tanah_source VALUES (?, 12)",
		[abraham],
	);
});

describe("external identifier persistence and deployment", () => {
	it("commits before invalidating every dependent entry and preserves other mappings", async () => {
		await migrate("external_reference_data.sql");
		await set("Q1", null, other);
		vi.mocked(revalidateWebsite).mockImplementation(async () => {
			expect(await stored()).toEqual({
				url: "https://www.wikidata.org/wiki/Q42",
			});
			return true;
		});
		await set("q42", seededUrl);
		expect(revalidateWebsite).toHaveBeenLastCalledWith([
			{
				changes: [
					{
						kind: "pedia-entity",
						entityId: abraham,
						entityType: "PERSON",
					entryUniqueNames: expect.arrayContaining(["אברהם", "אברם"]),
						refPerekIds: [12],
					},
				],
			},
		]);
		await migrate("external_reference_structure.sql");
		await migrate("external_reference_data.sql");
		expect(await stored()).toEqual({
			url: "https://www.wikidata.org/wiki/Q42",
		});
		expect(await stored(other)).toEqual({
			url: "https://www.wikidata.org/wiki/Q1",
		});
		expect(await stored(abraham, "SEFARIA")).toEqual({
			url: "https://www.sefaria.org/topics/abraham",
		});
		vi.mocked(revalidateWebsite).mockResolvedValue(true);
		await remove("https://www.wikidata.org/wiki/Q42");
		await migrate("external_reference_data.sql");
		expect(await stored()).toBeNull();
		expect(await stored(other)).toEqual({
			url: "https://www.wikidata.org/wiki/Q1",
		});
	});

	it("keeps an admin deletion when the entity was created after the initial seed", async () => {
		await db.execute("DELETE FROM tanahpedia_entity WHERE id = ?", [abraham]);
		await migrate("external_reference_data.sql");
		await db.execute(
			"INSERT INTO tanahpedia_entity VALUES (?, 'PERSON', 'אברהם')",
			[abraham],
		);
		await set("Q42");
		await remove("https://www.wikidata.org/wiki/Q42");
		await migrate("external_reference_data.sql");
		expect(await stored()).toBeNull();
		expect(
			await db.queryOne(
				"SELECT source FROM external_reference_seed WHERE subject_id = ? AND source = 'WIKIDATA'",
				[abraham],
			),
		).toEqual({ source: "WIKIDATA" });
	});

	it.each([null, seededUrl])(
		"serializes concurrent writes from snapshot %s",
		async (snapshot) => {
			if (snapshot) await migrate("external_reference_data.sql");
			const results = await Promise.allSettled([
				set("Q42", snapshot),
				set("Q1", snapshot),
			]);
			expect(
				results.filter((result) => result.status === "fulfilled"),
			).toHaveLength(1);
			const failure = results.find((result) => result.status === "rejected");
			expect(failure).toMatchObject({
				status: "rejected",
				reason: expect.objectContaining({
					message: expect.stringContaining("המיפוי השתנה"),
				}),
			});
			const winner = await stored();
			expect([
				"https://www.wikidata.org/wiki/Q42",
				"https://www.wikidata.org/wiki/Q1",
			]).toContain(winner?.url);
			expect(revalidateWebsite).toHaveBeenCalledTimes(1);
			await migrate("external_reference_data.sql");
			expect(await stored()).toEqual(winner);
		},
	);

	it("rolls back an unprotected deletion until the additive ledger is deployed", async () => {
		await db.execute("DROP TABLE external_reference_seed");
		try {
			await set("Q42");
			vi.mocked(revalidateWebsite).mockClear();
			await expect(remove("https://www.wikidata.org/wiki/Q42")).rejects.toThrow(
				"עדיין לא פרוסו",
			);
			expect(await stored()).toEqual({
				url: "https://www.wikidata.org/wiki/Q42",
			});
			expect(revalidateWebsite).not.toHaveBeenCalled();
		} finally {
			await migrate("external_reference_structure.sql");
		}
		await migrate("external_reference_data.sql");
		expect(await stored()).toEqual({
			url: "https://www.wikidata.org/wiki/Q42",
		});
		await remove("https://www.wikidata.org/wiki/Q42");
		await migrate("external_reference_data.sql");
		expect(await stored()).toBeNull();
	});

	it("rolls back a mapping update if claiming ownership fails", async () => {
		await migrate("external_reference_data.sql");
		await db.pool.query(
			"CREATE TRIGGER reject_claim BEFORE INSERT ON external_reference_seed FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ledger unavailable'",
		);
		try {
			await expect(set("Q42", seededUrl)).rejects.toThrow("ledger unavailable");
			await expect(remove(seededUrl)).rejects.toThrow("ledger unavailable");
			expect(await stored()).toEqual({ url: seededUrl });
			expect(revalidateWebsite).not.toHaveBeenCalled();
		} finally {
			await db.pool.query("DROP TRIGGER reject_claim");
		}
	});

	it("does not guess a seeded mapping for ambiguous entity names", async () => {
		await db.execute(
			"INSERT INTO tanahpedia_entity VALUES (?, 'PERSON', 'אברהם')",
			[randomUUID()],
		);
		await migrate("external_reference_data.sql");
		expect(await stored()).toBeNull();
		expect(await db.query("SELECT * FROM external_reference_seed")).toEqual([]);
	});

	it("rejects nonexistent entities and inconsistent provider URLs without persisting", async () => {
		await expect(set("Q42", null, randomUUID())).rejects.toThrow(
			"היישות לא נמצאה",
		);
		await expect(
			references.setEntityExternalReference({
				entityId: abraham,
				source: "WIKIPEDIA_HE",
				url: "https://en.wikipedia.org/wiki/Abraham",
				expectedUrl: null,
			}),
		).rejects.toThrow("קישור ויקיפדיה לא תקין");
		expect(await db.query("SELECT * FROM external_reference")).toEqual([]);
		expect(revalidateWebsite).not.toHaveBeenCalled();
	});
});
