import "server-only";
import { createHash, createSign, timingSafeEqual } from "node:crypto";
import { query } from "@/lib/api-client";
import { dailyPerekPayload } from "@/lib/web-push/payload";

/**
 * App push for the daily perek reminder (#1097): the device-registration
 * store behind `POST/DELETE /api/push/device` and the FCM HTTP v1 sender
 * behind `POST /api/push/device/daily`.
 *
 * A row in `tanah_push_device` is the registration record; deleting it is
 * the opt-out cleanup. Delivery itself goes to the FCM topic `daily_perek`
 * the device subscribes to — the row is bookkeeping/re-linking, not the
 * send target (see docs/app/push-notifications.md). The sender needs a
 * Google service account JSON in `FCM_SERVICE_ACCOUNT_JSON` plus the shared
 * `PUSH_SEND_SECRET`; the feature reports itself unconfigured when either
 * is missing or malformed.
 */

export interface PushDevice {
	userId: string;
	installationId: string;
	token: string;
	platform: "android" | "ios" | "other";
	topics: string[];
	appVersion: string;
}

export interface AppPushSendResult {
	sent: number;
	removed: number;
	failed: number;
}

// Firebase Installation IDs are URL-safe base64-ish (~22 chars); the client
// falls back to a 32-char hex GUID. Both fit `[A-Za-z0-9_-]`.
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
// FCM registration tokens: printable ASCII without spaces (covers the
// observed `[A-Za-z0-9_:-]` alphabet and future rotations).
const TOKEN_PATTERN = /^[\x21-\x7e]{8,1024}$/;
// FCM topic-name rules, and the per-registration cap against storage abuse.
const TOPIC_PATTERN = /^[a-zA-Z0-9\-_.~%]{1,900}$/;
const MAX_TOPICS = 32;
const PLATFORMS = new Set(["android", "ios", "other"]);
const VERSION_PATTERN = /^[\x20-\x7e]{1,64}$/;

const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const JWT_BEARER_GRANT = "urn:ietf:params:oauth:grant-type:jwt-bearer";
const DAILY_PEREK_TOPIC = "daily_perek";
// Refresh a minute early: the OAuth token nominally lives an hour.
const TOKEN_EXPIRY_MARGIN_MS = 60_000;

interface ServiceAccount {
	projectId: string;
	clientEmail: string;
	privateKey: string;
}

function serviceAccount(): ServiceAccount | null {
	const raw = process.env.FCM_SERVICE_ACCOUNT_JSON;
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		const account = {
			projectId: parsed.project_id,
			clientEmail: parsed.client_email,
			privateKey: parsed.private_key,
		};
		if (
			typeof account.projectId !== "string" ||
			!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(account.projectId) ||
			typeof account.clientEmail !== "string" ||
			!account.clientEmail.endsWith(".gserviceaccount.com") ||
			typeof account.privateKey !== "string" ||
			!account.privateKey.startsWith("-----BEGIN PRIVATE KEY-----")
		) {
			return null;
		}
		return account as ServiceAccount;
	} catch {
		return null;
	}
}

/** The registration store is armed once the service account is deployed. */
export function isDeviceRegistryConfigured(): boolean {
	return serviceAccount() !== null;
}

/** The sender additionally needs the bearer secret authorizing its route. */
export function isAppPushConfigured(): boolean {
	return serviceAccount() !== null && Boolean(process.env.PUSH_SEND_SECRET);
}

const digest = (value: string) => createHash("sha256").update(value).digest();

/**
 * Constant-time bearer check for the sender routes — same convention as
 * `POST /api/push/daily`.
 */
export function isPushSendAuthorized(request: Request): boolean {
	const header = request.headers.get("authorization") ?? "";
	const expected = `Bearer ${process.env.PUSH_SEND_SECRET}`;
	return timingSafeEqual(digest(header), digest(expected));
}

/** Validate an untrusted `POST /api/push/device` body. */
export function parseDeviceRegistration(body: unknown): PushDevice | null {
	if (typeof body !== "object" || body === null) return null;
	const { userId, installationId, token, platform, topics, appVersion } =
		body as Record<string, unknown>;
	if (typeof userId !== "string" || !ID_PATTERN.test(userId)) return null;
	if (
		typeof installationId !== "string" ||
		(installationId !== "" && !ID_PATTERN.test(installationId))
	) {
		return null;
	}
	if (!isDeviceToken(token)) return null;
	if (
		typeof platform !== "string" ||
		!PLATFORMS.has(platform as PushDevice["platform"])
	) {
		return null;
	}
	if (
		!Array.isArray(topics) ||
		topics.length > MAX_TOPICS ||
		!topics.every(
			(topic) => typeof topic === "string" && TOPIC_PATTERN.test(topic),
		)
	) {
		return null;
	}
	if (typeof appVersion !== "string" || !VERSION_PATTERN.test(appVersion)) {
		return null;
	}
	return {
		userId,
		installationId,
		token,
		platform: platform as PushDevice["platform"],
		topics,
		appVersion,
	};
}

