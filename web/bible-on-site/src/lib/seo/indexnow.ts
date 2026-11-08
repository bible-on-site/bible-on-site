import { SITE_ORIGIN } from "./jsonld";

/**
 * IndexNow — notifies participating search engines (Bing & co) that public
 * URLs changed, so they recrawl fresh content sooner.
 *
 * Wired into the content-freshness lifecycle: `POST /api/revalidate` submits
 * the caller-reported changed URLs *after* invalidation succeeded (via
 * `next/server` `after`, so the notification never delays or fails the admin
 * request). A committed save is only notified once the stale caches are
 * expired, which is the point at which public output is guaranteed fresh.
 *
 * Host policy: submissions always use the canonical `SITE_ORIGIN` host
 * (xn--febl3a.co.il). The .com pages canonicalize to .co.il, so notifying
 * .com URLs would advertise a duplicate as an independently indexable copy.
 * The ownership key file (`/{key}.txt`) is still served on every host (see
 * src/proxy.ts) so both properties can verify ownership.
 *
 * Delivery: undelivered URLs stay in `pending` and are merged into the next
 * submission, so a failed POST recovers on the next publication event or an
 * operator call. shortcut: per-instance in-memory pending, lost on task
 * replacement; upgrade to a durable queue if that gap matters.
 */

const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";
const SUBMISSION_TIMEOUT_MS = 5000;
/** https://www.indexnow.org/documentation — 10,000 URLs per POST. */
const MAX_URLS_PER_POST = 10_000;
/** Protocol key format: 8–128 chars of a–z, A–Z, 0–9 or `-`. */
const KEY_FORMAT = /^[a-zA-Z0-9-]{8,128}$/;

let warnedInvalidKey = false;

/** The configured ownership key, or null when the integration is off. */
export function indexNowKey(): string | null {
	const key = process.env.INDEXNOW_KEY?.trim();
	if (!key) return null;
	if (!KEY_FORMAT.test(key)) {
		if (!warnedInvalidKey) {
			console.warn(
				"INDEXNOW_KEY is set but not 8-128 [a-zA-Z0-9-] chars — IndexNow disabled",
			);
			warnedInvalidKey = true;
		}
		return null;
	}
	return key;
}

/** File name of the ownership proof served at the site root. */
export function indexNowKeyFileName(): string | null {
	const key = indexNowKey();
	return key ? `${key}.txt` : null;
}

/** Absolute URLs reported but not yet accepted by the IndexNow endpoint. */
const pending = new Set<string>();

/** Snapshot of undelivered URLs — observability and tests. */
export function pendingIndexNowUrls(): string[] {
	return [...pending];
}

/**
 * Normalizes caller-reported site-relative paths into the deduped set to
 * notify: strips query/fragment (clean URLs, no tracking params), drops
 * non-site or unresolvable entries (dynamic patterns cannot be enumerated),
 * and adds the public dependents that render the changed content — the
 * chapter page for an article, the index page for authors/entries, and the
 * sitemap that lists them.
 */
export function collectSubmissionPaths(paths: Iterable<string>): string[] {
	const collected = new Set<string>();
	for (const raw of paths) {
		const path = raw.split(/[?#]/, 1)[0];
		if (
			!path.startsWith("/") ||
			path.startsWith("//") ||
			path.includes("[")
		) {
			continue;
		}
		collected.add(path);
		if (/^\/929\/\d+\/\d+$/.test(path)) {
			collected.add(`/929/${path.split("/")[2]}`);
		} else if (path.startsWith("/929/authors/")) {
			collected.add("/929/authors");
		} else if (path.startsWith("/pedia/")) {
			collected.add("/pedia");
		}
	}
	if (collected.size > 0) collected.add("/sitemap.xml");
	return [...collected];
}

export type IndexNowOutcome = "submitted" | "skipped" | "failed";

async function postUrlList(
	key: string,
	urlList: string[],
): Promise<"submitted" | "failed"> {
	const host = new URL(SITE_ORIGIN).host;
	try {
		const response = await fetch(INDEXNOW_ENDPOINT, {
			method: "POST",
			headers: { "content-type": "application/json; charset=utf-8" },
			body: JSON.stringify({
				host,
				key,
				keyLocation: `${SITE_ORIGIN}/${key}.txt`,
				urlList,
			}),
			signal: AbortSignal.timeout(SUBMISSION_TIMEOUT_MS),
		});
		if (!response.ok) {
			console.error(
				`IndexNow submission failed: HTTP ${response.status} for ${urlList.length} URL(s)`,
			);
			return "failed";
		}
		return "submitted";
	} catch (error) {
		console.error("IndexNow submission request failed", error);
		return "failed";
	}
}

/**
 * Submits the given site-relative paths (plus any still-pending URLs from
 * earlier failures) to IndexNow. Never throws and never blocks beyond the
 * per-request timeout — a delivery failure is logged and kept pending, so it
 * can neither break revalidation nor delay the caller indefinitely.
 */
export async function submitIndexNow(
	paths: Iterable<string>,
): Promise<IndexNowOutcome> {
	const key = indexNowKey();
	if (!key) return "skipped";
	const urls = new Set(pending);
	for (const path of collectSubmissionPaths(paths)) {
		urls.add(new URL(path, SITE_ORIGIN).href);
	}
	if (urls.size === 0) return "skipped";

	const list = [...urls];
	let failed = false;
	for (let i = 0; i < list.length; i += MAX_URLS_PER_POST) {
		const chunk = list.slice(i, i + MAX_URLS_PER_POST);
		const outcome = await postUrlList(key, chunk);
		if (outcome === "submitted") {
			for (const url of chunk) pending.delete(url);
		} else {
			for (const url of chunk) pending.add(url);
			failed = true;
		}
	}
	return failed ? "failed" : "submitted";
}
