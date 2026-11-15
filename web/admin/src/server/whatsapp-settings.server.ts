import "@tanstack/react-start/server-only";
import { createHash, randomUUID } from "node:crypto";
import type { PoolConnection } from "mysql2/promise";
import type {
	WhatsAppAudience,
	WhatsAppConnectionState,
	WhatsAppReadiness,
	WhatsAppSettings,
	WhatsAppTargetView,
	WhatsAppVerification,
} from "~/lib/bulletin-whatsapp";
import {
	execute,
	query,
	queryOne,
	transaction,
	txExecute,
	txQuery,
	txQueryOne,
} from "./db";
import {
	type VerifiedWhatsAppTarget,
	WhatsAppClient,
	type WhatsAppClientConfig,
	WhatsAppDeferredError,
	WhatsAppError,
	WhatsAppSuppressedError,
} from "./whatsapp-client.server";

const CONFIG_ERROR = "הגדרות שירות הווטסאפ אינן תקינות";
export const WHATSAPP_DEFERRED =
	"מתבצעת בדיקת קבוצה נוספת. הבקשה נשמרה וממתינה לבדיקה.";
export const WHATSAPP_CACHE_SECONDS = 600;
const GROUP = /^[0-9]{8,30}(?:-[0-9]{8,20})?@g\.us$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const STATES = new Set<WhatsAppConnectionState>([
	"authorized",
	"notAuthorized",
	"blocked",
	"suspended",
	"sleepMode",
	"starting",
	"unknown",
]);

export interface WhatsAppRuntime extends WhatsAppClientConfig {
	testGroupId: string;
	realGroupId: string | null;
	testParticipantDigest: string;
	queueUrl: string;
	region: string;
}

/** Pure configuration loading; no provider request or database access. */
export function loadWhatsAppRuntime(): WhatsAppRuntime | null {
	const names = [
		"INSTANCE_ID",
		"API_TOKEN",
		"API_URL",
		"MEDIA_URL",
		"SENDER_PHONE",
		"TEST_GROUP_ID",
		"TEST_PARTICIPANT_DIGEST",
		"REAL_GROUP_ID",
	];
	const values = Object.fromEntries(
		names.map((name) => [
			name,
			process.env[`BULLETIN_WHATSAPP_${name}`]?.trim() ?? "",
		]),
	);
	if (Object.values(values).every((value) => !value)) return null;
	if (
		!/^\d{6,20}$/.test(values.INSTANCE_ID) ||
		!/^[A-Za-z0-9_-]{16,256}$/.test(values.API_TOKEN) ||
		!/^[1-9][0-9]{6,14}$/.test(values.SENDER_PHONE) ||
		!GROUP.test(values.TEST_GROUP_ID) ||
		!DIGEST.test(values.TEST_PARTICIPANT_DIGEST.toLowerCase()) ||
		(values.REAL_GROUP_ID &&
			(!GROUP.test(values.REAL_GROUP_ID) ||
				values.REAL_GROUP_ID === values.TEST_GROUP_ID))
	)
		throw new Error(CONFIG_ERROR);
	const region =
		process.env.BULLETIN_SES_REGION || process.env.AWS_REGION || "il-central-1";
	const account = process.env.BULLETIN_SES_ACCOUNT_ID;
	const queueUrl = process.env.BULLETIN_EMAIL_QUEUE_URL?.trim();
	if (!account || !/^\d{12}$/.test(account) || !queueUrl)
		throw new Error(CONFIG_ERROR);
	let queue: URL;
	try {
		queue = new URL(queueUrl);
	} catch {
		throw new Error(CONFIG_ERROR);
	}
	const parts = queue.pathname.split("/");
	if (
		queue.protocol !== "https:" ||
		queue.hostname !== `sqs.${region}.amazonaws.com` ||
		queue.port ||
		queue.username ||
		queue.password ||
		queue.search ||
		queue.hash ||
		parts.length !== 3 ||
		parts[1] !== account ||
		!/^[A-Za-z0-9_-]+$/.test(parts[2] ?? "")
	)
		throw new Error(CONFIG_ERROR);
	const runtime: WhatsAppRuntime = {
		instanceId: values.INSTANCE_ID,
		apiToken: values.API_TOKEN,
		apiUrl: values.API_URL,
		mediaUrl: values.MEDIA_URL,
		expectedSenderPhone: values.SENDER_PHONE,
		testGroupId: values.TEST_GROUP_ID,
		realGroupId: values.REAL_GROUP_ID || null,
		testParticipantDigest: values.TEST_PARTICIPANT_DIGEST.toLowerCase(),
		queueUrl,
		region,
	};
	// Constructor validation rejects untrusted provider origins without making HTTP calls.
	new WhatsAppClient(runtime);
	return runtime;
}

