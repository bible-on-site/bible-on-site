import "server-only";
import { createHash } from "node:crypto";
import webpush, { WebPushError } from "web-push";
import { getPerekByPerekId } from "@/data/perek-dto";
import { query } from "@/lib/api-client";

/**
 * Web Push for the daily perek reminder (#1096).
 *
 * A row in `tanah_web_push_subscription` is the opt-in; deleting it is the
 * opt-out. VAPID keys and the sender secret come from the runtime
 * environment, and the feature reports itself unconfigured when any is unset.
 */

export interface WebPushSubscription {
	endpoint: string;
	keys: { p256dh: string; auth: string };
}

export interface DailySendResult {
	sent: number;
	removed: number;
	failed: number;
}

// The server POSTs to stored endpoints, so only known browser push services are
// accepted (Chrome/Edge-Chromium/Opera/Samsung via FCM, Firefox, Edge on
// Windows, Safari) — never an arbitrary URL.
// Chrome on desktop currently issues jmt17.google.com/fcm/send/... endpoints.
const PUSH_SERVICE_HOST =
	/^(?:fcm\.googleapis\.com|android\.googleapis\.com|jmt\d+\.google\.com|updates\.push\.services\.mozilla\.com|[a-z0-9-]+\.notify\.windows\.com|web\.push\.apple\.com)$/;
const MAX_ENDPOINT_LENGTH = 1024;
const SEND_BATCH_SIZE = 50;
const DAILY_TTL_SECONDS = 12 * 60 * 60;

export function getVapidPublicKey(): string | null {
	return process.env.VAPID_PUBLIC_KEY || null;
}

function isBase64Url(value: unknown, maxLength: number): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		value.length <= maxLength &&
		// Browsers emit canonical unpadded base64url; a round trip rejects anything else.
		Buffer.from(value, "base64url").toString("base64url") === value
	);
}

export function isPushServiceEndpoint(value: unknown): value is string {
	if (typeof value !== "string" || value.length > MAX_ENDPOINT_LENGTH)
		return false;
	try {
		const url = new URL(value);
		return url.protocol === "https:" && PUSH_SERVICE_HOST.test(url.hostname);
	} catch {
		return false;
	}
}

/** Validate an untrusted `PushSubscription.toJSON()` body. */
export function parseSubscription(body: unknown): WebPushSubscription | null {
	if (typeof body !== "object" || body === null) return null;
	const { endpoint, keys } = body as Record<string, unknown>;
	if (!isPushServiceEndpoint(endpoint)) return null;
	if (typeof keys !== "object" || keys === null) return null;
	const { p256dh, auth } = keys as Record<string, unknown>;
	if (!isBase64Url(p256dh, 255) || !isBase64Url(auth, 64)) return null;
	return { endpoint, keys: { p256dh, auth } };
}

const endpointHash = (endpoint: string) =>
	createHash("sha256").update(endpoint).digest("hex");

export async function saveSubscription(
	subscription: WebPushSubscription,
): Promise<void> {
	const { endpoint, keys } = subscription;
	await query(
		`INSERT INTO tanah_web_push_subscription (endpoint_hash, endpoint, p256dh, auth)
		 VALUES (?, ?, ?, ?)
		 ON DUPLICATE KEY UPDATE p256dh = ?, auth = ?`,
		[
			endpointHash(endpoint),
			endpoint,
			keys.p256dh,
			keys.auth,
			keys.p256dh,
			keys.auth,
		],
	);
}

export async function deleteSubscription(endpoint: string): Promise<void> {
	await query(
		"DELETE FROM tanah_web_push_subscription WHERE endpoint_hash = ?",
		[endpointHash(endpoint)],
	);
}

/** Notification payload the service worker (`public/sw.js`) renders. */
export function dailyPerekPayload(perekId: number) {
	return {
		title: 'הפרק היומי - תנ"ך על הפרק',
		body: `הפרק של היום: ${getPerekByPerekId(perekId).source}`,
		url: `/929/${perekId}`,
		tag: "daily-perek",
	};
}

/**
 * Send today's perek to every stored subscription. Subscriptions the push
 * service reports as gone (404/410) are deleted; other failures are logged and
 * counted so one bad endpoint never blocks the rest.
 */
export async function sendDailyPerek(
	perekId: number,
): Promise<DailySendResult> {
	webpush.setVapidDetails(
		process.env.VAPID_SUBJECT as string,
		process.env.VAPID_PUBLIC_KEY as string,
		process.env.VAPID_PRIVATE_KEY as string,
	);
	const payload = JSON.stringify(dailyPerekPayload(perekId));
	const rows = await query<{ endpoint: string; p256dh: string; auth: string }>(
		"SELECT endpoint, p256dh, auth FROM tanah_web_push_subscription",
	);
	const result: DailySendResult = { sent: 0, removed: 0, failed: 0 };
	for (let i = 0; i < rows.length; i += SEND_BATCH_SIZE) {
		await Promise.all(
			rows.slice(i, i + SEND_BATCH_SIZE).map(async (row) => {
				try {
					await webpush.sendNotification(
						{
							endpoint: row.endpoint,
							keys: { p256dh: row.p256dh, auth: row.auth },
						},
						payload,
						{ TTL: DAILY_TTL_SECONDS, topic: "daily-perek", urgency: "normal" },
					);
					result.sent++;
				} catch (error) {
					if (
						error instanceof WebPushError &&
						(error.statusCode === 404 || error.statusCode === 410)
					) {
						await deleteSubscription(row.endpoint);
						result.removed++;
						return;
					}
					console.warn("Web push delivery failed", error);
					result.failed++;
				}
			}),
		);
	}
	return result;
}

export function isWebPushConfigured(): boolean {
	return Boolean(
		process.env.VAPID_PUBLIC_KEY &&
			process.env.VAPID_PRIVATE_KEY &&
			process.env.VAPID_SUBJECT &&
			process.env.PUSH_SEND_SECRET,
	);
}
