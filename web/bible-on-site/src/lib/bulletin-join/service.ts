import "server-only";
import { query } from "@/lib/api-client";

/**
 * Stable public join routes (#2939).
 *
 * `/dailyBulletin/join/whatsapp` and `/dailyBulletin/join/telegram` are
 * first-party URLs whose destinations an admin edits in the bulletin
 * console — rotating a WhatsApp invitation never requires a deploy. The
 * website only resolves the saved destination; it never accepts a
 * destination from the request.
 */
export type JoinChannel = "whatsapp" | "telegram";

export const JOIN_CHANNELS: readonly JoinChannel[] = [
	"telegram",
	"whatsapp",
] as const;

export function isJoinChannel(value: unknown): value is JoinChannel {
	return value === "whatsapp" || value === "telegram";
}

/**
 * Intentional join destinations only. The validator is deliberately
 * narrower than what the providers technically accept: an admin-managed
 * redirect target must be a plain HTTPS URL on the provider's join host,
 * with no credentials-in-URL, query, fragment, or non-default port.
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
 * The saved, enabled destination for a join channel, re-validated on read
 * so a hand-edited or corrupt row can never emit an open redirect.
 * `null` means no usable destination is configured.
 */
export async function resolveJoinDestination(
	channel: JoinChannel,
): Promise<string | null> {
	const rows = await query<{ destination: string | null }>(
		"SELECT destination FROM tanah_daily_bulletin_join_link WHERE channel = ? AND enabled = TRUE",
		[channel],
	);
	return validateJoinDestination(channel, rows[0]?.destination ?? null);
}
