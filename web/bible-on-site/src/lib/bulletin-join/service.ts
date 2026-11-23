import "server-only";
import { query } from "@/lib/api-client";
import {
	isJoinChannel,
	JOIN_CHANNELS,
	type JoinChannel,
	validateJoinDestination,
} from "../../../../shared/bulletin-join/index";

/**
 * Stable public join routes (#2939).
 *
 * `/dailyBulletin/join/whatsapp` and `/dailyBulletin/join/telegram` are
 * first-party URLs whose destinations an admin edits in the bulletin
 * console — rotating a WhatsApp invitation never requires a deploy. The
 * website only resolves the saved destination; it never accepts a
 * destination from the request. The channel list and the destination
 * validator are the single shared definition in
 * `web/shared/bulletin-join/` — the admin runs the same rules on save
 * that this read boundary runs before every redirect.
 */
export { isJoinChannel, JOIN_CHANNELS, validateJoinDestination };
export type { JoinChannel };

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
