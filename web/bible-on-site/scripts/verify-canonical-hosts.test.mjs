import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { verifyCanonicalHosts } from "./verify-canonical-hosts.mjs";

const DOMAIN = "xn--febl3a.co.il";
const BARE = `https://${DOMAIN}`;
const WWW = `https://www.${DOMAIN}`;

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
		return new Response(body ?? "<h1>Not found</h1>", {
			status: body === undefined ? 404 : 200,
		});
	};

// Healthy deployed state: www redirects to bare in one hop, both schemes.
const healthyRedirects = {
	[`${WWW}/`]: `${BARE}/`,
	[`http://www.${DOMAIN}/`]: `${BARE}/`,
	[`http://${DOMAIN}/`]: `${BARE}/`,
	[`${WWW}/929/1?book`]: `${BARE}/929/1?book`,
};
const healthyPages = { "/": "home", "/929/1": "chapter" };

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
	return new Response(healthyPages[path] ?? "x", {
		status: healthyPages[path] === undefined ? 404 : 200,
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
			return new Response(healthyPages[path] ?? "x", {
				status: healthyPages[path] === undefined ? 404 : 200,
			});
		},
	});
	assert.ok(seenAgents.some((agent) => agent.includes("AhrefsSiteAudit")));
});

// Static guard for the deployed nginx config: www must be a named server
// on both ports for both TLDs, redirecting to the bare host — otherwise
// it falls into the catch-all that 301s to /404 (#2377).
test("router.conf redirects www to the bare host on 80 and 443", () => {
	const confPath = path.resolve(
		path.dirname(fileURLToPath(import.meta.url)),
		"../../../docs/aws/cloudformation/ec2-nginx/router/router.conf",
	);
	const conf = readFileSync(confPath, "utf8");
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
