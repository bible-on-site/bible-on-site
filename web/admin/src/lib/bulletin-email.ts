import { validateBulletinDate } from "./daily-bulletin";

export type EmailAudience = "test" | "real";
export type EmailJobStatus =
	| "queued"
	| "sending"
	| "accepted"
	| "delivered"
	| "failed"
	| "uncertain"
	| "suppressed";

export interface EmailJobSummary {
	id: string;
	date: string;
	audience: EmailAudience;
	status: EmailJobStatus;
	counts: Record<string, number>;
	createdAt: string;
}

export interface EmailReadiness {
	configured: boolean;
	canSend: boolean;
	canUseReal: boolean;
	blockers: string[];
}

export interface EmailAudienceSettings {
	audience: EmailAudience;
	revision: number;
}

export interface SubscriberChange {
	email: string;
	audience: EmailAudience;
	action: "confirm" | "unsubscribe";
	source: string;
}

export interface BulletinEmailState {
	settings: EmailAudienceSettings;
	readiness: EmailReadiness;
	testRecipients: string[];
	realRecipients: number;
	unverifiedRecipients: number;
	job: EmailJobSummary | null;
}

export function validateAudienceChange(
	value: unknown,
): EmailAudienceSettings & { confirmReal: boolean } {
	if (
		!value ||
		typeof value !== "object" ||
		!("audience" in value) ||
		(value.audience !== "test" && value.audience !== "real") ||
		!("revision" in value) ||
		typeof value.revision !== "number" ||
		!Number.isSafeInteger(value.revision) ||
		value.revision < 0
	) {
		throw new Error("מצב השליחה אינו תקין");
	}
	const confirmReal = "confirmReal" in value && value.confirmReal === true;
	if (value.audience === "real" && !confirmReal)
		throw new Error("נדרש אישור מפורש להפעלת רשימת המנויים");
	return { audience: value.audience, revision: value.revision, confirmReal };
}

export function validateEmailQueueRequest(
	value: unknown,
): EmailAudienceSettings & { date: string; requestKey: string } {
	if (!value || typeof value !== "object")
		throw new Error("בקשת השליחה אינה תקינה");
	const item = value as Record<string, unknown>;
	const date = validateBulletinDate(item.date);
	if (
		(item.audience !== "test" && item.audience !== "real") ||
		typeof item.revision !== "number" ||
		!Number.isSafeInteger(item.revision) ||
		item.revision < 0 ||
		typeof item.requestKey !== "string" ||
		!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
			item.requestKey,
		)
	)
		throw new Error("בקשת השליחה אינה תקינה");
	return {
		date,
		requestKey: item.requestKey,
		audience: item.audience,
		revision: item.revision,
	};
}

export function validateSubscriberChange(value: unknown): SubscriberChange {
	if (!value || typeof value !== "object")
		throw new Error("פרטי המנוי אינם תקינים");
	const record = value as Record<string, unknown>;
	const email =
		typeof record.email === "string" ? record.email.trim().toLowerCase() : "";
	if (
		email.length > 254 ||
		!/^[\x21-\x7e]+$/.test(email) ||
		/[<>(),;:"]/.test(email) ||
		!/^[^@]+@[^@]+\.[^@]+$/.test(email) ||
		(record.audience !== "test" && record.audience !== "real") ||
		(record.action !== "confirm" && record.action !== "unsubscribe")
	)
		throw new Error("פרטי המנוי אינם תקינים");
	const source = typeof record.source === "string" ? record.source.trim() : "";
	if (
		record.action === "confirm" &&
		(source.length < 10 || source.length > 120)
	)
		throw new Error("יש לציין את מקור ההסכמה המפורשת");
	return { email, audience: record.audience, action: record.action, source };
}
