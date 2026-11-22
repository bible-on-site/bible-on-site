/**
 * Daily-bulletin join-link channel and destination contract (#2939) — the
 * single definition both consumers import (#3710).
 *
 * `/dailyBulletin/join/whatsapp` and `/dailyBulletin/join/telegram` on the
 * website resolve to whatever a bulletin admin saves — rotating a WhatsApp
 * invitation needs no redeploy and no code change. The same validator runs
 * at both trust boundaries: on save in the admin console and on read
 * before every redirect on the website, so a hand-edited row can never
 * emit an open redirect.
 *
 * The rules are deliberately narrower than what the providers technically
 * accept: a destination must be a plain HTTPS URL on the provider's join
 * host, with no credentials-in-URL, query, fragment, or non-default port,
 * and the join code/channel name in the path only.
 *
 * Side ownership stays local: the admin keeps its server-function payload
 * validation (`validateJoinLinkChange` — Hebrew editor-facing errors) and
 * the website keeps `resolveJoinDestination` (the DB read).
 */
export const JOIN_CHANNELS = ["telegram", "whatsapp"] as const;
export type JoinChannel = (typeof JOIN_CHANNELS)[number];

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
		// The user-controlled-URL taint pattern is a false positive here:
		// this function IS the allow-list validator (HTTPS only, fixed
		// provider host, no credentials/port/query/fragment), and its
		// callers re-validate at every read boundary (#2939).
		// nosemgrep
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
