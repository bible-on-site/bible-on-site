import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
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

const unsubscribedInSes: { email: string; topic: string }[] = [];
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
			async ensureSubscribedContact() {
				return "subscribed";
			}
			async unsubscribeContact(email: string, topic: string) {
				unsubscribedInSes.push({ email, topic });
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
import type { SesDeliveryEvent } from "~/server/ses-events.server";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const schema = `bulletin_engagement_${randomBytes(10).toString("hex")}`;
const bulletinDate = "2026-11-03";
let admin: Connection;
let db: typeof import("~/server/db");
let delivery: typeof import("~/server/ses-delivery.server");
let engagement: typeof import("~/server/bulletin-engagement.server");
let rolloutState: typeof import("~/server/rollout-state.server");
let admission: typeof import("~/server/rollout-admission.server");
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
		await connection.end();
	}
}

async function migrate(statements: string[]): Promise<void> {
	for (const statement of statements) await admin.query(statement); // nosemgrep: node-mysql-sqli -- statements are parsed from repo-owned migration SQL files, never user input
}

const engagementSql = parseMigration(
	"tanah_daily_bulletin_engagement_upgrade.sql",
);

let nextSubscriber = 0;
async function seedSubscriber(
	email: string,
	consent = "confirmed",
	audience = "real",
): Promise<number> {
	const id = 100 + nextSubscriber++;
	await db.execute(
		"INSERT INTO tanah_daily_bulletin_subscriber (id, email, audience, consent_status) VALUES (?, ?, ?, ?)",
		[id, email, audience, consent],
	);
	return id;
}

/** A bulletin + job + delivered recipient attempt ready for SES engagement events. */
async function seedDelivered({
	date,
	audience = "real",
	tracked = 1,
	subscriberId,
	status = "delivered",
	delivered = 1,
	accepted = 0,
}: {
	date: string;
	audience?: string;
	tracked?: number;
	subscriberId: number;
	status?: string;
	delivered?: number;
	accepted?: number;
}): Promise<{
	jobId: string;
	recipientId: number;
	token: string;
	email: string;
}> {
	await db.execute(
		`INSERT IGNORE INTO tanah_daily_bulletin
		 (bulletin_date,perek_id,article_id,input_json,subject,source,email_html,pdf_data,filename)
		 VALUES (?,1,1,?,'subject','source','<p>x</p>',?,'b.pdf')`,
		[date, JSON.stringify({ date }), Buffer.from("%PDF-1.7")],
	);
	const jobId = `job-${randomBytes(6).toString("hex")}`;
	await db.execute(
		`INSERT INTO tanah_daily_bulletin_email_job
		 (id, bulletin_date, audience, idempotency_key, settings_revision, status, cnt_delivered, cnt_accepted, tracked)
		 VALUES (?, ?, ?, ?, 0, 'delivered', ?, ?, ?)`,
		[jobId, date, audience, `k-${jobId}`, delivered, accepted, tracked],
	);
	const token = `tok-${randomBytes(4).toString("hex")}`;
	const subscriber = await db.queryOne<{ email: string }>(
		"SELECT email FROM tanah_daily_bulletin_subscriber WHERE id = ?",
		[subscriberId],
	);
	const result = await db.execute(
		`INSERT INTO tanah_daily_bulletin_email_recipient
		 (job_id, subscriber_id, email, status, attempt_token, message_id)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		[jobId, subscriberId, subscriber?.email, status, token, `msg-${token}`],
	);
	return {
		jobId,
		recipientId: Number(result.insertId),
		token,
		email: String(subscriber?.email),
	};
}

function event(
	type: "open" | "click",
	recipientId: number,
	token: string,
	email: string,
	overrides: Partial<SesDeliveryEvent> = {},
): SesDeliveryEvent {
	return {
		type,
		messageId: `msg-${token}`,
		attemptId: `${recipientId}_${token}`,
		email,
		timestamp: "2026-11-03T12:01:00.000Z",
		...overrides,
	};
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
		!/^bulletin_engagement_[a-f0-9]{20}$/.test(schema)
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
	delivery = await import("~/server/ses-delivery.server");
	engagement = await import("~/server/bulletin-engagement.server");
	rolloutState = await import("~/server/rollout-state.server");
	admission = await import("~/server/rollout-admission.server");
	await admin.query(
		"CREATE TABLE tanah_article (id MEDIUMINT PRIMARY KEY,name VARCHAR(700),content MEDIUMTEXT,distributable BOOLEAN NOT NULL,untouched VARCHAR(100) NOT NULL DEFAULT 'retain') ENGINE=InnoDB",
	);
	await migrate([
		...parseMigration("tanah_daily_bulletin_upgrade.sql"),
		...parseMigration("tanah_daily_bulletin_rollout_upgrade.sql"),
		...engagementSql,
	]);
});

beforeEach(async () => {
	for (const table of [
		"tanah_daily_bulletin_email_admission",
		"tanah_daily_bulletin_email_cohort",
		"tanah_daily_bulletin_email_recipient",
		"tanah_daily_bulletin_email_job",
		"tanah_daily_bulletin_subscriber",
		"tanah_daily_bulletin",
	])
		await admin.query(`DELETE FROM \`${table}\``);
	await admin.query(
		"UPDATE tanah_daily_bulletin_email_settings SET audience = 'test', revision = 0, next_send_at = NULL WHERE id = 1",
	);
	await admin.query(
		"UPDATE tanah_daily_bulletin_email_rollout SET state = 'disabled', revision = 0, last_error = NULL, started_at = NULL, completed_at = NULL WHERE id = 1",
	);
	unsubscribedInSes.length = 0;
	nextSubscriber = 0;
	vi.stubEnv("BULLETIN_SES_TRACKING_ENABLED", "");
});

