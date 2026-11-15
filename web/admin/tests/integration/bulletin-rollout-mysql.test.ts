import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
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

/** Simulated SES contact list: topics are per-address; optedOut is global. */
const contacts = new Map<string, Set<string>>();
const optedOut = new Set<string>();
const sesFailures = new Set<string>();
const unsubscribedInSes = new Set<string>();
vi.mock("~/server/ses-client.server", () => {
	class SesError extends Error {
		constructor(
			message: string,
			public outcome: "failed" | "uncertain",
		) {
			super(message);
			this.name = "SesError";
		}
	}
	class SesSuppressedError extends SesError {
		constructor() {
			super("suppressed", "failed");
			this.name = "SesSuppressedError";
		}
	}
	return {
		SesError,
		SesSuppressedError,
		SesClient: class {
			async ensureSubscribedContact(email: string, topic: string) {
				if (sesFailures.has(email)) throw new SesError("timeout", "uncertain");
				const topics = contacts.get(email);
				if (topics)
					return optedOut.has(email) || !topics.has(topic)
						? "opted_out"
						: "subscribed";
				contacts.set(email, new Set([topic]));
				return "subscribed";
			}
			async unsubscribeContact(email: string) {
				unsubscribedInSes.add(email);
				contacts.delete(email);
				optedOut.add(email);
			}
			async sendOne() {
				return `native-${randomBytes(6).toString("hex")}`;
			}
			destroy() {}
		},
	};
});
vi.mock("@aws-sdk/client-sesv2", () => ({
	SESv2Client: class {
		async send(command: { kind: string }) {
			return command.kind === "account"
				? { SendingEnabled: true, ProductionAccessEnabled: true }
				: {
						VerifiedForSendingStatus: true,
						DkimAttributes: {
							Status: "SUCCESS",
							SigningEnabled: true,
							SigningAttributesOrigin: "AWS_SES",
						},
					};
		}
		destroy() {}
	},
	GetAccountCommand: class {
		kind = "account";
		constructor(public input: unknown) {}
	},
	GetEmailIdentityCommand: class {
		kind = "identity";
		constructor(public input: unknown) {}
	},
	GetContactCommand: class {
		constructor(public input: unknown) {}
	},
	CreateContactCommand: class {
		constructor(public input: unknown) {}
	},
	UpdateContactCommand: class {
		constructor(public input: unknown) {}
	},
	SendEmailCommand: class {
		constructor(public input: unknown) {}
	},
}));
vi.mock("@aws-sdk/client-sqs", () => ({
	SQSClient: class {
		async send(command: {
			kind: string;
			input?: { Entries?: { Id: string }[] };
		}) {
			if (command.kind === "batch")
				return {
					Successful: (command.input?.Entries ?? []).map((entry) => ({
						Id: entry.Id,
					})),
				};
			return {};
		}
		destroy() {}
	},
	SendMessageBatchCommand: class {
		kind = "batch";
		constructor(public input: unknown) {}
	},
	ReceiveMessageCommand: class {
		kind = "receive";
		constructor(public input: unknown) {}
	},
	DeleteMessageCommand: class {
		kind = "delete";
		constructor(public input: unknown) {}
	},
}));

import {
	bulletinCohortSql,
	type CohortSnapshotMember,
	planBulletinCohort,
} from "~/server/bulletin-rollout-plan";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const schema = `bulletin_rollout_${randomBytes(10).toString("hex")}`;
const localDate = "2026-11-02";
const bulletinDate = "2026-11-03";
let admin: Connection;
let db: typeof import("~/server/db");
let admission: typeof import("~/server/rollout-admission.server");
let rolloutState: typeof import("~/server/rollout-state.server");
let settings: typeof import("~/server/ses-settings.server");
let delivery: typeof import("~/server/ses-delivery.server");
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

