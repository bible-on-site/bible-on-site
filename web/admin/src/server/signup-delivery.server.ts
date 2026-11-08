import "@tanstack/react-start/server-only";
import { execute, query } from "./db";
import { runOutboxSweep } from "./outbox-deadline.server";
import { SesClient } from "./ses-client.server";
import { loadEmailRuntime } from "./ses-settings.server";

/**
 * Public email-signup outbox (#2940).
 *
 * Signup is a direct subscription: the website confirms the subscriber row
 * inside the signup transaction and writes a durable `signup_intent` row.
 * This worker synchronizes confirmed signups into the SES contact list,
 * retrying through `ses_status`/`ses_attempts`. It never enqueues a
 * bulletin, never touches the send audience, and never sends mail itself —
 * the only outbound effect is the contact-list subscription write.
 */

const MAX_SES_SYNC_ATTEMPTS = 5;
const SIGNUP_AUDIENCE = "real";
/** Retires intents left in-flight by the removed confirmation-mail flow. */
const LEGACY_CANCELLED = "בוטל עם מעבר להרשמה ישירה ללא מייל אימות.";

interface IntentRow {
	id: number;
	email: string;
}

/**
 * Synchronizes one confirmed signup into the SES contact list. Preserves
 * unrelated topics; the outcome is re-verified and persisted on the intent.
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
 * 30-second reconcile block. Legacy in-flight confirmation intents are
 * retired first, then confirmed intents pending an SES sync are claimed.
 */
export async function reconcileSignupOutbox(
	signal?: AbortSignal,
): Promise<void> {
	await runOutboxSweep(signal, async (abort) => {
		await execute(
			`UPDATE tanah_daily_bulletin_signup_intent
			 SET status = 'failed', last_error = ?
			 WHERE status IN ('pending', 'sending', 'sent', 'uncertain')`,
			[LEGACY_CANCELLED],
		);
		const runtime = await loadEmailRuntime();
		if (!runtime) return;
		const client = new SesClient(runtime);
		try {
			const syncRows = await query<IntentRow>(
				`SELECT id, email
				 FROM tanah_daily_bulletin_signup_intent
				 WHERE status = 'confirmed' AND ses_status = 'pending' AND ses_attempts < ${MAX_SES_SYNC_ATTEMPTS}
				 AND (ses_next_attempt_at IS NULL OR ses_next_attempt_at <= UTC_TIMESTAMP(3))
				 ORDER BY id LIMIT 50`,
			);
			for (const row of syncRows) {
				abort.throwIfAborted();
				await syncSignupSubscriber(client, row);
			}
		} finally {
			client.destroy();
		}
	});
}
