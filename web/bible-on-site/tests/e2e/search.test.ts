import { expect, test } from "../util/playwright/test-fixture";

/**
 * E2E tests for site search (/search + /api/search).
 * Test data (tanah_test_data.sql) seeds authors/articles/notes on בראשית א,
 * so "בראשית" exercises every result type against the real stack.
 */

test.describe("Site search", () => {
	test("is discoverable from the nav button and the main menu", async ({
		page,
	}) => {
		await page.goto("/");

		// Persistent search entry point next to the hamburger.
		const searchEntry = page.getByRole("link", { name: "חיפוש" }).first();
		await expect(searchEntry).toBeVisible();
		await searchEntry.click();
		await page.waitForURL("**/search");
		await expect(
			page.getByRole("searchbox", { name: "מונח חיפוש" }),
		).toBeVisible();
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
		await expect(inputValue(page)).toBe("שמע ישראל");
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

	test("arrow keys move focus between the input and result links", async ({
		page,
	}) => {
		await page.goto("/search?q=בראשית");
		const input = page.getByRole("searchbox", { name: "מונח חיפוש" });
		await input.focus();
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

function inputValue(page: import("@playwright/test").Page) {
	return page
		.getByRole("searchbox", { name: "מונח חיפוש" })
		.evaluate((node: HTMLInputElement) => node.value);
}
