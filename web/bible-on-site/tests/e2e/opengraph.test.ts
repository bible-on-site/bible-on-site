import { expect, test } from "../util/playwright/test-fixture";

/**
 * E2E: every public page family emits complete Open Graph metadata —
 * `og:title`, `og:type`, `og:image`, `og:url`, site name and locale —
 * aligned with the canonical link through the real layout/metadata
 * pipeline, for both regular and HTML-limited (social crawler) agents.
 *
 * The local test DB has no chapter illustrations, so content pages fall
 * back to the branded card; unit tests cover real-image preference.
 */

const SITE_ORIGIN = "https://xn--febl3a.co.il";
const SOCIAL_BOT_UA = "facebookexternalhit/1.1";

const META_TAG_RE = /<meta[^>]*>/g;
const LINK_TAG_RE = /<link[^>]*>/g;

function attrValue(tag: string, name: string): string | undefined {
	// Attribute order varies, so compare name-before-value pairs directly.
	for (const m of tag.matchAll(/([\w:-]+)="([^"]*)"/g)) {
		if (m[1] === name) return m[2];
	}
	return undefined;
}

function tagsFor(
	html: string,
	property: string,
	attr = "property",
): string[] {
	return [...html.matchAll(META_TAG_RE)]
		.map((m) => m[0])
		.filter((tag) => attrValue(tag, attr) === property)
		.map((tag) => attrValue(tag, "content"))
		.filter((v): v is string => typeof v === "string");
}

function canonicalHref(html: string): string | undefined {
	const tag = [...html.matchAll(LINK_TAG_RE)]
		.map((m) => m[0])
		.find((t) => attrValue(t, "rel") === "canonical");
	return tag ? attrValue(tag, "href") : undefined;
}

async function htmlFor(
	request: import("@playwright/test").APIRequestContext,
	path: string,
	headers?: Record<string, string>,
): Promise<string> {
	const response = await request.get(path, { timeout: 120000, headers });
	expect(response.status()).toBe(200);
	return response.text();
}

