import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import mysql, { type Connection, type RowDataPacket } from "mysql2/promise";
import {
	afterAll,
	beforeAll,
	describe,
	expect,
	it,
	vi,
} from "vitest";

vi.mock("@tanstack/react-start/server-only", () => ({}));

import type { JoinChannel } from "~/lib/bulletin-join";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const schema = `bulletin_join_native_${randomBytes(10).toString("hex")}`;
let admin: Connection | undefined;
let db: typeof import("~/server/db");
let joinLinks: typeof import("~/server/join-links.server");
let created = false;

/** Run only the deployment parser helpers, never Lambda handler code. */
function parseMigration(name: string): string[] {
	const code = `
import ast, hashlib, json, os, pathlib, re, sys, zipfile
root = pathlib.Path(sys.argv[1])
archive = os.environ.get("BULLETIN_MYSQL_LAMBDA_ZIP")
if archive:
    content = pathlib.Path(archive).read_bytes()
    expected = os.environ.get("BULLETIN_MYSQL_LAMBDA_SHA256", "")
    if not re.fullmatch(r"[a-f0-9]{64}", expected) or hashlib.sha256(content).hexdigest() != expected:
        raise ValueError("Deployment archive checksum mismatch")
    with zipfile.ZipFile(archive) as bundle:
        source = bundle.read("index.py").decode("utf-8")
else:
    source = (root / "docs/aws/cloudformation/data-deploy/data-deploy-lambda.py").read_text(encoding="utf-8")
tree = ast.parse(source)
names = {"find_statement_end", "_should_execute", "parse_statements", "preprocess_sql"}
helpers = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in names]
if {node.name for node in helpers} != names:
    raise ValueError("Required deployment SQL helpers are missing")
namespace = {"re": re}
exec(compile(ast.Module(body=helpers, type_ignores=[]), "sql-parser-helpers", "exec"), namespace)
sql = (root / "data/mysql" / sys.argv[2]).read_text(encoding="utf-8")
for line in sql.splitlines():
    if line.lstrip().startswith("--") and ("'" in line or ";" in line):
        raise ValueError("Legacy deployment parser cannot safely split this comment")
print(json.dumps(namespace["parse_statements"](namespace["preprocess_sql"](sql))))
`;
	return JSON.parse(
		execFileSync(process.env.PYTHON ?? "python", ["-c", code, root, name], {
			encoding: "utf8",
			timeout: 5000,
			stdio: ["ignore", "pipe", "pipe"],
		}),
	);
}

async function migrate(statements: string[]): Promise<void> {
	const connection = await db.pool.getConnection();
	try {
		for (const statement of statements) await connection.query(statement); // nosemgrep: node-mysql-sqli -- statements are parsed from repo-owned migration SQL files, never user input
	} finally {
		connection.release();
	}
}

function linkRow(channel: JoinChannel) {
	return db.queryOne<RowDataPacket>(
		"SELECT * FROM tanah_daily_bulletin_join_link WHERE channel = ?",
		[channel],
	);
}

beforeAll(async () => {
	const configured = process.env.BULLETIN_MYSQL_TEST_DB_URL;
	if (!configured)
		throw new Error(
			"Set BULLETIN_MYSQL_TEST_DB_URL to an authorized loopback MySQL account",
		);
	const url = new URL(configured);
	if (
		url.protocol !== "mysql:" ||
		!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
		Number(url.port || 3306) !== 3306 ||
		!/^bulletin_join_native_[a-f0-9]{20}$/.test(schema)
	)
		throw new Error("Join-link tests require loopback MySQL on port 3306");
	admin = await mysql.createConnection({
		host: url.hostname,
		port: 3306,
		user: decodeURIComponent(url.username),
		password: decodeURIComponent(url.password),
	});
	await admin.query(`CREATE DATABASE \`${schema}\` CHARACTER SET utf8mb4`);
	created = true;
	url.pathname = `/${schema}`;
	url.search = "?ssl-mode=DISABLED";
	vi.stubEnv("DB_URL", url.toString());
	db = await import("~/server/db");
	joinLinks = await import("~/server/join-links.server");
	// The base bulletin migration foreign-keys into tanah_article.
	await db.execute(
		"CREATE TABLE tanah_article (id MEDIUMINT PRIMARY KEY, content TEXT) ENGINE=InnoDB",
	);
	// The signup intent references tanah_daily_bulletin_subscriber, so the base
	// bulletin migration must run first — the same deploy order sql-files.json
	// encodes.
	await migrate([
		...parseMigration("tanah_daily_bulletin_upgrade.sql"),
		...parseMigration("tanah_daily_bulletin_join_upgrade.sql"),
	]);
});

afterAll(async () => {
	if (db) await db.pool.end();
	if (admin) {
		try {
			if (created && /^bulletin_join_native_[a-f0-9]{20}$/.test(schema))
				await admin.query(`DROP DATABASE \`${schema}\``);
		} finally {
			await admin.end();
		}
	}
	vi.unstubAllEnvs();
});

