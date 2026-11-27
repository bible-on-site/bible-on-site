import "server-only";
import {
	createHash,
	createSign,
	createVerify,
	timingSafeEqual,
} from "node:crypto";
import { lockedTransaction, query, txExecute, txQuery } from "@/lib/api-client";
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
	/** Pre-auth registration key an upgraded installation is replacing, when one exists. */
	legacyUserId?: string;
}

export interface VerifiedFirebaseIdentity {
	userId: string;
}

export interface AppPushSendResult {
	sent: number;
	removed: number;
	failed: number;
}

// Firebase Auth uids and Installation IDs use URL-safe alphanumeric-ish
// alphabets; legacy registration keys were 32-char hex GUIDs. All fit
// `[A-Za-z0-9_-]`.
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
// FCM registration tokens: printable ASCII without spaces (covers the
// observed `[A-Za-z0-9_:-]` alphabet and future rotations).
const TOKEN_PATTERN = /^[\x21-\x7e]{8,1024}$/;
// FCM topic-name rules, and the per-registration caps against storage abuse
// — topics serialize into a VARCHAR(1024) column, so the stored form must be
// bounded too or a valid-looking list fails the INSERT with a 503.
const TOPIC_PATTERN = /^[a-zA-Z0-9\-_.~%]{1,900}$/;
const MAX_TOPICS = 32;
const MAX_TOPICS_SERIALIZED = 1024;
const PLATFORMS = new Set(["android", "ios", "other"]);
const VERSION_PATTERN = /^[\x20-\x7e]{1,64}$/;

const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const JWT_BEARER_GRANT = "urn:ietf:params:oauth:grant-type:jwt-bearer";
const DAILY_PEREK_TOPIC = "daily_perek";
// Refresh a minute early: the OAuth token nominally lives an hour.
const TOKEN_EXPIRY_MARGIN_MS = 60_000;
// Same 12-hour ceiling as the web-push sender: a daily reminder delivered
// after its study day ends is wrong, not late — FCM/APNs would otherwise
// retain undelivered messages for weeks (device offline, Shabbat gate).
const DAILY_TTL_SECONDS = 12 * 60 * 60;

interface ServiceAccount {
	projectId: string;
	clientEmail: string;
	privateKey: string;
}

let configWarned = false;

