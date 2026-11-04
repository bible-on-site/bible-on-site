import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { transaction, txExecute, txQueryOne } from "@/lib/api-client";
import {
	CONSENT_TEXT,
	CONSENT_VERSION,
	type ConfirmOutcome,
	isSignupSource,
	type SignupSource,
} from "./shared";

/**
 * Public daily-bulletin email signup (#2940).
 *
 * A signup writes a durable outbox row. The confirmation challenge is minted
 * only when the admin mail worker sends the confirmation mail, so this module
 * never stores a usable challenge — only its SHA-256 hash. The subscription
 * becomes real when the mailbox owner explicitly confirms, never earlier.
 */

/** How long a mailed confirmation link stays consumable. */
const CHALLENGE_TTL_HOURS = 48;
/** Confirmation-mail abuse caps; the answer stays generic either way. */
const MAX_INTENTS_PER_ADDRESS_24H = 3;
const MAX_INTENTS_GLOBAL_HOURLY = 500;
/** The public signup always joins the real audience; visitors choose nothing. */
const REAL_AUDIENCE = "real";

interface IntentRow {
	id: number;
	email: string;
	status: string;
	expired: number;
	consent_source: string;
}

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

export function isChallengeToken(value: unknown): value is string {
	return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}

/** The token itself is emitted only inside the confirmation mail. */
export function newChallengeToken(): string {
	return randomBytes(32).toString("base64url");
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
 * Records the signup intent. Always resolves the same way so callers answer
 * identically for fresh, existing, throttled or opted-out addresses — the
 * response must not enumerate subscriptions.
 *
 * Superseding live intents keeps only the newest mailed challenge usable;
 * rows are never deleted (audit + persistent throttling).
 */
export async function requestSignup(input: SignupRequest): Promise<void> {
	const emailHash = sha256(input.email);
	const consentSource = `website-signup:${input.source}`;
	await transaction(async (connection) => {
		// A new signup replaces any earlier live intent for the address.
		await txExecute(
			connection,
			`UPDATE tanah_daily_bulletin_signup_intent SET status = 'superseded'
			 WHERE email_hash = ? AND status IN ('pending','sending','sent','uncertain')`,
			[emailHash],
		);
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
		// Already-confirmed or throttled addresses are acknowledged without a
		// new challenge; the row keeps an auditable, unsendable record.
		const suppress =
			subscriber?.consent_status === "confirmed" ||
			Number(recent?.n ?? 0) >= MAX_INTENTS_PER_ADDRESS_24H ||
			Number(global?.n ?? 0) >= MAX_INTENTS_GLOBAL_HOURLY;
		await txExecute(
			connection,
			`INSERT INTO tanah_daily_bulletin_signup_intent
			 (email, email_hash, challenge_hash, status, consent_text, consent_version, consent_source, expires_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3) + INTERVAL ${CHALLENGE_TTL_HOURS} HOUR)`,
			[
				input.email,
				emailHash,
				sha256(`${randomUUID()}:${emailHash}`),
				suppress ? "suppressed" : "pending",
				CONSENT_TEXT,
				CONSENT_VERSION,
				consentSource,
			],
		);
	});
}

/**
 * Statuses whose challenge may still be consumed. `pending`/`sending`
 * cover the window between claim and mail acceptance; `uncertain` means
 * the mail's fate is unknown, so its link must keep working.
 */
const LIVE_STATUSES = new Set(["pending", "sending", "sent", "uncertain"]);

/**
 * Consumes a mailed challenge. The UPDATE inside the transaction is the only
 * path that creates the confirmed subscription — it is atomic, so replayed or
 * concurrent confirms cannot double-confirm, and a re-confirm of the same link
 * stays a successful no-op for truthful UX.
 */
export async function confirmSignup(token: string): Promise<ConfirmOutcome> {
	if (!isChallengeToken(token)) return "invalid";
	const challengeHash = sha256(token);
	return transaction(async (connection) => {
		const intent = await txQueryOne<IntentRow>(
			connection,
			`SELECT id, email, status, consent_source,
			        expires_at <= UTC_TIMESTAMP(3) AS expired
			 FROM tanah_daily_bulletin_signup_intent
			 WHERE challenge_hash = ? FOR UPDATE`,
			[challengeHash],
		);
		if (!intent) return "invalid";
		if (intent.status === "confirmed") return "confirmed";
		if (!LIVE_STATUSES.has(intent.status)) return "invalid";
		if (Number(intent.expired)) {
			await txExecute(
				connection,
				"UPDATE tanah_daily_bulletin_signup_intent SET status = 'expired' WHERE id = ?",
				[intent.id],
			);
			return "expired";
		}
		// Re-consent is only ever reached through a fresh mailed challenge, so
		// upgrading unsubscribed/bounced/complained rows is deliberate, not a
		// blind suppression clear. SES-side suppression still gates real sends.
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
			[intent.email, REAL_AUDIENCE, intent.consent_source],
		);
		const updated = await txExecute(
			connection,
			`UPDATE tanah_daily_bulletin_signup_intent
			 SET status = 'confirmed', confirmed_at = UTC_TIMESTAMP(3),
			     subscriber_id = ?, ses_status = 'pending',
			     ses_attempts = 0, ses_next_attempt_at = NULL
			 WHERE id = ?`,
			[saved.insertId, intent.id],
		);
		return updated.affectedRows === 1 ? "confirmed" : "invalid";
	});
}

/** Challenge tokens are compared by hash only; this is the lookup key. */
export function challengeHashOf(token: string): string {
	return sha256(token);
}
