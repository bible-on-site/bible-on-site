import "@tanstack/react-start/server-only";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
	DeleteMessageCommand,
	ReceiveMessageCommand,
	SendMessageBatchCommand,
	SQSClient,
} from "@aws-sdk/client-sqs";
import {
	type EmailJobStatus,
	type EmailJobSummary,
	validateEmailQueueRequest,
} from "~/lib/bulletin-email";
import { validateBulletinDate } from "~/lib/daily-bulletin";
import { readPreparedBulletin } from "./daily-bulletins.server";
import {
	execute,
	query,
	queryOne,
	transaction,
	txExecute,
	txQuery,
	txQueryOne,
} from "./db";
import { runOutboxSweep } from "./outbox-deadline.server";
import {
	type SesAudience,
	SesClient,
	SesError,
	SesSuppressedError,
} from "./ses-client.server";
import { parseSesEvent, type SesEvent } from "./ses-events.server";
import {
	DeliverySuppressed,
	getEmailReadiness,
	loadEmailRuntime,
	reserveSendSlot,
} from "./ses-settings.server";

const FAILED = "פעולת הדיוור נכשלה. לא תתבצע שליחה חוזרת אוטומטית.";
const UNCERTAIN = "תוצאת השליחה אינה ודאית. נדרשת בדיקה לפני פעולה נוספת.";
const SUPPRESSED = "השליחה נעצרה בעקבות שינוי במצב הדיוור או בהסכמת הנמען.";
const QUEUE_FAILED =
	"לא ניתן להעביר את כל הנמענים לתור. אפשר לנסות שוב באותה בקשה.";

const WHATSAPP_JOB_ID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function optionalWhatsAppDelivery() {
	if (
		[
			"INSTANCE_ID",
			"API_TOKEN",
			"API_URL",
			"MEDIA_URL",
			"SENDER_PHONE",
			"TEST_GROUP_ID",
			"TEST_PARTICIPANT_DIGEST",
		].some((name) => !process.env[`BULLETIN_WHATSAPP_${name}`]?.trim())
	)
		return null;
	return import("./whatsapp-delivery.server");
}

type RecipientStatus = EmailJobStatus | "bounced" | "complained";
interface JobRow {
	id: string;
	bulletin_date: Date | string;
	audience: SesAudience;
	settings_revision: number;
	status: EmailJobStatus;
	created_at: Date | string;
}
interface RecipientRow {
	id: number;
	job_id: string;
	subscriber_id: number;
	email: string;
	status: RecipientStatus;
	attempt_token: string | null;
	message_id: string | null;
	started_at: Date | string | null;
	event_at: Date | string | null;
	bulletin_date: Date | string;
	audience: SesAudience;
	settings_revision: number;
	consent_status: string;
	subscriber_email: string;
	subscriber_audience: SesAudience;
}
interface CountRow {
	status: RecipientStatus;
	count: number | string;
}

function dateOnly(value: Date | string): string {
	return value instanceof Date
		? value.toISOString().slice(0, 10)
		: value.slice(0, 10);
}

function sqlTime(value: string): string {
	return value.replace("T", " ").replace(/Z$/, "");
}

function isoTime(value: Date | string): string {
	return value instanceof Date
		? value.toISOString()
		: new Date(
				value.includes("T") ? value : `${value.replace(" ", "T")}Z`,
			).toISOString();
}

function countsMap(rows: CountRow[]): Record<string, number> {
	return Object.fromEntries(rows.map((row) => [row.status, Number(row.count)]));
}

function aggregate(counts: Record<string, number>): EmailJobStatus {
	if (counts.uncertain) return "uncertain";
	if (counts.sending) return "sending";
	if (counts.queued) return "queued";
	if (counts.accepted) return "accepted";
	if (counts.failed || counts.bounced || counts.complained) return "failed";
	if (counts.delivered) return "delivered";
	return "suppressed";
}