export function targetGroupId(
	runtime: WhatsAppRuntime,
	audience: WhatsAppAudience,
): string {
	const group = audience === "test" ? runtime.testGroupId : runtime.realGroupId;
	if (!group) throw new WhatsAppSuppressedError();
	return group;
}

/** No token or token hash is persisted; sends always verify the live account again. */
export function whatsAppConfigDigest(
	runtime: WhatsAppRuntime,
	audience: WhatsAppAudience,
): string {
	return createHash("sha256")
		.update(
			JSON.stringify([
				runtime.instanceId,
				runtime.apiUrl,
				runtime.mediaUrl,
				runtime.expectedSenderPhone,
				targetGroupId(runtime, audience),
				audience === "test" ? runtime.testParticipantDigest : null,
			]),
		)
		.digest("hex");
}

export function settingsFromRow(
	row: { audience: string; revision: string | number } | null,
): WhatsAppSettings {
	const revision = Number(row?.revision);
	if (
		!row ||
		(row.audience !== "test" && row.audience !== "real") ||
		!Number.isSafeInteger(revision) ||
		revision < 0
	)
		throw new Error("הגדרות הווטסאפ טרם נוצרו");
	return { audience: row.audience, revision };
}

export async function readWhatsAppSettings(): Promise<WhatsAppSettings> {
	return settingsFromRow(
		await queryOne<{ audience: string; revision: number }>(
			"SELECT audience, revision FROM tanah_daily_bulletin_whatsapp_settings WHERE id = 1",
		),
	);
}

export interface CachedWhatsAppTarget {
	audience: WhatsAppAudience;
	config_sha256: string;
	verified: number | boolean;
	connection_state: WhatsAppConnectionState;
	group_id: string | null;
	title: string | null;
	member_count: number | null;
	sender_id: string | null;
	sender_phone: string | null;
	participant_digest: string | null;
	checked_at: string;
	expires_at: string;
}
export interface WhatsAppTargets {
	test: CachedWhatsAppTarget | null;
	real: CachedWhatsAppTarget | null;
}

export async function readWhatsAppTargets(
	runtime: WhatsAppRuntime,
	connection?: PoolConnection,
): Promise<WhatsAppTargets> {
	const sql =
		"SELECT audience, config_sha256, verified, connection_state, group_id, title, member_count, sender_id, sender_phone, participant_digest, DATE_FORMAT(checked_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS checked_at, DATE_FORMAT(expires_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS expires_at FROM tanah_daily_bulletin_whatsapp_verification ORDER BY audience";
	const rows = connection
		? await txQuery<CachedWhatsAppTarget>(connection, `${sql} FOR UPDATE`)
		: await query<CachedWhatsAppTarget>(sql);
	const targets: WhatsAppTargets = { test: null, real: null };
	for (const row of rows) {
		if (row.audience !== "test" && row.audience !== "real") continue;
		if (row.audience === "real" && !runtime.realGroupId) continue;
		if (row.config_sha256 === whatsAppConfigDigest(runtime, row.audience))
			targets[row.audience] = row;
	}
	return targets;
}

