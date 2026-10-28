import "@tanstack/react-start/server-only";
import { createHash, randomUUID } from "node:crypto";
import { SendMessageBatchCommand, SQSClient } from "@aws-sdk/client-sqs";
import type { PoolConnection } from "mysql2/promise";
import {
	type BulletinTelegramState,
	type TelegramAudience,
	type TelegramAudienceChange,
	type TelegramJobStatus,
	type TelegramJobSummary,
	type TelegramQueueRequest,
	type TelegramSettings,
	validateTelegramAudienceChange,
	validateTelegramQueueRequest,
} from "~/lib/bulletin-telegram";
import { validateBulletinDate } from "~/lib/daily-bulletin";
import { readPreparedBulletin } from "./daily-bulletins.server";
import {
	execute,
	query,
	queryOne,
	transaction,
	txExecute,
	txQueryOne,
} from "./db";
import {
	TelegramClient,
	TelegramError,
	TelegramSuppressedError,
} from "./telegram-client.server";
import {
	loadTelegramRuntime,
	readTelegramSettings,
	reserveTelegramSendSlot,
	settingsFromRow,
	type TelegramRuntime,
	targetChatId,
	targetView,
	telegramReadiness,
	verifyTelegramTargets,
} from "./telegram-settings.server";

const FAILED = "פרסום העלון נכשל. לא תתבצע שליחה חוזרת אוטומטית.";
const UNCERTAIN = "תוצאת הפרסום אינה ודאית. נדרשת בדיקה ולא יתבצע פרסום חוזר.";
const SUPPRESSED = "הפרסום נעצר בעקבות שינוי בהגדרות או ביעד הטלגרם.";
const QUEUE_FAILED =
	"שמירת הבקשה הושלמה אך העברתה לתור לא הושלמה. אפשר לרענן או לחזור על אותה בקשה.";
const UUID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
interface JobRow {
	id: string;
	bulletin_date: string;
	audience: TelegramAudience;
	settings_revision: number;
	bot_id: number;
	target_chat_id: number;
	pdf_sha256: string;
	filename: string;
	caption: string;
	status: TelegramJobStatus;
	attempt_token: string | null;
	provider_message_id: number | null;
	provider_file_id: string | null;
	created_at: string;
	sent_at: string | null;
	last_error: string | null;
}

function summary(row: JobRow): TelegramJobSummary {
	return {
		id: row.id,
		date: row.bulletin_date,
		audience: row.audience,
		status: row.status,
		createdAt: row.created_at,
		sentAt: row.sent_at,
		error: row.last_error
			? row.status === "uncertain"
				? UNCERTAIN
				: row.status === "suppressed"
					? SUPPRESSED
					: FAILED
			: null,
	};
}
async function readJob(id: string): Promise<JobRow | null> {
	return queryOne<JobRow>(
		"SELECT j.*, DATE_FORMAT(j.bulletin_date, '%Y-%m-%d') AS bulletin_date, DATE_FORMAT(j.created_at, '%Y-%m-%dT%H:%i:%sZ') AS created_at, DATE_FORMAT(j.sent_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS sent_at FROM tanah_daily_bulletin_telegram_job j WHERE id = ?",
		[id],
	);
}
async function latestJob(
	date: string,
	audience: TelegramAudience,
): Promise<TelegramJobSummary | null> {
	const row = await queryOne<JobRow>(
		"SELECT j.*, DATE_FORMAT(j.bulletin_date, '%Y-%m-%d') AS bulletin_date, DATE_FORMAT(j.created_at, '%Y-%m-%dT%H:%i:%sZ') AS created_at, DATE_FORMAT(j.sent_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS sent_at FROM tanah_daily_bulletin_telegram_job j WHERE bulletin_date = ? AND audience = ? ORDER BY created_at DESC, id DESC LIMIT 1",
		[date, audience],
	);
	return row ? summary(row) : null;
}

