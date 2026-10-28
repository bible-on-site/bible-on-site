import "@tanstack/react-start/server-only";
import { createHash, randomUUID } from "node:crypto";
import { SendMessageBatchCommand, SQSClient } from "@aws-sdk/client-sqs";
import type { PoolConnection } from "mysql2/promise";
import {
	type BulletinWhatsAppState,
	validateWhatsAppAudienceChange,
	validateWhatsAppQueueRequest,
	type WhatsAppAudience,
	type WhatsAppAudienceChange,
	type WhatsAppJobStatus,
	type WhatsAppJobSummary,
	type WhatsAppQueueRequest,
	type WhatsAppSettings,
} from "~/lib/bulletin-whatsapp";
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
import { runOutboxSweep } from "./outbox-deadline.server";
import {
	WhatsAppClient,
	WhatsAppDeferredError,
	WhatsAppError,
	WhatsAppSuppressedError,
} from "./whatsapp-client.server";
import {
	loadWhatsAppRuntime,
	readWhatsAppSettings,
	readWhatsAppTargets,
	reserveWhatsAppGroupLookup,
	settingsFromRow,
	targetGroupId,
	usableWhatsAppTarget,
	verifyWhatsAppTarget,
	WHATSAPP_DEFERRED,
	type WhatsAppRuntime,
	whatsAppConfigDigest,
	whatsAppReadiness,
	whatsAppTargetView,
	whatsAppVerification,
} from "./whatsapp-settings.server";

const FAILED = "פרסום העלון בווטסאפ נכשל. לא תתבצע שליחה חוזרת אוטומטית.";
const UNCERTAIN = "תוצאת הפרסום אינה ודאית. נדרשת בדיקה ולא יתבצע פרסום חוזר.";
const SUPPRESSED = "הפרסום נעצר בעקבות שינוי בהגדרות או בקבוצת הווטסאפ.";
const QUEUE_FAILED =
	"הבקשה נשמרה אך העברתה לתור לא הושלמה. אפשר לחזור על אותה בקשה.";
const CHECK_LIMIT = "ממתין לחידוש מכסת בדיקת מצב השליחה. לא תתבצע שליחה נוספת.";
const UUID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIVE = "('queued','sending','accepted','uncertain')";
const JOB_SELECT =
	"SELECT j.*, DATE_FORMAT(j.bulletin_date, '%Y-%m-%d') AS bulletin_date, DATE_FORMAT(j.created_at, '%Y-%m-%dT%H:%i:%sZ') AS created_at, DATE_FORMAT(j.sent_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS sent_at FROM tanah_daily_bulletin_whatsapp_job j";
// Known accepted messages only. A status lookup can never issue another upload.
const RECONCILE_DELAYS = [120, 300, 900, 3600, 21600, 86400];

interface JobRow {
	id: string;
	bulletin_date: string;
	audience: WhatsAppAudience;
	settings_revision: number;
	instance_id: string;
	target_group_id: string;
	sender_id: string;
	sender_phone: string;
	participant_digest: string;
	config_sha256: string;
	pdf_sha256: string;
	filename: string;
	caption: string;
	status: WhatsAppJobStatus;
	attempt_token: string | null;
	upload_started_at: unknown;
	provider_message_id: string | null;
	provider_status: string | null;
	reconcile_attempts: number;
	created_at: string;
	sent_at: string | null;
	last_error: string | null;
}

function summary(row: JobRow): WhatsAppJobSummary {
	const error = row.last_error
		? row.status === "uncertain"
			? UNCERTAIN
			: row.status === "suppressed"
				? SUPPRESSED
				: row.status === "queued"
					? WHATSAPP_DEFERRED
					: row.status === "accepted"
						? CHECK_LIMIT
						: FAILED
		: null;
	return {
		id: row.id,
		date: row.bulletin_date,
		audience: row.audience,
		status: row.status,
		createdAt: row.created_at,
		sentAt: row.sent_at,
		error,
	};
}
async function readJob(id: string): Promise<JobRow | null> {
	return queryOne<JobRow>(`${JOB_SELECT} WHERE id = ?`, [id]);
}
async function latestJob(
	date: string,
	audience: WhatsAppAudience,
): Promise<WhatsAppJobSummary | null> {
	const row = await queryOne<JobRow>(
		`${JOB_SELECT} WHERE bulletin_date = ? AND audience = ? ORDER BY created_at DESC, id DESC LIMIT 1`,
		[date, audience],
	);
	return row ? summary(row) : null;
}
async function audienceLocked(connection?: PoolConnection): Promise<boolean> {
	const sql = `SELECT id FROM tanah_daily_bulletin_whatsapp_job WHERE status IN ${ACTIVE} LIMIT 1`;
	return !!(connection
		? await txQueryOne(connection, sql)
		: await queryOne(sql));
}

