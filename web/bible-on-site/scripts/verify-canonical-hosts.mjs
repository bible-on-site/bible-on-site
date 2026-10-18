import path from "node:path";
import { fileURLToPath } from "node:url";

// Post-deploy smoke check for canonical host normalization (#2377):
// every supported scheme/host combination must reach the canonical
// HTTPS bare host, deep links must keep path and query, and genuinely
// unknown paths must stay 404 instead of redirecting to /404.

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 2;
const BROWSER_UA = "bible-on-site-canonical-hosts-check";
// Ahrefs Site Audit sends this UA (distinct from the blocked AhrefsBot).
const CRAWLER_UA =
	"Mozilla/5.0 (compatible; AhrefsSiteAudit/6.1; +http://ahrefs.com/robot/)";

/** Follow redirects manually so every hop can be asserted and counted. */
async function chain(startUrl, fetchPage, userAgent) {
	const hops = [];
	let current = startUrl;
	for (;;) {
		const response = await fetchPage(current, {
			redirect: "manual",
			signal: AbortSignal.timeout(30_000),
			headers: { "user-agent": userAgent },
		});
		const location = response.headers.get("location");
		if (!REDIRECT_STATUSES.has(response.status) || !location) {
			return { hops, url: current, status: response.status };
		}
		hops.push({ status: response.status, location });
		current = new URL(location, current).href;
		if (hops.length > MAX_REDIRECTS) {
			throw new Error(
				`${startUrl}: redirect chain exceeded ${MAX_REDIRECTS} hops ` +
					hops.map((hop) => hop.location).join(" -> "),
			);
		}
	}
}

function assertEndsAt(startUrl, result, expectedUrl, expectedStatus) {
	if (result.url !== expectedUrl || result.status !== expectedStatus) {
		throw new Error(
			`${startUrl}: expected ${expectedStatus} at ${expectedUrl}, ` +
				`got ${result.status} at ${result.url} ` +
				`(${result.hops.length} hops: ${result.hops.map((hop) => hop.location).join(" -> ") || "none"})`,
		);
	}
}

export async function verifyCanonicalHosts(
	domain,
	{ fetchPage = fetch, crawlerUserAgent = CRAWLER_UA } = {},
) {
	const bare = `https://${domain}`;
	const www = `https://www.${domain}`;
	const httpBare = `http://${domain}`;
	const httpWww = `http://www.${domain}`;
	const deepLink = "/929/1?book";
	const missing = `/no-such-page-${Date.now()}`;

	// All four scheme/host combinations must land on the canonical homepage.
	for (const start of [`${www}/`, `${httpWww}/`, `${httpBare}/`]) {
		assertEndsAt(
			start,
			await chain(start, fetchPage, BROWSER_UA),
			`${bare}/`,
			200,
		);
	}
	assertEndsAt(
		`${bare}/`,
		await chain(`${bare}/`, fetchPage, BROWSER_UA),
		`${bare}/`,
		200,
	);

	// Deep links keep their path and query through the www redirect.
	assertEndsAt(
		`${www}${deepLink}`,
		await chain(`${www}${deepLink}`, fetchPage, BROWSER_UA),
		`${bare}${deepLink}`,
		200,
	);

	// Unknown paths must keep their requested path and return a real 404,
	// not a redirect to /404 (the defect this check guards against).
	for (const start of [`${www}${missing}`, `${bare}${missing}`]) {
		const result = await chain(start, fetchPage, BROWSER_UA);
		const finalPath = new URL(result.url).pathname;
		if (result.status !== 404 || finalPath !== missing) {
			throw new Error(
				`${start}: expected 404 at ${missing}, got ${result.status} at ${result.url}`,
			);
		}
	}

	// The seed crawler must observe the same canonical redirect as browsers.
	assertEndsAt(
		`${www}/`,
		await chain(`${www}/`, fetchPage, crawlerUserAgent),
		`${bare}/`,
		200,
	);
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
	const args = process.argv.slice(2);
	const domains = args
		.flatMap((arg, index) => (arg === "--domain" ? [args[index + 1]] : []))
		.filter(Boolean);
	if (domains.length === 0)
		throw new Error(
			"Usage: node verify-canonical-hosts.mjs --domain HOST [--domain HOST...]",
		);
	for (const domain of domains) {
		await verifyCanonicalHosts(domain);
		console.log(`Canonical hosts verified: ${domain}`);
	}
}
