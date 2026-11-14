import { getPerekByPerekId } from "@/data/perek-dto";

/**
 * Notification payload the service worker (`public/sw.js`) renders.
 *
 * Kept free of `server-only` so the e2e suite can dispatch the exact payload
 * the sender produces into a real worker — one drift between this builder and
 * the worker's expectations fails the browser test, not production.
 */
export function dailyPerekPayload(perekId: number) {
	return {
		title: 'הפרק היומי - תנ"ך על הפרק',
		body: `הפרק של היום: ${getPerekByPerekId(perekId).source}`,
		url: `/929/${perekId}`,
		tag: "daily-perek",
	};
}
