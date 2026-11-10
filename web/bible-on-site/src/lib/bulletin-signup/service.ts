import "server-only";
import { createHash } from "node:crypto";
import {
	lockedTransaction,
	txExecute,
	txQueryOne,
} from "@/lib/api-client";
import {
	CONSENT_TEXT,
	CONSENT_VERSION,
	isSignupSource,
	type SignupSource,
} from "./shared";

/**
 * Public daily-bulletin email signup (#2940).
 *
 * A signup is a direct subscription: the explicit consent checkbox on the
 * form is the consent basis, so the subscriber row is confirmed inside the
 * same transaction that records the durable intent. The admin outbox worker
 * then synchronizes confirmed intents into the SES contact list — the
 * intent row doubles as the retry record (`ses_status`/`ses_attempts`).
 */

/** Confirmation-mail abuse caps are gone; these bound repeat signups. */
const MAX_INTENTS_PER_ADDRESS_24H = 3;
const MAX_INTENTS_GLOBAL_HOURLY = 500;
/** The public signup always joins the real audience; visitors choose nothing. */
const REAL_AUDIENCE = "real";

const sha256 = (value: string) =>
	createHash("sha256").update(value).digest("hex");

/** Same address grammar as the SES client: printable, single @, dotted domain. */
export function normalizeEmail(value: unknown): string | null {
	if (
		typeof value !== "string" ||
		value.length > 254 ||
		!/^[\x21-\x7e]+$/.test(value) ||
		/[<>(),;:"]/.test(value) ||
		!/^[^@]+@[^@]+\.[^@]+$/.test(value)
	)
		return null;
	return value.toLowerCase();
}

export interface SignupRequest {
	email: string;
	source: SignupSource;
}

/**
 * Bounded, validated signup input. Explicit consent is part of the contract:
 * the UI checkbox maps to `consent: true` and anything else is rejected.
 */
export function parseSignupBody(body: unknown): SignupRequest | null {
	if (typeof body !== "object" || body === null) return null;
	const { email, consent, source } = body as Record<string, unknown>;
	const normalized = normalizeEmail(email);
	if (normalized === null || consent !== true || !isSignupSource(source))
		return null;
	return { email: normalized, source };
}

/**
 * Records the signup and confirms the subscription in one transaction.
 * Always resolves the same way so callers answer identically for fresh,
 * existing, throttled or opted-out addresses — the response must not
 * enumerate subscriptions.
 *
 * Rows are never deleted (audit + persistent throttling). A repeat signup
 * for an already-confirmed address, or one past the abuse caps, is recorded
 * as `suppressed` and changes nothing else. An address whose subscriber
 * recorded an opt-out or provider suppression (`unsubscribed`/`bounced`/
 * `complained`) is likewise only recorded: an anonymous form tick is not
 * mailbox proof, so re-consent after an opt-out stays with the recipient —
 * the SES preference page reports it back as a subscription event.
 * `pending` rows have never confirmed or opted out, so the explicit consent
 * box still confirms them; SES-side suppression gates real sends either way.
 */
export async function requestSignup(input: SignupRequest): Promise<void> {
	const emailHash = sha256(input.email);
	const consentSource = `website-signup:${input.source}`;
	// Serialize per normalized address: without the lock two concurrent
	// signups can both read "no subscriber" and each record a confirmed
	// intent, duplicating the SES sync and consent audit for one address.
	await lockedTransaction(
		`bulletin-signup:${emailHash.slice(0, 40)}`,
		async (connection) => {
			const subscriber = await txQueryOne<{ consent_status: string }>(
				connection,
				"SELECT consent_status FROM tanah_daily_bulletin_subscriber WHERE email = ? AND audience = ?",
				[input.email, REAL_AUDIENCE],
			);
			const recent = await txQueryOne<{ n: number | string }>(
				connection,
				`SELECT COUNT(*) AS n FROM tanah_daily_bulletin_signup_intent
				 WHERE email_hash = ? AND created_at > UTC_TIMESTAMP(3) - INTERVAL 1 DAY`,
				[emailHash],
			);
			const global = await txQueryOne<{ n: number | string }>(
				connection,
				`SELECT COUNT(*) AS n FROM tanah_daily_bulletin_signup_intent
				 WHERE created_at > UTC_TIMESTAMP(3) - INTERVAL 1 HOUR`,
			);
			const suppress =
				subscriber?.consent_status === "confirmed" ||
				["unsubscribed", "bounced", "complained"].includes(
					subscriber?.consent_status ?? "",
				) ||
				Number(recent?.n ?? 0) >= MAX_INTENTS_PER_ADDRESS_24H ||
				Number(global?.n ?? 0) >= MAX_INTENTS_GLOBAL_HOURLY;
			if (suppress) {
				await txExecute(
					connection,
					`INSERT INTO tanah_daily_bulletin_signup_intent
					 (email, email_hash, status, consent_text, consent_version, consent_source)
					 VALUES (?, ?, 'suppressed', ?, ?, ?)`,
					[input.email, emailHash, CONSENT_TEXT, CONSENT_VERSION, consentSource],
				);
				return;
			}
			const saved = await txExecute(
				connection,
				`INSERT INTO tanah_daily_bulletin_subscriber
				 (email, audience, consent_status, consent_source, consented_at, last_event_at)
				 VALUES (?, ?, 'confirmed', ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))
				 ON DUPLICATE KEY UPDATE
				 consent_status = 'confirmed',
				 consent_source = VALUES(consent_source),
				 consented_at = UTC_TIMESTAMP(3),
				 last_event_at = UTC_TIMESTAMP(3),
				 id = LAST_INSERT_ID(id)`,
				[input.email, REAL_AUDIENCE, consentSource],
			);
			await txExecute(
				connection,
				`INSERT INTO tanah_daily_bulletin_signup_intent
				 (email, email_hash, status, consent_text, consent_version, consent_source, ses_status, subscriber_id)
				 VALUES (?, ?, 'confirmed', ?, ?, ?, 'pending', ?)`,
				[
					input.email,
					emailHash,
					CONSENT_TEXT,
					CONSENT_VERSION,
					consentSource,
					saved.insertId,
				],
			);
		},
	);
}
