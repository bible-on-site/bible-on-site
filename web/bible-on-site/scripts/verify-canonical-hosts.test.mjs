import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { verifyCanonicalHosts } from "./verify-canonical-hosts.mjs";

const DOMAIN = "xn--febl3a.co.il";
const BARE = `https://${DOMAIN}`;
const WWW = `https://www.${DOMAIN}`;

// The deployed app answers every miss with its branded Hebrew 404 — the
// mocks mirror that so the 404 probes have a body to assert. For /www/
// misses the router serves the committed fallback file instead, which
// carries the same title plus its identifying marker (issue #2935).
const BRANDED_404 = "<title>העמוד לא נמצא</title>";
const ROUTER_BRANDED_404 =
	"<!-- bible-on-site router branded 404 fallback (issue #2935) -->" +
	BRANDED_404;

/** Default 404 body for a path: the router fallback file under /www/. */
const missingBody = (path) =>
	path.startsWith("/www/") ? ROUTER_BRANDED_404 : BRANDED_404;

/** Serve `redirects`/`pages` as a fake origin: map url -> 301 target or body. */
const fetchFrom =
	({ redirects = {}, pages = {} }) =>
	async (url) => {
		const target = redirects[url];
		if (target !== undefined) {
			return new Response(null, {
				status: 301,
				headers: { location: target },
			});
		}
		const path = new URL(url).pathname;
		const body = pages[path];
		return new Response(body ?? missingBody(path), {
			status: body === undefined ? 404 : 200,
			headers: pageHeaders(path),
		});
	};

// Healthy deployed state: www redirects to bare in one hop, both schemes.
const healthyRedirects = {
	[`${WWW}/`]: `${BARE}/`,
	[`http://www.${DOMAIN}/`]: `${BARE}/`,
	[`http://${DOMAIN}/`]: `${BARE}/`,
	[`${WWW}/929/1?book`]: `${BARE}/929/1?book`,
	[`${BARE}/sitemap_www.xml`]: `${BARE}/sitemap.xml`,
	// The supplied URL starts on the www host (#2935): host normalization
	// preserves the path, then the alias redirects into the canonical doc.
	[`${WWW}/sitemap_www.xml`]: `${BARE}/sitemap_www.xml`,
};
const healthyPages = {
	"/": "home",
	"/929/1": "chapter",
	"/sitemap.xml":
		'<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>',
	// The branded router fallback deployed into the /www/ tree (#2935).
	"/www/404.html": ROUTER_BRANDED_404,
};
const pageHeaders = (path) => ({
	"content-type": path === "/sitemap.xml" ? "application/xml" : "text/html",
});

test("all scheme/host combinations reach the canonical bare host", async () => {
	await verifyCanonicalHosts(DOMAIN, {
		fetchPage: fetchFrom({
			redirects: healthyRedirects,
			pages: healthyPages,
		}),
	});
});

test("www redirecting to /404 fails — the exact deployed defect (#2377)", async () => {
	await assert.rejects(
		verifyCanonicalHosts(DOMAIN, {
			fetchPage: fetchFrom({
				redirects: Object.fromEntries(
					Object.keys(healthyRedirects).map((from) => [from, `${BARE}/404`]),
				),
				pages: healthyPages,
			}),
		}),
		/expected 200 at .* got 404 at .*\/404/,
	);
});

test("a redirect that drops the deep-link query fails", async () => {
	await assert.rejects(
		verifyCanonicalHosts(DOMAIN, {
			fetchPage: fetchFrom({
				redirects: {
					...healthyRedirects,
					[`${WWW}/929/1?book`]: `${BARE}/929/1`,
				},
				pages: healthyPages,
			}),
		}),
		/929\/1\?book.*got 200 at .*\/929\/1/,
	);
});

const redirectTo = (location) =>
	new Response(null, { status: 301, headers: { location } });
const pageAt = (url) => {
	const path = new URL(url).pathname;
	return new Response(healthyPages[path] ?? missingBody(path), {
		status: healthyPages[path] === undefined ? 404 : 200,
		headers: pageHeaders(path),
	});
};