async function summary(job: JobRow): Promise<EmailJobSummary> {
	const counts = await query<CountRow>(
		"SELECT status, COUNT(*) AS count FROM tanah_daily_bulletin_email_recipient WHERE job_id = ? GROUP BY status",
		[job.id],
	);
	return {
		id: job.id,
		date: dateOnly(job.bulletin_date),
		audience: job.audience,
		status: aggregate(countsMap(counts)),
		counts: countsMap(counts),
		createdAt: isoTime(job.created_at),
	};
}

async function refreshJob(jobId: string, signal?: AbortSignal): Promise<void> {
	await transaction(async (connection) => {
		signal?.throwIfAborted();
		// Lock before counting: concurrent event handlers cannot publish stale totals.
		const job = await txQueryOne<JobRow>(
			connection,
			"SELECT j.*, DATE_FORMAT(j.bulletin_date, '%Y-%m-%d') AS bulletin_date FROM tanah_daily_bulletin_email_job j WHERE id = ? FOR UPDATE",
			[jobId],
		);
		signal?.throwIfAborted();
		if (!job) return;
		const rows = await txQuery<CountRow>(
			connection,
			"SELECT status, COUNT(*) AS count FROM tanah_daily_bulletin_email_recipient WHERE job_id = ? GROUP BY status",
			[jobId],
		);
		signal?.throwIfAborted();
		const status = aggregate(countsMap(rows));
		const error =
			status === "uncertain" ? UNCERTAIN : status === "failed" ? FAILED : null;
		await txExecute(
			connection,
			"UPDATE tanah_daily_bulletin_email_job SET status = ?, last_error = ? WHERE id = ?",
			[status, error, jobId],
		);
		signal?.throwIfAborted();
		if (job.audience === "real") {
			const channelStatus =
				status === "delivered"
					? "sent"
					: status === "uncertain"
						? "uncertain"
						: status === "failed" || status === "suppressed"
							? "failed"
							: "sending";
			await txExecute(
				connection,
				`UPDATE tanah_daily_bulletin_delivery SET status = ?, provider_message_id = ?, last_error = ?,
				 sent_at = CASE WHEN ? = 'sent' THEN COALESCE(sent_at, UTC_TIMESTAMP()) ELSE sent_at END
				 WHERE bulletin_date = ? AND channel = 'email'`,
				[
					channelStatus,
					`ses:${jobId}`,
					error,
					channelStatus,
					dateOnly(job.bulletin_date),
				],
			);
		}
	});
}

export async function readLatestEmailJob(
	date: string,
	audience?: SesAudience,
): Promise<EmailJobSummary | null> {
	validateBulletinDate(date);
	if (audience !== undefined && audience !== "test" && audience !== "real")
		throw new Error(SUPPRESSED);
	const job = await queryOne<JobRow>(
		audience === undefined
			? "SELECT j.*, DATE_FORMAT(j.bulletin_date, '%Y-%m-%d') AS bulletin_date, DATE_FORMAT(j.created_at, '%Y-%m-%dT%H:%i:%sZ') AS created_at FROM tanah_daily_bulletin_email_job j WHERE bulletin_date = ? ORDER BY created_at DESC, id DESC LIMIT 1"
			: "SELECT j.*, DATE_FORMAT(j.bulletin_date, '%Y-%m-%d') AS bulletin_date, DATE_FORMAT(j.created_at, '%Y-%m-%dT%H:%i:%sZ') AS created_at FROM tanah_daily_bulletin_email_job j WHERE bulletin_date = ? AND audience = ? ORDER BY created_at DESC, id DESC LIMIT 1",
		audience === undefined ? [date] : [date, audience],
	);
	return job ? summary(job) : null;
}