export async function getBulletinTelegramState(
	date: string,
): Promise<BulletinTelegramState> {
	validateBulletinDate(date);
	let settings: TelegramSettings;
	let job: TelegramJobSummary | null;
	try {
		settings = await readTelegramSettings();
		job = await latestJob(date, settings.audience);
	} catch {
		throw new Error("לא ניתן לקרוא את מצב הפרסום בטלגרם. רעננו את המסך.");
	}
	const disabled = (
		configured: boolean,
		message: string,
	): BulletinTelegramState => ({
		settings,
		readiness: {
			configured,
			canSend: false,
			canUseReal: false,
			blockers: [message],
		},
		testTarget: null,
		realTarget: null,
		job,
	});
	let runtime: TelegramRuntime | null;
	try {
		runtime = loadTelegramRuntime();
	} catch {
		return disabled(true, "הגדרות שירות הטלגרם אינן תקינות");
	}
	if (!runtime) return disabled(false, "שירות הטלגרם טרם הוגדר");
	const targets = await verifyTelegramTargets(runtime);
	return {
		settings,
		readiness: telegramReadiness(targets, settings.audience),
		testTarget: targetView(targets.test),
		realTarget: targetView(targets.real),
		job,
	};
}

export async function setTelegramAudience(
	change: TelegramAudienceChange,
): Promise<TelegramSettings> {
	const value = validateTelegramAudienceChange(change);
	if (value.audience === "real") {
		const runtime = loadTelegramRuntime();
		if (!runtime || !(await verifyTelegramTargets(runtime)).real)
			throw new Error("הערוץ הציבורי טרם הוגדר ואומת");
	}
	return transaction(async (connection) => {
		const settings = settingsFromRow(
			await txQueryOne<{ audience: string; revision: number }>(
				connection,
				"SELECT audience, revision FROM tanah_daily_bulletin_telegram_settings WHERE id = 1 FOR UPDATE",
			),
		);
		if (settings.revision !== value.expectedRevision)
			throw new TelegramSuppressedError();
		if (settings.audience === value.audience) return settings;
		if (settings.revision >= Number.MAX_SAFE_INTEGER)
			throw new Error(SUPPRESSED);
		const active = await txQueryOne<{ id: string }>(
			connection,
			"SELECT id FROM tanah_daily_bulletin_telegram_job WHERE status IN ('queued','sending','uncertain') LIMIT 1",
		);
		if (active)
			throw new Error(
				"יש פרסום פעיל או שתוצאתו אינה ודאית. נדרשת בדיקה לפני שינוי הערוץ.",
			);
		await txExecute(
			connection,
			"UPDATE tanah_daily_bulletin_telegram_settings SET audience = ?, revision = revision + 1 WHERE id = 1",
			[value.audience],
		);
		return { audience: value.audience, revision: settings.revision + 1 };
	});
}

async function existingRequest(
	connection: PoolConnection,
	value: TelegramQueueRequest,
	key: string,
): Promise<JobRow | null> {
	const settings = settingsFromRow(
		await txQueryOne<{ audience: string; revision: number }>(
			connection,
			"SELECT audience, revision FROM tanah_daily_bulletin_telegram_settings WHERE id = 1 FOR UPDATE",
		),
	);
	if (
		settings.audience !== value.expectedAudience ||
		settings.revision !== value.expectedRevision
	)
		throw new TelegramSuppressedError();
	return txQueryOne<JobRow>(
		connection,
		"SELECT j.*, DATE_FORMAT(j.bulletin_date, '%Y-%m-%d') AS bulletin_date, DATE_FORMAT(j.created_at, '%Y-%m-%dT%H:%i:%sZ') AS created_at, DATE_FORMAT(j.sent_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS sent_at FROM tanah_daily_bulletin_telegram_job j WHERE bulletin_date = ? AND audience = ? AND idempotency_key = ?",
		[value.date, value.expectedAudience, key],
	);
}