export async function getBulletinWhatsAppState(
	date: string,
): Promise<BulletinWhatsAppState> {
	validateBulletinDate(date);
	let settings: WhatsAppSettings;
	let job: WhatsAppJobSummary | null;
	let locked: boolean;
	try {
		settings = await readWhatsAppSettings();
		[job, locked] = await Promise.all([
			latestJob(date, settings.audience),
			audienceLocked(),
		]);
	} catch {
		throw new Error("לא ניתן לקרוא את מצב הפרסום בווטסאפ. רעננו את המסך.");
	}
	const disabled = (
		configured: boolean,
		message: string,
	): BulletinWhatsAppState => ({
		settings,
		job,
		audienceLocked: locked,
		readiness: {
			configured,
			canSend: false,
			canUseReal: false,
			blockers: [message],
		},
		testTarget: null,
		realTarget: null,
		verification: {
			connectionState: "unknown",
			checkedAt: null,
			expiresAt: null,
		},
	});
	let runtime: WhatsAppRuntime | null;
	try {
		runtime = loadWhatsAppRuntime();
	} catch {
		return disabled(true, "הגדרות שירות הווטסאפ אינן תקינות");
	}
	if (!runtime) return disabled(false, "שירות הווטסאפ טרם הוגדר");
	let targets: Awaited<ReturnType<typeof readWhatsAppTargets>>;
	try {
		targets = await readWhatsAppTargets(runtime);
	} catch {
		throw new Error("לא ניתן לקרוא את אימות קבוצות הווטסאפ. רעננו את המסך.");
	}
	return {
		settings,
		job,
		audienceLocked: locked,
		readiness: whatsAppReadiness(runtime, targets, settings.audience),
		testTarget: whatsAppTargetView(targets.test),
		realTarget: whatsAppTargetView(targets.real),
		verification: whatsAppVerification(targets),
	};
}

/** Explicit authenticated action only; passive state reads never contact the provider. */
export async function verifyBulletinWhatsApp(
	date: string,
): Promise<BulletinWhatsAppState> {
	validateBulletinDate(date);
	const runtime = loadWhatsAppRuntime();
	if (!runtime) return getBulletinWhatsAppState(date);
	const settings = await readWhatsAppSettings();
	const targets = await readWhatsAppTargets(runtime);
	const other = settings.audience === "test" ? "real" : "test";
	const audience =
		usableWhatsAppTarget(
			runtime,
			settings.audience,
			targets[settings.audience],
		) &&
		(other === "test" || runtime.realGroupId !== null) &&
		!usableWhatsAppTarget(runtime, other, targets[other])
			? other
			: settings.audience;
	try {
		await verifyWhatsAppTarget(runtime, audience);
	} catch (error) {
		if (error instanceof WhatsAppDeferredError) {
			const state = await getBulletinWhatsAppState(date);
			return {
				...state,
				readiness: {
					...state.readiness,
					canSend: false,
					blockers: [WHATSAPP_DEFERRED],
				},
			};
		}
		// Verification stores a sanitized failed result; never return provider details.
		if (!(error instanceof WhatsAppError))
			throw new Error("לא ניתן להשלים את בדיקת הווטסאפ");
	}
	return getBulletinWhatsAppState(date);
}