async function publishRecipients(
	client: SQSClient,
	queueUrl: string,
	recipients: { id: number }[],
	shutdown?: AbortSignal,
): Promise<void> {
	const signal = shutdown ?? AbortSignal.timeout(15_000);
	try {
		for (let index = 0; index < recipients.length; index += 10) {
			signal.throwIfAborted();
			const entries = recipients.slice(index, index + 10).map(({ id }) => ({
				Id: String(id),
				MessageBody: JSON.stringify({ kind: "send", recipientId: Number(id) }),
			}));
			const result = await client.send(
				new SendMessageBatchCommand({
					QueueUrl: queueUrl,
					Entries: entries,
				}),
				{ abortSignal: signal },
			);
			signal.throwIfAborted();
			const acknowledged = new Set(result.Successful?.map((entry) => entry.Id));
			if (
				result.Failed?.length ||
				entries.some((entry) => !acknowledged.has(entry.Id))
			)
				throw new Error(QUEUE_FAILED);
		}
	} catch {
		throw new Error(QUEUE_FAILED);
	}
}

async function publishQueued(jobId: string): Promise<void> {
	const runtime = await loadEmailRuntime();
	if (!runtime) throw new Error(QUEUE_FAILED);
	const recipients = await query<{ id: number }>(
		"SELECT id FROM tanah_daily_bulletin_email_recipient WHERE job_id = ? AND status = 'queued' ORDER BY id",
		[jobId],
	);
	const client = new SQSClient({ region: runtime.region, maxAttempts: 1 });
	try {
		await publishRecipients(client, runtime.queueUrl, recipients);
	} finally {
		client.destroy();
	}
}

async function reconcileEmailOutbox(
	client: SQSClient,
	queueUrl: string,
	shutdown?: AbortSignal,
): Promise<void> {
	await runOutboxSweep(shutdown, async (signal) => {
		// Recovery must not depend on the original SQS message still existing: it may
		// already be in the DLQ after a database outage. Never requeue an expired claim.
		const stale = await query<{ id: number; job_id: string }>(
			`SELECT id, job_id FROM tanah_daily_bulletin_email_recipient WHERE status = 'sending'
		 AND (started_at IS NULL OR started_at < UTC_TIMESTAMP(3) - INTERVAL 60 SECOND) ORDER BY id LIMIT 100`,
		);
		signal.throwIfAborted();
		const jobs = new Set<string>();
		for (const row of stale) {
			signal.throwIfAborted();
			const changed = await execute(
				`UPDATE tanah_daily_bulletin_email_recipient SET status = 'uncertain', last_error = ?
			 WHERE id = ? AND status = 'sending'
			 AND (started_at IS NULL OR started_at < UTC_TIMESTAMP(3) - INTERVAL 60 SECOND)`,
				[UNCERTAIN, row.id],
			);
			signal.throwIfAborted();
			if (changed.affectedRows === 1) jobs.add(row.job_id);
		}
		for (const id of jobs) {
			signal.throwIfAborted();
			await refreshJob(id, signal);
		}
		signal.throwIfAborted();
		// The committed rows form an outbox. Re-publishing is safe because send claims
		// are atomic, and only queued recipients are ever eligible for this sweep.
		const recipients = await query<{ id: number }>(
			"SELECT id FROM tanah_daily_bulletin_email_recipient WHERE status = 'queued' ORDER BY id LIMIT 100",
		);
		signal.throwIfAborted();
		await publishRecipients(client, queueUrl, recipients, signal);
	});
}