async function publishJobs(
	client: SQSClient,
	queueUrl: string,
	jobs: { id: string }[],
	signal?: AbortSignal,
): Promise<void> {
	const deadline = AbortSignal.timeout(15_000);
	const abortSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
	try {
		for (let offset = 0; offset < jobs.length; offset += 10) {
			abortSignal.throwIfAborted();
			const entries = jobs.slice(offset, offset + 10).map(({ id }) => ({
				Id: id,
				MessageBody: JSON.stringify({ kind: "telegram.send", jobId: id }),
			}));
			const result = await client.send(
				new SendMessageBatchCommand({ QueueUrl: queueUrl, Entries: entries }),
				{ abortSignal },
			);
			abortSignal.throwIfAborted();
			const accepted = new Set(result.Successful?.map((entry) => entry.Id));
			if (result.Failed?.length || entries.some(({ Id }) => !accepted.has(Id)))
				throw new Error(QUEUE_FAILED);
		}
	} catch {
		throw new Error(QUEUE_FAILED);
	}
}
async function publishQueued(
	id: string,
	runtime: TelegramRuntime,
): Promise<void> {
	const jobs = await query<{ id: string }>(
		"SELECT id FROM tanah_daily_bulletin_telegram_job WHERE id = ? AND status = 'queued'",
		[id],
	);
	if (!jobs.length) return;
	const client = new SQSClient({ region: runtime.region, maxAttempts: 1 });
	try {
		await publishJobs(client, runtime.queueUrl, jobs);
	} finally {
		client.destroy();
	}
}

export async function enqueueBulletinTelegram(
	request: TelegramQueueRequest,
): Promise<TelegramJobSummary> {
	const value = validateTelegramQueueRequest(request);
	const runtime = loadTelegramRuntime();
	if (!runtime) throw new Error("שירות הטלגרם טרם הוגדר");
	const key =
		value.expectedAudience === "real" ? "production" : value.requestKey;
	const existing = await transaction((connection) =>
		existingRequest(connection, value, key),
	);
	if (existing) {
		await publishQueued(existing.id, runtime);
		return summary(existing);
	}
	const prepared = await readPreparedBulletin(value.date);
	if (!prepared) throw new Error("יש להכין את העלון לפני הפרסום");
	const pdf = Buffer.from(prepared.pdfBase64, "base64");
	if (
		!pdf.length ||
		pdf.length > 50_000_000 ||
		pdf.subarray(0, 5).toString() !== "%PDF-" ||
		!prepared.filename ||
		prepared.filename.length > 255 ||
		/[\r\n/\\]/.test(prepared.filename)
	)
		throw new Error(FAILED);
	const caption = `${prepared.source}\n${prepared.input.hebrewDate} (${value.date})\nלימוד יומי בתנ"ך על הפרק\nhttps://xn--febl3a.co.il/929/${prepared.input.perekId}`;
	if (
		caption.length > 1024 ||
		!Number.isSafeInteger(prepared.input.perekId) ||
		prepared.input.perekId < 1 ||
		prepared.input.perekId > 929
	)
		throw new Error(FAILED);
	const target = (await verifyTelegramTargets(runtime))[value.expectedAudience];
	if (
		!target ||
		target.chatId !== targetChatId(runtime, value.expectedAudience)
	)
		throw new TelegramSuppressedError();
	const job = await transaction(async (connection) => {
		const found = await existingRequest(connection, value, key);
		if (found) return found;
		if (
			await txQueryOne<{ id: string }>(
				connection,
				"SELECT id FROM tanah_daily_bulletin_telegram_job WHERE bulletin_date = ? AND audience = ? AND status IN ('queued','sending','uncertain') LIMIT 1",
				[value.date, value.expectedAudience],
			)
		)
			throw new Error("יש בקשת פרסום פתוחה או שתוצאתה אינה ודאית לתאריך זה");
		if (value.expectedAudience === "real") {
			const channel = await txQueryOne<{
				status: string;
				attempt_count: number;
				provider_message_id: string | null;
				sent_at: unknown;
				lease_token: string | null;
				lease_until: unknown;
			}>(
				connection,
				"SELECT status, attempt_count, provider_message_id, sent_at, lease_token, lease_until FROM tanah_daily_bulletin_delivery WHERE bulletin_date = ? AND channel = 'telegram' FOR UPDATE",
				[value.date],
			);
			if (
				channel?.status !== "pending" ||
				Number(channel.attempt_count) !== 0 ||
				channel.provider_message_id !== null ||
				channel.sent_at !== null ||
				channel.lease_token !== null ||
				channel.lease_until !== null
			)
				throw new Error("קיים ניסיון פרסום קודם לתאריך זה ונדרשת בדיקה");
		}
		const id = randomUUID();
		await txExecute(
			connection,
			"INSERT INTO tanah_daily_bulletin_telegram_job (id, bulletin_date, audience, idempotency_key, settings_revision, bot_id, target_chat_id, pdf_sha256, filename, caption) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
			[
				id,
				value.date,
				value.expectedAudience,
				key,
				value.expectedRevision,
				target.botId,
				target.chatId,
				createHash("sha256").update(pdf).digest("hex"),
				prepared.filename,
				caption,
			],
		);
		if (value.expectedAudience === "real") {
			const reserved = await txExecute(
				connection,
				"UPDATE tanah_daily_bulletin_delivery SET status = 'sending', provider_message_id = ?, last_error = NULL WHERE bulletin_date = ? AND channel = 'telegram' AND status = 'pending' AND attempt_count = 0 AND provider_message_id IS NULL AND sent_at IS NULL AND lease_token IS NULL AND lease_until IS NULL",
				[`telegram-job:${id}`, value.date],
			);
			if (reserved.affectedRows !== 1) throw new TelegramSuppressedError();
		}
		const inserted = await txQueryOne<JobRow>(
			connection,
			"SELECT j.*, DATE_FORMAT(j.bulletin_date, '%Y-%m-%d') AS bulletin_date, DATE_FORMAT(j.created_at, '%Y-%m-%dT%H:%i:%sZ') AS created_at, DATE_FORMAT(j.sent_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS sent_at FROM tanah_daily_bulletin_telegram_job j WHERE id = ?",
			[id],
		);
		if (!inserted) throw new Error(FAILED);
		return inserted;
	});
	await publishQueued(job.id, runtime);
	return summary(job);
}