export function usableWhatsAppTarget(
	runtime: WhatsAppRuntime,
	audience: WhatsAppAudience,
	row: CachedWhatsAppTarget | null,
	now = Date.now(),
): row is CachedWhatsAppTarget & {
	group_id: string;
	title: string;
	sender_id: string;
	sender_phone: string;
	participant_digest: string;
} {
	return (
		!!row &&
		Number(row.verified) === 1 &&
		row.connection_state === "authorized" &&
		row.config_sha256 === whatsAppConfigDigest(runtime, audience) &&
		row.group_id === targetGroupId(runtime, audience) &&
		typeof row.title === "string" &&
		row.title.trim().length > 0 &&
		row.title.length <= 255 &&
		typeof row.sender_id === "string" &&
		row.sender_id.length > 0 &&
		row.sender_phone === runtime.expectedSenderPhone &&
		typeof row.participant_digest === "string" &&
		DIGEST.test(row.participant_digest) &&
		Number.isSafeInteger(Number(row.member_count)) &&
		Number(row.member_count) > 0 &&
		Number.isFinite(Date.parse(row.checked_at)) &&
		Date.parse(row.checked_at) <= now + 30_000 &&
		Date.parse(row.expires_at) > now &&
		(audience !== "test" ||
			(Number(row.member_count) <= 2 &&
				row.participant_digest === runtime.testParticipantDigest))
	);
}

export function whatsAppVerification(
	targets: WhatsAppTargets,
): WhatsAppVerification {
	const latest = [targets.test, targets.real]
		.filter((row): row is CachedWhatsAppTarget => row !== null)
		.sort(
			(left, right) =>
				Date.parse(right.checked_at) - Date.parse(left.checked_at),
		)[0];
	return latest
		? {
				connectionState: STATES.has(latest.connection_state)
					? latest.connection_state
					: "unknown",
				checkedAt: Number.isFinite(Date.parse(latest.checked_at))
					? latest.checked_at
					: null,
				expiresAt: Number.isFinite(Date.parse(latest.expires_at))
					? latest.expires_at
					: null,
			}
		: { connectionState: "unknown", checkedAt: null, expiresAt: null };
}

export function whatsAppReadiness(
	runtime: WhatsAppRuntime,
	targets: WhatsAppTargets,
	audience: WhatsAppAudience,
): WhatsAppReadiness {
	const connection = whatsAppVerification(targets);
	const connected =
		connection.connectionState === "authorized" &&
		Date.parse(connection.expiresAt ?? "") > Date.now();
	const ready = (value: WhatsAppAudience) =>
		connected &&
		(value === "test" || runtime.realGroupId !== null) &&
		usableWhatsAppTarget(runtime, value, targets[value]);
	return {
		configured: true,
		canSend: ready(audience),
		canUseReal: ready("real"),
		blockers: ready(audience)
			? []
			: [
					audience === "real" && !runtime.realGroupId
						? "הקבוצה הרגילה טרם הוגדרה"
						: "יש לאמת את החיבור ואת הקבוצה לפני השליחה",
				],
	};
}

export function whatsAppTargetView(
	row: CachedWhatsAppTarget | null,
): WhatsAppTargetView | null {
	return row?.title
		? {
				title: row.title,
				memberCount: Number.isSafeInteger(Number(row.member_count))
					? Number(row.member_count)
					: null,
				verifiedAt: Number(row.verified) === 1 ? row.checked_at : null,
			}
		: null;
}