export async function setWhatsAppAudience(
	change: WhatsAppAudienceChange,
): Promise<WhatsAppSettings> {
	const value = validateWhatsAppAudienceChange(change);
	return transaction(async (connection) => {
		const settings = settingsFromRow(
			await txQueryOne<{ audience: string; revision: number }>(
				connection,
				"SELECT audience, revision FROM tanah_daily_bulletin_whatsapp_settings WHERE id = 1 FOR UPDATE",
			),
		);
		if (settings.revision !== value.expectedRevision)
			throw new WhatsAppSuppressedError();
		if (settings.audience === value.audience) return settings;
		if (settings.revision >= Number.MAX_SAFE_INTEGER)
			throw new Error(SUPPRESSED);
		if (await audienceLocked(connection))
			throw new Error(
				"יש פרסום פעיל או שתוצאתו אינה ודאית. נדרשת בדיקה לפני שינוי הקבוצה.",
			);
		if (value.audience === "real") {
			const runtime = loadWhatsAppRuntime();
			if (
				!runtime?.realGroupId ||
				!whatsAppReadiness(
					runtime,
					await readWhatsAppTargets(runtime, connection),
					"real",
				).canUseReal
			)
				throw new Error("הקבוצה הרגילה טרם הוגדרה ואומתה");
		}
		await txExecute(
			connection,
			"UPDATE tanah_daily_bulletin_whatsapp_settings SET audience = ?, revision = revision + 1 WHERE id = 1",
			[value.audience],
		);
		return { audience: value.audience, revision: settings.revision + 1 };
	});
}

async function existingRequest(
	connection: PoolConnection,
	value: WhatsAppQueueRequest,
	key: string,
): Promise<JobRow | null> {
	const settings = settingsFromRow(
		await txQueryOne<{ audience: string; revision: number }>(
			connection,
			"SELECT audience, revision FROM tanah_daily_bulletin_whatsapp_settings WHERE id = 1 FOR UPDATE",
		),
	);
	if (
		settings.audience !== value.expectedAudience ||
		settings.revision !== value.expectedRevision
	)
		throw new WhatsAppSuppressedError();
	return txQueryOne<JobRow>(
		connection,
		`${JOB_SELECT} WHERE bulletin_date = ? AND audience = ? AND idempotency_key = ?`,
		[value.date, value.expectedAudience, key],
	);
}

async function publishJobs(
	client: SQSClient,
	queueUrl: string,
	jobs: { id: string }[],
	signal?: AbortSignal,
): Promise<void> {
	const abortSignal = signal ?? AbortSignal.timeout(15_000);
	try {
		for (let offset = 0; offset < jobs.length; offset += 10) {
			abortSignal.throwIfAborted();
			const entries = jobs.slice(offset, offset + 10).map(({ id }) => ({
				Id: id,
				MessageBody: JSON.stringify({ kind: "whatsapp.send", jobId: id }),
			}));
			const response = await client.send(
				new SendMessageBatchCommand({ QueueUrl: queueUrl, Entries: entries }),
				{ abortSignal },
			);
			abortSignal.throwIfAborted();
			const accepted = new Set(response.Successful?.map((item) => item.Id));
			if (
				response.Failed?.length ||
				entries.some(({ Id }) => !accepted.has(Id))
			)
				throw new Error(QUEUE_FAILED);
		}
	} catch {
		throw new Error(QUEUE_FAILED);
	}
}
async function publishQueued(
	id: string,
	runtime: WhatsAppRuntime,
): Promise<void> {
	const rows = await query<{ id: string }>(
		"SELECT id FROM tanah_daily_bulletin_whatsapp_job WHERE id = ? AND status = 'queued' AND (available_after IS NULL OR available_after <= UTC_TIMESTAMP(3))",
		[id],
	);
	if (!rows.length) return;
	const client = new SQSClient({ region: runtime.region, maxAttempts: 1 });
	try {
		await publishJobs(client, runtime.queueUrl, rows);
	} finally {
		client.destroy();
	}
}