export async function enqueueBulletinEmail(
	date: string,
	requestKey: string,
	expected: { audience: SesAudience; revision: number },
): Promise<EmailJobSummary> {
	validateEmailQueueRequest({
		date,
		requestKey,
		audience: expected?.audience,
		revision: expected?.revision,
	});
	const readiness = await getEmailReadiness();
	if (
		!readiness.canSend ||
		(expected.audience === "real" && !readiness.canUseReal)
	)
		throw new Error("הדיוור אינו מוכן לשליחה");
	if (!(await readPreparedBulletin(date)))
		throw new Error("יש להכין את העלון לפני השליחה");
	const key = expected.audience === "real" ? "production" : requestKey;
	const job = await transaction(async (connection) => {
		const settings = await txQueryOne<{
			audience: SesAudience;
			revision: number;
		}>(
			connection,
			"SELECT audience, revision FROM tanah_daily_bulletin_email_settings WHERE id = 1 FOR UPDATE",
		);
		if (
			!settings ||
			settings.audience !== expected.audience ||
			Number(settings.revision) !== expected.revision
		)
			throw new DeliverySuppressed();
		const existing = await txQueryOne<JobRow>(
			connection,
			"SELECT j.*, DATE_FORMAT(j.bulletin_date, '%Y-%m-%d') AS bulletin_date, DATE_FORMAT(j.created_at, '%Y-%m-%dT%H:%i:%sZ') AS created_at FROM tanah_daily_bulletin_email_job j WHERE bulletin_date = ? AND audience = ? AND idempotency_key = ?",
			[date, expected.audience, key],
		);
		if (existing) return existing;
		const active = await txQueryOne<{ id: string }>(
			connection,
			`SELECT j.id FROM tanah_daily_bulletin_email_job j WHERE bulletin_date = ? AND audience = ?
			 AND (j.status IN ('queued', 'sending', 'accepted', 'uncertain') OR EXISTS (
			 SELECT 1 FROM tanah_daily_bulletin_email_recipient r WHERE r.job_id = j.id AND r.status IN ('queued', 'sending', 'accepted', 'uncertain'))) LIMIT 1`,
			[date, expected.audience],
		);
		if (active)
			throw new Error("יש בקשת שליחה פתוחה או שתוצאתה אינה ודאית לתאריך זה");
		if (expected.audience === "real") {
			const previous = await txQueryOne<{
				status: string;
				attempt_count: number;
				provider_message_id: string | null;
				sent_at: Date | string | null;
				lease_token: string | null;
				lease_until: Date | string | null;
			}>(
				connection,
				"SELECT status, attempt_count, provider_message_id, sent_at, lease_token, lease_until FROM tanah_daily_bulletin_delivery WHERE bulletin_date = ? AND channel = 'email' FOR UPDATE",
				[date],
			);
			if (
				previous?.status !== "pending" ||
				Number(previous.attempt_count) !== 0 ||
				previous.provider_message_id !== null ||
				previous.sent_at !== null ||
				previous.lease_token !== null ||
				previous.lease_until !== null
			)
				throw new Error("קיים ניסיון דיוור קודם לתאריך זה ונדרשת בדיקה");
		}
		const subscribers = await txQuery<{ id: number; email: string }>(
			connection,
			"SELECT id, email FROM tanah_daily_bulletin_subscriber WHERE audience = ? AND consent_status = 'confirmed' ORDER BY id FOR UPDATE",
			[expected.audience],
		);
		if (!subscribers.length)
			throw new Error("אין נמענים שאישרו קבלת דיוור ברשימה שנבחרה");
		const id = randomUUID();
		await txExecute(
			connection,
			"INSERT INTO tanah_daily_bulletin_email_job (id, bulletin_date, audience, idempotency_key, settings_revision) VALUES (?, ?, ?, ?, ?)",
			[id, date, expected.audience, key, expected.revision],
		);
		for (const subscriber of subscribers) {
			await txExecute(
				connection,
				"INSERT INTO tanah_daily_bulletin_email_recipient (job_id, subscriber_id, email) VALUES (?, ?, ?)",
				[id, subscriber.id, subscriber.email.toLowerCase()],
			);
		}
		if (expected.audience === "real") {
			const reserved = await txExecute(
				connection,
				`UPDATE tanah_daily_bulletin_delivery SET status = ?, provider_message_id = ?
				 WHERE bulletin_date = ? AND channel = 'email' AND status = 'pending' AND attempt_count = 0
				 AND provider_message_id IS NULL AND sent_at IS NULL AND lease_token IS NULL AND lease_until IS NULL`,
				["sending", `ses:${id}`, date],
			);
			if (reserved.affectedRows !== 1) throw new DeliverySuppressed();
		}
		const inserted = await txQueryOne<JobRow>(
			connection,
			"SELECT j.*, DATE_FORMAT(j.bulletin_date, '%Y-%m-%d') AS bulletin_date, DATE_FORMAT(j.created_at, '%Y-%m-%dT%H:%i:%sZ') AS created_at FROM tanah_daily_bulletin_email_job j WHERE id = ?",
			[id],
		);
		if (!inserted) throw new Error(FAILED);
		return inserted;
	});
	await publishQueued(job.id);
	return summary(job);
}