test("www unknown path forwarded to /404 fails even though status stays 404", async () => {
	// Defect shape: every unknown www path 301s to <bare>/404, so the final
	// status is 404 but the requested path was rewritten away.
	const defective = async (url) => {
		const target = healthyRedirects[url];
		if (target !== undefined) return redirectTo(target);
		if (new URL(url).hostname === `www.${DOMAIN}`)
			return redirectTo(`${BARE}/404`);
		return pageAt(url);
	};
	await assert.rejects(
		verifyCanonicalHosts(DOMAIN, { fetchPage: defective }),
		/expected 404 at .*no-such-page.*got 404 at .*\/404/,
	);
});

test("unknown www path that preserves its path to the bare 404 passes", async () => {
	const passthrough = async (url) => {
		const target = healthyRedirects[url];
		if (target !== undefined) return redirectTo(target);
		if (new URL(url).hostname === `www.${DOMAIN}`) {
			const parsed = new URL(url);
			return redirectTo(`${BARE}${parsed.pathname}${parsed.search}`);
		}
		return pageAt(url);
	};
	await verifyCanonicalHosts(DOMAIN, { fetchPage: passthrough });
});

test("redirect loops beyond the hop bound fail", async () => {
	const looping = async (url) =>
		new Response(null, { status: 301, headers: { location: url } });
	await assert.rejects(
		verifyCanonicalHosts(DOMAIN, { fetchPage: looping }),
		/redirect chain exceeded 2 hops/,
	);
});

test("the seed crawler UA is used for its own request", async () => {
	const seenAgents = [];
	await verifyCanonicalHosts(DOMAIN, {
		fetchPage: async (url, options) => {
			seenAgents.push(options.headers["user-agent"]);
			const target = healthyRedirects[url];
			if (target !== undefined) {
				return new Response(null, {
					status: 301,
					headers: { location: target },
				});
			}
			const path = new URL(url).pathname;
			return new Response(healthyPages[path] ?? missingBody(path), {
				status: healthyPages[path] === undefined ? 404 : 200,
				headers: pageHeaders(path),
			});
		},
	});
	assert.ok(seenAgents.some((agent) => agent.includes("AhrefsSiteAudit")));
});

/** Healthy host responses with one injectable override per test. */
const healthyWith = (override) => async (url) => {
	const path = new URL(url).pathname;
	const special = override?.(url, path);
	if (special !== undefined) return special;
	const target = healthyRedirects[url];
	if (target !== undefined) return redirectTo(target);
	return pageAt(url);
};

test("sitemap_www.xml falling through to a 404 fails — the reported defect (#2935)", async () => {
	await assert.rejects(
		verifyCanonicalHosts(DOMAIN, {
			fetchPage: fetchFrom({
				redirects: Object.fromEntries(
					Object.entries(healthyRedirects).filter(
						([from]) => from !== `${BARE}/sitemap_www.xml`,
					),
				),
				pages: healthyPages,
			}),
		}),
		/sitemap_www\.xml: expected 200 at .*sitemap\.xml.*got 404/,
	);
});

test("a non-permanent sitemap alias redirect fails", async () => {
	await assert.rejects(
		verifyCanonicalHosts(DOMAIN, {
			fetchPage: healthyWith((url) =>
				url === `${BARE}/sitemap_www.xml`
					? new Response(null, {
							status: 302,
							headers: { location: `${BARE}/sitemap.xml` },
						})
					: undefined,
			),
		}),
		/non-permanent HTTP 302/,
	);
});

test("an HTML response at the canonical sitemap fails even with HTTP 200", async () => {
	await assert.rejects(
		verifyCanonicalHosts(DOMAIN, {
			fetchPage: healthyWith((_url, path) =>
				path === "/sitemap.xml"
					? new Response(BRANDED_404, {
							status: 200,
							headers: { "content-type": "text/html" },
						})
					: undefined,
			),
		}),
		/expected an XML content type/,
	);
});

test("an XML content type cannot disguise a missing sitemap document", async () => {
	for (const body of [
		BRANDED_404,
		'<urlset xmlns="https://wrong.example/"></urlset>',
		'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
	]) {
		await assert.rejects(
			verifyCanonicalHosts(DOMAIN, {
				fetchPage: healthyWith((_url, path) =>
					path === "/sitemap.xml"
						? new Response(body, {
								status: 200,
								headers: { "content-type": "application/xml; charset=utf-8" },
							})
						: undefined,
				),
			}),
			/expected a sitemap urlset document/,
		);
	}
});

