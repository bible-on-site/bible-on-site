import { expect, test } from "../util/playwright/test-fixture";

/**
 * E2E tests for site search (/search + /api/search).
 * Test data (tanah_test_data.sql) seeds authors/articles/notes on בראשית א,
 * and the db-populator Tanahpedia seed adds entries (משה-רבנו, יהושע-בן-נון)
 * with aliases, so "בראשית" plus a couple of entry queries exercise every
 * result type against the real stack.
 */

test.describe("Site search", () => {
	test("is discoverable from an icon-only button pinned to the nav's left edge", async ({
		page,
	}) => {
		await page.goto("/");

		// Persistent icon-only search entry pinned to the physical left
		// edge of the top nav, opposite the hamburger at the right edge.
		// The accessible name comes from aria-label — no visible text (#2154).
		const topNav = page.locator("nav.top-nav");
		const searchEntry = topNav.getByRole("link", { name: "חיפוש" });
		await expect(searchEntry).toBeVisible();
		await expect(searchEntry).toHaveText("");

		// At any viewport the button hugs the left edge with the normal
		// padding while the hamburger hugs the right edge — never adjacent.
		const width = page.viewportSize()?.width ?? 0;
		const searchBox = await searchEntry.boundingBox();
		const hamburgerBox = await page
			.getByRole("button", { name: "תפריט ראשי" })
			.boundingBox();
		expect(searchBox).not.toBeNull();
		expect(hamburgerBox).not.toBeNull();
		expect(searchBox?.x ?? Infinity).toBeLessThan(width * 0.1);
		expect((hamburgerBox?.x ?? 0) + (hamburgerBox?.width ?? 0)).toBeGreaterThan(
			width * 0.9,
		);

		await searchEntry.click();
		await page.waitForURL("**/search");
		await expect(
			page.getByRole("searchbox", { name: "מונח חיפוש" }),
		).toBeVisible();
	});

	test("main menu leads with על הפרק and holds no search row", async ({
		page,
	}) => {
		await page.goto("/");

		await page.getByRole("button", { name: "תפריט ראשי" }).click();
		const menu = page.locator("#main-menu");

		// Search lives on its own header button; the first regular menu
		// item is the reader (#2102).
		const firstItem = menu.locator("ul li").first();
		await expect(firstItem.getByRole("link")).toHaveText(/על הפרק/);
		await expect(firstItem.getByRole("link")).toHaveAttribute(
			"href",
			"/929",
		);
		await expect(
			menu.getByRole("link", { name: "חיפוש" }),
		).toHaveCount(0);
	});

	test("renders SSR results for a shared query URL", async ({ page }) => {
		await page.goto("/search?q=בראשית");

		// Perakim and pesukim resolve from the bundled corpus. Result links
		// contain their snippet text too, so locate by href, not name.
		const perekLink = page.locator('a[data-result-link][href="/929/1"]');
		await expect(perekLink).toBeVisible();

		// Result groups are headed by their Hebrew type names.
		await expect(
			page.getByRole("heading", { name: "פרקים" }),
		).toBeVisible();
		await expect(
			page.getByRole("heading", { name: "פסוקים" }),
		).toBeVisible();
	});

	test("typing settles into a shareable URL and live results", async ({
		page,
	}) => {
		await page.goto("/search");
		const input = page.getByRole("searchbox", { name: "מונח חיפוש" });
		await input.fill("שמע ישראל");

		await page.waitForURL(/q=/, { timeout: 5000 });
		await expect(page).toHaveURL(/q=%D7%A9%D7%9E%D7%A2/);
		// שמע ישראל appears in several perakim; דברים ו ד must be among them.
		await expect(
			page.locator('a[data-result-link][href="/929/159#pasuk-4"]'),
		).toBeVisible();
	});

	test("result links are ordinary crawlable links to canonical pages", async ({
		page,
	}) => {
		await page.goto("/search?q=שמע ישראל");
		const link = page.locator(
			'a[data-result-link][href="/929/159#pasuk-4"]',
		);
		await expect(link).toBeVisible();
		await link.click();
		await page.waitForURL("**/929/159**");

		// Returning restores query, results and list position.
		await page.goBack();
		await page.waitForURL(/q=/);
		await expect(
			page.getByRole("searchbox", { name: "מונח חיפוש" }),
		).toHaveValue("שמע ישראל");
		await expect(
			page.locator('a[data-result-link][href="/929/159#pasuk-4"]'),
		).toBeVisible();
	});

	test("filters narrow the result types and persist in the URL", async ({
		page,
	}) => {
		await page.goto("/search?q=בראשית");
		await page.getByRole("checkbox", { name: "פסוקים" }).click();
		await expect(page).toHaveURL(/type=/);
		await expect(
			page.getByRole("heading", { name: "פסוקים" }),
		).toHaveCount(0);
		await expect(
			page.getByRole("heading", { name: "פרקים" }),
		).toBeVisible();
	});

	test("finds Tanahpedia entries by title, alias and body text", async ({
		page,
	}) => {
		await page.goto(`/search?q=${encodeURIComponent("משה")}`);

		// Title + alias match: the result links the canonical entry slug.
		await expect(
			page.getByRole("heading", { name: "תנכפדיה" }),
		).toBeVisible();
		const entryLink = page.locator(
			`a[data-result-link][href="/pedia/${encodeURIComponent("משה-רבנו")}"]`,
		);
		await expect(entryLink).toBeVisible();

		// A seeded alias ("הושע בן נון") resolves to its canonical entry.
		await page.goto(`/search?q=${encodeURIComponent("הושע בן נון")}`);
		const aliasLink = page.locator(
			`a[data-result-link][href="/pedia/${encodeURIComponent("יהושע-בן-נון")}"]`,
		);
		await expect(aliasLink).toBeVisible();

		// Body-text match: "עלינו לשבח" only appears in the יהושע entry body.
		await page.goto(`/search?q=${encodeURIComponent("עלינו לשבח")}`);
		await expect(
			page.locator(
				`a[data-result-link][href="/pedia/${encodeURIComponent("יהושע-בן-נון")}"]`,
			),
		).toBeVisible();
	});

	test("a Tanahpedia result opens the canonical entry page", async ({
		page,
	}) => {
		await page.goto(`/search?q=${encodeURIComponent("הושע בן נון")}`);
		const link = page.locator(
			`a[data-result-link][href="/pedia/${encodeURIComponent("יהושע-בן-נון")}"]`,
		);
		await expect(link).toBeVisible();
		await link.click();
		await page.waitForURL("**/pedia/*");
		await expect(page.locator("h1")).toContainText("יהושע בן נון");
	});

	test("arrow keys move focus between the input and result links", async ({
		page,
	}) => {
		await page.goto("/search?q=בראשית");
		const input = page.getByRole("searchbox", { name: "מונח חיפוש" });
		// focus() does not wait for the server-rendered input to become interactive.
		await expect(input).toBeEnabled();
		await input.focus();
		await expect(input).toBeFocused();
		await page.keyboard.press("ArrowDown");
		const first = page.locator("a[data-result-link]").first();
		await expect(first).toBeFocused();
		await page.keyboard.press("Escape");
		await expect(input).toBeFocused();
	});

	test("is marked noindex for crawlers but still linkable", async ({
		page,
	}) => {
		const response = await page.goto("/search?q=בראשית");
		expect(response?.status()).toBe(200);
		await expect(
			page.locator('meta[name="robots"]'),
		).toHaveAttribute("content", /noindex/);
		// The search page itself must not appear in the sitemap.
	});

	test("sitemap stays limited to canonical content", async ({
		request,
	}) => {
		const sitemap = await (
			await request.get("/sitemap.xml")
		).text();
		expect(sitemap).not.toContain("/search");
	});
});

test.describe("/api/search", () => {
	test("returns the result contract as JSON", async ({ request }) => {
		const response = await request.get(
			`/api/search?q=${encodeURIComponent("בראשית")}`,
		);
		expect(response.status()).toBe(200);
		expect(response.headers()["cache-control"]).toBe("no-store");
		const body = await response.json();
		expect(body.query).toBe("בראשית");
		const perek = body.results.find(
			(item: { type: string }) => item.type === "perek",
		);
		expect(perek.href).toBe("/929/1");
	});

	test("rejects an empty query", async ({ request }) => {
		const response = await request.get("/api/search");
		expect(response.status()).toBe(400);
	});
});

