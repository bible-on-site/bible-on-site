import { execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import mysql, { type Connection, type RowDataPacket } from "mysql2/promise";
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
vi.mock("~/server/render-daily.server", () => ({
	renderDailyBulletin: vi.fn(),
}));
vi.mock("@aws-sdk/client-sqs", () => ({
	SQSClient: class {
		constructor() {
			throw new Error("Native tests prohibit AWS calls");
		}
	},
	SendMessageBatchCommand: class {},
}));

import {
	WhatsAppClient,
	WhatsAppDeferredError,
} from "~/server/whatsapp-client.server";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const schema = `bulletin_wa_native_${randomBytes(10).toString("hex")}`;
const date = "2026-01-07";
const pdf = Buffer.from("%PDF-1.7\nimmutable native regression fixture\n%%EOF");
const digest = createHash("sha256").update(pdf).digest("hex");
const participantDigest = `sha256:${"a".repeat(64)}`;
const instance = "111111111111";
const group = "111111111111111111@g.us";
const sender = "222222222222222@lid";
const phone = "15550000001";
let admin: Connection | undefined;
let db: typeof import("~/server/db");
let settings: typeof import("~/server/whatsapp-settings.server");
let delivery: typeof import("~/server/whatsapp-delivery.server");
let migrationStatements: string[];
let created = false;

/** Run only the parser helpers, never import Lambda AWS clients or handler code. */
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

async function insertJob(
	status = "accepted",
	key = randomUUID(),
	audience: "test" | "real" = "test",
): Promise<string> {
	const id = randomUUID();
	const runtime = settings.loadWhatsAppRuntime();
	if (!runtime) throw new Error("Native fixture configuration is missing");
	await db.execute(
		`INSERT INTO tanah_daily_bulletin_whatsapp_job
		(id, bulletin_date, audience, idempotency_key, settings_revision, instance_id, target_group_id,
		sender_id, sender_phone, participant_digest, config_sha256, pdf_sha256, filename, caption,
		status, provider_message_id, next_reconcile_at)
		VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, 'native.pdf', 'fixture caption', ?, ?, UTC_TIMESTAMP(3) - INTERVAL 1 SECOND)`,
		[
			id,
			date,
			audience,
			key,
			instance,
			settings.targetGroupId(runtime, audience),
			sender,
			phone,
			participantDigest,
			settings.whatsAppConfigDigest(runtime, audience),
			digest,
			status,
			status === "accepted" ? randomBytes(12).toString("hex") : null,
		],
	);
	return id;
}

async function fingerprint(tables: string[]): Promise<string> {
	const records = [];
	for (const table of tables) {
		if (!/^tanah_[a-z_]+$/.test(table)) throw new Error("Unsafe fixture table");
		const rows = await db.query<RowDataPacket>(`SELECT * FROM ${table}`);
		records.push([table, rows.map((row) => JSON.stringify(row)).sort()]);
	}
	return createHash("sha256").update(JSON.stringify(records)).digest("hex");
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
		!/^bulletin_wa_native_[a-f0-9]{20}$/.test(schema)
	)
		throw new Error(
			"Native bulletin tests require loopback MySQL on port 3306",
		);
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
	for (const [name, value] of Object.entries({
		INSTANCE_ID: instance,
		API_TOKEN: "native_mock_token_never_for_http",
		API_URL: "https://api.greenapi.com",
		MEDIA_URL: "https://media.greenapi.com",
		SENDER_PHONE: phone,
		TEST_GROUP_ID: group,
		TEST_PARTICIPANT_DIGEST: participantDigest,
		REAL_GROUP_ID: "",
	}))
		vi.stubEnv(`BULLETIN_WHATSAPP_${name}`, value);
	vi.stubEnv("BULLETIN_SES_ACCOUNT_ID", "111111111111");
	vi.stubEnv("BULLETIN_SES_REGION", "il-central-1");
	vi.stubEnv(
		"BULLETIN_EMAIL_QUEUE_URL",
		"https://sqs.il-central-1.amazonaws.com/111111111111/native-fixture",
	);
	vi.stubGlobal(
		"fetch",
		vi.fn(() => {
			throw new Error("Native tests prohibit external HTTP");
		}),
	);
	db = await import("~/server/db");
	settings = await import("~/server/whatsapp-settings.server");
	delivery = await import("~/server/whatsapp-delivery.server");
	await db.execute(
		"CREATE TABLE tanah_article (id MEDIUMINT PRIMARY KEY, content TEXT) ENGINE=InnoDB",
	);
	await db.execute("INSERT INTO tanah_article VALUES (1, 'preserved article')");
	await migrate(parseMigration("tanah_daily_bulletin_upgrade.sql"));
	await db.execute(
		`INSERT INTO tanah_daily_bulletin
		(bulletin_date,perek_id,article_id,input_json,subject,source,email_html,pdf_data,filename)
		VALUES (?,1,1,?, 'preserved subject','preserved source','<p>preserved</p>',?,'native.pdf')`,
		[
			date,
			JSON.stringify({ date, perekId: 1, hebrewDate: "fixture date" }),
			pdf,
		],
	);
	await db.execute(
		"INSERT INTO tanah_daily_bulletin_delivery (bulletin_date,channel,status,attempt_count,provider_message_id) VALUES (?, 'email', 'sent', 1, 'preserved-ses-message')",
		[date],
	);
	await db.execute(
		"INSERT INTO tanah_daily_bulletin_subscriber (id,email,audience,consent_status) VALUES (1,'fixture@example.invalid','test','unsubscribed')",
	);
	await db.execute(
		"INSERT INTO tanah_daily_bulletin_email_job (id,bulletin_date,audience,idempotency_key,settings_revision,status) VALUES ('legacy-job',?,'test','legacy',0,'delivered')",
		[date],
	);
	await db.execute(
		"INSERT INTO tanah_daily_bulletin_email_recipient (job_id,subscriber_id,email,status,message_id) VALUES ('legacy-job',1,'fixture@example.invalid','delivered','legacy-ses-id')",
	);
	await db.execute(
		"UPDATE tanah_daily_bulletin_email_settings SET audience='real',revision=9 WHERE id=1",
	);
	migrationStatements = parseMigration(
		"tanah_daily_bulletin_whatsapp_upgrade.sql",
	);
	await migrate(migrationStatements);
});