afterAll(async () => {
	if (created) {
		await admin.query(`DROP DATABASE \`${schema}\``);
		await admin.end();
	}
});

describe("engagement schema upgrade", () => {
	it("adds the columns idempotently on repeat deployment", async () => {
		await migrate(engagementSql);
		const columns = await db.query<{ COLUMN_NAME: string }>(
			`SELECT COLUMN_NAME FROM information_schema.COLUMNS
			 WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'tanah_daily_bulletin_email_recipient'
			 AND COLUMN_NAME IN ('opened_at','open_count','clicked_at','click_count')`,
			[schema],
		);
		expect(columns.map((c) => c.COLUMN_NAME).sort()).toEqual([
			"click_count",
			"clicked_at",
			"open_count",
			"opened_at",
		]);
	});
});

describe("tracked SES engagement events", () => {
	it("counts a recipient once per metric while recording each event", async () => {
		const subscriber = await seedSubscriber("a@example.invalid");
		const { recipientId, token } = await seedDelivered({
			date: bulletinDate,
			subscriberId: subscriber,
		});
		await delivery.applySesEvent(
			event("open", recipientId, token, "a@example.invalid"),
		);
		await delivery.applySesEvent(
			event("open", recipientId, token, "a@example.invalid"),
		);
		await delivery.applySesEvent(
			event("click", recipientId, token, "a@example.invalid", {
				link: "https://xn--febl3a.co.il/perek/1",
				timestamp: "2026-11-03T12:02:00.000Z",
			}),
		);
		const row = await db.queryOne<RowDataPacket>(
			"SELECT * FROM tanah_daily_bulletin_email_recipient WHERE id = ?",
			[recipientId],
		);
		expect(row?.open_count).toBe(2);
		expect(row?.click_count).toBe(1);
		expect(row?.opened_at).not.toBeNull();
		expect(row?.clicked_at).not.toBeNull();
		const panel = await engagement.readEmailEngagementPanel();
		const edition = panel?.editions.find((e) => e.date === bulletinDate);
		expect(edition).toMatchObject({
			tracked: true,
			delivered: 1,
			opened: 1,
			clicked: 1,
		});
		// The same subscriber's activity in another edition counts there too,
		// and a test-audience send never enters the production statistics.
		const second = await seedDelivered({
			date: "2026-11-04",
			subscriberId: subscriber,
		});
		await delivery.applySesEvent(
			event("open", second.recipientId, second.token, "a@example.invalid"),
		);
		const testSub = await seedSubscriber(
			"t-probe@example.invalid",
			"confirmed",
			"test",
		);
		const testSend = await seedDelivered({
			date: "2026-11-05",
			audience: "test",
			subscriberId: testSub,
		});
		await delivery.applySesEvent(
			event(
				"open",
				testSend.recipientId,
				testSend.token,
				"t-probe@example.invalid",
			),
		);
		const next = await engagement.readEmailEngagementPanel();
		expect(next?.editions.find((e) => e.date === "2026-11-04")).toMatchObject({
			delivered: 1,
			opened: 1,
		});
		expect(next?.editions.map((e) => e.date)).not.toContain("2026-11-05");
		expect(next?.inactive.map((i) => i.email)).not.toContain(
			"t-probe@example.invalid",
		);
	});
	it("keeps the newest activity timestamp across out-of-order events", async () => {
		const subscriber = await seedSubscriber("b@example.invalid");
		const { recipientId, token } = await seedDelivered({
			date: bulletinDate,
			subscriberId: subscriber,
		});
		await delivery.applySesEvent(
			event("open", recipientId, token, "b@example.invalid", {
				timestamp: "2026-11-03T12:05:00.000Z",
			}),
		);
		await delivery.applySesEvent(
			event("open", recipientId, token, "b@example.invalid", {
				timestamp: "2026-11-03T12:02:00.000Z",
			}),
		);
		const row = await db.queryOne<{ opened_at: string }>(
			"SELECT DATE_FORMAT(opened_at, '%Y-%m-%dT%H:%i:%s.000Z') AS opened_at FROM tanah_daily_bulletin_email_recipient WHERE id = ?",
			[recipientId],
		);
		expect(row?.opened_at).toBe("2026-11-03T12:05:00.000Z");
	});
	it("never counts an unsubscribe or subscription-management click", async () => {
		const subscriber = await seedSubscriber("c@example.invalid");
		const { recipientId, token } = await seedDelivered({
			date: bulletinDate,
			subscriberId: subscriber,
		});
		for (const link of [
			"https://abc.subscription.il-central-1.amazonses.com/",
			"https://xn--febl3a.co.il/unsubscribe?id=7",
		])
			await delivery.applySesEvent(
				event("click", recipientId, token, "c@example.invalid", { link }),
			);
		const row = await db.queryOne<{
			clicked_at: string | null;
			click_count: number;
		}>(
			"SELECT clicked_at, click_count FROM tanah_daily_bulletin_email_recipient WHERE id = ?",
			[recipientId],
		);
		expect(row?.clicked_at).toBeNull();
		expect(Number(row?.click_count)).toBe(0);
	});
	it("lifts a mid-flight attempt to delivered on tracked engagement", async () => {
		const subscriber = await seedSubscriber("d@example.invalid");
		const { recipientId, jobId, token } = await seedDelivered({
			date: bulletinDate,
			subscriberId: subscriber,
			status: "accepted",
			delivered: 0,
			accepted: 1,
		});
		await delivery.applySesEvent(
			event("open", recipientId, token, "d@example.invalid"),
		);
		const row = await db.queryOne<{ status: string }>(
			"SELECT status FROM tanah_daily_bulletin_email_recipient WHERE id = ?",
			[recipientId],
		);
		expect(row?.status).toBe("delivered");
		const job = await db.queryOne<{
			status: string;
			cnt_delivered: number;
			cnt_accepted: number;
		}>(
			"SELECT status, cnt_delivered, cnt_accepted FROM tanah_daily_bulletin_email_job WHERE id = ?",
			[jobId],
		);
		expect(Number(job?.cnt_delivered)).toBe(1);
		expect(job?.status).toBe("delivered");
	});
	it("marks a job tracked only when collection was enabled at enqueue", async () => {
		await db.execute(
			`INSERT INTO tanah_daily_bulletin
			 (bulletin_date,perek_id,article_id,input_json,subject,source,email_html,pdf_data,filename)
			 VALUES (?,1,1,?,'subject','source','<p>x</p>',?,'b.pdf')`,
			[
				bulletinDate,
				JSON.stringify({ date: bulletinDate }),
				Buffer.from("%PDF-1.7"),
			],
		);
		await seedSubscriber("t1@example.invalid", "confirmed", "test");
		vi.stubEnv("BULLETIN_SES_TRACKING_ENABLED", "true");
		const job = await delivery.enqueueBulletinEmail(
			bulletinDate,
			"11111111-1111-4111-8111-111111111111",
			{ audience: "test", revision: 0 },
		);
		const row = await db.queryOne<{ tracked: number }>(
			"SELECT tracked FROM tanah_daily_bulletin_email_job WHERE id = ?",
			[job.id],
		);
		expect(Number(row?.tracked)).toBe(1);
		vi.stubEnv("BULLETIN_SES_TRACKING_ENABLED", "");
		const summary = await delivery.readLatestEmailJob(bulletinDate, "test");
		expect(summary).toMatchObject({ tracked: true, opened: 0, clicked: 0 });
	});
});