export async function enqueueBulletinWhatsApp(
	request: WhatsAppQueueRequest,
): Promise<WhatsAppJobSummary> {
	const value = validateWhatsAppQueueRequest(request);
	const runtime = loadWhatsAppRuntime();
	if (!runtime) throw new Error("שירות הווטסאפ טרם הוגדר");
	const key =
		value.expectedAudience === "real" ? "production" : value.requestKey;
	const prior = await transaction((connection) =>
		existingRequest(connection, value, key),
	);
	if (prior) {
		await publishQueued(prior.id, runtime);
		return summary(prior);
	}
	const prepared = await readPreparedBulletin(value.date);
	if (!prepared) throw new Error("יש להכין את העלון לפני הפרסום");
	const pdf = Buffer.from(prepared.pdfBase64, "base64");
	if (
		!pdf.length ||
		pdf.length > 100_000_000 ||
		pdf.subarray(0, 5).toString() !== "%PDF-" ||
		pdf.toString("base64") !== prepared.pdfBase64 ||
		!prepared.filename ||
		Buffer.byteLength(prepared.filename) > 255 ||
		!/\.pdf$/i.test(prepared.filename) ||
		/[/\\]/.test(prepared.filename) ||
		[...prepared.filename].some(
			(character) =>
				character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
		) ||
		!Number.isSafeInteger(prepared.input.perekId) ||
		prepared.input.perekId < 1 ||
		prepared.input.perekId > 929 ||
		prepared.input.date !== value.date
	)
		throw new Error(FAILED);
	const caption = `${prepared.source}\n${prepared.input.hebrewDate} (${value.date})\nלימוד יומי בתנ"ך על הפרק\nhttps://xn--febl3a.co.il/929/${prepared.input.perekId}`;
	if (caption.length > 1024) throw new Error(FAILED);
	const job = await transaction(async (connection) => {
		const existing = await existingRequest(connection, value, key);
		if (existing) return existing;
		if (
			await txQueryOne(
				connection,
				`SELECT id FROM tanah_daily_bulletin_whatsapp_job WHERE bulletin_date = ? AND audience = ? AND status IN ${ACTIVE} LIMIT 1`,
				[value.date, value.expectedAudience],
			)
		)
			throw new Error("יש בקשת פרסום פתוחה או שתוצאתה אינה ודאית לתאריך זה");
		const targets = await readWhatsAppTargets(runtime, connection);
		const target = targets[value.expectedAudience];
		if (
			!whatsAppReadiness(runtime, targets, value.expectedAudience).canSend ||
			!usableWhatsAppTarget(runtime, value.expectedAudience, target)
		)
			throw new WhatsAppSuppressedError();
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
				"SELECT status, attempt_count, provider_message_id, sent_at, lease_token, lease_until FROM tanah_daily_bulletin_delivery WHERE bulletin_date = ? AND channel = 'whatsapp' FOR UPDATE",
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
			"INSERT INTO tanah_daily_bulletin_whatsapp_job (id, bulletin_date, audience, idempotency_key, settings_revision, instance_id, target_group_id, sender_id, sender_phone, participant_digest, config_sha256, pdf_sha256, filename, caption) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
			[
				id,
				value.date,
				value.expectedAudience,
				key,
				value.expectedRevision,
				runtime.instanceId,
				target.group_id,
				target.sender_id,
				target.sender_phone,
				target.participant_digest,
				whatsAppConfigDigest(runtime, value.expectedAudience),
				createHash("sha256").update(pdf).digest("hex"),
				prepared.filename,
				caption,
			],
		);
		if (value.expectedAudience === "real") {
			const reserved = await txExecute(
				connection,
				"UPDATE tanah_daily_bulletin_delivery SET status = 'sending', provider_message_id = ?, last_error = NULL WHERE bulletin_date = ? AND channel = 'whatsapp' AND status = 'pending' AND attempt_count = 0 AND provider_message_id IS NULL AND sent_at IS NULL AND lease_token IS NULL AND lease_until IS NULL",
				[`whatsapp-job:${id}`, value.date],
			);
			if (reserved.affectedRows !== 1) throw new WhatsAppSuppressedError();
		}
		const inserted = await txQueryOne<JobRow>(
			connection,
			`${JOB_SELECT} WHERE id = ?`,
			[id],
		);
		if (!inserted) throw new Error(FAILED);
		return inserted;
	});
	await publishQueued(job.id, runtime);
	return summary(job);
}