/** The same isolated parser helpers, applied to generated SQL text. */
function parseStatements(sql: string): string[] {
	const code = `
import ast, hashlib, json, os, pathlib, re, sys, zipfile
archive = os.environ.get("BULLETIN_MYSQL_LAMBDA_ZIP")
if archive:
    content = pathlib.Path(archive).read_bytes()
    expected = os.environ.get("BULLETIN_MYSQL_LAMBDA_SHA256", "")
    if not re.fullmatch(r"[a-f0-9]{64}", expected) or hashlib.sha256(content).hexdigest() != expected:
        raise ValueError("Deployment archive checksum mismatch")
    with zipfile.ZipFile(archive) as bundle:
        source = bundle.read("index.py").decode("utf-8")
else:
    source = (pathlib.Path(sys.argv[1]) / "docs/aws/cloudformation/data-deploy/data-deploy-lambda.py").read_text(encoding="utf-8")
tree = ast.parse(source)
names = {"find_statement_end", "_should_execute", "parse_statements", "preprocess_sql"}
helpers = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in names]
if {node.name for node in helpers} != names:
    raise ValueError("Required deployment SQL helpers are missing")
namespace = {"re": re}
exec(compile(ast.Module(body=helpers, type_ignores=[]), "sql-parser-helpers", "exec"), namespace)
print(json.dumps(namespace["parse_statements"](namespace["preprocess_sql"](sys.stdin.read()))))
`;
	return JSON.parse(
		execFileSync(process.env.PYTHON ?? "python", ["-c", code, root], {
			input: sql,
			encoding: "utf8",
			timeout: 5000,
			stdio: ["pipe", "pipe", "pipe"],
		}),
	);
}

async function apply(sql: string): Promise<void> {
	const url = new URL(process.env.DB_URL ?? "");
	const connection = await mysql.createConnection({
		host: url.hostname,
		port: 3306,
		user: decodeURIComponent(url.username),
		password: decodeURIComponent(url.password),
		database: schema,
	});
	try {
		for (const statement of parseStatements(sql))
			await connection.query(statement); // nosemgrep: node-mysql-sqli -- generated SQL is validated by the cohort planner and the deployment parser
	} finally {
		// Mirrors Lambda connection teardown: an aborted transaction rolls back.
		await connection.end();
	}
}

const members: CohortSnapshotMember[] = [
	{
		subscriberId: 10,
		email: "first@example.invalid",
		consentStatus: "pending",
	},
	{
		subscriberId: 11,
		email: "second@example.invalid",
		consentStatus: "pending",
	},
	{
		subscriberId: 12,
		email: "optout@example.invalid",
		consentStatus: "unsubscribed",
	},
	{
		subscriberId: 13,
		email: "active@example.invalid",
		consentStatus: "confirmed",
	},
];

async function seedSubscribers() {
	await db.execute(
		"INSERT INTO tanah_daily_bulletin_subscriber (id, email, audience, consent_status) VALUES (10,'first@example.invalid','real','pending'),(11,'second@example.invalid','real','pending'),(12,'optout@example.invalid','real','unsubscribed'),(13,'active@example.invalid','real','confirmed')",
	);
}

async function enrollCohort() {
	const plan = planBulletinCohort(members);
	await apply(bulletinCohortSql(members, plan));
}

async function cohortRows(): Promise<RowDataPacket[]> {
	return db.query<RowDataPacket>(
		"SELECT * FROM tanah_daily_bulletin_email_cohort ORDER BY position",
	);
}
async function admissionRows(): Promise<RowDataPacket[]> {
	return db.query<RowDataPacket>(
		"SELECT * FROM tanah_daily_bulletin_email_admission ORDER BY local_date",
	);
}
async function consentOf(id: number): Promise<string> {
	const row = await db.queryOne<{ consent_status: string }>(
		"SELECT consent_status FROM tanah_daily_bulletin_subscriber WHERE id = ?",
		[id],
	);
	return String(row?.consent_status);
}

