import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import mysql, { type Connection, type RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

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
				 (email, email_hash, consent_text, consent_version, consent_source, subscriber_id)
				 VALUES ('f@example.invalid', REPEAT('a', 64), 'consent', 'v1', 'fixture', 999999)`,
			),
		).rejects.toThrow();
	});
});

describe("join-link reads and CAS updates", () => {
	it("returns both channels in canonical order through the server reader", async () => {
		const links = await joinLinks.readJoinLinks();
		expect(links.map((link) => link.channel)).toEqual(["telegram", "whatsapp"]);
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
		consent_text: "consent fixture",
		consent_version: "2026-10",
		consent_source: "native-fixture",
	};

	it("enforces the subscriber FK on the SES-sync link", async () => {
		await db.execute(
			"INSERT INTO tanah_daily_bulletin_subscriber (email,audience,consent_status) VALUES ('reader@example.invalid','real','confirmed')",
		);
		const subscriber = await db.queryOne<RowDataPacket>(
			"SELECT id FROM tanah_daily_bulletin_subscriber WHERE email = 'reader@example.invalid'",
		);
		await db.execute(
			`INSERT INTO tanah_daily_bulletin_signup_intent
			 (email, email_hash, consent_text, consent_version, consent_source, subscriber_id)
			 VALUES (?, ?, ?, ?, ?, ?)`,
			[
				row.email,
				row.email_hash,
				row.consent_text,
				row.consent_version,
				row.consent_source,
				subscriber?.id,
			],
		);
		await expect(
			db.execute(
				`INSERT INTO tanah_daily_bulletin_signup_intent
				 (email, email_hash, consent_text, consent_version, consent_source, subscriber_id)
				 VALUES ('other@example.invalid', ?, ?, ?, ?, 999999)`,
				[
					"c".repeat(64),
					row.consent_text,
					row.consent_version,
					row.consent_source,
				],
			),
		).rejects.toThrow();
	});

	it("defaults a fresh intent to confirmed with SES sync counters at zero", async () => {
		const intent = await db.queryOne<RowDataPacket>(
			"SELECT status, ses_attempts, ses_status FROM tanah_daily_bulletin_signup_intent WHERE email = 'reader@example.invalid'",
		);
		expect(intent).toMatchObject({
			status: "confirmed",
			ses_attempts: 0,
		});
	});
});

describe("legacy confirmation-mail schema reconciliation", () => {
	// The confirmation-mail revision of this migration created the intent
	// table with challenge/expires columns and a wider status enum; databases
	// that applied it must converge when the direct-subscribe revision runs.
	const LEGACY_SIGNUP_INTENT_DDL = `CREATE TABLE tanah_daily_bulletin_signup_intent (
		id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
		email VARCHAR(254) NOT NULL,
		email_hash CHAR(64) NOT NULL,
		challenge_hash CHAR(64) NOT NULL,
		status ENUM('pending', 'sending', 'sent', 'confirmed', 'failed', 'uncertain', 'superseded', 'suppressed', 'expired') NOT NULL DEFAULT 'pending',
		consent_text VARCHAR(500) NOT NULL,
		consent_version VARCHAR(40) NOT NULL,
		consent_source VARCHAR(120) NOT NULL,
		send_token CHAR(36) NULL,
		send_started_at DATETIME(3) NULL,
		message_id VARCHAR(255) NULL,
		ses_status ENUM('pending', 'subscribed', 'opted_out', 'failed') NULL,
		ses_attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
		ses_next_attempt_at DATETIME(3) NULL,
		subscriber_id BIGINT UNSIGNED NULL,
		expires_at DATETIME(3) NOT NULL,
		confirmed_at DATETIME(3) NULL,
		last_error VARCHAR(255) NULL,
		created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
		updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
		UNIQUE KEY uq_bulletin_signup_challenge (challenge_hash),
		KEY ix_bulletin_signup_email (email_hash, created_at),
		KEY ix_bulletin_signup_send (status, id),
		KEY ix_bulletin_signup_ses (status, ses_status, id),
		CONSTRAINT fk_bulletin_signup_subscriber FOREIGN KEY (subscriber_id)
			REFERENCES tanah_daily_bulletin_subscriber(id)
	) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;

	it("converges a legacy table so direct signups insert cleanly", async () => {
		await db.execute("DROP TABLE tanah_daily_bulletin_signup_intent");
		await db.execute(LEGACY_SIGNUP_INTENT_DDL);
		await db.execute(
			`INSERT INTO tanah_daily_bulletin_signup_intent
			 (email, email_hash, challenge_hash, status, consent_text, consent_version, consent_source, expires_at)
			 VALUES ('legacy@example.invalid', ?, ?, 'sent', 'consent', 'v1', 'fixture', UTC_TIMESTAMP(3))`,
			["d".repeat(64), "e".repeat(64)],
		);
		await migrate(parseMigration("tanah_daily_bulletin_join_upgrade.sql"));

		const columns = await db.query<RowDataPacket>(
			`SELECT COLUMN_NAME name FROM information_schema.COLUMNS
			 WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'tanah_daily_bulletin_signup_intent'`,
			[schema],
		);
		const names = columns.map((column) => column.name);
		for (const dropped of [
			"challenge_hash",
			"send_token",
			"send_started_at",
			"message_id",
			"expires_at",
			"confirmed_at",
		])
			expect(names).not.toContain(dropped);

		const statusColumn = await db.queryOne<RowDataPacket>(
			`SELECT COLUMN_TYPE column_type, COLUMN_DEFAULT column_default
			 FROM information_schema.COLUMNS
			 WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'tanah_daily_bulletin_signup_intent'
			   AND COLUMN_NAME = 'status'`,
			[schema],
		);
		expect(statusColumn?.column_type).toBe(
			"enum('confirmed','suppressed','failed')",
		);
		expect(statusColumn?.column_default).toBe("confirmed");

		const legacy = await db.queryOne<RowDataPacket>(
			"SELECT status FROM tanah_daily_bulletin_signup_intent WHERE email = 'legacy@example.invalid'",
		);
		expect(legacy?.status).toBe("failed");

		// The direct-subscribe insert shape used by requestSignup must succeed.
		await db.execute(
			`INSERT INTO tanah_daily_bulletin_signup_intent
			 (email, email_hash, status, consent_text, consent_version, consent_source, ses_status)
			 VALUES ('direct@example.invalid', ?, 'confirmed', 'consent', 'v1', 'fixture', 'pending')`,
			["f".repeat(64)],
		);
	});
});