async function syncProductionChannel(
	id: string,
	signal?: AbortSignal,
): Promise<void> {
	await transaction(async (connection) => {
		signal?.throwIfAborted();
		const row = await txQueryOne<JobRow>(
			connection,
			`${JOB_SELECT} WHERE id = ? FOR UPDATE`,
			[id],
		);
		signal?.throwIfAborted();
		if (row?.audience !== "real") return;
		const status =
			row.status === "sent"
				? "sent"
				: row.status === "uncertain"
					? "uncertain"
					: row.status === "failed" || row.status === "suppressed"
						? "failed"
						: "sending";
		const marker = `whatsapp-job:${row.id}`;
		const provider = row.provider_message_id
			? `whatsapp:${row.target_group_id}:${row.provider_message_id}`
			: marker;
		await txExecute(
			connection,
			"UPDATE tanah_daily_bulletin_delivery SET status = ?, provider_message_id = ?, last_error = ?, lease_token = ?, lease_until = NULL, attempt_count = GREATEST(attempt_count, ?), sent_at = CASE WHEN ? = 'sent' THEN COALESCE(sent_at, UTC_TIMESTAMP()) ELSE sent_at END WHERE bulletin_date = ? AND channel = 'whatsapp' AND provider_message_id IN (?, ?) AND (status = 'sending' OR status = ?) AND attempt_count <= ? AND (lease_token IS NULL OR lease_token = ?) AND lease_until IS NULL AND (sent_at IS NULL OR (status = 'sent' AND ? = 'sent'))",
			[
				status,
				provider,
				row.last_error,
				row.upload_started_at ? row.attempt_token : null,
				row.upload_started_at ? 1 : 0,
				status,
				row.bulletin_date,
				marker,
				provider,
				status,
				row.upload_started_at ? 1 : 0,
				row.attempt_token,
				status,
			],
		);
	});
}

function frozenTargetMatches(runtime: WhatsAppRuntime, row: JobRow): boolean {
	return (
		row.instance_id === runtime.instanceId &&
		row.sender_phone === runtime.expectedSenderPhone &&
		(row.audience === "test" || runtime.realGroupId !== null) &&
		row.target_group_id === targetGroupId(runtime, row.audience) &&
		row.config_sha256 === whatsAppConfigDigest(runtime, row.audience) &&
		(row.audience !== "test" ||
			row.participant_digest === runtime.testParticipantDigest)
	);
}

async function markUploadStarted(
	id: string,
	token: string,
	runtime: WhatsAppRuntime,
	signal?: AbortSignal,
): Promise<void> {
	await transaction(async (connection) => {
		signal?.throwIfAborted();
		const settings = settingsFromRow(
			await txQueryOne<{ audience: string; revision: number }>(
				connection,
				"SELECT audience, revision FROM tanah_daily_bulletin_whatsapp_settings WHERE id = 1 FOR UPDATE",
			),
		);
		signal?.throwIfAborted();
		const row = await txQueryOne<JobRow>(
			connection,
			`${JOB_SELECT} WHERE id = ? FOR UPDATE`,
			[id],
		);
		signal?.throwIfAborted();
		if (
			row?.status !== "sending" ||
			row.attempt_token !== token ||
			row.upload_started_at !== null ||
			row.audience !== settings.audience ||
			Number(row.settings_revision) !== settings.revision ||
			!frozenTargetMatches(runtime, row)
		)
			throw new WhatsAppSuppressedError();
		if (row.audience === "real") {
			const legacy = await txQueryOne<{
				status: string;
				provider_message_id: string | null;
				attempt_count: number;
				sent_at: unknown;
				lease_token: string | null;
				lease_until: unknown;
			}>(
				connection,
				"SELECT status, provider_message_id, attempt_count, sent_at, lease_token, lease_until FROM tanah_daily_bulletin_delivery WHERE bulletin_date = ? AND channel = 'whatsapp' FOR UPDATE",
				[row.bulletin_date],
			);
			signal?.throwIfAborted();
			if (
				legacy?.status !== "sending" ||
				legacy.provider_message_id !== `whatsapp-job:${id}` ||
				Number(legacy.attempt_count) !== 0 ||
				legacy.sent_at !== null ||
				legacy.lease_token !== null ||
				legacy.lease_until !== null
			)
				throw new WhatsAppSuppressedError();
		}
		const saved = await txExecute(
			connection,
			"UPDATE tanah_daily_bulletin_whatsapp_job SET upload_started_at = UTC_TIMESTAMP(3) WHERE id = ? AND status = 'sending' AND attempt_token = ? AND upload_started_at IS NULL",
			[id, token],
		);
		if (saved.affectedRows !== 1) throw new WhatsAppSuppressedError();
	});
}