afterAll(async () => {
	if (db) await db.pool.end();
	if (admin) {
		try {
			if (created && /^bulletin_wa_native_[a-f0-9]{20}$/.test(schema))
				await admin.query(`DROP DATABASE \`${schema}\``);
		} finally {
			await admin.end();
		}
	}
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
});

beforeEach(async () => {
	vi.restoreAllMocks();
	vi.stubEnv("BULLETIN_WHATSAPP_REAL_GROUP_ID", "");
	await db.execute(
		"DELETE FROM tanah_daily_bulletin_delivery WHERE channel='whatsapp'",
	);
	await db.execute("DELETE FROM tanah_daily_bulletin_whatsapp_job");
	await db.execute("DELETE FROM tanah_daily_bulletin_whatsapp_verification");
	await db.execute(`UPDATE tanah_daily_bulletin_whatsapp_settings SET audience='test',revision=0,
		group_lookup_token=NULL,group_lookup_until=NULL,next_group_lookup_at=NULL,
		message_check_month=NULL,message_checks_used=0,next_message_check_at=NULL WHERE id=1`);
});

describe("native WhatsApp migration and durable claim invariants", () => {
	it("parses all additive statements and preserves legacy and WhatsApp history over repeated deployment", async () => {
		expect(migrationStatements).toHaveLength(15);
		expect(migrationStatements.join("\n")).not.toMatch(
			/\b(?:DROP|TRUNCATE|DELETE)\b/i,
		);
		expect(await settings.readWhatsAppSettings()).toEqual({
			audience: "test",
			revision: 0,
		});
		await insertJob("sent");
		await db.execute(
			"UPDATE tanah_daily_bulletin_whatsapp_settings SET audience='real',revision=17,message_checks_used=999 WHERE id=1",
		);
		await db.execute(
			`INSERT INTO tanah_daily_bulletin_whatsapp_verification
			(audience,config_sha256,verified,connection_state,title,checked_at,expires_at)
			VALUES ('test',?,TRUE,'authorized','preserved target',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3)+INTERVAL 10 MINUTE)`,
			["b".repeat(64)],
		);
		const tables = [
			"tanah_article",
			"tanah_daily_bulletin",
			"tanah_daily_bulletin_delivery",
			"tanah_daily_bulletin_email_settings",
			"tanah_daily_bulletin_subscriber",
			"tanah_daily_bulletin_email_job",
			"tanah_daily_bulletin_email_recipient",
			"tanah_daily_bulletin_whatsapp_settings",
			"tanah_daily_bulletin_whatsapp_verification",
			"tanah_daily_bulletin_whatsapp_job",
		];
		const before = await fingerprint(tables);
		await migrate(migrationStatements);
		await migrate(migrationStatements);
		expect(await fingerprint(tables)).toBe(before);
		expect(await settings.readWhatsAppSettings()).toEqual({
			audience: "real",
			revision: 17,
		});
	});

	it("allows one global group lease under contention, keeps the one-second gap and fences a late release", async () => {
		const attempts = await Promise.allSettled(
			Array.from({ length: 24 }, () =>
				settings.reserveWhatsAppGroupLookup(new AbortController().signal),
			),
		);
		const winners = attempts.filter((result) => result.status === "fulfilled");
		expect(winners).toHaveLength(1);
		for (const result of attempts)
			if (result.status === "rejected")
				expect(result.reason).toBeInstanceOf(WhatsAppDeferredError);
		const releaseOld = (
			winners[0] as PromiseFulfilledResult<() => Promise<void>>
		).value;
		await db.execute(
			"UPDATE tanah_daily_bulletin_whatsapp_settings SET group_lookup_until=UTC_TIMESTAMP(3)-INTERVAL 1 SECOND,next_group_lookup_at=UTC_TIMESTAMP(3)-INTERVAL 1 SECOND WHERE id=1",
		);
		const releaseNew = await settings.reserveWhatsAppGroupLookup(
			new AbortController().signal,
		);
		const newer = await db.queryOne<{ group_lookup_token: string }>(
			"SELECT group_lookup_token FROM tanah_daily_bulletin_whatsapp_settings WHERE id=1",
		);
		await releaseOld();
		expect(
			await db.queryOne(
				"SELECT group_lookup_token FROM tanah_daily_bulletin_whatsapp_settings WHERE id=1",
			),
		).toEqual(newer);
		await releaseNew();
		await releaseNew();
		expect(
			await db.queryOne(
				"SELECT group_lookup_token,group_lookup_until,(next_group_lookup_at > UTC_TIMESTAMP(3)) AS gap FROM tanah_daily_bulletin_whatsapp_settings WHERE id=1",
			),
		).toEqual({ group_lookup_token: null, group_lookup_until: null, gap: 1 });
		await expect(
			settings.reserveWhatsAppGroupLookup(new AbortController().signal),
		).rejects.toBeInstanceOf(WhatsAppDeferredError);
	});

	it("reserves the final monthly status check once across competing accepted jobs and defers the remainder", async () => {
		const ids = await Promise.all([insertJob(), insertJob()]);
		await db.execute(
			"UPDATE tanah_daily_bulletin_whatsapp_settings SET message_check_month=DATE_FORMAT(UTC_TIMESTAMP(),'%Y-%m'),message_checks_used=999 WHERE id=1",
		);
		const lookup = vi
			.spyOn(WhatsAppClient.prototype, "getMessage")
			.mockResolvedValue({ status: "pending" });
		const upload = vi.spyOn(WhatsAppClient.prototype, "sendDocument");
		await Promise.all(
			Array.from({ length: 24 }, (_, index) =>
				delivery.processWhatsAppJob(ids[index % 2]),
			),
		);
		expect(lookup).toHaveBeenCalledTimes(1);
		expect(upload).not.toHaveBeenCalled();
		expect(
			await db.queryOne(
				"SELECT message_checks_used FROM tanah_daily_bulletin_whatsapp_settings WHERE id=1",
			),
		).toEqual({ message_checks_used: 1000 });
		expect(
			await db.queryOne(
				"SELECT SUM(reconcile_attempts) AS total,COUNT(*) AS accepted FROM tanah_daily_bulletin_whatsapp_job WHERE status='accepted'",
			),
		).toEqual({ total: "1", accepted: 2 });
		await db.execute(
			"UPDATE tanah_daily_bulletin_whatsapp_settings SET next_message_check_at=UTC_TIMESTAMP(3)-INTERVAL 1 SECOND WHERE id=1",
		);
		await db.execute(
			"UPDATE tanah_daily_bulletin_whatsapp_job SET next_reconcile_at=UTC_TIMESTAMP(3)-INTERVAL 1 SECOND",
		);
		await Promise.all(ids.map((id) => delivery.processWhatsAppJob(id)));
		expect(lookup).toHaveBeenCalledTimes(1);
		expect(
			await db.queryOne(
				"SELECT COUNT(*) AS deferred FROM tanah_daily_bulletin_whatsapp_job WHERE status='accepted' AND next_reconcile_at=TIMESTAMPADD(DAY,1,LAST_DAY(UTC_DATE()))",
			),
		).toEqual({ deferred: 2 });
	});

	it("resets the monthly counter in UTC atomically without retrying the accepted upload", async () => {
		const id = await insertJob();
		await db.execute(
			"UPDATE tanah_daily_bulletin_whatsapp_settings SET message_check_month='2000-01',message_checks_used=1000 WHERE id=1",
		);
		const lookup = vi
			.spyOn(WhatsAppClient.prototype, "getMessage")
			.mockResolvedValue({ status: "delivered" });
		const upload = vi.spyOn(WhatsAppClient.prototype, "sendDocument");
		await Promise.all(
			Array.from({ length: 20 }, () => delivery.processWhatsAppJob(id)),
		);
		expect(lookup).toHaveBeenCalledTimes(1);
		expect(upload).not.toHaveBeenCalled();
		expect(
			await db.queryOne(
				"SELECT message_checks_used,(message_check_month=DATE_FORMAT(UTC_TIMESTAMP(),'%Y-%m')) AS current_month FROM tanah_daily_bulletin_whatsapp_settings WHERE id=1",
			),
		).toEqual({ message_checks_used: 1, current_month: 1 });
		expect(
			await db.queryOne(
				"SELECT status,reconcile_attempts,reconcile_token,reconcile_until FROM tanah_daily_bulletin_whatsapp_job WHERE id=?",
				[id],
			),
		).toEqual({
			status: "sent",
			reconcile_attempts: 1,
			reconcile_token: null,
			reconcile_until: null,
		});
	});

	it("claims one upload and saves one provider acknowledgement despite duplicate queue consumers", async () => {
		const id = await insertJob("queued");
		const upload = vi
			.spyOn(WhatsAppClient.prototype, "sendDocument")
			.mockImplementation(async (request) => {
				await request.beforeSend();
				return { messageId: "native_provider_ack_123456" };
			});
		await Promise.all(
			Array.from({ length: 24 }, () => delivery.processWhatsAppJob(id)),
		);
		expect(upload).toHaveBeenCalledTimes(1);
		expect(
			await db.queryOne(
				"SELECT status,provider_message_id,(upload_started_at IS NOT NULL) AS claimed FROM tanah_daily_bulletin_whatsapp_job WHERE id=?",
				[id],
			),
		).toEqual({
			status: "accepted",
			provider_message_id: "native_provider_ack_123456",
			claimed: 1,
		});
		await delivery.processWhatsAppJob(id);
		expect(upload).toHaveBeenCalledTimes(1);
	});

	it("suppresses a queued job if the stored PDF changes before the single upload claim", async () => {
		const id = await insertJob("queued");
		const upload = vi.spyOn(WhatsAppClient.prototype, "sendDocument");
		await db.execute(
			"UPDATE tanah_daily_bulletin SET pdf_data=? WHERE bulletin_date=?",
			[Buffer.from("%PDF-1.7\nchanged after the job snapshot\n%%EOF"), date],
		);
		try {
			await delivery.processWhatsAppJob(id);
			expect(upload).not.toHaveBeenCalled();
			expect(
				await db.queryOne(
					"SELECT status,pdf_sha256,upload_started_at,provider_message_id FROM tanah_daily_bulletin_whatsapp_job WHERE id=?",
					[id],
				),
			).toEqual({
				status: "suppressed",
				pdf_sha256: digest,
				upload_started_at: null,
				provider_message_id: null,
			});
		} finally {
			await db.execute(
				"UPDATE tanah_daily_bulletin SET pdf_data=? WHERE bulletin_date=?",
				[pdf, date],
			);
		}
	});

	it.each([false, true])(
		"preserves legacy real-group ownership before upload, ownership changed=%s",
		async (changed) => {
			vi.stubEnv("BULLETIN_WHATSAPP_REAL_GROUP_ID", "999999999999999999@g.us");
			await db.execute(
				"UPDATE tanah_daily_bulletin_whatsapp_settings SET audience='real' WHERE id=1",
			);
			const id = await insertJob("queued", randomUUID(), "real");
			const marker = `whatsapp-job:${id}`;
			await db.execute(
				"INSERT INTO tanah_daily_bulletin_delivery (bulletin_date,channel,status,provider_message_id) VALUES (?,'whatsapp','sending',?)",
				[date, marker],
			);
			if (changed)
				await db.execute(
					"UPDATE tanah_daily_bulletin_delivery SET status='sent',attempt_count=1,sent_at=UTC_TIMESTAMP() WHERE bulletin_date=? AND channel='whatsapp'",
					[date],
				);
			let uploads = 0;
			vi.spyOn(WhatsAppClient.prototype, "sendDocument").mockImplementation(
				async (request) => {
					await request.beforeSend();
					uploads++;
					return { messageId: "native_real_ack_123456789" };
				},
			);
			await delivery.processWhatsAppJob(id);
			expect(uploads).toBe(changed ? 0 : 1);
			expect(
				await db.queryOne(
					"SELECT status,(upload_started_at IS NOT NULL) AS claimed FROM tanah_daily_bulletin_whatsapp_job WHERE id=?",
					[id],
				),
			).toEqual({
				status: changed ? "suppressed" : "accepted",
				claimed: changed ? 0 : 1,
			});
			expect(
				await db.queryOne(
					"SELECT status,attempt_count,provider_message_id FROM tanah_daily_bulletin_delivery WHERE bulletin_date=? AND channel='whatsapp'",
					[date],
				),
			).toEqual({
				status: changed ? "sent" : "sending",
				attempt_count: 1,
				provider_message_id: changed
					? marker
					: "whatsapp:999999999999999999@g.us:native_real_ack_123456789",
			});
		},
	);
});