describe("one-year inactivity review", () => {
	async function seedHistory(
		email: string,
		editions: {
			monthsAgo: number;
			tracked?: number;
			opened?: number;
			clicked?: number;
		}[],
		consent = "confirmed",
	): Promise<number> {
		const subscriberId = await seedSubscriber(email, consent);
		for (const edition of editions) {
			const date = await db.queryOne<{ d: string }>(
				`SELECT DATE_FORMAT(UTC_DATE() - INTERVAL ${edition.monthsAgo} MONTH, '%Y-%m-%d') AS d`,
			);
			const { recipientId } = await seedDelivered({
				date: String(date?.d),
				subscriberId,
				tracked: edition.tracked ?? 1,
			});
			if (edition.opened !== undefined)
				await db.execute(
					`UPDATE tanah_daily_bulletin_email_recipient
					 SET opened_at = UTC_TIMESTAMP(3) - INTERVAL ${edition.opened} MONTH WHERE id = ?`,
					[recipientId],
				);
			if (edition.clicked !== undefined)
				await db.execute(
					`UPDATE tanah_daily_bulletin_email_recipient
					 SET clicked_at = UTC_TIMESTAMP(3) - INTERVAL ${edition.clicked} MONTH WHERE id = ?`,
					[recipientId],
				);
		}
		return subscriberId;
	}

	it("lists only subscribers with a full year of quiet tracked history", async () => {
		// A full year of tracked deliveries, no recorded activity.
		const quiet = await seedHistory("quiet@example.invalid", [
			{ monthsAgo: 13 },
			{ monthsAgo: 2 },
		]);
		// Exact one-year boundary: first tracked delivery a full year ago.
		const boundary = await seedHistory("edge@example.invalid", [
			{ monthsAgo: 12 },
			{ monthsAgo: 1 },
		]);
		// Recent tracked open excludes.
		await seedHistory("opened@example.invalid", [
			{ monthsAgo: 13 },
			{ monthsAgo: 2, opened: 1 },
		]);
		// A qualifying tracked content click counts as activity.
		await seedHistory("clicked@example.invalid", [
			{ monthsAgo: 13 },
			{ monthsAgo: 6, clicked: 4 },
		]);
		// First tracked delivery is not yet a full year back.
		await seedHistory("new@example.invalid", [{ monthsAgo: 6 }]);
		// An untracked gap inside the trailing year makes history incomplete.
		await seedHistory("gap@example.invalid", [
			{ monthsAgo: 13 },
			{ monthsAgo: 5, tracked: 0 },
		]);
		// No actual delivery inside the trailing year.
		await seedHistory("old@example.invalid", [{ monthsAgo: 14 }]);
		// Non-confirmed consent never qualifies.
		await seedHistory(
			"gone@example.invalid",
			[{ monthsAgo: 13 }, { monthsAgo: 1 }],
			"unsubscribed",
		);
		const panel = await engagement.readEmailEngagementPanel();
		expect(panel?.inactive.map((i) => i.email)).toEqual([
			"quiet@example.invalid",
			"edge@example.invalid",
		]);
		expect(panel?.inactive.find((i) => i.id === quiet)?.trackedLastYear).toBe(
			1,
		);
		expect(
			panel?.inactive.find((i) => i.id === boundary)?.firstTrackedDelivery,
		).toBeTruthy();
	});

	it("confirms removal with a re-checked eligibility and records the admin", async () => {
		const quiet = await seedHistory("quiet2@example.invalid", [
			{ monthsAgo: 13 },
			{ monthsAgo: 2 },
		]);
		await engagement.confirmInactivityUnsubscribe(quiet, "admin-sub-1");
		const row = await db.queryOne<RowDataPacket>(
			"SELECT * FROM tanah_daily_bulletin_subscriber WHERE id = ?",
			[quiet],
		);
		expect(row?.consent_status).toBe("unsubscribed");
		expect(row?.admin_action).toBe("inactivity-unsubscribe");
		expect(row?.admin_actor).toBe("admin-sub-1");
		expect(row?.admin_action_at).not.toBeNull();
		expect(unsubscribedInSes).toEqual([
			{ email: "quiet2@example.invalid", topic: "real" },
		]);
		// A repeat confirmation only re-mirrors SES; it cannot resurrect consent.
		await engagement.confirmInactivityUnsubscribe(quiet, "admin-sub-1");
		expect(unsubscribedInSes).toHaveLength(2);
		const after = await db.queryOne<{ consent_status: string }>(
			"SELECT consent_status FROM tanah_daily_bulletin_subscriber WHERE id = ?",
			[quiet],
		);
		expect(after?.consent_status).toBe("unsubscribed");
	});

	it("refuses removal once eligibility vanished and never calls SES", async () => {
		const recent = await seedHistory("recent@example.invalid", [
			{ monthsAgo: 13 },
			{ monthsAgo: 2, opened: 1 },
		]);
		await expect(
			engagement.confirmInactivityUnsubscribe(recent, "admin-sub-1"),
		).rejects.toThrow("אינו עומד בתנאי ההסרה");
		expect(unsubscribedInSes).toHaveLength(0);
		const row = await db.queryOne<{ consent_status: string }>(
			"SELECT consent_status FROM tanah_daily_bulletin_subscriber WHERE id = ?",
			[recent],
		);
		expect(row?.consent_status).toBe("confirmed");
	});
});

