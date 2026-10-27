import { expect, test } from "../util/playwright/test-fixture";
import { TOP_NAV_BLUE, topNavBackground } from "../util/playwright/top-nav";

const PARASHA_ROOT = `/${encodeURIComponent("פרשה")}`;

/**
 * פרשה reader e2e — the weekly Torah-reading division under its own
 * root. Covers the landing (five Torah sefarim only), a unit's Torah
 * text, the labeled Haftarah custom variants, multi-range auxiliary
 * readings, unit navigation, and indexable base readings with duplicate
 * presentation/content variants excluded from search.
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

		await page
			.getByRole("link", { name: /פרשת בראשית/ })
			.first()
			.click();
		// First visit compiles the unit route — allow for cold dev servers.
		await page.waitForURL(`**${PARASHA_ROOT}/1`, { timeout: 90_000 });
		await expect(
			page.getByRole("heading", { level: 1, name: /פרשת בראשית/ }),
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
		await page.goto(`${PARASHA_ROOT}/1`);
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

		// Adjacent-unit navigation by parasha identity.
		await page.getByRole("link", { name: /פרשה הבאה/ }).click();
		await page.waitForURL(`**${PARASHA_ROOT}/2`, { timeout: 60_000 });
		await expect(
			page.getByRole("heading", { level: 1, name: /פרשת נח/ }),
		).toBeVisible();
		await page.getByRole("link", { name: /פרשה קודמת/ }).click();
		await page.waitForURL(`**${PARASHA_ROOT}/1`);
	});

	test("multi-range Haftarah preserves the perek jump", async ({ page }) => {
		// פרשת יתרו (unit 17): אשכנזים reads ישעיהו ו-ז plus ט ה-ו —
		// separate ranges, never filled in between.
		await page.goto(`${PARASHA_ROOT}/17`);
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
	}) => {
		// פרשת ויגש (unit 11): the documented חב"ד division re-slices
		// עליות ג-ה — רביעי moves from בראשית מה יט to מה כח (#2519).
		await page.goto(`${PARASHA_ROOT}/11`);
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
		// wait for the soft-navigation round-trip. The click may race
		// hydration, so retry until the press lands.
		const chabadButton = page.getByRole("button", { name: 'חב"ד' });
		await expect(async () => {
			if ((await chabadButton.getAttribute("aria-pressed")) !== "true") {
				await chabadButton.click();
			}
			await expect(chabadButton).toHaveAttribute("aria-pressed", "true");
		}).toPass({ timeout: 15_000 });
		await expect(markerAt("pasuk-45-19")).toHaveCount(0);
		await expect(markerAt("pasuk-45-28").first()).toHaveText("רביעי");
		await expect(markerAt("pasuk-46-8").first()).toHaveText("חמישי");
		// The choice mirrors into ?variant= once the soft navigation
		// commits — dev-server RSC renders can take tens of seconds.
		await expect(page).toHaveURL(/variant=/, { timeout: 60_000 });

		// Re-selecting the common split clears the selection params.
		const commonButton = page.getByRole("button", { name: "נפוץ" });
		await expect(async () => {
			if ((await commonButton.getAttribute("aria-pressed")) !== "true") {
				await commonButton.click();
			}
			await expect(commonButton).toHaveAttribute("aria-pressed", "true");
		}).toPass({ timeout: 15_000 });
		await expect(markerAt("pasuk-45-19").first()).toHaveText("רביעי");
	});

	test("joined parashot keep separate unit identities", async ({ page }) => {
		// ויקהל (22) and פקודי (23) are joined in some years but stay
		// distinct addressable units.
		await page.goto(`${PARASHA_ROOT}/22`);
		await expect(
			page.getByRole("heading", { level: 1, name: /פרשת ויקהל/ }),
		).toBeVisible();
		await page.goto(`${PARASHA_ROOT}/23`);
		await expect(
			page.getByRole("heading", { level: 1, name: /פרשת פקודי/ }),
		).toBeVisible();
	});

	test("seo policy: base parasha units stay indexable and self-canonical", async ({
		page,
	}) => {
		await page.goto(`${PARASHA_ROOT}/1`);
		await expect(
			page.locator('meta[name="robots"][content*="noindex"]'),
		).toHaveCount(0);
		await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
			"href",
			/%D7%A4%D7%A8%D7%A9%D7%94\/1|פרשה\/1/,
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
			const response = await request.get(`${PARASHA_ROOT}/1${suffix}`);
			expect(response.status()).toBe(200);
			expect(response.headers()["x-robots-tag"]).toBe(
				suffix && !suffix.startsWith("?utm_") ? "noindex, follow" : undefined,
			);
			const html = await response.text();
			expect(html).not.toMatch(/<meta name="robots" content="[^"]*noindex/);
			expect(html).toMatch(
				/<link rel="canonical" href="[^"]*(?:%D7%A4%D7%A8%D7%A9%D7%94|פרשה)\/1"/,
			);
		}
		for (const path of [
			"/parasha/1?perush=Rashi",
			`${PARASHA_ROOT}/${encodeURIComponent("בראשית")}/${encodeURIComponent("כריכה")}`,
		]) {
			const response = await request.get(path);
			expect(response.status(), path).toBe(200);
			expect(response.headers()["x-robots-tag"], path).toBe("noindex, follow");
		}
	});

	test("book view opens on ?book and shows the sefer book", async ({
		page,
	}) => {
		await page.goto(`${PARASHA_ROOT}/1?book`);
		const overlay = page.locator('[class*="seferOverlay"]');
		await expect(overlay).toBeVisible({ timeout: 15_000 });
	});

	test("unknown unit ids return 404", async ({ page }) => {
		const response = await page.goto(`${PARASHA_ROOT}/55`);
		expect(response?.status()).toBe(404);
	});
});
