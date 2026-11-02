import { expect, test } from "../util/playwright/test-fixture";
import { TOP_NAV_BLUE, topNavBackground } from "../util/playwright/top-nav";

const PARASHA_ROOT = `/${encodeURIComponent("פרשה")}`;

/** Encoded public path for a canonical slug (issue #2738). */
const unitPath = (slug: string) =>
	`${PARASHA_ROOT}/${encodeURIComponent(slug)}`;

/** Matches a decoded pathname exactly — browser URLs stay percent-encoded. */
const pathnameIs = (path: string) => (url: URL) =>
	decodeURIComponent(url.pathname) === path;

/**
 * פרשה reader e2e — the weekly Torah-reading division under its own
 * root. Covers the landing (five Torah sefarim only), a unit's Torah
 * text, the labeled Haftarah custom variants, multi-range auxiliary
 * readings, unit navigation, and indexable base readings with duplicate
 * presentation/content variants excluded from search.
 *
 * Issue #2738: public unit URLs are canonical Hebrew-name slugs —
 * legacy numeric ids, researched aliases, and the ASCII route dir
 * permanent-redirect to them.
 */
test.describe("פרשה reading root", () => {
	// Unit pages render Torah text, every Haftarah variant, perushim,
	// articles, and the embedded sefer book — cold compilation under the
	// e2e dev server can exceed the default 20s budget and parallel
	// workers thrash the first-hit compile even further.
	test.describe.configure({ timeout: 120_000 });

	test("landing lists only the five Torah sefarim", async ({ page }) => {
		await page.goto(PARASHA_ROOT);
		await expect(
			page.getByRole("heading", { name: "פרשה על הפרק" }),
		).toBeVisible();
		await expect(page).toHaveTitle(/פרשה על הפרק/);

		for (const sefer of ["בראשית", "שמות", "ויקרא", "במדבר", "דברים"]) {
			await expect(
				page.getByRole("heading", { name: `ספר ${sefer}` }),
			).toBeVisible();
		}
		// Prophetic sefarim appear only inside Haftarah readings — never
		// as primary sefarim.
		await expect(page.getByRole("heading", { name: "ספר ישעיהו" })).toHaveCount(
			0,
		);

		// Reference sections render but do not replace static content.
		await expect(
			page.getByRole("heading", { name: "פרשיות מחוברות" }),
		).toBeVisible();
		await expect(
			page.getByRole("heading", {
				name: "הפטרות לשבתות ומועדים מיוחדים",
			}),
		).toBeVisible();

		// Every listed parasha href is a canonical Hebrew-name slug.
		for (const link of await page
			.locator("ol a[href]")
			.evaluateAll((anchors) =>
				anchors.map((a) => decodeURIComponent(a.getAttribute("href") ?? "")),
			)) {
			expect(link).toMatch(/^\/פרשה\/[א-ת-]+$/);
		}

		await page
			.getByRole("link", { name: /פרשת בראשית/ })
			.first()
			.click();
		// First visit compiles the unit route — allow for cold dev servers.
		await page.waitForURL(pathnameIs("/פרשה/בראשית"), { timeout: 90_000 });
		await expect(
			page.getByRole("heading", { level: 1, name: /פרשת בראשית/ }),
		).toBeVisible();
	});

	test("legacy numeric and alias URLs permanent-redirect to canonical slugs", async ({
		request,
	}) => {
		for (const [legacy, slug] of [
			["/פרשה/1", "/פרשה/בראשית"],
			["/פרשה/54", "/פרשה/וזאת-הברכה"],
			["/parasha/1", "/פרשה/בראשית"],
			["/פרשה/תצווה", "/פרשה/תצוה"],
			["/פרשה/שלח לך", "/פרשה/שלח"],
			["/פרשה/פרשת לך לך", "/פרשה/לך-לך"],
		] as const) {
			const response = await request.get(legacy, {
				maxRedirects: 0,
			});
			expect(response.status(), legacy).toBe(308);
			const location = response.headers().location ?? "";
			// The proxy emits a same-origin (relative) Location — resolve it.
			expect(
				decodeURIComponent(new URL(location, "http://127.0.0.1:3001").pathname),
				legacy,
			).toBe(slug);
		}
	});

	test("numeric and alias entry points land on the canonical page", async ({
		page,
	}) => {
		await page.goto(`${PARASHA_ROOT}/3`);
		await page.waitForURL(pathnameIs("/פרשה/לך-לך"));
		await expect(
			page.getByRole("heading", { level: 1, name: /פרשת לך לך/ }),
		).toBeVisible();
	});

	test("renders the shared blue top bar on direct load", async ({ page }) => {
		await page.goto(PARASHA_ROOT);
		await expect(
			page.getByRole("heading", { name: "פרשה על הפרק" }),
		).toBeVisible();

		expect(await topNavBackground(page)).toBe(TOP_NAV_BLUE);
	});

	test("keeps the shared blue top bar when navigating from another page", async ({
		page,
	}) => {
		await page.goto("/");
		await page.getByRole("button", { name: "תפריט ראשי" }).click();
		await page
			.locator("#main-menu")
			.getByRole("link", { name: "פרשה על הפרק", exact: true })
			.click();
		await page.waitForURL(
			(url) => decodeURIComponent(url.pathname) === "/פרשה",
		);
		await expect(
			page.getByRole("heading", { name: "פרשה על הפרק" }),
		).toBeVisible();

		expect(await topNavBackground(page)).toBe(TOP_NAV_BLUE);
	});

	test("unit page renders Torah text and labeled Haftarah variants", async ({
		page,
	}) => {
		await page.goto(unitPath("בראשית"));
		await expect(
			page.getByRole("heading", { level: 1, name: /פרשת בראשית/ }),
		).toBeVisible();
		await expect(
			page.getByRole("heading", { name: "קריאת התורה" }),
		).toBeVisible();

		// Canonical pasuk anchors across the whole Torah range
		// (בראשית א א - ו ח → perekIds 1-6).
		await expect(page.locator("#pasuk-1-1")).toBeAttached();
		await expect(page.locator("#pasuk-6-8")).toBeAttached();

		// Every custom variant is labeled — nothing flattened.
		await expect(
			page.getByRole("heading", { name: "הפטרה", exact: true }),
		).toBeVisible();
		for (const custom of ["ספרדים", "אשכנזים", "תימנים"]) {
			await expect(
				page.getByRole("heading", { name: `הפטרה - ${custom}` }),
			).toBeVisible();
		}
		// Haftarah text renders (ישעיהו מב → perekId 376); auxiliary
		// anchors are scope-suffixed so overlapping variants stay unique.
		await expect(page.locator("#pasuk-376-5-haftara-sefaradi")).toBeAttached();

		// Range-scoped commentary/article sections for both readings.
		await expect(
			page.getByRole("heading", { name: "פרשנים על הפרשה" }),
		).toBeVisible();
		await expect(
			page.getByRole("heading", { name: "פרשנים על ההפטרה" }),
		).toBeVisible();

		// Adjacent-unit navigation by parasha identity — canonical slugs.
		// Soft navigations compile the target RSC route under the dev
		// server — same cold-compile budget as the landing nav above.
		await page.getByRole("link", { name: /פרשה הבאה/ }).click();
		await page.waitForURL(pathnameIs("/פרשה/נח"), { timeout: 90_000 });
		await expect(
			page.getByRole("heading", { level: 1, name: /פרשת נח/ }),
		).toBeVisible();
		await page.getByRole("link", { name: /פרשה קודמת/ }).click();
		await page.waitForURL(pathnameIs("/פרשה/בראשית"), { timeout: 90_000 });
	});

	test("multi-range Haftarah preserves the perek jump", async ({ page }) => {
		// פרשת יתרו (unit 17): אשכנזים reads ישעיהו ו-ז plus ט ה-ו —
		// separate ranges, never filled in between.
		await page.goto(unitPath("יתרו"));
		await expect(
			page.getByRole("heading", { level: 1, name: /פרשת יתרו/ }),
		).toBeVisible();
		await expect(page.locator("#pasuk-341-6-haftara-ashkenazi")).toBeAttached();
		await expect(page.locator("#pasuk-343-5-haftara-ashkenazi")).toBeAttached();
		// The skipped perek's pesukim (ישעיהו ח → perekId 342) are absent.
		await expect(page.locator('[id^="pasuk-342-"]')).toHaveCount(0);
	});

	test("aliyah markers and the מנהג variant swap in place", async ({
		page,
	}, testInfo) => {
		// פרשת ויגש (unit 11): the documented חב"ד division re-slices
		// עליות ג-ה — רביעי moves from בראשית מה יט to מה כח (#2519).
		await page.goto(unitPath("ויגש"));
		await expect(
			page.getByRole("heading", { level: 1, name: /פרשת ויגש/ }),
		).toBeVisible();

		const markerAt = (pasukId: string) =>
			page.locator(`#${pasukId} [data-aliyah-marker]:visible`);
		// Default Shabbat layer — prominent aliyah pills at the exact
		// boundary pesukim; the perek label stays a modest pasuk-like
		// text, not the old banner.
		await expect(markerAt("pasuk-44-18").first()).toHaveText("ראשון");
		await expect(markerAt("pasuk-45-19").first()).toHaveText("רביעי");
		await expect(
			page.locator('[class*="perekBreakLabelModest"]', {
				hasText: "בראשית מה",
			}),
		).toBeAttached();

		// The מנהג group offers the documented חב"ד variant. The layer
		// swaps instantly without remounting scripture — it must not
		// wait for the soft-navigation round-trip. The first click must
		// survive hydration without a second user action.
		const chabadButton = page.getByRole("button", { name: 'חב"ד' });
		await chabadButton.click();
		await expect(chabadButton).toHaveAttribute("aria-pressed", "true");
		await expect(markerAt("pasuk-45-19")).toHaveCount(0);
		await expect(markerAt("pasuk-45-28").first()).toHaveText("רביעי");
		await expect(markerAt("pasuk-46-8").first()).toHaveText("חמישי");
		await testInfo.attach("aliyah-first-variant-click", {
			body: await page.getByRole("group", { name: "חלוקת עליות" }).screenshot(),
			contentType: "image/png",
		});
		// The choice mirrors into ?variant= once the soft navigation
		// commits — dev-server RSC renders can take tens of seconds.
		await expect(page).toHaveURL(/variant=/, { timeout: 60_000 });

		// Re-selecting the common split clears the selection params.
		const commonButton = page.getByRole("button", { name: "נפוץ" });
		await commonButton.click();
		await expect(commonButton).toHaveAttribute("aria-pressed", "true");
		await expect(markerAt("pasuk-45-19").first()).toHaveText("רביעי");
		await testInfo.attach("aliyah-first-common-click", {
			body: await page.getByRole("group", { name: "חלוקת עליות" }).screenshot(),
			contentType: "image/png",
		});
	});

	test("joined parashot keep separate unit identities", async ({ page }) => {
		// ויקהל (22) and פקודי (23) are joined in some years but stay
		// distinct addressable units — the joined name never resolves.
		await page.goto(unitPath("ויקהל"));
		await expect(
			page.getByRole("heading", { level: 1, name: /פרשת ויקהל/ }),
		).toBeVisible();
		await page.goto(unitPath("פקודי"));
		await expect(
			page.getByRole("heading", { level: 1, name: /פרשת פקודי/ }),
		).toBeVisible();
		const joined = await page.goto(unitPath("ויקהל-פקודי"));
		expect(joined?.status()).toBe(404);
	});

	test("seo policy: base parasha units stay indexable and self-canonical", async ({
		page,
	}) => {
		await page.goto(unitPath("בראשית"));
		await expect(
			page.locator('meta[name="robots"][content*="noindex"]'),
		).toHaveCount(0);
		await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
			"href",
			/%D7%A4%D7%A8%D7%A9%D7%94\/(?:%D7%91%D7%A8%D7%90%D7%A9%D7%99%D7%AA)|פרשה\/בראשית/,
		);
	});

	test("seo policy: duplicate views stay usable without contaminating base responses", async ({
		request,
	}) => {
		for (const suffix of [
			"",
			"?perush=Rashi",
			"",
			"?book&article=123",
			"",
			"?haftaraPerush=Rashi",
			"?haftaraArticle=123",
			"?book",
			"?variant=x",
			"?utm_source=test",
			"",
		]) {
			const response = await request.get(`${unitPath("בראשית")}${suffix}`);
			expect(response.status()).toBe(200);
			expect(response.headers()["x-robots-tag"]).toBe(
				suffix && !suffix.startsWith("?utm_") ? "noindex, follow" : undefined,
			);
			const html = await response.text();
			expect(html).not.toMatch(/<meta name="robots" content="[^"]*noindex/);
			expect(html).toMatch(
				/<link rel="canonical" href="[^"]*\/(?:%D7%91%D7%A8%D7%90%D7%A9%D7%99%D7%AA|בראשית)"/,
			);
		}
		for (const path of [
			`${PARASHA_ROOT}/${encodeURIComponent("בראשית")}/${encodeURIComponent("כריכה")}`,
		]) {
			const response = await request.get(path);
			expect(response.status(), path).toBe(200);
			expect(response.headers()["x-robots-tag"], path).toBe("noindex, follow");
		}
		// A legacy numeric deep link redirects first, preserving the
		// selection — the canonical page then noindexes the variant.
		const legacy = await request.get("/פרשה/1?perush=Rashi", {
			maxRedirects: 0,
		});
		expect(legacy.status()).toBe(308);
		const location = decodeURIComponent(legacy.headers().location ?? "");
		expect(location).toContain("/פרשה/בראשית");
		expect(location).toContain("perush=Rashi");
	});

	test("book view opens on ?book and shows the sefer book", async ({
		page,
	}) => {
		await page.goto(`${unitPath("בראשית")}?book`);
		const overlay = page.locator('[class*="seferOverlay"]');
		await expect(overlay).toBeVisible({ timeout: 15_000 });
	});

	test("book-chrome cover route still lands on the sefer's first parasha", async ({
		page,
	}) => {
		// Book-chrome public URLs carry ?book (the flipbook history mapper
		// emits them that way) — /פרשה/{sefer}/{cover-slug}?book.
		await page.goto(
			`${PARASHA_ROOT}/${encodeURIComponent("בראשית")}/${encodeURIComponent("כריכה")}?book`,
		);
		const overlay = page.locator('[class*="seferOverlay"]');
		await expect(overlay).toBeVisible({ timeout: 15_000 });
	});

	test("unknown unit ids and unknown names return 404", async ({ page }) => {
		for (const path of [
			`${PARASHA_ROOT}/55`,
			unitPath("דמיון"),
			`${PARASHA_ROOT}/${encodeURIComponent("פרשת דמיון")}`,
		]) {
			const response = await page.goto(path);
			expect(response?.status(), path).toBe(404);
		}
	});
});