describe("rollout interplay after admin removal", () => {
	it("cannot re-admit a subscriber whose opt-out was recorded", async () => {
		const members: CohortSnapshotMember[] = [
			{
				subscriberId: 200,
				email: "pending@example.invalid",
				consentStatus: "pending",
			},
			{
				subscriberId: 201,
				email: "removed@example.invalid",
				consentStatus: "unsubscribed",
			},
		];
		await db.execute(
			"INSERT INTO tanah_daily_bulletin_subscriber (id, email, audience, consent_status) VALUES (200,'pending@example.invalid','real','pending'),(201,'removed@example.invalid','real','unsubscribed')",
		);
		await apply(bulletinCohortSql(members, planBulletinCohort(members)));
		await rolloutState.setRolloutState({ action: "enable", revision: 0 });
		await admission.reconcileRolloutAdmission(
			undefined,
			new Date("2026-11-02T06:00:00Z"),
		);
		const rows = await db.query<RowDataPacket>(
			"SELECT subscriber_id, status, excluded_reason FROM tanah_daily_bulletin_email_cohort ORDER BY position",
		);
		// The unsubscribed member is excluded; the next pending member admits.
		expect(rows[1].status).toBe("excluded");
		expect(rows[1].excluded_reason).toBe("unsubscribed");
		const consent = await db.queryOne<{ consent_status: string }>(
			"SELECT consent_status FROM tanah_daily_bulletin_subscriber WHERE id = 201",
		);
		expect(consent?.consent_status).toBe("unsubscribed");
	});
});