function expectCompleteOg(html: string, path: string) {
	const [ogUrl] = tagsFor(html, "og:url");
	expect(ogUrl, `og:url on ${path}`).toBeTruthy();
	expect(tagsFor(html, "og:url")).toHaveLength(1);
	expect(ogUrl).toBe(canonicalHref(html));
	expect(ogUrl).toMatch(/^https:\/\//);
	expect(tagsFor(html, "og:title")[0]).toBeTruthy();
	expect(tagsFor(html, "og:type")[0]).toBeTruthy();
	expect(tagsFor(html, "og:site_name")[0]).toBeTruthy();
	expect(tagsFor(html, "og:locale")[0]).toBe("he_IL");
	const [image] = tagsFor(html, "og:image");
	expect(image, `og:image on ${path}`).toMatch(/^https?:\/\//);
	expect(tagsFor(html, "og:image:type")[0]).toMatch(/^image\//);
	expect(tagsFor(html, "og:image:alt")[0]).toBeTruthy();
}

test.describe("Open Graph metadata", () => {
	// The first request to each route triggers a `next dev` compile; give the
	// heaviest pages room.
	test.beforeEach(() => {
		test.slow();
	});

	const websiteRoutes: [string, string][] = [
		["home", "/"],
		["section", "/contact"],
		["bookshelf", "/bookshelf"],
		["authors list", "/929/authors"],
		["perek (unillustrated→fallback)", "/929/1"],
		["pedia landing", "/pedia"],
		["pedia category", `/pedia/${encodeURIComponent("אישים")}`],
		["pedia entry", `/pedia/${encodeURIComponent("יהושע-בן-נון")}`],
		["calendar", `/${encodeURIComponent("לוח")}`],
		["journalism", "/journalism"],
		["rabbis blessing", "/rabbis-blessing"],
		["accessibility", "/accessibility"],
		["parasha landing", `/${encodeURIComponent("פרשה")}`],
		["parasha unit", `/${encodeURIComponent("פרשה")}/1`],
	];

	for (const [label, path] of websiteRoutes) {
		test(`${label} emits required og:* properties aligned with canonical`, async ({
			request,
		}) => {
			expectCompleteOg(await htmlFor(request, path), path);
			expect(tagsFor(await htmlFor(request, path), "og:type")[0]).toBe(
				"website",
			);
		});
	}

	test("author profile emits og:type profile with the portrait image", async ({
		request,
	}) => {
		const html = await htmlFor(request, "/929/authors/1");
		expectCompleteOg(html, "/929/authors/1");
		expect(tagsFor(html, "og:type")[0]).toBe("profile");
		expect(tagsFor(html, "og:image")[0]).not.toBe(
			`${SITE_ORIGIN}/images/og/default.jpg`,
		);
	});

	test("article page emits og:type article and an author profile URL", async ({
		request,
	}) => {
		const html = await htmlFor(request, "/929/1/1");
		expectCompleteOg(html, "/929/1/1");
		expect(tagsFor(html, "og:type")[0]).toBe("article");
		const authors = tagsFor(html, "article:author");
		expect(authors.length).toBeGreaterThan(0);
		for (const author of authors) {
			expect(author).toMatch(/^https:\/\/.*\/929\/authors\//);
		}
	});

	test("Hebrew-slug commentary emits article metadata without a fake author", async ({
		request,
	}) => {
		// The test DB only seeds perushim for perek 1 (the full perushim dump
		// is not loaded locally), so רש"י on בראשית א is the guaranteed case.
		const path = `/929/1/${encodeURIComponent('רש"י')}`;
		const html = await htmlFor(request, path);
		expectCompleteOg(html, path);
		expect(tagsFor(html, "og:type")[0]).toBe("article");
		// OGP requires article:author to be a profile URL; parshanim have none.
		expect(tagsFor(html, "article:author")).toHaveLength(0);
	});

	test("perek og:image carries mime, dimensions and alt whether illustrated or fallback", async ({
		request,
	}) => {
		const html = await htmlFor(request, "/929/1");
		expect(tagsFor(html, "og:image")[0]).toMatch(/^https?:\/\//);
		expect(tagsFor(html, "og:image:type")[0]).toMatch(/^image\//);
		expect(tagsFor(html, "og:image:alt")[0]).toBeTruthy();
		// The branded fallback (test DB has no illustrations) always carries
		// its intrinsic dimensions; a real illustration carries its own.
		for (const dim of ["og:image:width", "og:image:height"]) {
			expect(tagsFor(html, dim)[0]).toMatch(/^\d+$/);
		}
	});

	test("pages without a content image fall back to the branded card", async ({
		request,
	}) => {
		const html = await htmlFor(request, "/accessibility");
		expect(tagsFor(html, "og:image")[0]).toBe(
			`${SITE_ORIGIN}/images/og/default.jpg`,
		);
		expect(tagsFor(html, "og:image:type")[0]).toBe("image/jpeg");
		expect(tagsFor(html, "og:image:width")[0]).toBe("1200");
		expect(tagsFor(html, "og:image:height")[0]).toBe("630");
	});

	test("the fallback image asset is publicly fetchable as JPEG", async ({
		request,
	}) => {
		const response = await request.get("/images/og/default.jpg", {
			timeout: 60000,
		});
		expect(response.status()).toBe(200);
		expect(response.headers()["content-type"]).toContain("image/jpeg");
		const body = await response.body();
		// JPEG magic bytes.
		expect(body[0]).toBe(0xff);
		expect(body[1]).toBe(0xd8);
	});

	test("social crawler UA receives og:* tags inside <head>", async ({
		request,
	}) => {
		const html = await htmlFor(request, "/929/1", {
			"user-agent": SOCIAL_BOT_UA,
		});
		const headEnd = html.indexOf("</head>");
		expect(headEnd).toBeGreaterThan(0);
		for (const tag of html.match(/<meta[^>]+property="og:[^"]*"[^>]*>/g) ??
			[]) {
			expect(html.indexOf(tag)).toBeLessThan(headEnd);
		}
		expectCompleteOg(html, "/929/1");
	});

	test("masora keeps its noindex policy alongside complete og:* tags", async ({
		request,
	}) => {
		const html = await htmlFor(request, `/${encodeURIComponent("מסורה")}`);
		expect(tagsFor(html, "robots", "name")[0]).toContain("noindex");
		expectCompleteOg(html, "/מסורה");
	});

	test("a missing page returns 404 and does not advertise bogus metadata", async ({
		request,
	}) => {
		const response = await request.get("/929/0/", { timeout: 120000 });
		expect(response.status()).toBe(404);
		const html = await response.text();
		// The 404 must not inherit the root layout's homepage OG block.
		expect(tagsFor(html, "og:url")).toHaveLength(0);
		expect(tagsFor(html, "og:title")).toHaveLength(0);
		expect(canonicalHref(html)).toBeUndefined();
	});

	test("the /929/rabbis rewrite alias serves the authors page canonical", async ({
		request,
	}) => {
		// /929/rabbis is a rewrite (not a redirect): it serves /929/authors at
		// the alias URL, so og:url/canonical must point at the canonical path.
		const html = await htmlFor(request, "/929/rabbis");
		expectCompleteOg(html, "/929/rabbis");
		expect(canonicalHref(html)).toBe(`${SITE_ORIGIN}/929/authors`);
		expect(tagsFor(html, "og:url")[0]).toBe(`${SITE_ORIGIN}/929/authors`);
	});

	test("the legacy /authors route still redirects permanently", async ({
		request,
	}) => {
		const response = await request.get("/authors", {
			timeout: 60000,
			maxRedirects: 0,
		});
		expect(response.status()).toBe(308);
		expect(response.headers().location).toBe("/929/authors");
	});
});