async function syncProductionChannel(id: string): Promise<void> {
	await transaction(async (connection) => {
		const row = await txQueryOne<JobRow>(
			connection,
			"SELECT j.*, DATE_FORMAT(j.bulletin_date, '%Y-%m-%d') AS bulletin_date FROM tanah_daily_bulletin_telegram_job j WHERE id = ? FOR UPDATE",
			[id],
		);
		if (row?.audience !== "real") return;
		const status =
			row.status === "queued"
				? "pending"
				: row.status === "suppressed"
					? "failed"
					: row.status;
		await txExecute(
			connection,
			"UPDATE tanah_daily_bulletin_delivery SET status = ?, provider_message_id = ?, last_error = ?, lease_token = ?, lease_until = NULL, attempt_count = GREATEST(attempt_count, ?), sent_at = CASE WHEN ? = 'sent' THEN COALESCE(sent_at, UTC_TIMESTAMP()) ELSE sent_at END WHERE bulletin_date = ? AND channel = 'telegram'",
			[
				status,
				row.provider_message_id
					? `telegram:${row.target_chat_id}:${row.provider_message_id}`
					: `telegram-job:${row.id}`,
				row.last_error,
				row.attempt_token,
				row.attempt_token ? 1 : 0,
				status,
				row.bulletin_date,
			],
		);
	});
}