test("the router fallback file missing from the /www/ tree fails — the deploy gap (#2935)", async () => {
	await assert.rejects(
		verifyCanonicalHosts(DOMAIN, {
			fetchPage: healthyWith((url, path) =>
				url.startsWith(BARE) && path === "/www/404.html"
					? new Response("<html><body><h1>404 Not Found</h1></body></html>", {
							status: 404,
						})
					: undefined,
			),
		}),
		/\/www\/404\.html: expected 200 for the deployed router 404 fallback/,
	);
});

test("a wrong file deployed at /www/404.html fails", async () => {
	await assert.rejects(
		verifyCanonicalHosts(DOMAIN, {
			fetchPage: healthyWith((url, path) =>
				url.startsWith(BARE) && path === "/www/404.html"
					? new Response("<html>placeholder</html>", { status: 200 })
					: undefined,
			),
		}),
		/\/www\/404\.html: response is not the committed router 404 fallback/,
	);
});

test("nginx's stock 404 on a /www/ miss fails — the branded page must answer (#2935)", async () => {
	await assert.rejects(
		verifyCanonicalHosts(DOMAIN, {
			fetchPage: healthyWith((url, path) =>
				url.startsWith(BARE) &&
				path.startsWith("/www/") &&
				path !== "/www/404.html"
					? new Response("<html><body><h1>404 Not Found</h1></body></html>", {
							status: 404,
						})
					: undefined,
			),
		}),
		/did not render the branded Hebrew 404/,
	);
});

test("an app-rendered branded 404 on a /www/ miss fails — the miss must stay router-local (#2935)", async () => {
	// The app's own branded page carries the same title but not the router
	// file's marker — catching a regression that proxies /www/ misses into
	// the website backend again.
	await assert.rejects(
		verifyCanonicalHosts(DOMAIN, {
			fetchPage: healthyWith((url, path) =>
				url.startsWith(BARE) &&
				path.startsWith("/www/") &&
				path !== "/www/404.html"
					? new Response(BRANDED_404, { status: 404 })
					: undefined,
			),
		}),
		/not served by the router fallback file/,
	);
});

test("a soft-200 on a /www/ miss fails", async () => {
	await assert.rejects(
		verifyCanonicalHosts(DOMAIN, {
			fetchPage: healthyWith((url, path) =>
				url.startsWith(BARE) &&
				path.startsWith("/www/") &&
				path !== "/www/404.html"
					? new Response("<html>index</html>", { status: 200 })
					: undefined,
			),
		}),
		/expected 404, got 200/,
	);
});

const ROUTER_CONF = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../../../docs/aws/cloudformation/ec2-nginx/router/router.conf",
);

// Static guard for the deployed nginx config: www must be a named server
// on both ports for both TLDs, redirecting to the bare host — otherwise
// it falls into the catch-all that 301s to /404 (#2377).
test("router.conf redirects www to the bare host on 80 and 443", () => {
	const conf = readFileSync(ROUTER_CONF, "utf8");
	const blocks = conf.match(/server \{[^}]+\}/gs) ?? [];
	for (const host of ["xn--febl3a.co.il", "xn--febl3a.com"]) {
		for (const port of ["80", "443"]) {
			const block = blocks.find(
				(candidate) =>
					candidate.includes(`listen ${port}`) &&
					candidate.includes(`server_name www.${host}`),
			);
			assert.ok(
				block,
				`router.conf has no :${port} server block for www.${host}`,
			);
			assert.ok(
				block.includes(`return 301 https://${host}`),
				`www.${host} on :${port} does not redirect to the bare host`,
			);
		}
	}
});