const at = (utc: string) => new Date(`${utc}Z`);

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
		!/^bulletin_rollout_[a-f0-9]{20}$/.test(schema)
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
	await admin.changeUser({ database: schema });
	url.pathname = `/${schema}`;
	url.search = "?ssl-mode=DISABLED";
	vi.stubEnv("DB_URL", url.toString());
	for (const [name, value] of Object.entries({
		BULLETIN_SES_FROM: "bulletin@example.invalid",
		BULLETIN_SES_CONTACT_LIST: "native-bulletin",
		BULLETIN_SES_CONFIGURATION_SET: "native-events",
		BULLETIN_EMAIL_QUEUE_URL:
			"https://sqs.il-central-1.amazonaws.com/123456789012/native",
		BULLETIN_SES_ACCOUNT_ID: "123456789012",
		BULLETIN_SES_REGION: "il-central-1",
	}))
		vi.stubEnv(name, value);
	db = await import("~/server/db");
	admission = await import("~/server/rollout-admission.server");
	rolloutState = await import("~/server/rollout-state.server");
	settings = await import("~/server/ses-settings.server");
	delivery = await import("~/server/ses-delivery.server");
	// The bulletin upgrade conditionally ALTERs the pre-existing article table.
	await admin.query(
		"CREATE TABLE tanah_article (id MEDIUMINT PRIMARY KEY,name VARCHAR(700),content MEDIUMTEXT,distributable BOOLEAN NOT NULL,untouched VARCHAR(100) NOT NULL DEFAULT 'retain') ENGINE=InnoDB",
	);
	// Base bulletin schema, then this rollout's upgrade — through the deployment parser.
	for (const statement of parseMigration("tanah_daily_bulletin_upgrade.sql"))
		await admin.query(statement);
	for (const statement of parseMigration(
		"tanah_daily_bulletin_rollout_upgrade.sql",
	))
		await admin.query(statement);
	await db.execute(
		`INSERT INTO tanah_daily_bulletin
		(bulletin_date,perek_id,article_id,input_json,subject,source,email_html,pdf_data,filename)
		VALUES (?,1,1,?,'native subject','native source','<p>native</p>',?,'native.pdf')`,
		[
			bulletinDate,
			JSON.stringify({ date: bulletinDate }),
			Buffer.from("%PDF-1.7"),
		],
	);
	await db.execute(
		"INSERT INTO tanah_daily_bulletin_delivery (bulletin_date,channel,status) VALUES (?, 'email', 'pending')",
		[bulletinDate],
	);
});

beforeEach(async () => {
	for (const table of [
		"tanah_daily_bulletin_email_admission",
		"tanah_daily_bulletin_email_cohort",
		"tanah_daily_bulletin_email_recipient",
		"tanah_daily_bulletin_email_job",
		"tanah_daily_bulletin_subscriber",
	])
		await admin.query(`DELETE FROM \`${table}\``);
	await admin.query(
		"UPDATE tanah_daily_bulletin_email_settings SET audience = 'test', revision = 0, next_send_at = NULL WHERE id = 1",
	);
	await admin.query(
		"UPDATE tanah_daily_bulletin_email_rollout SET state = 'disabled', revision = 0, last_error = NULL, started_at = NULL, completed_at = NULL WHERE id = 1",
	);
	await admin.query(
		"UPDATE tanah_daily_bulletin_delivery SET status = 'pending', attempt_count = 0, lease_token = NULL, lease_until = NULL, provider_message_id = NULL, last_error = NULL, sent_at = NULL WHERE bulletin_date = ? AND channel = 'email'",
		[bulletinDate],
	);
	contacts.clear();
	optedOut.clear();
	sesFailures.clear();
	unsubscribedInSes.clear();
});

afterAll(async () => {
	if (created) {
		await admin.query(`DROP DATABASE \`${schema}\``);
		await admin.end();
	}
});

describe("rollout schema upgrade", () => {
	it("creates the control row, unique keys and foreign keys exactly once", async () => {
		const rollout = await db.query<RowDataPacket>(
			"SELECT * FROM tanah_daily_bulletin_email_rollout",
		);
		expect(rollout).toHaveLength(1);
		expect(rollout[0]).toMatchObject({ state: "disabled", cohort: "original" });
		// Applying the migration a second time must be a no-op.
		for (const statement of parseMigration(
			"tanah_daily_bulletin_rollout_upgrade.sql",
		))
			await admin.query(statement);
		expect(
			await db.query<RowDataPacket>(
				"SELECT * FROM tanah_daily_bulletin_email_rollout",
			),
		).toHaveLength(1);
	});
});