async function recipient(id: number): Promise<RecipientRow | null> {
	return queryOne<RecipientRow>(
		`SELECT r.*, DATE_FORMAT(j.bulletin_date, '%Y-%m-%d') AS bulletin_date, j.audience, j.settings_revision,
		 s.consent_status, s.email AS subscriber_email, s.audience AS subscriber_audience
		 FROM tanah_daily_bulletin_email_recipient r
		 JOIN tanah_daily_bulletin_email_job j ON j.id = r.job_id
		 JOIN tanah_daily_bulletin_subscriber s ON s.id = r.subscriber_id WHERE r.id = ?`,
		[id],
	);
}

export async function processEmailRecipient(id: number): Promise<void> {
	if (!Number.isSafeInteger(id) || id <= 0) throw new Error(FAILED);
	const row = await recipient(id);
	if (!row) return;
	if (row.status === "sending") {
		// A process can die after SES accepted mail. An expired attempt is never resent.
		await execute(
			`UPDATE tanah_daily_bulletin_email_recipient SET status = 'uncertain', last_error = ?
			 WHERE id = ? AND status = 'sending'
			 AND (started_at IS NULL OR started_at < UTC_TIMESTAMP(3) - INTERVAL 60 SECOND)`,
			[UNCERTAIN, id],
		);
		await refreshJob(row.job_id);
		return;
	}
	if (row.status !== "queued") {
		await refreshJob(row.job_id);
		return;
	}
	const token = randomUUID();
	const claim = await execute(
		`UPDATE tanah_daily_bulletin_email_recipient SET status = 'sending', attempt_token = ?, started_at = UTC_TIMESTAMP(3), last_error = NULL
		 WHERE id = ? AND status = 'queued'`,
		[token, id],
	);
	if (claim.affectedRows !== 1) return;
	let providerStarted = false;
	let suppressed = false;
	try {
		const runtime = await loadEmailRuntime();
		if (!runtime) throw new SesError(FAILED, "failed");
		const current = await recipient(id);
		if (
			current?.consent_status !== "confirmed" ||
			current.subscriber_audience !== row.audience ||
			current.email.toLowerCase() !== current.subscriber_email.toLowerCase()
		)
			throw new DeliverySuppressed();
		const bulletin = await readPreparedBulletin(dateOnly(row.bulletin_date));
		if (!bulletin) throw new SesError(FAILED, "failed");
		const client = new SesClient({
			...runtime,
			beforeSend: async () => {
				try {
					await reserveSendSlot(
						row.audience,
						Number(row.settings_revision),
						Number(row.subscriber_id),
					);
				} catch (error) {
					suppressed = error instanceof DeliverySuppressed;
					throw error;
				}
				providerStarted = true;
			},
		});
		// Pace the contact read separately from SendEmail and recheck again at send.
		await reserveSendSlot(
			row.audience,
			Number(row.settings_revision),
			Number(row.subscriber_id),
		);
		const messageId = await client.sendOne({
			to: row.email,
			subject: bulletin.subject,
			html: bulletin.emailHtml,
			audience: row.audience,
			externalId: `${id}_${token}`,
		});
		providerStarted = true;
		const saved = await execute(
			`UPDATE tanah_daily_bulletin_email_recipient SET message_id = ?,
			 last_error = CASE WHEN status IN ('sending', 'uncertain', 'accepted') THEN NULL ELSE last_error END,
			 status = CASE WHEN status IN ('sending', 'uncertain') THEN 'accepted' ELSE status END
			 WHERE id = ? AND attempt_token = ? AND (message_id IS NULL OR message_id = ?)`,
			[messageId, id, token, messageId],
		);
		if (saved.affectedRows !== 1) throw new Error(UNCERTAIN);
	} catch (error) {
		const state =
			suppressed ||
			error instanceof DeliverySuppressed ||
			error instanceof SesSuppressedError
				? "suppressed"
				: error instanceof SesError
					? error.outcome
					: providerStarted
						? "uncertain"
						: "failed";
		await execute(
			`UPDATE tanah_daily_bulletin_email_recipient SET status = ?, last_error = ?
			 WHERE id = ? AND attempt_token = ? AND status IN ('sending', 'uncertain')`,
			[
				state,
				state === "uncertain"
					? UNCERTAIN
					: state === "suppressed"
						? SUPPRESSED
						: FAILED,
				id,
				token,
			],
		);
	}
	await refreshJob(row.job_id);
}