async function reconcileAccepted(
	id: string,
	runtime: WhatsAppRuntime,
	signal?: AbortSignal,
): Promise<void> {
	if (signal?.aborted) return;
	const claim = await transaction(async (connection) => {
		signal?.throwIfAborted();
		const settings = await txQueryOne<{
			audience: string;
			revision: number;
			current_month: string;
			message_check_month: string | null;
			message_checks_used: number;
			busy: number;
		}>(
			connection,
			"SELECT audience, revision, DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m') AS current_month, message_check_month, message_checks_used, (next_message_check_at > UTC_TIMESTAMP(3)) AS busy FROM tanah_daily_bulletin_whatsapp_settings WHERE id = 1 FOR UPDATE",
		);
		signal?.throwIfAborted();
		settingsFromRow(settings);
		const row = await txQueryOne<JobRow & { due: number }>(
			connection,
			`${JOB_SELECT.replace("SELECT j.*,", "SELECT j.*, (next_reconcile_at <= UTC_TIMESTAMP(3) AND (reconcile_until IS NULL OR reconcile_until <= UTC_TIMESTAMP(3))) AS due,")} WHERE id = ? FOR UPDATE`,
			[id],
		);
		if (
			row?.status !== "accepted" ||
			Number(row.due) !== 1 ||
			Number(settings?.busy) === 1 ||
			signal?.aborted
		)
			return null;
		if (
			!row.provider_message_id ||
			!frozenTargetMatches(runtime, row) ||
			Number(row.reconcile_attempts) >= RECONCILE_DELAYS.length
		) {
			await txExecute(
				connection,
				"UPDATE tanah_daily_bulletin_whatsapp_job SET status = 'uncertain', last_error = ?, reconcile_token = NULL, reconcile_until = NULL WHERE id = ? AND status = 'accepted'",
				[UNCERTAIN, id],
			);
			return null;
		}
		const used = Number(settings?.message_checks_used);
		if (!Number.isSafeInteger(used) || used < 0 || used > 1000)
			throw new Error(FAILED);
		if (
			settings?.message_check_month === settings?.current_month &&
			used >= 1000
		) {
			await txExecute(
				connection,
				"UPDATE tanah_daily_bulletin_whatsapp_job SET next_reconcile_at = TIMESTAMPADD(DAY, 1, LAST_DAY(UTC_DATE())), last_error = ? WHERE id = ? AND status = 'accepted'",
				[CHECK_LIMIT, id],
			);
			return null;
		}
		const token = randomUUID();
		await txExecute(
			connection,
			"UPDATE tanah_daily_bulletin_whatsapp_settings SET message_checks_used = CASE WHEN message_check_month = DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m') THEN message_checks_used + 1 ELSE 1 END, message_check_month = DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m'), next_message_check_at = TIMESTAMPADD(SECOND, 1, UTC_TIMESTAMP(3)) WHERE id = 1",
		);
		signal?.throwIfAborted();
		await txExecute(
			connection,
			"UPDATE tanah_daily_bulletin_whatsapp_job SET reconcile_token = ?, reconcile_until = TIMESTAMPADD(SECOND, 30, UTC_TIMESTAMP(3)), reconcile_attempts = reconcile_attempts + 1 WHERE id = ? AND status = 'accepted'",
			[token, id],
		);
		return { row, token, attempt: Number(row.reconcile_attempts) + 1 };
	});
	if (signal?.aborted) return;
	if (!claim) {
		await syncProductionChannel(id, signal);
		return;
	}
	let outcome = "pending";
	if (!signal?.aborted) {
		try {
			outcome = (
				await new WhatsAppClient(runtime).getMessage({
					groupId: claim.row.target_group_id,
					messageId: claim.row.provider_message_id as string,
					senderId: claim.row.sender_id,
					filename: claim.row.filename,
					signal,
				})
			).status;
		} catch {
			/* An unavailable read cannot undo a known upload acknowledgement or cause another upload. */
		}
	}
	if (signal?.aborted) return;
	const status = ["sent", "delivered", "read"].includes(outcome)
		? "sent"
		: ["failed", "suspended", "noAccount", "notInGroup"].includes(outcome)
			? "failed"
			: claim.attempt >= RECONCILE_DELAYS.length
				? "uncertain"
				: "accepted";
	await execute(
		"UPDATE tanah_daily_bulletin_whatsapp_job SET status = ?, provider_status = ?, last_error = ?, sent_at = CASE WHEN ? = 'sent' THEN COALESCE(sent_at, UTC_TIMESTAMP(3)) ELSE sent_at END, next_reconcile_at = CASE WHEN ? = 'accepted' THEN TIMESTAMPADD(SECOND, ?, UTC_TIMESTAMP(3)) ELSE NULL END, reconcile_token = NULL, reconcile_until = NULL WHERE id = ? AND status = 'accepted' AND reconcile_token = ?",
		[
			status,
			outcome,
			status === "uncertain" ? UNCERTAIN : status === "failed" ? FAILED : null,
			status,
			status,
			RECONCILE_DELAYS[claim.attempt] ?? 86400,
			id,
			claim.token,
		],
	);
	await syncProductionChannel(id, signal);
}

