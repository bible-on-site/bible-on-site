import { expect, test } from "../util/playwright/test-fixture";

const PARASHA_ROOT = `/${encodeURIComponent("פרשה")}`;

/**
 * פרשה reader e2e — the weekly Torah-reading division under its own
 * root. Covers the landing (five Torah sefarim only), a unit's Torah
 * text, the labeled Haftarah custom variants, multi-range auxiliary
 * readings, unit navigation, and the deliberate alternate-slice SEO
 * policy (noindex + self canonical).
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

	test("seo policy: parasha units are noindex alternate slices", async ({
		page,
	}) => {
		await page.goto(`${PARASHA_ROOT}/1`);
		await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
			"content",
			/noindex/,
		);
		await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
			"href",
			/%D7%A4%D7%A8%D7%A9%D7%94\/1|פרשה\/1/,
		);
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
