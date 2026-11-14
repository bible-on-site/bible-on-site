import { validateBulletinDate } from "./daily-bulletin";

export type TelegramAudience = "test" | "real";
export type TelegramJobStatus =
	| "queued"
	| "sending"
	| "sent"
	| "failed"
	| "uncertain"
	| "suppressed";

export interface TelegramSettings {
	audience: TelegramAudience;
	revision: number;
}

export interface TelegramReadiness {
	configured: boolean;
	canSend: boolean;
	canUseReal: boolean;
	blockers: string[];
}

export interface TelegramTargetView {
	title: string;
	username: string | null;
}

export interface TelegramJobSummary {
	id: string;
	date: string;
	audience: TelegramAudience;
	status: TelegramJobStatus;
	createdAt: string;
	sentAt: string | null;
	error: string | null;
}

export interface BulletinTelegramState {
	settings: TelegramSettings;
	readiness: TelegramReadiness;
	testTarget: TelegramTargetView | null;
	realTarget: TelegramTargetView | null;
	job: TelegramJobSummary | null;
}

export interface TelegramQueueRequest {
	date: string;
	requestKey: string;
	expectedAudience: TelegramAudience;
	expectedRevision: number;
}

export interface TelegramAudienceChange {
	audience: TelegramAudience;
	expectedRevision: number;
	confirmReal: boolean;
}

function record(value: unknown, keys: string[]): Record<string, unknown> {
	if (
		!value ||
		typeof value !== "object" ||
		Array.isArray(value) ||
		Object.keys(value).some((key) => !keys.includes(key))
	)
		throw new Error("בקשת הטלגרם אינה תקינה");
	return value as Record<string, unknown>;
}

function audience(value: unknown): value is TelegramAudience {
	return value === "test" || value === "real";
}

function revision(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function validateTelegramQueueRequest(
	value: unknown,
): TelegramQueueRequest {
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
		throw new Error("בקשת הטלגרם אינה תקינה");
	return {
		date,
		requestKey: item.requestKey.toLowerCase(),
		expectedAudience: item.expectedAudience,
		expectedRevision: item.expectedRevision,
	};
}

export function validateTelegramAudienceChange(
	value: unknown,
): TelegramAudienceChange {
	const item = record(value, ["audience", "expectedRevision", "confirmReal"]);
	if (
		!audience(item.audience) ||
		!revision(item.expectedRevision) ||
		("confirmReal" in item && typeof item.confirmReal !== "boolean")
	)
		throw new Error("מצב השליחה בטלגרם אינו תקין");
	if (item.audience === "real" && item.confirmReal !== true)
		throw new Error("נדרש אישור מפורש להפעלת הערוץ הציבורי");
	return {
		audience: item.audience,
		expectedRevision: item.expectedRevision,
		confirmReal: item.confirmReal === true,
	};
}
