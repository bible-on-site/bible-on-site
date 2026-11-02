import { expect, test } from "../../util/playwright/test-fixture";

/**
 * E2E tests for the article detail page (/929/[number]/[slug]).
 *
 * Test data (tanah_test_data.sql): perek 1 has articles; first article has
 * name "בראשית ברא - עיון בפסוק הראשון", author 1 "הרב לדוגמא שליט"א", and HTML content.
 */

test.describe("Article page", () => {
	test("shows rabbi name, picture, title, and article body", async ({
		page,
	}) => {
		// Direct navigation to first article of perek 1
		await page.goto("/929/1/1");

		const articleView = page.locator("#article-view");
		await expect(articleView).toBeVisible({ timeout: 10_000 });

		// Rabbi (author) name in header
		await expect(
			articleView.locator("span").filter({ hasText: "הרב לדוגמא" }),
		).toBeVisible();

		// Rabbi picture
		await expect(articleView.locator("img[alt*='הרב']")).toBeVisible();

		// Article title
		await expect(
			articleView.getByRole("heading", { name: /בראשית ברא/ }),
		).toBeVisible();

		// Article body content (test data has "פתיחה" and "בראשית" in content)
		await expect(articleView.getByText("פתיחה")).toBeVisible();
		await expect(
			articleView.getByRole("heading", { name: /פירוש המילה "בראשית"/ }),
		).toBeVisible();
	});

	test("author name links to author page", async ({ page }) => {
		await page.goto("/929/1/1");

		const articleView = page.locator("#article-view");
		await expect(articleView).toBeVisible({ timeout: 10_000 });

		const authorLink = articleView.locator('a[href*="/929/authors/"]');
		await expect(authorLink).toBeVisible();

		await authorLink.click();
		await page.waitForURL(/\/929\/authors\/.+$/);
		await expect(page.locator("h1")).toContainText("הרב");
	});

	test("back to perek link returns to perek page", async ({ page }) => {
		await page.goto("/929/1/1");

		const backLink = page.getByRole("link", { name: /חזרה לפרק/ });
		await expect(backLink).toBeVisible();
		await expect(backLink).toHaveAttribute("href", "/929/1");

		await backLink.click();
		await page.waitForURL(/\/929\/1$/);
		await expect(page).toHaveURL(/\/929\/1$/);
	});

	test("aligns article-route controls in the unified command row (#2786)", async ({
		page,
	}) => {
		await page.goto("/929/1/1");

		const articleView = page.locator("#article-view");
		const commandRow = articleView.getByRole("group", {
			name: "פעולות מאמר",
		});
		await expect(commandRow).toBeVisible();

		// The row trails the article — the main content stays on top
		// (review ask: on the standalone route the commands sit at the
		// bottom).
		const ordering = await articleView.evaluate((article) => {
			const children = Array.from(article.children);
			const row = article.querySelector('[data-flipbook-no-flip]');
			const header = article.querySelector("header");
			const body = article.querySelector('[class*="articleBody"]');
			const follows = (before: Element | null, after: Element | null) =>
				before != null &&
				after != null &&
				!!(before.compareDocumentPosition(after) &
					Node.DOCUMENT_POSITION_FOLLOWING);
			return {
				rowLast: children[children.length - 1] === row?.parentElement,
				rowAfterHeader: follows(header, row),
				rowAfterBody: follows(body, row),
			};
		});
		expect(ordering).toEqual({
			rowLast: true,
			rowAfterHeader: true,
			rowAfterBody: true,
		});

		// Return is a real link to the perek route; share is a command button.
		await expect(
			commandRow.getByRole("link", { name: "חזרה לפרק" }),
		).toHaveAttribute("href", "/929/1");
		const share = commandRow.getByRole("button", { name: "שתף" });
		await expect(share).toBeVisible();
		// Both commands share the one base control treatment.
		const treatment = await commandRow.evaluate((row) =>
			Array.from(row.querySelectorAll("[data-article-action]")).map((el) => {
				const computed = getComputedStyle(el);
				return {
					height: el.getBoundingClientRect().height,
					radius: computed.borderRadius,
					background: computed.backgroundColor,
					border: computed.borderColor,
				};
			}),
		);
		expect(treatment.length).toBe(2);
		expect(treatment[1]).toEqual(treatment[0]);

		// No fullscreen command on a route that already is a full page, and
		// the old bottom-only back row is gone.
		await expect(
			commandRow.getByRole("button", { name: "מסך מלא" }),
		).toHaveCount(0);
		await expect(articleView.getByText("חזרה לפרק →")).toHaveCount(0);
	});

	test("opening article from carousel shows same article content", async ({
		page,
	}) => {
		await page.goto("/929/1");

		const articlesSection = page.locator("section").filter({
			has: page.locator("text=מאמרים על הפרק"),
		});
		await expect(articlesSection).toBeVisible();

		// Click first article in carousel
		await articlesSection.locator("a").first().click();
		await page.waitForURL(/\/929\/1\/\d+$/);

		// Same article view content
		const articleView = page.locator("#article-view");
		await expect(articleView).toBeVisible({ timeout: 10_000 });
		await expect(
			articleView.getByRole("heading", { name: /בראשית ברא/ }),
		).toBeVisible();
	});
});