function serviceAccount(): ServiceAccount | null {
	const raw = process.env.FCM_SERVICE_ACCOUNT_JSON;
	if (!raw) return null;
	const malformed = () => {
		// Called on every gated request — one diagnostic per process, and no
		// detail that could echo credential material into the log.
		if (!configWarned) {
			configWarned = true;
			console.warn(
				"FCM_SERVICE_ACCOUNT_JSON is malformed; app push is disabled",
			);
		}
		return null;
	};
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
			return malformed();
		}
		return account as ServiceAccount;
	} catch {
		return malformed();
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

const FIREBASE_PROJECT_ID =
	process.env.FIREBASE_PROJECT_ID ?? "tanah-al-haperek";
const FIREBASE_CERTIFICATES_URL =
	"https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";
const MAX_FIREBASE_ID_TOKEN_CHARS = 8192;
const FIREBASE_CLOCK_TOLERANCE_SECONDS = 300;

let cachedFirebaseCertificates: {
	certificates: Record<string, string>;
	expiresAt: number;
} | null = null;
let lastUnknownKidRefreshAt = 0;
// A fresh cache normally already contains every kid Google signs with. Permit
// one forced refresh per minute for the rotation edge case without letting
// bearerless requests turn random kids into unbounded outbound fetches.
const UNKNOWN_KID_REFRESH_INTERVAL_MS = 60_000;

/** The Google certificate endpoint needed for verification is unavailable. */
export class FirebaseIdentityUnavailableError extends Error {}

function cacheSeconds(cacheControl: string | null): number {
	const seconds = Number(/max-age=(\d+)/.exec(cacheControl ?? "")?.[1] ?? 0);
	return Number.isFinite(seconds) && seconds > 0 ? seconds : 3600;
}

async function fetchFirebaseCertificates(): Promise<Record<string, string>> {
	let response: Response;
	try {
		response = await fetch(FIREBASE_CERTIFICATES_URL);
	} catch {
		throw new FirebaseIdentityUnavailableError(
			"Firebase certificate endpoint is unreachable",
		);
	}
	if (!response.ok) {
		throw new FirebaseIdentityUnavailableError(
			`Firebase certificate endpoint returned ${response.status}`,
		);
	}
	let body: Record<string, unknown>;
	try {
		body = (await response.json()) as Record<string, unknown>;
	} catch {
		throw new FirebaseIdentityUnavailableError(
			"Firebase certificate endpoint returned a malformed body",
		);
	}
	if (
		typeof body !== "object" ||
		body === null ||
		!Object.values(body).every((value) => typeof value === "string")
	) {
		throw new FirebaseIdentityUnavailableError(
			"Firebase certificate endpoint returned a malformed body",
		);
	}
	cachedFirebaseCertificates = {
		certificates: body as Record<string, string>,
		expiresAt:
			Date.now() + cacheSeconds(response.headers.get("cache-control")) * 1000,
	};
	return cachedFirebaseCertificates.certificates;
}

async function firebaseCertificate(kid: string): Promise<string | null> {
	const cache = cachedFirebaseCertificates;
	if (!cache || cache.expiresAt <= Date.now()) {
		return (await fetchFirebaseCertificates())[kid] ?? null;
	}
	const cached = cache.certificates[kid];
	if (cached) return cached;
	const now = Date.now();
	if (now - lastUnknownKidRefreshAt < UNKNOWN_KID_REFRESH_INTERVAL_MS) {
		return null;
	}
	lastUnknownKidRefreshAt = now;
	return (await fetchFirebaseCertificates())[kid] ?? null;
}

function decodeJwtPart<T>(part: string): T | null {
	try {
		return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as T;
	} catch {
		return null;
	}
}

/**
 * Verifies a Firebase Auth ID token without a client library, following the
 * published securetoken contract. Returns null for an invalid token; failures
 * to reach Google's certificate endpoint throw
 * {@link FirebaseIdentityUnavailableError} so callers answer 503 rather than
 * treating a transient outage as a forged credential.
 */
export async function verifyFirebaseIdToken(
	token: string,
): Promise<VerifiedFirebaseIdentity | null> {
	if (token.length > MAX_FIREBASE_ID_TOKEN_CHARS) return null;
	const parts = token.split(".");
	if (parts.length !== 3 || parts.some((part) => part.length === 0))
		return null;
	const [encodedHeader, encodedPayload, encodedSignature] = parts;
	const header = decodeJwtPart<{ alg?: unknown; kid?: unknown }>(encodedHeader);
	const payload = decodeJwtPart<Record<string, unknown>>(encodedPayload);
	if (
		header?.alg !== "RS256" ||
		typeof header.kid !== "string" ||
		header.kid.length === 0 ||
		payload === null
	) {
		return null;
	}
	const certificate = await firebaseCertificate(header.kid);
	if (!certificate) return null;
	let signatureValid = false;
	try {
		signatureValid = createVerify("RSA-SHA256")
			.update(`${encodedHeader}.${encodedPayload}`)
			.verify(certificate, Buffer.from(encodedSignature, "base64url"));
	} catch {
		return null;
	}
	if (!signatureValid) return null;
	const now = Math.floor(Date.now() / 1000);
	const { aud, exp, iat, iss, sub } = payload;
	if (
		aud !== FIREBASE_PROJECT_ID ||
		iss !== `https://securetoken.google.com/${FIREBASE_PROJECT_ID}` ||
		typeof exp !== "number" ||
		exp + FIREBASE_CLOCK_TOLERANCE_SECONDS <= now ||
		typeof iat !== "number" ||
		iat - FIREBASE_CLOCK_TOLERANCE_SECONDS >= now ||
		typeof sub !== "string" ||
		!ID_PATTERN.test(sub)
	) {
		return null;
	}
	return { userId: sub };
}

/** Validate an untrusted `POST /api/push/device` body. */
export function parseDeviceRegistration(body: unknown): PushDevice | null {
	if (typeof body !== "object" || body === null) return null;
	const {
		userId,
		installationId,
		token,
		platform,
		topics,
		appVersion,
		legacyUserId,
	} = body as Record<string, unknown>;
	if (typeof userId !== "string" || !ID_PATTERN.test(userId)) return null;
	if (
		legacyUserId !== undefined &&
		legacyUserId !== null &&
		(typeof legacyUserId !== "string" ||
			!ID_PATTERN.test(legacyUserId) ||
			legacyUserId === userId)
	) {
		return null;
	}
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
		JSON.stringify(topics).length > MAX_TOPICS_SERIALIZED ||
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
		...(typeof legacyUserId === "string" ? { legacyUserId } : {}),
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
 * Hard bound on stored registrations (#3500): anonymous Firebase Auth
 * identities cost no account setup, so a per-IP limit alone cannot stop a
 * flood spread over many addresses.
 * Well above the real device count; upserts of an existing `userId` stay
 * allowed past the cap so re-syncs and token rotation never break — only
 * brand-new identities are refused.
 */
const MAX_STORED_DEVICES = 25_000;

/** The registration table hit its bound; only existing keys may update. */
export class DeviceStoreFullError extends Error {}

/** The verified Firebase identity does not own the stored registration row. */
export class DeviceOwnershipError extends Error {}

/** Legacy migration outcome for a verified registration upsert. */
export interface SaveDeviceResult {
	/** The unbound legacy row was removed after its verified replacement was stored. */
	legacyMigrated: boolean;
	/**
	 * A supplied legacy key was not confirmed migrated. Deliberately does not
	 * distinguish missing, auth-bound, or possession-mismatched rows: exposing
	 * that distinction would make the response a legacy-registration existence oracle.
	 */
	legacyUnresolved: boolean;
}

interface StoredDeviceOwnership {
	user_id: string;
	auth_user_id: string | null;
	installation_id?: string;
	token?: string;
}

function assertDeviceOwner(device: PushDevice, authUserId: string): void {
	if (device.userId !== authUserId) throw new DeviceOwnershipError();
}

/**
 * Upsert by `userId`, where `userId` is the verified anonymous Firebase Auth
 * identity of this installation. `installationId`/`token` are rotation
 * metadata, never credentials. A pre-auth row may be replaced only through
 * the explicit legacy-migration evidence documented in
 * docs/app/push-notifications.md. The result tells the client whether it must
 * retain its compatibility key for a possible later legacy-lane opt-out without
 * revealing whether that key names an existing row.
 */
export async function saveDevice(
	device: PushDevice,
	authUserId: string,
): Promise<SaveDeviceResult> {
	assertDeviceOwner(device, authUserId);
	const topics = JSON.stringify(device.topics);
	const params = [
		device.userId,
		authUserId,
		device.installationId,
		device.token,
		device.platform,
		topics,
		device.appVersion,
		authUserId,
		device.installationId,
		device.token,
		device.platform,
		topics,
		device.appVersion,
	];
	const upsert = `INSERT INTO tanah_push_device (user_id, auth_user_id, installation_id, token, platform, topics, app_version)
		 VALUES (?, ?, ?, ?, ?, ?, ?)
		 ON DUPLICATE KEY UPDATE auth_user_id = ?, installation_id = ?, token = ?, platform = ?, topics = ?, app_version = ?`;
	// Ownership, capacity and legacy migration are one serialized decision;
	// the lock is narrow enough for this low-volume registration surface.
	return await lockedTransaction("tanah_push_device:save", async (conn) => {
		const claimed = await txQuery<StoredDeviceOwnership>(
			conn,
			"SELECT user_id, auth_user_id FROM tanah_push_device WHERE user_id = ? FOR UPDATE",
			[device.userId],
		);
		const existing = claimed[0];
		// A null binding is the pre-auth migration state. It may be claimed
		// only when the row key itself is the verified uid; a row owned by a
		// different verified installation is immutable to this caller.
		if (
			existing &&
			existing.auth_user_id !== null &&
			existing.auth_user_id !== authUserId
		) {
			throw new DeviceOwnershipError();
		}
		const legacyRows = device.legacyUserId
			? await txQuery<StoredDeviceOwnership>(
					conn,
					"SELECT user_id, auth_user_id, installation_id, token FROM tanah_push_device WHERE user_id = ? FOR UPDATE",
					[device.legacyUserId],
				)
			: [];
		const legacy = legacyRows[0];
		const migratesLegacy = Boolean(
			legacy &&
				legacy.auth_user_id === null &&
				((legacy.installation_id !== "" &&
					legacy.installation_id === device.installationId) ||
					legacy.token === device.token),
		);
		// Migration replaces one row with another, so it remains available at
		// capacity; only an operation whose final row count increases is capped.
		if (!existing && !migratesLegacy) {
			const rows = await txQuery<{ total: number }>(
				conn,
				"SELECT COUNT(*) AS total FROM tanah_push_device",
			);
			if (Number(rows[0]?.total ?? 0) >= MAX_STORED_DEVICES) {
				throw new DeviceStoreFullError();
			}
		}
		await txExecute(conn, upsert, params);
		if (!device.legacyUserId) {
			return { legacyMigrated: false, legacyUnresolved: false };
		}
		if (!migratesLegacy) {
			return {
				legacyMigrated: false,
				legacyUnresolved: true,
			};
		}
		await txExecute(
			conn,
			"DELETE FROM tanah_push_device WHERE user_id = ? AND auth_user_id IS NULL",
			[device.legacyUserId],
		);
		return { legacyMigrated: true, legacyUnresolved: false };
	});
}

/** Authenticated opt-out: only the verified owner installation can remove its row. */
export async function deleteDevice(
	userId: string,
	authUserId: string,
): Promise<void> {
	if (userId !== authUserId) throw new DeviceOwnershipError();
	await lockedTransaction("tanah_push_device:delete", async (conn) => {
		const rows = await txQuery<StoredDeviceOwnership>(
			conn,
			"SELECT user_id, auth_user_id FROM tanah_push_device WHERE user_id = ? FOR UPDATE",
			[userId],
		);
		const existing = rows[0];
		if (
			existing &&
			existing.auth_user_id !== null &&
			existing.auth_user_id !== authUserId
		) {
			throw new DeviceOwnershipError();
		}
		await txExecute(conn, "DELETE FROM tanah_push_device WHERE user_id = ?", [
			userId,
		]);
	});
}

/**
 * Compatibility opt-out for supported pre-auth clients. Those clients cannot
 * prove possession of a row, so this deliberately cannot touch a row once it
 * is auth-bound; unbound rows are the legacy migration state only.
 */
export async function deleteLegacyDevice(userId: string): Promise<void> {
	await query(
		"DELETE FROM tanah_push_device WHERE user_id = ? AND auth_user_id IS NULL",
		[userId],
	);
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
 * Whether a failed send proves the targeted token dead. FCM HTTP v1 maps a
 * dead registration to 404 NOT_FOUND, or to 400 INVALID_ARGUMENT whose
 * `google.firebase.fcm.v1.FcmError` detail carries `UNREGISTERED`. Other
 * 400s are message-shape errors — a send failure, not dead registration
 * data, so the row must survive.
 */
async function isUnregisteredToken(response: Response): Promise<boolean> {
	if (response.status === 404) return true;
	if (response.status !== 400) return false;
	try {
		const body = (await response.json()) as {
			error?: { details?: { errorCode?: string }[] };
		};
		return (
			body.error?.details?.some(
				(detail) => detail.errorCode === "UNREGISTERED",
			) ?? false
		);
	} catch {
		return false;
	}
}

/**
 * Sends today's perek to the `daily_perek` FCM topic — or to the single
 * registration `token` when given, for the controlled one-device delivery
 * check the operator runs before the daily schedule is armed. A targeted
 * token FCM reports as unregistered is deleted from the store; other
 * failures are counted without logging provider details (which echo the
 * token back).
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
						ttl: `${DAILY_TTL_SECONDS}s`,
						notification: { channel_id: DAILY_PEREK_TOPIC },
					},
					apns: {
						headers: {
							"apns-expiration": `${Math.floor(Date.now() / 1000) + DAILY_TTL_SECONDS}`,
						},
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
	if (token && (await isUnregisteredToken(response))) {
		await deleteDeviceToken(token);
		return { sent: 0, removed: 1, failed: 0 };
	}
	console.warn("App push delivery failed", { statusCode: response.status });
	return { sent: 0, removed: 0, failed: 1 };
}
