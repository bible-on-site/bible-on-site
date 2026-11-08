/**
 * Admin-managed public join-link destinations (#2939).
 *
 * `/dailyBulletin/join/whatsapp` and `/dailyBulletin/join/telegram` on the website resolve to whatever a
 * bulletin admin saves here — rotating a WhatsApp invitation needs no
 * redeploy and no code change. The validator is deliberately narrower than
 * what the providers technically accept: a destination must be a plain
 * HTTPS URL on the provider's join host, with no credentials-in-URL, query,
 * fragment, or non-default port, and the join code/channel name in the path
 * only. The identical rules run on the website before every redirect, so a
 * hand-edited row can never emit an open redirect.
 */
export const JOIN_CHANNELS = ["telegram", "whatsapp"] as const;
export type JoinChannel = (typeof JOIN_CHANNELS)[number];

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

export function isJoinChannel(value: unknown): value is JoinChannel {
	return value === "telegram" || value === "whatsapp";
}

/**
 * Returns the normalized destination or `null` when the value is not an
 * acceptable join URL for the channel.
 */
export function validateJoinDestination(
	channel: JoinChannel,
	value: unknown,
): string | null {
	if (typeof value !== "string") return null;
	const raw = value.trim();
	if (raw.length === 0 || raw.length > 2048) return null;
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return null;
	}
	if (
		url.protocol !== "https:" ||
		url.username !== "" ||
		url.password !== "" ||
		url.port !== "" ||
		url.search !== "" ||
		url.hash !== ""
	)
		return null;
	const segments = url.pathname.split("/").filter(Boolean);
	if (channel === "whatsapp") {
		// Group invitation: https://chat.whatsapp.com/<invite-code>
		if (url.hostname !== "chat.whatsapp.com") return null;
		if (segments.length !== 1 || !/^[A-Za-z0-9]{16,160}$/.test(segments[0]))
			return null;
	}
	if (channel === "telegram") {
		// Public channel: https://t.me/<name>
		if (url.hostname !== "t.me") return null;
		if (
			segments.length !== 1 ||
			!/^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(segments[0])
		)
			return null;
	}
	return `https://${url.hostname}/${segments.join("/")}`;
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
