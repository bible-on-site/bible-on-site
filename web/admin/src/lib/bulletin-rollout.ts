/** Original-cohort gradual email rollout (#3382). Pure contracts — no server imports. */

export type EmailRolloutState = "disabled" | "running" | "paused" | "completed";
export type EmailRolloutAction = "enable" | "pause" | "resume" | "disable";
export type EmailAdmissionStatus =
	| "reserved"
	| "admitted"
	| "exhausted"
	| "lapsed";

/** The one cohort this rollout admits: the private original subscriber list. */
export const ROLLOUT_COHORT = "original";

/** Local-day admission cap bookkeeping; one committed activation per Jerusalem date. */
export const MAX_DAILY_ADMISSION_ATTEMPTS = 5;
/** Older in-flight reservations reconciled per worker sweep. */
export const MAX_STALE_RESERVATIONS = 10;

export interface EmailAdmissionRecord {
	localDate: string;
	status: EmailAdmissionStatus;
	subscriberId: number | null;
	lastError: string | null;
}

export interface EmailRolloutSummary {
	state: EmailRolloutState;
	cohort: string;
	revision: number;
	admitted: number;
	remaining: number;
	excluded: number;
	admission: EmailAdmissionRecord | null;
	lastError: string | null;
}

export interface EmailRolloutChange {
	action: EmailRolloutAction;
	revision: number;
}

const jerusalemDay = new Intl.DateTimeFormat("en-CA", {
	timeZone: "Asia/Jerusalem",
	year: "numeric",
	month: "2-digit",
	day: "2-digit",
});

/** The Asia/Jerusalem calendar day an admission is attributed to. */
export function admissionLocalDate(now = new Date()): string {
	return jerusalemDay.format(now);
}

/** Only a running rollout claims a new local-day admission. */
export function rolloutAdmits(state: EmailRolloutState | null | undefined) {
	return state === "running";
}

/**
 * The limited real-cohort delivery contract: while the rollout is anything but
 * disabled, the durable real-audience job may reach the confirmed cohort.
 * Pausing stops admissions only — already admitted subscribers keep receiving
 * ordinary bulletins. Disabling is the full rollback: no admissions and no
 * cohort delivery, with all consent history retained.
 */
export function rolloutDelivers(state: EmailRolloutState | null | undefined) {
	return state === "running" || state === "paused" || state === "completed";
}

/** Allowed operator transitions; `completed` is reached only by exhaustion. */
export function rolloutTransition(
	state: EmailRolloutState,
	action: EmailRolloutAction,
): EmailRolloutState | null {
	switch (action) {
		case "enable":
			return state === "disabled" ? "running" : null;
		case "pause":
			return state === "running" ? "paused" : null;
		case "resume":
			return state === "paused" ? "running" : null;
		case "disable":
			return "disabled";
		default:
			return null;
	}
}

export function validateRolloutChange(value: unknown): EmailRolloutChange {
	if (
		!value ||
		typeof value !== "object" ||
		!("action" in value) ||
		!("revision" in value) ||
		typeof value.revision !== "number" ||
		!Number.isSafeInteger(value.revision) ||
		value.revision < 0 ||
		(value.action !== "enable" &&
			value.action !== "pause" &&
			value.action !== "resume" &&
			value.action !== "disable")
	) {
		throw new Error("מצב ההפעלה ההדרגתית אינו תקין");
	}
	return { action: value.action, revision: value.revision };
}
