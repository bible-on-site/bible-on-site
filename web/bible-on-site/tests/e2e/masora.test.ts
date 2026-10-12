import { expect, test } from "../util/playwright/test-fixture";

const MASORA_ROOT = `/${encodeURIComponent("מסורה")}`;

/**
 * מסורה reader e2e — the shared reading-unit contract rendered under
 * its own root. Covers the derivation shapes the contract supports: a
 * regular unit ending mid-pasuk, a cross-perek unit, a single-pasuk
 * unit, and the deliberate SEO policy (equivalent whole-perek units
 * consolidate to /929; the rest stay noindex).
 */
test.describe("מסורה reading root", () => {
	test("landing lists sefarim with links into their first units", async ({
		page,
	}) => {
		await page.goto(MASORA_ROOT);
		await expect(
			page.getByRole("heading", { name: "מסורה על הפרק" }),
		).toBeVisible();
		await expect(page).toHaveTitle(/מסורה על הפרק/);

		// בראשית is the first sefer; its first unit is 1.
		const bereshit = page.getByRole("link", { name: "בראשית" }).first();
		await expect(bereshit).toBeVisible();
		await bereshit.click();
		// First visit compiles the unit route — allow for cold dev servers.
		await page.waitForURL(`**${MASORA_ROOT}/1`, { timeout: 60_000 });
		await expect(
			page.getByRole("heading", { level: 1, name: "בראשית פרשה א" }),
		).toBeVisible();
	});

	test("unit page renders text, closing break, nav, and sections", async ({
		page,
	}) => {
		await page.goto(`${MASORA_ROOT}/1`);
		// Article/perush cards render h1s too — address the unit heading by name.
		const heading = page.getByRole("heading", {
			level: 1,
			name: "בראשית פרשה א",
		});
		await expect(heading).toBeVisible();
		// Unit 1 closes on a פתוחה marker.
		await expect(heading).toContainText("פרשה פתוחה");

		// Canonical pasuk anchors carry perek coordinates.
		await expect(page.locator("#pasuk-1-5")).toBeAttached();

		// Range-scoped commentary/article sections render.
		await expect(
			page.getByRole("heading", { name: "פרשנים על הפרשה" }),
		).toBeVisible();
		await expect(
			page.getByRole("heading", { name: "מאמרים על הפרשה" }),
		).toBeVisible();

		// Adjacent-unit navigation.
		await page.getByRole("link", { name: /פרשה הבאה/ }).click();
		await page.waitForURL(`**${MASORA_ROOT}/2`);
		await page.getByRole("link", { name: /פרשה קודמת/ }).click();
		await page.waitForURL(`**${MASORA_ROOT}/1`);

		// Breadcrumb exposes the division label.
		await expect(
			page
				.getByRole("navigation", { name: "Breadcrumb" })
				.getByRole("link", { name: "מסורה על הפרק" }),
		).toBeVisible();
	});

	test("cross-perek unit keeps canonical pasuk anchors", async ({ page }) => {
		// Unit 8 spans בראשית ב ד - ג טו.
		await page.goto(`${MASORA_ROOT}/8`);
		await expect(
			page.getByRole("heading", { level: 1, name: "בראשית פרשה ח" }),
		).toBeVisible();
		await expect(page.locator("#pasuk-2-4")).toBeAttached();
		await expect(page.locator("#pasuk-3-15")).toBeAttached();
	});

	test("single-pasuk unit with intra-pasuk boundary renders", async ({
		page,
	}) => {
		// Unit 2826 is דברי הימים א ה כט — one pasuk cut mid-verse.
		await page.goto(`${MASORA_ROOT}/2826`);
		await expect(
			page.getByRole("heading", { level: 1, name: "דברי הימים פרשה נח" }),
		).toBeVisible();
		await expect(page.locator("#pasuk-869-29")).toBeAttached();
	});

	test("seo policy: non-equivalent unit is noindex, whole-perek unit canonicalizes", async ({
		page,
	}) => {
		// Unit 1 is not a whole perek → self canonical + noindex,follow.
		await page.goto(`${MASORA_ROOT}/1`);
		await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
			"content",
			/noindex/,
		);
		await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
			"href",
			/%D7%9E%D7%A1%D7%95%D7%A8%D7%94\/1|מסורה\/1/,
		);

		// Unit 523 covers exactly במדבר לו (perek 153) → canonical /929/153.
		await page.goto(`${MASORA_ROOT}/523`);
		await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
			"href",
			/\/929\/153$/,
		);
	});

	test("unknown unit ids return 404", async ({ page }) => {
		const response = await page.goto(`${MASORA_ROOT}/99999`);
		expect(response?.status()).toBe(404);
	});
});