export async function applySesEvent(event: SesEvent): Promise<void> {
	if (event.type === "subscription") {
		for (const audience of ["test", "real"] as const) {
			const preference = event.topics[audience];
			if (!event.unsubscribeAll && preference === undefined) continue;
			const optout = event.unsubscribeAll || preference === "OPT_OUT";
			await execute(
				`UPDATE tanah_daily_bulletin_subscriber SET
				 consent_status = CASE WHEN consent_status IN ('bounced', 'complained') THEN consent_status
				 WHEN ? THEN CASE WHEN consent_status = 'pending' THEN 'pending' ELSE 'unsubscribed' END
				 WHEN consent_status = 'unsubscribed' AND consented_at IS NOT NULL THEN 'confirmed' ELSE consent_status END,
				 last_event_at = ? WHERE email = ? AND audience = ? AND (last_event_at IS NULL OR last_event_at < ? OR (? AND last_event_at = ?))`,
				[
					optout,
					sqlTime(event.timestamp),
					event.email,
					audience,
					sqlTime(event.timestamp),
					optout,
					sqlTime(event.timestamp),
				],
			);
		}
		return;
	}
	const separator = event.attemptId.indexOf("_");
	const id = Number(event.attemptId.slice(0, separator));
	const token = event.attemptId.slice(separator + 1);
	if (separator < 1 || !Number.isSafeInteger(id) || id <= 0 || !token) return;
	const matched = await transaction(async (connection) => {
		const row = await txQueryOne<RecipientRow>(
			connection,
			"SELECT r.*, DATE_FORMAT(r.event_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS event_at FROM tanah_daily_bulletin_email_recipient r WHERE id = ? FOR UPDATE",
			[id],
		);
		if (
			!row ||
			row.attempt_token !== token ||
			row.email.toLowerCase() !== event.email ||
			(row.message_id !== null && row.message_id !== event.messageId)
		)
			return null;
		const status: RecipientStatus =
			event.type === "delivery"
				? "delivered"
				: event.type === "complaint"
					? "complained"
					: event.type === "bounce"
						? event.permanent
							? "bounced"
							: "failed"
						: event.type === "reject" || event.type === "renderingFailure"
							? "failed"
							: "accepted";
		// Permanent negative signals suppress both audiences even if another event is newer.
		if (
			event.type === "complaint" ||
			(event.type === "bounce" && event.permanent)
		) {
			await txExecute(
				connection,
				`UPDATE tanah_daily_bulletin_subscriber SET consent_status = CASE WHEN consent_status = 'complained' THEN 'complained' ELSE ? END,
				 last_event_at = GREATEST(COALESCE(last_event_at, ?), ?) WHERE email = ?`,
				[
					event.type === "complaint" ? "complained" : "bounced",
					sqlTime(event.timestamp),
					sqlTime(event.timestamp),
					event.email,
				],
			);
		}
		const priority: Partial<Record<RecipientStatus, number>> = {
			accepted: 1,
			delivered: 2,
			failed: 3,
			bounced: 4,
			complained: 5,
		};
		const older =
			row.event_at !== null && isoTime(row.event_at) > event.timestamp;
		const equal =
			row.event_at !== null && isoTime(row.event_at) === event.timestamp;
		if (
			(older && status !== "bounced" && status !== "complained") ||
			(equal && (priority[row.status] ?? 0) >= (priority[status] ?? 0))
		)
			return row.job_id;
		// Delivery cannot undo a bounce/complaint, and a delayed send cannot undo delivery.
		const keepTerminal = (priority[row.status] ?? 0) > (priority[status] ?? 0);
		const nextStatus = keepTerminal ? row.status : status;
		await txExecute(
			connection,
			`UPDATE tanah_daily_bulletin_email_recipient SET message_id = ?, status = ?, event_at = ?, last_error = ?
			 WHERE id = ? AND attempt_token = ? AND (message_id IS NULL OR message_id = ?)`,
			[
				event.messageId,
				nextStatus,
				older && row.event_at
					? sqlTime(isoTime(row.event_at))
					: sqlTime(event.timestamp),
				nextStatus === "failed" ||
				nextStatus === "bounced" ||
				nextStatus === "complained"
					? FAILED
					: null,
				id,
				token,
				event.messageId,
			],
		);
		return row.job_id;
	});
	if (matched) await refreshJob(matched);
}

