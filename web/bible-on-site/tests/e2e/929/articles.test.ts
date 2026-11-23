import { expect, test } from "../../util/playwright/test-fixture";

/**
 * E2E tests for the ArticlesSection component (carousel view).
 *
 * Tests verify that articles are displayed correctly when available.
 * Perek 1 (Bereshit א) has test articles seeded in the database.
 */

test.describe("Articles Section", () => {
	test("displays articles carousel when available for perek", async ({
		page,
	}) => {
		// Perek 1 has articles in test data (tanah_test_data.sql)
		await page.goto("/929/1");

		// Check for the articles section
		const articlesSection = page.locator("section").filter({
			has: page.locator("text=מאמרים על הפרק"),
		});

		await expect(articlesSection).toBeVisible();

		// Check that at least one carousel item (link) is displayed
		const carouselItems = articlesSection.locator("a");
		await expect(carouselItems.first()).toBeVisible();
	});

	test("displays author name and image in carousel", async ({ page }) => {
		await page.goto("/929/1");

		// Wait for articles section to appear
		const articlesSection = page.locator("section").filter({
			has: page.locator("text=מאמרים על הפרק"),
		});

		await expect(articlesSection).toBeVisible();

		// Check for author image (the section icon is decorative, alt="")
		const authorImage = articlesSection.locator('img:not([alt=""])');
		await expect(authorImage.first()).toBeVisible();
	});

	test("carousel items link to article page", async ({ page }) => {
		await page.goto("/929/1");

		const articlesSection = page.locator("section").filter({
			has: page.locator("text=מאמרים על הפרק"),
		});

		await expect(articlesSection).toBeVisible();

		// Check that links point to article pages (/929/perekId/slug)
		const articleLink = articlesSection.locator("a").first();
		await expect(articleLink).toBeVisible();
		const href = await articleLink.getAttribute("href");
		expect(href).toMatch(/^\/929\/\d+\/\d+$/);
	});

	test("carousel prev/next buttons scroll one card at a time", async ({
		page,
	}) => {
		// Perek 1 has 4 test articles; they overflow a phone-width carousel.
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto("/929/1");

		const articlesSection = page.locator("section").filter({
			has: page.locator("text=מאמרים על הפרק"),
		});
		const prev = articlesSection.getByRole("button", { name: "מאמר קודם" });
		const next = articlesSection.getByRole("button", { name: "מאמר הבא" });
		const position = articlesSection.getByTestId("carousel-position");

		await expect(next).toBeEnabled();
		await expect(prev).toBeDisabled();
		await expect(position).toHaveText(/^1 \/ 4$/);

		await next.click();
		await expect(position).toHaveText(/^2 \/ 4$/);
		await expect(prev).toBeEnabled();

		await next.click();
		await expect(position).toHaveText(/^3 \/ 4$/);
		await next.click();
		await expect(position).toHaveText(/^4 \/ 4$/);
		await expect(next).toBeDisabled();

		// From the end, prev must land on the partly hidden card 3, not skip it.
		await prev.click();
		await expect(position).toHaveText(/^3 \/ 4$/);
		await prev.click();
		await expect(position).toHaveText(/^2 \/ 4$/);
		await prev.click();
		await expect(position).toHaveText(/^1 \/ 4$/);
		await expect(prev).toBeDisabled();
	});

	test("carousel controls stay hidden when every card fits", async ({
		page,
	}) => {
		// 4 test articles fit side by side at desktop width.
		await page.setViewportSize({ width: 1366, height: 850 });
		await page.goto("/929/1");

		const articlesSection = page.locator("section").filter({
			has: page.locator("text=מאמרים על הפרק"),
		});
		await expect(articlesSection.locator("a").first()).toBeVisible();
		await expect(
			articlesSection.getByRole("button", { name: "מאמר הבא" }),
		).toBeHidden();
		await expect(articlesSection.getByTestId("carousel-position")).toHaveCount(
			0,
		);
	});

	test("keeps clamped abstract paragraphs from painting over each other (#3676)", async ({
		page,
	}, testInfo) => {
		// Fixture article on perek 320 mirrors production article 3336: a long
		// <h1> heading that wraps past the three-line clamp plus a separate
		// <p> source line. Block children inside a line-clamped box get their
		// box height clipped at the clamp point while their remaining lines
		// keep painting, so the source line painted on top of the heading's
		// last line. Assert the line boxes of distinct paragraphs never share
		// vertical space, at desktop and phone widths.
		for (const width of [1366, 390]) {
			await page.setViewportSize({ width, height: 850 });
			await page.goto("/929/320");

			const card = page.locator("a", {
				has: page.locator("text=מלכות עתליה ביהודה"),
			});
			await expect(card).toBeVisible();
			// Fonts swap after load; geometry must be measured with the active
			// font so line boxes match what the user sees.
			await card.evaluate(() => document.fonts.ready);

			const report = await card.evaluate((el) => {
				const abstract = el.querySelector(
					'[class*="articleAbstract"]',
				) as HTMLElement;
				const paras = [...abstract.querySelectorAll("p")];
				const lineRects = paras.map((p) => {
					const range = document.createRange();
					range.selectNodeContents(p);
					return [...range.getClientRects()].filter((r) => r.height > 1);
				});
				const overlapping: [number, number][] = [];
				for (let i = 0; i < lineRects.length; i++) {
					for (let j = i + 1; j < lineRects.length; j++) {
						const sharesVerticalBand = lineRects[i].some((a) =>
							lineRects[j].some(
								(b) =>
									Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2,
							),
						);
						if (sharesVerticalBand) overlapping.push([i, j]);
					}
				}
				return {
					paragraphs: paras.length,
					overlapping,
					clipped: abstract.scrollHeight > abstract.clientHeight,
				};
			});

			expect(
				report.paragraphs,
				`fixture abstract should keep two paragraphs at ${width}px`,
			).toBe(2);
			expect(
				report.overlapping,
				`abstract paragraphs overlap at ${width}px viewport`,
			).toEqual([]);
			// The abstract still exceeds its clamp: a clipped box proves the
			// line-clamp stayed active instead of expanding the card.
			expect(report.clipped).toBe(true);

			// Card capture lands in the HTML report artifact as visual
			// evidence for the clamp state at this width.
			await testInfo.attach(`article-card-${width}px`, {
				body: await card.screenshot(),
				contentType: "image/png",
			});
		}
	});

	test("does not display articles section when no articles exist", async ({
		page,
	}) => {
		// Perek 2 should not have articles in test data
		await page.goto("/929/2");

		// Wait for the page to load by checking perek text area exists
		await expect(page.locator("article").first()).toBeVisible();

		// Articles section renders with an empty message when no articles exist
		const articlesSection = page.locator("section").filter({
			has: page.locator("text=מאמרים על הפרק"),
		});
		await expect(articlesSection).toBeVisible();
		// Should show the empty message and have no article links
		await expect(articlesSection.getByText("אין מאמרים לפרק זה")).toBeVisible();
		await expect(articlesSection.locator("a")).toHaveCount(0);
	});

	test("shows לקריאה נוספת on a perek whose only articles are secondary coverage (#3752)", async ({
		page,
	}) => {
		// Fixture: article 1 (primary בראשית א) verifiably covers בראשית ב א.
		// Perek 2 carries no articles of its own, so the recommendation
		// section is the entire card list.
		await page.goto("/929/2");

		const further = page.locator("section").filter({
			has: page.locator("text=לקריאה נוספת"),
		});
		await expect(further).toBeVisible();
		const card = further.locator("a#article-1");
		await expect(card).toBeVisible();
		// The card routes through the article's OWN primary perek.
		await expect(card).toHaveAttribute("href", "/929/1/1");

		// The regular section keeps its empty state above the recommendations.
		const primary = page.locator("section").filter({
			has: page.locator("text=מאמרים על הפרק"),
		});
		await expect(
			primary.getByText("אין מאמרים לפרק זה"),
		).toBeVisible();
	});

	test("hides לקריאה נוספת on a perek nothing verified covers (#3752)", async ({
		page,
	}) => {
		await page.goto("/929/3");
		await expect(page.locator("article").first()).toBeVisible();
		await expect(
			page.locator("section").filter({ hasText: "לקריאה נוספת" }),
		).toHaveCount(0);
	});
});