/** The `userId` an opt-out `DELETE /api/push/device` body names. */
export function parseDeviceUserId(body: unknown): string | null {
	if (typeof body !== "object" || body === null) return null;
	const { userId } = body as Record<string, unknown>;
	return typeof userId === "string" && ID_PATTERN.test(userId) ? userId : null;
}

/** FCM registration-token shape, shared by registration and targeted sends. */
export function isDeviceToken(value: unknown): value is string {
	return typeof value === "string" && TOKEN_PATTERN.test(value);
}

/**
 * Upsert by `userId`: the row carries one current (installationId, token)
 * pair — token rotation replaces the token, a reinstall re-links a new
 * installation id to the durable identity.
 */
export async function saveDevice(device: PushDevice): Promise<void> {
	const topics = JSON.stringify(device.topics);
	await query(
		`INSERT INTO tanah_push_device (user_id, installation_id, token, platform, topics, app_version)
		 VALUES (?, ?, ?, ?, ?, ?)
		 ON DUPLICATE KEY UPDATE installation_id = ?, token = ?, platform = ?, topics = ?, app_version = ?`,
		[
			device.userId,
			device.installationId,
			device.token,
			device.platform,
			topics,
			device.appVersion,
			device.installationId,
			device.token,
			device.platform,
			topics,
			device.appVersion,
		],
	);
}

export async function deleteDevice(userId: string): Promise<void> {
	await query("DELETE FROM tanah_push_device WHERE user_id = ?", [userId]);
}

/** Drops a registration FCM reports as unregistered (stale-token cleanup). */
export async function deleteDeviceToken(token: string): Promise<void> {
	await query("DELETE FROM tanah_push_device WHERE token = ?", [token]);
}

let cachedAccessToken: { value: string; expiresAt: number } | null = null;

/**
 * Exchanges the service account for a short-lived OAuth access token:
 * RS256-signed JWT bearer grant, no client library.
 */
async function fcmAccessToken(account: ServiceAccount): Promise<string> {
	if (
		cachedAccessToken &&
		cachedAccessToken.expiresAt > Date.now() + TOKEN_EXPIRY_MARGIN_MS
	) {
		return cachedAccessToken.value;
	}
	const now = Math.floor(Date.now() / 1000);
	const encode = (part: object) =>
		Buffer.from(JSON.stringify(part)).toString("base64url");
	const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({
		iss: account.clientEmail,
		scope: FCM_SCOPE,
		aud: OAUTH_TOKEN_URL,
		iat: now,
		exp: now + 3600,
	})}`;
	const signature = createSign("RSA-SHA256")
		.update(unsigned)
		.sign(account.privateKey, "base64url");
	const response = await fetch(OAUTH_TOKEN_URL, {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: JWT_BEARER_GRANT,
			assertion: `${unsigned}.${signature}`,
		}).toString(),
	});
	if (!response.ok) {
		throw new Error(`OAuth token endpoint returned ${response.status}`);
	}
	const body = (await response.json()) as {
		access_token?: unknown;
		expires_in?: unknown;
	};
	if (
		typeof body.access_token !== "string" ||
		typeof body.expires_in !== "number"
	) {
		throw new Error("OAuth token endpoint returned a malformed body");
	}
	cachedAccessToken = {
		value: body.access_token,
		expiresAt: Date.now() + body.expires_in * 1000,
	};
	return cachedAccessToken.value;
}

/**
 * Sends today's perek to the `daily_perek` FCM topic — or to the single
 * registration `token` when given, for the controlled one-device delivery
 * check the operator runs before the daily schedule is armed. A targeted
 * token FCM reports as unregistered/invalid is deleted from the store;
 * other failures are counted without logging provider details (which echo
 * the token back).
 */
export async function sendDailyPerekToDevices(
	perekId: number,
	token?: string,
): Promise<AppPushSendResult> {
	const account = serviceAccount();
	if (!account) {
		throw new Error("FCM service account is not configured");
	}
	const accessToken = await fcmAccessToken(account);
	const payload = dailyPerekPayload(perekId);
	const response = await fetch(
		`https://fcm.googleapis.com/v1/projects/${account.projectId}/messages:send`,
		{
			method: "POST",
			headers: {
				authorization: `Bearer ${accessToken}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({
				message: {
					...(token ? { token } : { topic: DAILY_PEREK_TOPIC }),
					notification: { title: payload.title, body: payload.body },
					data: { url: payload.url, tag: payload.tag },
					android: {
						notification: { channel_id: DAILY_PEREK_TOPIC },
					},
					apns: {
						payload: {
							aps: { sound: "default", "thread-id": payload.tag },
						},
					},
				},
			}),
		},
	);
	if (response.ok) {
		return { sent: 1, removed: 0, failed: 0 };
	}
	// FCM HTTP v1 maps legacy `NotRegistered`/`InvalidRegistration` to 404
	// NOT_FOUND and 400 INVALID_ARGUMENT — a targeted token producing either
	// is dead registration data.
	if (token && (response.status === 400 || response.status === 404)) {
		await deleteDeviceToken(token);
		return { sent: 0, removed: 1, failed: 0 };
	}
	console.warn("App push delivery failed", { statusCode: response.status });
	return { sent: 0, removed: 0, failed: 1 };
}
