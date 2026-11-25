import { expect, test } from "../util/test-fixture";

test.describe("Articles Management", () => {
	test("displays articles navigation", async ({ page }) => {
		await page.goto("/articles");

		await expect(page.locator("h1")).toContainText("ניהול מאמרים");
		// Should have the perek search combobox
		await expect(
			page.getByRole("combobox", { name: "חיפוש ספר ופרק" }),
		).toBeVisible();
	});

	test("can navigate to new article form", async ({ page }) => {
		await page.goto("/articles");

		await page.getByRole("link", { name: "מאמר חדש" }).click();
		await expect(page).toHaveURL(/\/articles\/new/);
		await expect(page.locator("h1")).toContainText("מאמר חדש");
	});

	test("new article form has required fields", async ({ page }) => {
		await page.goto("/articles/new");

		// Check form fields exist
		await expect(page.getByLabel("שם המאמר")).toBeVisible();
		await expect(page.getByLabel("מחבר")).toBeVisible();
		await expect(page.getByLabel(/פרק/)).toBeVisible();
		await expect(page.getByLabel("עדיפות")).toBeVisible();
	});

	test("article edit page shows every relationship-registry section (#3102)", async ({
		page,
	}) => {
		await page.goto("/articles/1");
		await expect(page.locator("h1")).toContainText("עריכת מאמר");

		// One section per registry entry: managed single-valued fields,
		// verified coverage, dedication assignments, read-only mention
		// annotations and the pending-schema entries.
		await expect(
			page.getByRole("heading", { name: /קשרי המאמר/ }),
		).toBeVisible();
		await expect(page.getByText("פרק ראשי")).toBeVisible();
		await expect(page.getByText("כיסוי פסוקים מאומת")).toBeVisible();
		await expect(
			page.getByRole("heading", { name: "הקדשות", exact: true }),
		).toBeVisible();
		await expect(page.getByText("אנוטציות תנכפדיה")).toBeVisible();
		await expect(page.getByText("תאריך עברי חוזר")).toBeVisible();
		// The panel section heading — the bare text also matches the nav
		// link and the form's checkbox group label.
		await expect(
			page.getByRole("heading", { name: "מועדים", exact: true }),
		).toBeVisible();
		await page.getByRole("link", { name: "PRs לקישורי מאמר זה" }).click();
		await expect(page).toHaveURL(
			(url) => url.pathname === "/" && url.searchParams.get("tab") === "prs",
		);
	});

	test("perek combobox navigates to the picked perek", async ({ page }) => {
		await page.goto("/articles");

		// Wait for page to load
		await expect(page.locator("h1")).toContainText("ניהול מאמרים", {
			timeout: 10000,
		});

		await page
			.getByRole("combobox", { name: "חיפוש ספר ופרק" })
			.fill("בראשית");
		const navigationStarted = performance.now();
		await page.getByRole("option", { name: "בראשית פרק א" }).click();
		await expect(page).toHaveURL(/\/articles\/perek\/1/, { timeout: 15000 });
		await expect(page.getByRole("heading", { name: /פרק 1/ })).toBeVisible({
			timeout: Math.max(1, 15000 - (performance.now() - navigationStarted)),
		});
	});

	test("perek combobox keeps the canonical-number direct jump", async ({
		page,
	}) => {
		await page.goto("/articles");

		const input = page.getByRole("combobox", { name: "חיפוש ספר ופרק" });
		await input.fill("1");
		await expect(
			page.getByRole("option", { name: "בראשית פרק א" }),
		).toBeVisible();
		await input.press("Enter");
		await expect(page).toHaveURL(/\/articles\/perek\/1/);
	});

	test("perek combobox filters by sefer and shows additionals", async ({
		page,
	}) => {
		await page.goto("/articles");

		const input = page.getByRole("combobox", { name: "חיפוש ספר ופרק" });
		await input.fill("שמואל");
		// First perek of שמואל א
		await expect(
			page.getByRole("option", { name: "שמואל פרק א א" }),
		).toBeVisible();
		// First perek of שמואל ב
		await expect(
			page.getByRole("option", { name: "שמואל פרק ב א" }),
		).toBeVisible();
		// Non-matching sefarim are filtered out
		await expect(
			page.getByRole("option", { name: /בראשית/ }),
		).toHaveCount(0);
	});
});