export async function startEmailWorker(signal: AbortSignal): Promise<void> {
	const runtime = await loadEmailRuntime();
	if (!runtime || signal.aborted) return;
	const client = new SQSClient({ region: runtime.region, maxAttempts: 1 });
	let nextSweep = 0;
	try {
		while (!signal.aborted) {
			try {
				if (Date.now() >= nextSweep) {
					nextSweep = Date.now() + 30_000;
					await reconcileEmailOutbox(client, runtime.queueUrl, signal);
					if (signal.aborted) break;
					try {
						const whatsapp = await optionalWhatsAppDelivery();
						if (signal.aborted) break;
						await whatsapp?.reconcileWhatsAppOutbox(
							client,
							runtime.queueUrl,
							signal,
						);
					} catch {
						// A missing migration/provider configuration must not block the existing email consumer.
						if (!signal.aborted)
							console.error("WhatsApp bulletin outbox reconciliation failed");
					}
				}
				if (signal.aborted) break;
				const result = await client.send(
					new ReceiveMessageCommand({
						QueueUrl: runtime.queueUrl,
						WaitTimeSeconds: Math.max(
							1,
							Math.min(20, Math.ceil((nextSweep - Date.now()) / 1_000)),
						),
						MaxNumberOfMessages: 1,
						VisibilityTimeout: 120,
					}),
					{
						abortSignal: AbortSignal.any([signal, AbortSignal.timeout(35_000)]),
					},
				);
				for (const message of result.Messages ?? []) {
					if (signal.aborted) break;
					if (!message.Body || !message.ReceiptHandle) continue;
					let payload: unknown;
					try {
						payload = JSON.parse(message.Body);
					} catch {
						continue;
					}
					let handled = false;
					if (
						typeof payload === "object" &&
						payload !== null &&
						"kind" in payload &&
						payload.kind === "send" &&
						"recipientId" in payload &&
						typeof payload.recipientId === "number" &&
						Number.isSafeInteger(payload.recipientId) &&
						payload.recipientId > 0
					) {
						await processEmailRecipient(payload.recipientId);
						handled = true;
					} else if (
						typeof payload === "object" &&
						payload !== null &&
						"kind" in payload &&
						payload.kind === "whatsapp.send"
					) {
						if (
							Object.keys(payload).length === 2 &&
							"jobId" in payload &&
							typeof payload.jobId === "string" &&
							WHATSAPP_JOB_ID.test(payload.jobId)
						) {
							const whatsapp = await optionalWhatsAppDelivery();
							if (signal.aborted) break;
							if (whatsapp)
								handled = await whatsapp.processWhatsAppJob(
									payload.jobId.toLowerCase(),
									signal,
								);
						}
					} else {
						const event = parseSesEvent(payload, runtime);
						if (event) {
							await applySesEvent(event);
							handled = true;
						}
					}
					if (handled)
						await client.send(
							new DeleteMessageCommand({
								QueueUrl: runtime.queueUrl,
								ReceiptHandle: message.ReceiptHandle,
							}),
							{ abortSignal: AbortSignal.timeout(15_000) },
						);
				}
			} catch {
				if (!signal.aborted)
					await delay(1_000, undefined, { signal }).catch(() => {});
			}
		}
	} finally {
		client.destroy();
	}
}
