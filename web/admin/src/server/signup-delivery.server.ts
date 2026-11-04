import "@tanstack/react-start/server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { WEBSITE_BASE } from "~/lib/website-base";
import { execute, query, queryOne, transaction, txExecute, txQueryOne } from "./db";
import { runOutboxSweep } from "./outbox-deadline.server";
import { SesClient, SesError } from "./ses-client.server";
import type { SesDeliveryEvent } from "./ses-events.server";
import { loadEmailRuntime } from "./ses-settings.server";

/**
 * Public email-signup outbox (#2940).
 *
 * The website writes a durable `signup_intent` row; this worker claims it,
 * mints the one-use confirmation challenge (only its hash is ever stored),
 * sends the confirmation mail through SES, and later synchronizes confirmed
 * signups into the SES contact list. It never enqueues a bulletin, never
 * touches the send audience, and never confirms a subscription — only the
 * mailbox owner's explicit confirm does that (on the website).
 */

const UNCERTAIN = "תוצאת שליחת מייל האימות אינה ודאית.";
const FAILED = "שליחת מייל האימות נכשלה.";
/** Same claim window as the bulletin recipient worker. */
const SEND_STALE_SECONDS = 60;
/** Confirmation links live 48 hours from when the mail is sent. */
const CHALLENGE_TTL_HOURS = 48;
const MAX_SES_SYNC_ATTEMPTS = 5;
const SIGNUP_AUDIENCE = "real";

const sha256 = (value: string) =>
	createHash("sha256").update(value).digest("hex");

interface IntentRow {
	id: number;
	email: string;
	send_token: string | null;
	status: string;
	ses_status: string | null;
	ses_attempts: number;
	subscriber_id: number | null;
}

/** The mailed confirmation page, consistent with the website's contract. */
export function signupConfirmUrl(token: string): string {
	return `${WEBSITE_BASE}/join/email/confirm?t=${encodeURIComponent(token)}`;
}