/** One database-backed lease covers every app replica and every group lookup. */
export async function reserveWhatsAppGroupLookup(
	signal: AbortSignal,
): Promise<() => Promise<void>> {
	signal.throwIfAborted();
	const token = randomUUID();
	await transaction(async (connection) => {
		const slot = await txQueryOne<{
			audience: string;
			revision: number;
			busy: number;
		}>(
			connection,
			"SELECT audience, revision, (group_lookup_until > UTC_TIMESTAMP(3) OR next_group_lookup_at > UTC_TIMESTAMP(3)) AS busy FROM tanah_daily_bulletin_whatsapp_settings WHERE id = 1 FOR UPDATE",
		);
		settingsFromRow(slot);
		if (Number(slot?.busy) === 1) throw new WhatsAppDeferredError();
		signal.throwIfAborted();
		await txExecute(
			connection,
			"UPDATE tanah_daily_bulletin_whatsapp_settings SET group_lookup_token = ?, group_lookup_until = TIMESTAMPADD(SECOND, 20, UTC_TIMESTAMP(3)), next_group_lookup_at = TIMESTAMPADD(SECOND, 1, UTC_TIMESTAMP(3)) WHERE id = 1",
			[token],
		);
	});
	let released = false;
	return async () => {
		if (released) return;
		released = true;
		await execute(
			"UPDATE tanah_daily_bulletin_whatsapp_settings SET group_lookup_token = NULL, group_lookup_until = NULL, next_group_lookup_at = GREATEST(next_group_lookup_at, TIMESTAMPADD(SECOND, 1, UTC_TIMESTAMP(3))) WHERE id = 1 AND group_lookup_token = ?",
			[token],
		);
	};
}

export async function verifyWhatsAppTarget(
	runtime: WhatsAppRuntime,
	audience: WhatsAppAudience,
): Promise<VerifiedWhatsAppTarget> {
	const groupId = targetGroupId(runtime, audience);
	const configDigest = whatsAppConfigDigest(runtime, audience);
	try {
		const result = await new WhatsAppClient(runtime).verifyTarget({
			groupId,
			audience,
			expectedParticipantDigest:
				audience === "test" ? runtime.testParticipantDigest : undefined,
			beforeGroupData: reserveWhatsAppGroupLookup,
		});
		await execute(
			"INSERT INTO tanah_daily_bulletin_whatsapp_verification (audience, config_sha256, verified, connection_state, group_id, title, member_count, sender_id, sender_phone, participant_digest, checked_at, expires_at) VALUES (?, ?, TRUE, 'authorized', ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3), TIMESTAMPADD(SECOND, ?, UTC_TIMESTAMP(3))) ON DUPLICATE KEY UPDATE config_sha256 = VALUES(config_sha256), verified = TRUE, connection_state = 'authorized', group_id = VALUES(group_id), title = VALUES(title), member_count = VALUES(member_count), sender_id = VALUES(sender_id), sender_phone = VALUES(sender_phone), participant_digest = VALUES(participant_digest), checked_at = VALUES(checked_at), expires_at = VALUES(expires_at)",
			[
				audience,
				configDigest,
				result.groupId,
				result.title,
				result.size,
				result.senderId,
				result.senderPhone,
				result.participantDigest,
				WHATSAPP_CACHE_SECONDS,
			],
		);
		return result;
	} catch (error) {
		if (error instanceof WhatsAppDeferredError) throw error;
		const state =
			error instanceof WhatsAppError &&
			error.connectionState &&
			STATES.has(error.connectionState)
				? error.connectionState
				: "unknown";
		await execute(
			"INSERT INTO tanah_daily_bulletin_whatsapp_verification (audience, config_sha256, verified, connection_state, checked_at, expires_at) VALUES (?, ?, FALSE, ?, UTC_TIMESTAMP(3), TIMESTAMPADD(SECOND, ?, UTC_TIMESTAMP(3))) ON DUPLICATE KEY UPDATE config_sha256 = VALUES(config_sha256), verified = FALSE, connection_state = VALUES(connection_state), group_id = NULL, title = NULL, member_count = NULL, sender_id = NULL, sender_phone = NULL, participant_digest = NULL, checked_at = VALUES(checked_at), expires_at = VALUES(expires_at)",
			[audience, configDigest, state, WHATSAPP_CACHE_SECONDS],
		);
		throw error;
	}
}
