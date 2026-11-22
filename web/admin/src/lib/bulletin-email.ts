import type { EmailRolloutSummary } from "./bulletin-rollout";
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
	/**
	 * Whether SES engagement collection was enabled at enqueue; `null` while
	 * the engagement schema is not deployed — never conflate with a measured 0.
	 */
	tracked: boolean | null;
	/** Recipients with at least one tracked open; `null` without the schema. */
	opened: number | null;
	/** Recipients with at least one tracked content click; `null` likewise. */
	clicked: number | null;
}

export interface EmailEditionStats {
	jobId: string;
	date: string;
	/** False for editions sent before tracking was enabled — not a measured 0. */
	tracked: boolean;
	delivered: number;
	opened: number;
	clicked: number;
}

export interface InactiveSubscriber {
	id: number;
	email: string;
	firstTrackedDelivery: string;
	trackedLastYear: number;
}

export interface EmailEngagementPanel {
	editions: EmailEditionStats[];
	inactive: InactiveSubscriber[];
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
	/** Original-cohort rollout operator view; null while the schema is absent. */
	rollout: EmailRolloutSummary | null;
	/** The limited-cohort 'real' job for this date, when it differs from `job`. */
	rolloutJob: EmailJobSummary | null;
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

/**
 * Whether a tracked click destination is subscription management rather than
 * bulletin content. The SES preference page is hosted on AWS endpoints, and
 * any explicit unsubscribe path stays out of engagement either way.
 */
export function isSubscriptionManagementLink(link: string): boolean {
	let url: URL;
	try {
		url = new URL(link);
	} catch {
		return true;
	}
	if (url.protocol !== "https:" && url.protocol !== "http:") return true;
	const host = url.hostname.toLowerCase();
	if (
		host === "amazonses.com" ||
		host.endsWith(".amazonses.com") ||
		host === "amazonaws.com" ||
		host.endsWith(".amazonaws.com")
	)
		return true;
	return /unsubscribe|subscription/i.test(url.pathname);
}

export function validateInactivityUnsubscribe(value: unknown): {
	subscriberId: number;
} {
	if (
		!value ||
		typeof value !== "object" ||
		!("subscriberId" in value) ||
		typeof value.subscriberId !== "number" ||
		!Number.isSafeInteger(value.subscriberId) ||
		value.subscriberId <= 0
	)
		throw new Error("בקשת ההסרה אינה תקינה");
	return { subscriberId: value.subscriberId };
}