describe("cohort enrollment plan", () => {
	it("enrolls the reconciled list in order and refuses a repeated operation", async () => {
		await seedSubscribers();
		await enrollCohort();
		const rows = await cohortRows();
		expect(
			rows.map((row) => [row.subscriber_id, row.position, row.status]),
		).toEqual([
			[10, 1, "pending"],
			[11, 2, "pending"],
			[12, 3, "excluded"],
			[13, 4, "admitted"],
		]);
		await expect(enrollCohort()).rejects.toThrow();
	});
	it("aborts the guarded operation when consent drifted after planning", async () => {
		await seedSubscribers();
		await admin.query(
			"UPDATE tanah_daily_bulletin_subscriber SET consent_status = 'unsubscribed' WHERE id = 11",
		);
		await expect(enrollCohort()).rejects.toThrow();
		expect(await cohortRows()).toHaveLength(0);
	});
});

describe("admission sweep on the real schema", () => {
	it("admits one member per Jerusalem day in cohort order", async () => {
		await seedSubscribers();
		await enrollCohort();
		await rolloutState.setRolloutState({ action: "enable", revision: 0 });
		await admission.reconcileRolloutAdmission(
			undefined,
			at(`${localDate}T06:00:00`),
		);
		expect(await consentOf(10)).toBe("confirmed");
		expect(await consentOf(11)).toBe("pending");
		const rows = await admissionRows();
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			local_date: expect.anything(),
			status: "admitted",
			subscriber_id: 10,
		});
		// A duplicate trigger the same day cannot activate a second member.
		await admission.reconcileRolloutAdmission(
			undefined,
			at(`${localDate}T12:00:00`),
		);
		expect(await consentOf(11)).toBe("pending");
	});
	it("serializes concurrent same-day sweeps into one admission", async () => {
		await seedSubscribers();
		await enrollCohort();
		await rolloutState.setRolloutState({ action: "enable", revision: 0 });
		await Promise.all(
			Array.from({ length: 4 }, () =>
				admission.reconcileRolloutAdmission(
					undefined,
					at(`${localDate}T06:00:00`),
				),
			),
		);
		const rows = await admissionRows();
		expect(rows).toHaveLength(1);
		expect(
			(
				await db.query<{ n: number }>(
					"SELECT COUNT(*) AS n FROM tanah_daily_bulletin_email_cohort WHERE status = 'admitted' AND admission_date IS NOT NULL",
				)
			)[0].n,
		).toBe(1);
	});
	it("skips an opted-out member and admits the next eligible member the same day", async () => {
		await seedSubscribers();
		// Member 10 has an existing SES contact that opted out since the import.
		contacts.set("first@example.invalid", new Set());
		optedOut.add("first@example.invalid");
		await enrollCohort();
		await rolloutState.setRolloutState({ action: "enable", revision: 0 });
		await admission.reconcileRolloutAdmission(
			undefined,
			at(`${localDate}T06:00:00`),
		);
		expect(await consentOf(10)).toBe("unsubscribed");
		expect(await consentOf(11)).toBe("confirmed");
		const rows = await admissionRows();
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ status: "admitted", subscriber_id: 11 });
	});
	it("resumes the same reservation after a provider error", async () => {
		await seedSubscribers();
		sesFailures.add("first@example.invalid");
		await enrollCohort();
		await rolloutState.setRolloutState({ action: "enable", revision: 0 });
		await admission.reconcileRolloutAdmission(
			undefined,
			at(`${localDate}T06:00:00`),
		);
		expect(await consentOf(10)).toBe("pending");
		expect((await admissionRows())[0]).toMatchObject({
			status: "reserved",
			subscriber_id: 10,
		});
		sesFailures.clear();
		await admission.reconcileRolloutAdmission(
			undefined,
			at(`${localDate}T08:00:00`),
		);
		expect(await consentOf(10)).toBe("confirmed");
		expect((await admissionRows())[0]).toMatchObject({
			status: "admitted",
			subscriber_id: 10,
		});
	});
	it("finishes an older reservation for its recorded member without extra admissions", async () => {
		await seedSubscribers();
		await enrollCohort();
		await admin.query(
			"INSERT INTO tanah_daily_bulletin_email_admission (cohort, local_date, subscriber_id, status) VALUES ('original', '2026-10-30', 10, 'reserved')",
		);
		await rolloutState.setRolloutState({ action: "enable", revision: 0 });
		await admission.reconcileRolloutAdmission(
			undefined,
			at(`${localDate}T06:00:00`),
		);
		const rows = await admissionRows();
		expect(rows).toHaveLength(2);
		expect(rows[0]).toMatchObject({ status: "admitted", subscriber_id: 10 });
		expect(rows[1]).toMatchObject({ status: "admitted", subscriber_id: 11 });
	});
	it("stops new admissions while paused but keeps deliveries licensed", async () => {
		await seedSubscribers();
		await enrollCohort();
		await rolloutState.setRolloutState({ action: "enable", revision: 0 });
		await rolloutState.setRolloutState({ action: "pause", revision: 1 });
		await admission.reconcileRolloutAdmission(
			undefined,
			at(`${localDate}T06:00:00`),
		);
		expect(await admissionRows()).toHaveLength(0);
		// Delivery stays licensed: already-admitted members keep receiving.
		await expect(
			settings.reserveSendSlot("real", 0, 13),
		).resolves.toBeUndefined();
	});
});