/** Confirmation mail — complete standalone HTML (no consent footer). */
function confirmationMailHtml(confirmUrl: string): string {
	return `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f9fa;font-family:Arial,sans-serif">
<table role="presentation" width="100%" dir="rtl" style="border-collapse:collapse">
<tr><td align="center" style="padding:24px">
<table role="presentation" width="600" dir="rtl" style="width:100%;max-width:600px;border-collapse:collapse;background:#ffffff;border-radius:8px">
<tr><td style="padding:28px;text-align:right">
<h1 style="margin:0 0 16px;font-size:20px;color:#1d3a44">אימות הרשמה לעלון היומי</h1>
<p style="margin:0 0 16px;font-size:15px;line-height:1.8;color:#1d3a44">
ביקשתם להירשם לעלון היומי של תנ&quot;ך על הפרק בדוא&quot;ל.
כדי להשלים את ההרשמה יש ללחוץ על הכפתור:
</p>
<p style="margin:0 0 16px;text-align:center">
<a href="${confirmUrl}" style="display:inline-block;background:#1552ac;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 28px;border-radius:6px">אישור ההרשמה</a>
</p>
<p style="margin:0 0 8px;font-size:13px;line-height:1.8;color:#637780">
הקישור תקף למשך ${CHALLENGE_TTL_HOURS} שעות וניתן לשימוש חד-פעמי.
</p>
<p style="margin:0;font-size:13px;line-height:1.8;color:#637780">
לא ביקשתם להירשם? אפשר להתעלם מהמייל - ההרשמה לא תושלם ללא אישור מפורש.
</p>
</td></tr>
<tr><td style="padding:16px 28px;background:#f5f9fa;border-top:1px solid #dce5e7;text-align:right;font-size:12px;color:#637780">
תנ&quot;ך על הפרק - לימוד יומי | <a href="https://xn--febl3a.co.il/" style="color:#28758a">האתר</a> | <a href="mailto:tanah.site@gmail.com" style="color:#28758a">tanah.site@gmail.com</a>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

/**
 * Claims and sends one pending intent. The claim atomically mints the
 * challenge: only the owning worker learns the raw token, and the row keeps
 * only its hash. A worker that dies between claim and send leaves `sending`
 * with a stored challenge — the stale sweep marks it `uncertain`, never a
 * silent duplicate (the confirm contract tolerates it: the hash stays
 * consumable while live).
 */
async function processSignupSend(
	client: SesClient,
	intentId: number,
	signal?: AbortSignal,
): Promise<void> {
	const sendToken = randomUUID();
	const token = randomBytes(32).toString("base64url");
	const challengeHash = sha256(token);
	const claimed = await execute(
		`UPDATE tanah_daily_bulletin_signup_intent
		 SET status = 'sending', send_token = ?, send_started_at = UTC_TIMESTAMP(3),
		     challenge_hash = ?, expires_at = UTC_TIMESTAMP(3) + INTERVAL ${CHALLENGE_TTL_HOURS} HOUR,
		     last_error = NULL
		 WHERE id = ? AND status = 'pending'`,
		[sendToken, challengeHash, intentId],
	);
	if (claimed.affectedRows !== 1) return;
	const row = await queryOne<IntentRow>(
		"SELECT id, email, send_token, status, ses_status, ses_attempts, subscriber_id FROM tanah_daily_bulletin_signup_intent WHERE id = ?",
		[intentId],
	);
	if (!row || row.send_token !== sendToken) return;
	let providerStarted = false;
	try {
		signal?.throwIfAborted();
		const messageId = await client.sendTransactional({
			to: row.email,
			subject: 'אימות הרשמה לעלון היומי של תנ"ך על הפרק',
			html: confirmationMailHtml(signupConfirmUrl(token)),
			externalId: `${intentId}_${sendToken}`,
		});
		providerStarted = true;
		await execute(
			`UPDATE tanah_daily_bulletin_signup_intent
			 SET status = 'sent', message_id = ?
			 WHERE id = ? AND send_token = ? AND status = 'sending'`,
			[messageId, intentId, sendToken],
		);
	} catch (error) {
		const state =
			error instanceof SesError
				? error.outcome
				: providerStarted
					? "uncertain"
					: "failed";
		await execute(
			`UPDATE tanah_daily_bulletin_signup_intent
			 SET status = ?, last_error = ?
			 WHERE id = ? AND send_token = ? AND status = 'sending'`,
			[
				state,
				state === "uncertain" ? UNCERTAIN : FAILED,
				intentId,
				sendToken,
			],
		);
	}
}

/**
 * Synchronizes one confirmed signup into the SES contact list. Runs only for
 * `confirmed` intents, so SES writes always follow explicit mailbox consent.
 * Preserves unrelated topics; the outcome is re-verified and persisted.
 */
async function syncSignupSubscriber(
	client: SesClient,
	row: IntentRow,
): Promise<void> {
	try {
		const result = await client.resubscribeContact(row.email, SIGNUP_AUDIENCE);
		await execute(
			`UPDATE tanah_daily_bulletin_signup_intent
			 SET ses_status = ?, ses_attempts = ses_attempts + 1, ses_next_attempt_at = NULL
			 WHERE id = ? AND status = 'confirmed'`,
			[result, row.id],
		);
	} catch {
		await execute(
			`UPDATE tanah_daily_bulletin_signup_intent
			 SET ses_attempts = ses_attempts + 1,
			     ses_status = CASE WHEN ses_attempts + 1 >= ${MAX_SES_SYNC_ATTEMPTS} THEN 'failed' ELSE ses_status END,
			     ses_next_attempt_at = CASE WHEN ses_attempts + 1 >= ${MAX_SES_SYNC_ATTEMPTS} THEN NULL ELSE UTC_TIMESTAMP(3) + INTERVAL (ses_attempts + 1) * 2 MINUTE END
			 WHERE id = ? AND status = 'confirmed'`,
			[row.id],
		);
	}
}

/**
 * Periodic outbox sweep for the signup flow, called from the email worker's
 * 30-second reconcile block. Order matters: stale sends are marked
 * uncertain first (their mailed link stays consumable), SES sync runs for
 * newly confirmed intents, then pending sends are claimed.
 */
export async function reconcileSignupOutbox(signal?: AbortSignal): Promise<void> {
	await runOutboxSweep(signal, async (abort) => {
		await execute(
			`UPDATE tanah_daily_bulletin_signup_intent SET status = 'uncertain', last_error = ?
			 WHERE status = 'sending'
			 AND (send_started_at IS NULL OR send_started_at < UTC_TIMESTAMP(3) - INTERVAL ${SEND_STALE_SECONDS} SECOND)`,
			[UNCERTAIN],
		);
		const runtime = await loadEmailRuntime();
		if (!runtime) return;
		const client = new SesClient(runtime);
		try {
			const syncRows = await query<IntentRow>(
				`SELECT id, email, send_token, status, ses_status, ses_attempts, subscriber_id
				 FROM tanah_daily_bulletin_signup_intent
				 WHERE status = 'confirmed' AND ses_status = 'pending' AND ses_attempts < ${MAX_SES_SYNC_ATTEMPTS}
				 AND (ses_next_attempt_at IS NULL OR ses_next_attempt_at <= UTC_TIMESTAMP(3))
				 ORDER BY id LIMIT 50`,
			);
			for (const row of syncRows) {
				abort.throwIfAborted();
				await syncSignupSubscriber(client, row);
			}
			const pending = await query<{ id: number }>(
				"SELECT id FROM tanah_daily_bulletin_signup_intent WHERE status = 'pending' ORDER BY id LIMIT 50",
			);
			for (const row of pending) {
				abort.throwIfAborted();
				await processSignupSend(client, row.id, abort);
			}
		} finally {
			client.destroy();
		}
	});
}

/**
 * SES delivery events for signup-confirmation sends, routed by the worker
 * via `signupIntentId` (#2940). A permanent bounce or complaint on the
 * confirmation mail fails the intent and mirrors the same subscriber-level
 * protection the bulletin flow applies, so a future bulletin never treats
 * the address as healthy by accident.
 */
export async function applySignupSesEvent(
	event: SesDeliveryEvent,
): Promise<void> {
	if (event.signupIntentId === null) return;
	const separator = event.attemptId.indexOf("_");
	const token = event.attemptId.slice(separator + 1);
	if (separator < 1 || !token) return;
	const sqlTime = (value: string) => value.replace("T", " ").replace(/Z$/, "");
	const failed =
		event.type === "complaint" || (event.type === "bounce" && event.permanent);
	if (!failed) return;
	await transaction(async (connection) => {
		const intent = await txQueryOne<IntentRow>(
			connection,
			"SELECT id, email, send_token, status, ses_status, ses_attempts, subscriber_id FROM tanah_daily_bulletin_signup_intent WHERE id = ? FOR UPDATE",
			[event.signupIntentId],
		);
		if (
			!intent ||
			intent.send_token !== token ||
			intent.email.toLowerCase() !== event.email
		)
			return;
		await txExecute(
			connection,
			`UPDATE tanah_daily_bulletin_signup_intent SET status = 'failed', last_error = ?
			 WHERE id = ? AND status IN ('pending', 'sending', 'sent', 'uncertain')`,
			[
				event.type === "complaint"
					? "מייל האימות סומן כתלונה."
					: "מייל האימות נדחה על ידי שרת הדואר.",
				intent.id,
			],
		);
		// Record the provider's permanent negative signal even when no
		// subscriber row exists yet (a bounce before confirm), so the address
		// can never be treated as healthy later. A confirmed intent's
		// deliberate re-consent can still upgrade it only via a new challenge.
		// Ordering: an event stamped before the subscriber's last recorded
		// event is a late delivery about an older mail and must not downgrade
		// the newer state; an event on the current consent attempt is newer
		// than last_event_at and still applies as permanent suppression.
		await txExecute(
			connection,
			`INSERT INTO tanah_daily_bulletin_subscriber
			 (email, audience, consent_status, consent_source, last_event_at)
			 VALUES (?, ?, ?, 'ses-event:signup', ?)
			 ON DUPLICATE KEY UPDATE
			 consent_status = CASE
			     WHEN consent_status = 'complained' THEN 'complained'
			     WHEN last_event_at IS NOT NULL AND last_event_at > VALUES(last_event_at) THEN consent_status
			     ELSE VALUES(consent_status) END,
			 last_event_at = GREATEST(COALESCE(last_event_at, VALUES(last_event_at)), VALUES(last_event_at))`,
			[
				intent.email,
				SIGNUP_AUDIENCE,
				event.type === "complaint" ? "complained" : "bounced",
				sqlTime(event.timestamp),
			],
		);
	});
}
