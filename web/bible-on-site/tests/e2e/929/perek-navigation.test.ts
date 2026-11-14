import { expect, test } from "../../util/playwright/test-fixture";

/**
 * E2E tests for the previous/next perek navigation on /929/[number]
 * (issue #2518): real crawlable links, canonical-id targets across
 * book/additional boundaries, and no fabricated routes at the edges.
 */

test.describe("Perek Navigation", () => {
	test("navigates to the adjacent perakim by canonical order", async ({
		page,
	}) => {
		await page.goto("/929/2");

		const nav = page.getByRole("navigation", { name: "ניווט בין פרקים" });
		await expect(nav).toBeVisible();
		await expect(
			nav.getByRole("link", { name: /הפרק הקודם/ }),
		).toHaveAttribute("href", "/929/1");
		await expect(
			nav.getByRole("link", { name: /הפרק הבא/ }),
		).toHaveAttribute("href", "/929/3");

		await nav.getByRole("link", { name: /הפרק הבא/ }).click();
		await page.waitForURL("**/929/3");
		await page
			.getByRole("navigation", { name: "ניווט בין פרקים" })
			.getByRole("link", { name: /הפרק הקודם/ })
			.click();
		await page.waitForURL("**/929/2");
	});

	test("exposes semantic prev/next relationships for crawlers", async ({
		page,
	}) => {
		await page.goto("/929/2");
		const nav = page.getByRole("navigation", { name: "ניווט בין פרקים" });
		await expect(nav.getByRole("link", { name: /הפרק הקודם/ })).toHaveAttribute(
			"rel",
			"prev",
		);
		await expect(nav.getByRole("link", { name: /הפרק הבא/ })).toHaveAttribute(
			"rel",
			"next",
		);
	});

	test("labels links with the destination source", async ({ page }) => {
		await page.goto("/929/2");
		const nav = page.getByRole("navigation", { name: "ניווט בין פרקים" });
		await expect(
			nav.getByRole("link", { name: /בראשית א/ }),
		).toBeVisible();
		await expect(
			nav.getByRole("link", { name: /בראשית ג/ }),
		).toBeVisible();
	});

	test("omits the previous link on the first perek", async ({ page }) => {
		await page.goto("/929/1");
		const nav = page.getByRole("navigation", { name: "ניווט בין פרקים" });
		await expect(nav.getByRole("link", { name: /הפרק הקודם/ })).toHaveCount(0);
		await expect(
			nav.getByRole("link", { name: /הפרק הבא/ }),
		).toHaveAttribute("href", "/929/2");
	});

	test("omits the next link on the last perek", async ({ page }) => {
		await page.goto("/929/929");
		const nav = page.getByRole("navigation", { name: "ניווט בין פרקים" });
		await expect(nav.getByRole("link", { name: /הפרק הבא/ })).toHaveCount(0);
		await expect(
			nav.getByRole("link", { name: /הפרק הקודם/ }),
		).toHaveAttribute("href", "/929/928");
	});

	test("crosses the עזרא ע to עזרא נ additional boundary", async ({
		page,
	}) => {
		await page.goto("/929/851");
		const nav = page.getByRole("navigation", { name: "ניווט בין פרקים" });
		await expect(
			nav.getByRole("link", { name: /עזרא נ א/ }),
		).toHaveAttribute("href", "/929/852");
	});
});
