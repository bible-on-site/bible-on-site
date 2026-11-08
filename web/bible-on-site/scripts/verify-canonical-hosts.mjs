import path from "node:path";
import { fileURLToPath } from "node:url";

// Post-deploy smoke check for canonical host normalization (#2377):
// every supported scheme/host combination must reach the canonical
// HTTPS bare host, deep links must keep path and query, and genuinely
// unknown paths must stay 404 instead of redirecting to /404.

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 2;
const BROWSER_UA = "bible-on-site-canonical-hosts-check";
// Identifying comment inside docs/aws/cloudformation/ec2-nginx/router/404.html.
// The app renders the same branded title, so only this marker proves the
// committed router fallback — not an app-rendered page — answered the miss.
const ROUTER_404_MARKER = "bible-on-site router branded 404 fallback";
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
			return { hops, url: current, status: response.status, response };
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

	// The public sitemap alias must permanently redirect into the
	// single canonical document — a 404 or an HTML body here is the
	// reported defect (#2935). The exact supplied URL starts on the www
	// host, so the compatibility chain is asserted on both host variants:
	// www → bare → /sitemap.xml, permanent hops only.
	for (const sitemapStart of [
		`${bare}/sitemap_www.xml`,
		`${www}/sitemap_www.xml`,
	]) {
		const sitemapResult = await chain(sitemapStart, fetchPage, BROWSER_UA);
		assertEndsAt(sitemapStart, sitemapResult, `${bare}/sitemap.xml`, 200);
		for (const hop of sitemapResult.hops) {
			if (hop.status !== 301 && hop.status !== 308) {
				throw new Error(
					`${sitemapStart}: redirect to ${hop.location} used non-permanent HTTP ${hop.status}`,
				);
			}
		}
		const contentType =
			sitemapResult.response.headers.get("content-type") ?? "";
		if (!/^(?:application|text)\/xml(?:\s*;|$)/i.test(contentType)) {
			throw new Error(
				`${sitemapStart}: expected an XML content type, got ${contentType || "none"}`,
			);
		}
		// Check the document itself as well as HTTP status: a successful
		// HTML error page or a truncated/non-sitemap XML response must fail.
		// Browser E2E coverage also parses the complete XML document.
		const sitemapBody = await sitemapResult.response.text();
		if (
			!/^\s*(?:<\?xml[^?]*\?>\s*)?<urlset\b[^>]*\sxmlns=["']http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9["'][^>]*>[\s\S]*<\/urlset>\s*$/.test(
				sitemapBody,
			)
		) {
			throw new Error(`${sitemapStart}: expected a sitemap urlset document`);
		}
	}

	// The /www/ static tree is a supported surface served router-local: a
	// miss must answer with the branded Hebrew 404 file deployed into the
	// tree as /www/404.html — never nginx's stock page, a soft-200, or an
	// app-rendered page (#2935). Probe the fallback file directly first so
	// a missing deploy is diagnosed before the miss behavior is checked.
	const fallbackProbe = await fetchPage(`${bare}/www/404.html`, {
		redirect: "manual",
		signal: AbortSignal.timeout(30_000),
		headers: { "user-agent": BROWSER_UA },
	});
	if (fallbackProbe.status !== 200) {
		throw new Error(
			`${bare}/www/404.html: expected 200 for the deployed router 404 fallback, got ${fallbackProbe.status}`,
		);
	}
	if (!(await fallbackProbe.text()).includes(ROUTER_404_MARKER)) {
		throw new Error(
			`${bare}/www/404.html: response is not the committed router 404 fallback`,
		);
	}

	const staticMissing = `/www/no-such-file-${Date.now()}.html`;
	const staticResponse = await fetchPage(`${bare}${staticMissing}`, {
		redirect: "manual",
		signal: AbortSignal.timeout(30_000),
		headers: { "user-agent": BROWSER_UA },
	});
	if (staticResponse.status !== 404) {
		throw new Error(
			`${bare}${staticMissing}: expected 404, got ${staticResponse.status}`,
		);
	}
	const staticBody = await staticResponse.text();
	if (!staticBody.includes("העמוד לא נמצא")) {
		throw new Error(
			`${bare}${staticMissing}: missing static file did not render the branded Hebrew 404`,
		);
	}
	if (!staticBody.includes(ROUTER_404_MARKER)) {
		throw new Error(
			`${bare}${staticMissing}: branded 404 was not served by the router fallback file (misses must stay router-local)`,
		);
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
