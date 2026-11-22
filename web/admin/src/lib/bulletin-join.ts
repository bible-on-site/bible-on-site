/**
 * Admin-managed public join-link destinations (#2939).
 *
 * `/dailyBulletin/join/whatsapp` and `/dailyBulletin/join/telegram` on the website resolve to whatever a
 * bulletin admin saves here — rotating a WhatsApp invitation needs no
 * redeploy and no code change. The channel list and destination validator
 * are defined once in `web/shared/bulletin-join/`; the identical rules run
 * on the website before every redirect, so a hand-edited row can never
 * emit an open redirect.
 */
import {
	isJoinChannel,
	type JoinChannel,
	validateJoinDestination,
} from "../../../shared/bulletin-join/index";

export {
	isJoinChannel,
	JOIN_CHANNELS,
	type JoinChannel,
	validateJoinDestination,
} from "../../../shared/bulletin-join/index";

export interface JoinLinkState {
	channel: JoinChannel;
	enabled: boolean;
	destination: string | null;
	/** Optimistic-concurrency counter; an update must present the seen value. */
	revision: number;
	updatedBy: string | null;
	updatedAt: string | null;
}

export interface JoinLinkAuditEntry {
	id: number;
	channel: JoinChannel;
	enabled: boolean;
	destination: string | null;
	revision: number;
	changedBy: string | null;
	changedAt: string;
}

export interface JoinLinkChange {
	channel: JoinChannel;
	enabled: boolean;
	/** Required when `enabled`; kept (validated) or NULL when disabled. */
	destination: string | null;
	expectedRevision: number;
}

/**
 * Validates the server-function payload for updating one channel's join
 * link. Throws a Hebrew, user-facing error on invalid input (the convention
 * across the bulletin validators).
 */
export function validateJoinLinkChange(value: unknown): JoinLinkChange {
	const invalid = new Error("הגדרת קישור ההצטרפות אינה תקינה");
	if (!value || typeof value !== "object") throw invalid;
	const item = value as Record<string, unknown>;
	if (!isJoinChannel(item.channel)) throw invalid;
	if (typeof item.enabled !== "boolean") throw invalid;
	if (
		typeof item.expectedRevision !== "number" ||
		!Number.isSafeInteger(item.expectedRevision) ||
		item.expectedRevision < 0
	)
		throw invalid;
	// The destination field is free to hold a value while the channel is
	// disabled (so toggling off and back on keeps it), but whatever is stored
	// must itself be a valid join URL.
	const provided =
		typeof item.destination === "string" && item.destination.trim() !== "";
	const destination = provided
		? validateJoinDestination(item.channel, item.destination)
		: null;
	if (provided && destination === null) {
		throw new Error(
			item.channel === "whatsapp"
				? "יש להזין קישור הזמנה מלא לקבוצת הווטסאפ (chat.whatsapp.com)"
				: "יש להזין כתובת ערוץ טלגרם מלאה (t.me)",
		);
	}
	if (item.enabled && destination === null) throw invalid;
	return {
		channel: item.channel,
		enabled: item.enabled,
		destination,
		expectedRevision: item.expectedRevision,
	};
}