// The router-owned /www/ static tree is a supported surface: its misses
// stay router-local, answered by the branded fallback file deployed into
// the tree — never nginx's stock English 404 and never an app proxy hop
// (issue #2935).
test("router.conf serves missing /www/ files with the router-local branded 404", () => {
	const conf = readFileSync(ROUTER_CONF, "utf8");
	const wwwBlocks = conf.match(/location \/www\/ \{[^}]+\}/g) ?? [];
	assert.equal(
		wwwBlocks.length,
		2,
		`expected a location /www/ block in both TLD servers, found ${wwwBlocks.length}`,
	);
	for (const block of wwwBlocks) {
		assert.ok(
			block.includes("error_page 404 /www/404.html"),
			"location /www/ missing the router-local branded-404 error_page",
		);
		assert.ok(
			!block.includes("error_page 404 /404"),
			"location /www/ must not re-dispatch misses into the app proxy",
		);
	}
	const fallbackBlocks =
		conf.match(/location = \/www\/404\.html \{[^}]+\}/g) ?? [];
	assert.equal(
		fallbackBlocks.length,
		2,
		`expected an exact-match /www/404.html block in both TLD servers, found ${fallbackBlocks.length}`,
	);
	for (const block of fallbackBlocks) {
		assert.ok(
			block.includes("alias /var/www/html/404.html"),
			"the /www/404.html block must serve the deployed fallback file",
		);
		assert.ok(
			!block.includes("error_page"),
			"the /www/404.html block must define no error_page of its own (missing file degrades, no loop)",
		);
	}
});

const ROUTER_404 = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../../../docs/aws/cloudformation/ec2-nginx/router/404.html",
);
const APP_NOT_FOUND = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../src/app/not-found.tsx",
);
const APP_MISSING_PAGE = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../src/lib/seo/missing-page.ts",
);

// The router fallback is a static snapshot of the app's branded missing
// page. Pin the shared contract — title, pasuk, source, recovery link,
// noindex — so a branding change in the app fails CI until the deployed
// file is regenerated (#2935).
test("router/404.html keeps the app's branded missing-page contract", () => {
	const html = readFileSync(ROUTER_404, "utf8");
	const appSource = readFileSync(APP_NOT_FOUND, "utf8");
	const metadataSource = readFileSync(APP_MISSING_PAGE, "utf8");

	const title = metadataSource.match(/title: "([^"]+)"/)?.[1];
	assert.ok(title, "could not read the shared missing-page title");
	const pageTitle = html.match(/<title>([^<]*)<\/title>/)?.[1];
	assert.equal(
		pageTitle,
		title,
		"router/404.html must title itself with the shared missing-page title",
	);

	const pasuk = appSource.match(/<h1[^>]*>([^<]+)<\/h1>/)?.[1]?.trim();
	assert.ok(pasuk, "could not read the branded pasuk");
	assert.ok(html.includes(pasuk), "router/404.html must show the same pasuk");

	const source = appSource.match(/styles\.source\}>([^<]+)<\/p>/)?.[1]?.trim();
	assert.ok(source, "could not read the pasuk source");
	assert.ok(html.includes(source), "router/404.html must show the same source");

	const homeLink = appSource.match(/>([^<]+)<\/Link>/)?.[1]?.trim();
	assert.ok(homeLink, "could not read the recovery link text");
	assert.ok(
		html.includes(`href="/"`) && html.includes(homeLink),
		"router/404.html must keep the same home recovery link",
	);
});

test("router/404.html is a deployable router-local page", () => {
	const html = readFileSync(ROUTER_404, "utf8");
	assert.ok(
		html.includes("bible-on-site router branded 404 fallback"),
		"router/404.html must carry the marker the deployed probe asserts",
	);
	assert.ok(
		html.includes('dir="rtl"') && html.includes('lang="he"'),
		"router/404.html must be an RTL Hebrew page",
	);
	assert.ok(
		/name="robots" content="noindex"/.test(html),
		"router/404.html must be noindex like the app's 404",
	);
	// Every element must be inline markup — any external-loading tag
	// (script, link, img, iframe, …) breaks self-containment on redeploys.
	const tags = [...html.matchAll(/<\s*\/?\s*([a-zA-Z][a-zA-Z0-9]*)/g)].map(
		(match) => match[1].toLowerCase(),
	);
	const allowed = new Set([
		"html",
		"head",
		"meta",
		"title",
		"style",
		"body",
		"div",
		"p",
		"h1",
		"a",
	]);
	const unexpected = tags.filter((tag) => !allowed.has(tag));
	assert.deepEqual(
		unexpected,
		[],
		"router/404.html must be self-contained — app-asset references break on redeploys",
	);
	assert.ok(
		!html.includes("/_next/"),
		"router/404.html must not reference hashed app assets — they rotate on redeploys",
	);
});