export async function processWhatsAppJob(
	id: string,
	signal?: AbortSignal,
): Promise<boolean> {
	if (!UUID.test(id) || signal?.aborted) return false;
	const runtime = loadWhatsAppRuntime();
	if (!runtime) return false;
	const row = await readJob(id);
	if (signal?.aborted) return false;
	if (!row) return false;
	if (row.status === "accepted") {
		await reconcileAccepted(id, runtime, signal);
		return true;
	}
	if (row.status === "sending") {
		const stale = await execute(
			"UPDATE tanah_daily_bulletin_whatsapp_job SET status = 'uncertain', last_error = ? WHERE id = ? AND status = 'sending' AND (started_at IS NULL OR started_at < UTC_TIMESTAMP(3) - INTERVAL 90 SECOND)",
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
	if (
		row.attempt_token !== null ||
		row.upload_started_at !== null ||
		row.provider_message_id !== null
	) {
		await execute(
			"UPDATE tanah_daily_bulletin_whatsapp_job SET status = 'uncertain', last_error = ? WHERE id = ? AND status = 'queued' AND (attempt_token IS NOT NULL OR upload_started_at IS NOT NULL OR provider_message_id IS NOT NULL)",
			[UNCERTAIN, id],
		);
		await syncProductionChannel(id);
		return true;
	}
	const token = randomUUID();
	const claimed = await execute(
		"UPDATE tanah_daily_bulletin_whatsapp_job SET status = 'sending', attempt_token = ?, started_at = UTC_TIMESTAMP(3), last_error = NULL WHERE id = ? AND status = 'queued' AND attempt_token IS NULL AND upload_started_at IS NULL AND provider_message_id IS NULL AND (available_after IS NULL OR available_after <= UTC_TIMESTAMP(3))",
		[token, id],
	);
	if (claimed.affectedRows !== 1) return false;
	let uploadMayHaveStarted = false;
	try {
		signal?.throwIfAborted();
		if (!frozenTargetMatches(runtime, row)) throw new WhatsAppSuppressedError();
		const prepared = await readPreparedBulletin(row.bulletin_date);
		signal?.throwIfAborted();
		if (!prepared) throw new WhatsAppSuppressedError();
		const pdf = Buffer.from(prepared.pdfBase64, "base64");
		if (
			prepared.filename !== row.filename ||
			createHash("sha256").update(pdf).digest("hex") !== row.pdf_sha256
		)
			throw new WhatsAppSuppressedError();
		const result = await new WhatsAppClient(runtime).sendDocument({
			groupId: row.target_group_id,
			audience: row.audience,
			senderId: row.sender_id,
			senderPhone: row.sender_phone,
			participantDigest: row.participant_digest,
			pdfSha256: row.pdf_sha256,
			pdf,
			filename: row.filename,
			caption: row.caption,
			beforeGroupData: reserveWhatsAppGroupLookup,
			signal,
			beforeSend: async () => {
				signal?.throwIfAborted();
				await markUploadStarted(id, token, runtime, signal);
				uploadMayHaveStarted = true;
				signal?.throwIfAborted();
			},
		});
		uploadMayHaveStarted = true;
		const saved = await execute(
			"UPDATE tanah_daily_bulletin_whatsapp_job SET status = 'accepted', provider_message_id = ?, provider_status = 'pending', next_reconcile_at = TIMESTAMPADD(SECOND, 120, UTC_TIMESTAMP(3)), last_error = NULL WHERE id = ? AND status = 'sending' AND attempt_token = ? AND provider_message_id IS NULL",
			[result.messageId, id, token],
		);
		if (saved.affectedRows !== 1) throw new WhatsAppError("uncertain");
	} catch (error) {
		if (
			(error instanceof WhatsAppDeferredError || signal?.aborted) &&
			!uploadMayHaveStarted
		) {
			await execute(
				"UPDATE tanah_daily_bulletin_whatsapp_job SET status = 'queued', attempt_token = NULL, started_at = NULL, available_after = TIMESTAMPADD(SECOND, 2, UTC_TIMESTAMP(3)), last_error = ? WHERE id = ? AND status = 'sending' AND attempt_token = ? AND upload_started_at IS NULL",
				[WHATSAPP_DEFERRED, id, token],
			);
			return false;
		}
		const status =
			signal?.aborted && uploadMayHaveStarted
				? "uncertain"
				: error instanceof WhatsAppSuppressedError
					? "suppressed"
					: error instanceof WhatsAppError
						? error.outcome
						: uploadMayHaveStarted
							? "uncertain"
							: "failed";
		await execute(
			"UPDATE tanah_daily_bulletin_whatsapp_job SET status = ?, last_error = ? WHERE id = ? AND status = 'sending' AND attempt_token = ?",
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
	}
	await syncProductionChannel(id);
	return true;
}

export async function reconcileWhatsAppOutbox(
	client: SQSClient,
	queueUrl: string,
	signal?: AbortSignal,
): Promise<void> {
	if (signal?.aborted) return;
	const runtime = loadWhatsAppRuntime();
	if (!runtime) return;
	if (queueUrl !== runtime.queueUrl) throw new Error(QUEUE_FAILED);
	await runOutboxSweep(signal, async (outboxSignal) => {
		const stale = await query<{ id: string }>(
			"SELECT id FROM tanah_daily_bulletin_whatsapp_job WHERE status = 'sending' AND (started_at IS NULL OR started_at < UTC_TIMESTAMP(3) - INTERVAL 90 SECOND) ORDER BY id LIMIT 100",
		);
		outboxSignal.throwIfAborted();
		for (const { id } of stale) {
			if (outboxSignal.aborted) return;
			const changed = await execute(
				"UPDATE tanah_daily_bulletin_whatsapp_job SET status = 'uncertain', last_error = ? WHERE id = ? AND status = 'sending' AND (started_at IS NULL OR started_at < UTC_TIMESTAMP(3) - INTERVAL 90 SECOND)",
				[UNCERTAIN, id],
			);
			outboxSignal.throwIfAborted();
			if (changed.affectedRows === 1)
				await syncProductionChannel(id, outboxSignal);
		}
		outboxSignal.throwIfAborted();
		const accepted = await query<{ id: string }>(
			"SELECT id FROM tanah_daily_bulletin_whatsapp_job WHERE status = 'accepted' AND next_reconcile_at <= UTC_TIMESTAMP(3) AND (reconcile_until IS NULL OR reconcile_until <= UTC_TIMESTAMP(3)) ORDER BY next_reconcile_at, id LIMIT 5",
		);
		outboxSignal.throwIfAborted();
		for (const { id } of accepted) {
			if (outboxSignal.aborted) return;
			await reconcileAccepted(id, runtime, outboxSignal);
		}
		if (outboxSignal.aborted) return;
		const queued = await query<{ id: string }>(
			"SELECT id FROM tanah_daily_bulletin_whatsapp_job WHERE status = 'queued' AND (available_after IS NULL OR available_after <= UTC_TIMESTAMP(3)) ORDER BY id LIMIT 100",
		);
		outboxSignal.throwIfAborted();
		await publishJobs(client, queueUrl, queued, outboxSignal);
	});
}