describe("join-link migration", () => {
	it("seeds telegram enabled and whatsapp deliberately blank", async () => {
		expect(await linkRow("telegram")).toMatchObject({
			enabled: 1,
			destination: "https://t.me/alhaperek",
			revision: 0,
		});
		expect(await linkRow("whatsapp")).toMatchObject({
			enabled: 0,
			destination: null,
			revision: 0,
		});
	});

	it("survives re-application without overwriting an edited destination", async () => {
		await db.execute(
			"UPDATE tanah_daily_bulletin_join_link SET destination = ?, revision = 9 WHERE channel = 'whatsapp'",
			["https://chat.whatsapp.com/AbCdEfGh1234567890"],
		);
		await migrate(parseMigration("tanah_daily_bulletin_join_upgrade.sql"));
		expect(await linkRow("whatsapp")).toMatchObject({
			destination: "https://chat.whatsapp.com/AbCdEfGh1234567890",
			revision: 9,
		});
		await db.execute(
			"UPDATE tanah_daily_bulletin_join_link SET destination = NULL, revision = 0 WHERE channel = 'whatsapp'",
		);
	});

	it("creates the audit and signup-intent tables with the FK intact", async () => {
		const rows = await db.query<RowDataPacket>(
			"SELECT TABLE_NAME name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME LIKE 'tanah_daily_bulletin_%'",
			[schema],
		);
		const names = rows.map((row) => row.name);
		expect(names).toContain("tanah_daily_bulletin_join_link_audit");
		expect(names).toContain("tanah_daily_bulletin_signup_intent");
		await expect(
			db.execute(
				`INSERT INTO tanah_daily_bulletin_signup_intent
				 (email, email_hash, challenge_hash, consent_text, consent_version, consent_source, expires_at, subscriber_id)
				 VALUES ('f@example.invalid', REPEAT('a', 64), REPEAT('b', 64), 'consent', 'v1', 'fixture', UTC_TIMESTAMP(3), 999999)`,
			),
		).rejects.toThrow();
	});
});

describe("join-link reads and CAS updates", () => {
	it("returns both channels in canonical order through the server reader", async () => {
		const links = await joinLinks.readJoinLinks();
		expect(links.map((link) => link.channel)).toEqual([
			"telegram",
			"whatsapp",
		]);
		expect(links[0]).toMatchObject({
			enabled: true,
			destination: "https://t.me/alhaperek",
		});
	});

	it("writes a new revision and an audit row on update", async () => {
		const before = await joinLinks.readJoinLinks();
		const state = await joinLinks.updateJoinLink({
			channel: "whatsapp",
			enabled: true,
			destination: "https://chat.whatsapp.com/AbCdEfGh1234567890",
			expectedRevision: before[1].revision,
			changedBy: "native-fixture",
		});
		expect(state.revision).toBe(before[1].revision + 1);
		const audit = await db.query<RowDataPacket>(
			"SELECT * FROM tanah_daily_bulletin_join_link_audit WHERE channel = 'whatsapp' ORDER BY id DESC LIMIT 1",
		);
		expect(audit[0]).toMatchObject({
			enabled: 1,
			destination: "https://chat.whatsapp.com/AbCdEfGh1234567890",
			revision: before[1].revision + 1,
			changed_by: "native-fixture",
		});
	});

	it("rejects a stale revision inside the transaction and audits nothing", async () => {
		const current = await joinLinks.readJoinLinks();
		await expect(
			joinLinks.updateJoinLink({
				channel: "telegram",
				enabled: false,
				destination: null,
				expectedRevision: current[0].revision + 5,
				changedBy: "native-fixture",
			}),
		).rejects.toThrow();
		const row = await linkRow("telegram");
		expect(row?.destination).toBe("https://t.me/alhaperek");
		const count = await db.queryOne<RowDataPacket>(
			"SELECT COUNT(*) n FROM tanah_daily_bulletin_join_link_audit WHERE channel = 'telegram'",
		);
		expect(Number(count?.n)).toBe(0);
	});
});

describe("signup intent constraints", () => {
	const row = {
		email: "reader@example.invalid",
		email_hash: "a".repeat(64),
		challenge_hash: "b".repeat(64),
		consent_text: "consent fixture",
		consent_version: "2026-10",
		consent_source: "native-fixture",
	};

	it("enforces the unique challenge hash and the subscriber FK", async () => {
		await db.execute(
			"INSERT INTO tanah_daily_bulletin_subscriber (email,audience,consent_status) VALUES ('reader@example.invalid','real','confirmed')",
		);
		const subscriber = await db.queryOne<RowDataPacket>(
			"SELECT id FROM tanah_daily_bulletin_subscriber WHERE email = 'reader@example.invalid'",
		);
		await db.execute(
			`INSERT INTO tanah_daily_bulletin_signup_intent
			 (email, email_hash, challenge_hash, consent_text, consent_version, consent_source, expires_at, subscriber_id)
			 VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3), ?)`,
			[
				row.email,
				row.email_hash,
				row.challenge_hash,
				row.consent_text,
				row.consent_version,
				row.consent_source,
				subscriber?.id,
			],
		);
		await expect(
			db.execute(
				`INSERT INTO tanah_daily_bulletin_signup_intent
				 (email, email_hash, challenge_hash, consent_text, consent_version, consent_source, expires_at)
				 VALUES ('other@example.invalid', ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))`,
				[
					"c".repeat(64),
					row.challenge_hash,
					row.consent_text,
					row.consent_version,
					row.consent_source,
				],
			),
		).rejects.toThrow();
	});

	it("defaults a fresh intent to pending with the email index populated", async () => {
		const intent = await db.queryOne<RowDataPacket>(
			"SELECT status, ses_attempts, send_token, challenge_hash FROM tanah_daily_bulletin_signup_intent WHERE email = 'reader@example.invalid'",
		);
		expect(intent).toMatchObject({
			status: "pending",
			ses_attempts: 0,
			send_token: null,
			challenge_hash: row.challenge_hash,
		});
	});
});