export async function processTelegramJob(id: string): Promise<boolean> {
	if (!UUID.test(id)) return false;
	const runtime = loadTelegramRuntime();
	if (!runtime) return false;
	const row = await readJob(id);
	if (!row) return false;
	if (row.status === "sending") {
		const stale = await execute(
			"UPDATE tanah_daily_bulletin_telegram_job SET status = 'uncertain', last_error = ? WHERE id = ? AND status = 'sending' AND (started_at IS NULL OR started_at < UTC_TIMESTAMP(3) - INTERVAL 60 SECOND)",
			[UNCERTAIN, id],
		);
		if (stale.affectedRows === 1) {
			await syncProductionChannel(id);
			return true;
		}
		return false;
	}
	if (row.status !== "queued") {
		await syncProductionChannel(id);
		return true;
	}
	const token = randomUUID();
	const claimed = await execute(
		"UPDATE tanah_daily_bulletin_telegram_job SET status = 'sending', attempt_token = ?, started_at = UTC_TIMESTAMP(3), last_error = NULL WHERE id = ? AND status = 'queued'",
		[token, id],
	);
	if (claimed.affectedRows !== 1) return false;
	let mutationMayHaveStarted = false;
	try {
		if (
			Number(row.target_chat_id) !== targetChatId(runtime, row.audience) ||
			!Number.isSafeInteger(Number(row.bot_id)) ||
			Number(row.bot_id) <= 0
		)
			throw new TelegramSuppressedError();
		const prepared = await readPreparedBulletin(row.bulletin_date);
		if (!prepared) throw new TelegramSuppressedError();
		const pdf = Buffer.from(prepared.pdfBase64, "base64");
		if (
			prepared.filename !== row.filename ||
			createHash("sha256").update(pdf).digest("hex") !== row.pdf_sha256
		)
			throw new TelegramSuppressedError();
		await syncProductionChannel(id);
		const result = await new TelegramClient(runtime).sendDocument({
			botId: Number(row.bot_id),
			chatId: Number(row.target_chat_id),
			audience: row.audience,
			pdf,
			filename: row.filename,
			caption: row.caption,
			beforeSend: async () => {
				await reserveTelegramSendSlot(id, token);
				mutationMayHaveStarted = true;
			},
		});
		mutationMayHaveStarted = true;
		const saved = await execute(
			"UPDATE tanah_daily_bulletin_telegram_job SET status = 'sent', provider_message_id = ?, provider_file_id = ?, last_error = NULL, sent_at = UTC_TIMESTAMP(3) WHERE id = ? AND status = 'sending' AND attempt_token = ?",
			[result.messageId, result.fileId, id, token],
		);
		if (saved.affectedRows !== 1) throw new TelegramError("uncertain");
	} catch (error) {
		const status =
			error instanceof TelegramSuppressedError
				? "suppressed"
				: error instanceof TelegramError
					? error.outcome === "uncertain"
						? "uncertain"
						: "failed"
					: mutationMayHaveStarted
						? "uncertain"
						: "failed";
		try {
			await execute(
				"UPDATE tanah_daily_bulletin_telegram_job SET status = ?, last_error = ? WHERE id = ? AND status = 'sending' AND attempt_token = ?",
				[
					status,
					status === "uncertain"
						? UNCERTAIN
						: status === "suppressed"
							? SUPPRESSED
							: FAILED,
					id,
					token,
				],
			);
		} catch {
			throw new Error("לא ניתן לשמור את תוצאת הפרסום בטלגרם");
		}
	}
	await syncProductionChannel(id);
	return true;
}

export async function reconcileTelegramOutbox(
	client: SQSClient,
	queueUrl: string,
	signal?: AbortSignal,
): Promise<void> {
	if (signal?.aborted) return;
	const runtime = loadTelegramRuntime();
	if (!runtime) return;
	if (queueUrl !== runtime.queueUrl) throw new Error(QUEUE_FAILED);
	const stale = await query<{ id: string }>(
		"SELECT id FROM tanah_daily_bulletin_telegram_job WHERE status = 'sending' AND (started_at IS NULL OR started_at < UTC_TIMESTAMP(3) - INTERVAL 60 SECOND) ORDER BY id LIMIT 100",
	);
	for (const { id } of stale) {
		if (signal?.aborted) return;
		const changed = await execute(
			"UPDATE tanah_daily_bulletin_telegram_job SET status = 'uncertain', last_error = ? WHERE id = ? AND status = 'sending' AND (started_at IS NULL OR started_at < UTC_TIMESTAMP(3) - INTERVAL 60 SECOND)",
			[UNCERTAIN, id],
		);
		if (changed.affectedRows === 1) await syncProductionChannel(id);
	}
	if (signal?.aborted) return;
	const queued = await query<{ id: string }>(
		"SELECT id FROM tanah_daily_bulletin_telegram_job WHERE status = 'queued' ORDER BY id LIMIT 100",
	);
	await publishJobs(client, queueUrl, queued, signal);
}
