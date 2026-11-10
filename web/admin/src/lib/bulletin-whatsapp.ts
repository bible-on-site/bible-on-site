import { validateBulletinDate } from "./daily-bulletin";

export type WhatsAppAudience = "test" | "real";
export type WhatsAppJobStatus =
	| "queued"
	| "sending"
	| "accepted"
	| "sent"
	| "failed"
	| "uncertain"
	| "suppressed";

export interface WhatsAppSettings {
	audience: WhatsAppAudience;
	revision: number;
}

export interface WhatsAppReadiness {
	configured: boolean;
	canSend: boolean;
	canUseReal: boolean;
	blockers: string[];
}

/** Display-only cached metadata; group identifiers remain on the server. */
export interface WhatsAppTargetView {
	title: string;
	memberCount: number | null;
	verifiedAt: string | null;
}

export type WhatsAppConnectionState =
	| "authorized"
	| "notAuthorized"
	| "blocked"
	| "suspended"
	| "sleepMode"
	| "starting"
	| "unknown";

export interface WhatsAppVerification {
	connectionState: WhatsAppConnectionState;
	checkedAt: string | null;
	expiresAt: string | null;
}

export interface WhatsAppJobSummary {
	id: string;
	date: string;
	audience: WhatsAppAudience;
	status: WhatsAppJobStatus;
	createdAt: string;
	sentAt: string | null;
	error: string | null;
}

export interface BulletinWhatsAppState {
	settings: WhatsAppSettings;
	readiness: WhatsAppReadiness;
	testTarget: WhatsAppTargetView | null;
	realTarget: WhatsAppTargetView | null;
	verification: WhatsAppVerification;
	/** Another date can have an active job, even when this date has none. */
	audienceLocked: boolean;
	job: WhatsAppJobSummary | null;
}

export interface WhatsAppQueueRequest {
	date: string;
	requestKey: string;
	expectedAudience: WhatsAppAudience;
	expectedRevision: number;
}

export interface WhatsAppAudienceChange {
	audience: WhatsAppAudience;
	expectedRevision: number;
	confirmReal: boolean;
}

function record(
	value: unknown,
	required: string[],
	optional: string[] = [],
): Record<string, unknown> {
	if (
		!value ||
		typeof value !== "object" ||
		Array.isArray(value) ||
		(Object.getPrototypeOf(value) !== Object.prototype &&
			Object.getPrototypeOf(value) !== null) ||
		!required.every((key) => Object.hasOwn(value, key)) ||
		Reflect.ownKeys(value).some(
			(key) =>
				typeof key !== "string" || ![...required, ...optional].includes(key),
		)
	)
		throw new Error("בקשת הווטסאפ אינה תקינה");
	return value as Record<string, unknown>;
}

function audience(value: unknown): value is WhatsAppAudience {
	return value === "test" || value === "real";
}

function revision(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function validateWhatsAppQueueRequest(
	value: unknown,
): WhatsAppQueueRequest {
	const item = record(value, [
		"date",
		"requestKey",
		"expectedAudience",
		"expectedRevision",
	]);
	const date = validateBulletinDate(item.date);
	if (
		!audience(item.expectedAudience) ||
		!revision(item.expectedRevision) ||
		typeof item.requestKey !== "string" ||
		!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
			item.requestKey,
		)
	)
		throw new Error("בקשת הווטסאפ אינה תקינה");
	return {
		date,
		requestKey: item.requestKey.toLowerCase(),
		expectedAudience: item.expectedAudience,
		expectedRevision: item.expectedRevision,
	};
}

export function validateWhatsAppAudienceChange(
	value: unknown,
): WhatsAppAudienceChange {
	const item = record(value, ["audience", "expectedRevision"], ["confirmReal"]);
	if (
		!audience(item.audience) ||
		!revision(item.expectedRevision) ||
		(Object.hasOwn(item, "confirmReal") &&
			typeof item.confirmReal !== "boolean")
	)
		throw new Error("קהל השליחה בווטסאפ אינו תקין");
	if (item.audience === "real" && item.confirmReal !== true)
		throw new Error("נדרש אישור מפורש להפעלת הקבוצה הרגילה");
	return {
		audience: item.audience,
		expectedRevision: item.expectedRevision,
		confirmReal: item.confirmReal === true,
	};
}