describe("limited-cohort delivery contract", () => {
	it("gates a real send on the rollout license plus confirmed consent", async () => {
		await seedSubscribers();
		await enrollCohort();
		await rolloutState.setRolloutState({ action: "enable", revision: 0 });
		await admission.reconcileRolloutAdmission(
			undefined,
			at(`${localDate}T06:00:00`),
		);
		// The admitted member and the pre-confirmed member may be sent to even
		// though the global audience is still 'test'.
		await expect(
			settings.reserveSendSlot("real", 0, 10),
		).resolves.toBeUndefined();
		await expect(
			settings.reserveSendSlot("real", 0, 13),
		).resolves.toBeUndefined();
		// The not-yet-admitted member stays suppressed — still pending.
		await expect(settings.reserveSendSlot("real", 0, 11)).rejects.toThrow();
	});
	it("suppresses cohort delivery once the rollout is disabled", async () => {
		await seedSubscribers();
		await enrollCohort();
		await rolloutState.setRolloutState({ action: "enable", revision: 0 });
		await admission.reconcileRolloutAdmission(
			undefined,
			at(`${localDate}T06:00:00`),
		);
		const { revision } = await rolloutState.setRolloutState({
			action: "disable",
			revision: 1,
		});
		expect(revision).toBe(2);
		await expect(settings.reserveSendSlot("real", 0, 10)).rejects.toThrow();
	});
	it("enqueues the durable real job only under the rollout license", async () => {
		await seedSubscribers();
		await enrollCohort();
		await expect(
			delivery.enqueueBulletinRolloutEmail(bulletinDate, randomUUID(), 0),
		).rejects.toThrow();
		await rolloutState.setRolloutState({ action: "enable", revision: 0 });
		await admission.reconcileRolloutAdmission(
			undefined,
			at(`${localDate}T06:00:00`),
		);
		const job = await delivery.enqueueBulletinRolloutEmail(
			bulletinDate,
			randomUUID(),
			0,
		);
		expect(job.audience).toBe("real");
		// Exactly the two confirmed real subscribers: admitted + pre-confirmed.
		expect(job.counts.queued).toBe(2);
		const recipients = await db.query<RowDataPacket>(
			"SELECT subscriber_id, status FROM tanah_daily_bulletin_email_recipient WHERE job_id = ? ORDER BY subscriber_id",
			[job.id],
		);
		expect(recipients.map((row) => row.subscriber_id)).toEqual([10, 13]);
		// The channel ledger records the cohort send, keeping the test send intact.
		const channel = await db.query<RowDataPacket>(
			"SELECT status, provider_message_id FROM tanah_daily_bulletin_delivery WHERE bulletin_date = ? AND channel = 'email'",
			[bulletinDate],
		);
		expect(channel[0]).toMatchObject({
			status: "sending",
			provider_message_id: `ses:${job.id}`,
		});
	});
});
