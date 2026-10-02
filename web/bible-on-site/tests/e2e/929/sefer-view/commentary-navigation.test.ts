import { expect } from "@playwright/test";
import { SeferPage } from "../../../util/playwright/page-objects/sefer-page";
import { test } from "../../../util/playwright/test-fixture";

test.describe("Sefer commentary navigation", () => {
	test.beforeEach(({ skipOnNotWideEnough }) => {
		void skipOnNotWideEnough;
	});

	test.describe("Touch content navigation", () => {
		test.use({ hasTouch: true });
		for (const kind of ["perush", "article"] as const) {
			test(`opens ${kind} on the first tap after a native page swipe`, async ({
				page,
			}) => {
				test.setTimeout(90_000);
				const seferPage = new SeferPage(page);
				await seferPage.openSeferViewForPerek(2);
				await seferPage.verifyPesukimAreVisible();
				await expect(page).toHaveURL(/\/929\/2\?book/);
				await expect(page.locator(".flipbook-toolbar-indicator")).toHaveValue(
					"ב / נ",
				);
				await page.evaluate(() => document.fonts.ready);
				const rect = await page
					.locator(".he-book .page.current-page article")
					.first()
					.boundingBox();
				if (!rect) throw new Error("Verse text is not visible");
				const x = Math.round(rect.x + rect.width - 40);
				const y = Math.round(rect.y + 45);
				expect(
					await page.evaluate(
						({ x, y }) => {
							const target = document.elementFromPoint(x, y);
							return (
								!!target?.closest("article") &&
								!target.closest("[data-flipbook-no-flip]")
							);
						},
						{ x, y },
					),
				).toBe(true);
				const client = await page.context().newCDPSession(page);
				await client.send("Input.dispatchTouchEvent", {
					type: "touchStart",
					touchPoints: [{ x, y }],
				});
				for (let step = 1; step <= 6; step++) {
					await client.send("Input.dispatchTouchEvent", {
						type: "touchMove",
						touchPoints: [{ x: x - Math.round((step * 650) / 6), y }],
					});
					if (step === 3) {
						await expect
							.poll(() =>
								page
									.locator(".he-book .page")
									.evaluateAll((pages) =>
										pages.some(
											(element) =>
												(element as HTMLElement).style.willChange ===
												"transform",
										),
									),
							)
							.toBe(true);
					}
				}
				await client.send("Input.dispatchTouchEvent", {
					type: "touchEnd",
					touchPoints: [],
				});
				await expect(page.locator(".flipbook-toolbar-indicator")).toHaveValue(
					"א / נ",
				);
				const blank = page.locator('.he-book .page[data-page-index="4"]');
				const item =
					kind === "article"
						? blank.locator("button#article-1")
						: blank.getByRole("button", { name: /רש"י/ });
				await item.tap();
				await expect(
					blank.getByText(kind === "article" ? "פתיחה" : /אמר רבי יצחק/),
				).toBeVisible({ timeout: 30_000 });
				await expect
					.poll(() => decodeURIComponent(new URL(page.url()).pathname))
					.toBe(kind === "article" ? "/929/1/1" : '/929/1/רש"י');
			});
		}
	});

	for (const mouseMode of ["turn", "select"] as const) {
		for (const kind of ["perush", "article"] as const) {
			test(`opens ${kind} after paging in mouse ${mouseMode} mode and restores it with history`, async ({
				page,
			}) => {
				test.setTimeout(90_000);
				const seferPage = new SeferPage(page);
				await seferPage.openSeferViewForPerek(1);
				await page.locator(".flipbook-toolbar-next").click();
				await expect(page).toHaveURL(/\/929\/2\?book/);
				await page.locator(".flipbook-toolbar-prev").click();
				await expect(page).toHaveURL(/\/929\/1\?book/);
				if (mouseMode === "select") {
					await page
						.getByRole("button", { name: "בחירת טקסט עם העכבר" })
						.click();
				}
				await page.locator(".he-book").evaluate((book) => {
					book.setAttribute("data-navigation-marker", "same-book");
				});
				const blank = page.locator('.he-book .page[data-page-index="4"]');
				const item =
					kind === "article"
						? blank.locator("button#article-1")
						: blank.getByRole("button", { name: /רש"י/ });
				const back = blank.getByRole("button", {
					name: kind === "article" ? "חזרה למאמרים →" : "→ חזרה לפרשנים",
				});
				await item.click();
				await expect(back).toBeVisible({ timeout: 30_000 });
				await expect(
					blank.getByText(kind === "article" ? "פתיחה" : /אמר רבי יצחק/),
				).toBeVisible();
				await expect
					.poll(() => decodeURIComponent(new URL(page.url()).pathname))
					.toBe(kind === "article" ? "/929/1/1" : '/929/1/רש"י');
				await page.goBack();
				await expect(page).toHaveURL(/\/929\/1\?book/);
				await expect(back).toHaveCount(0);
				await expect(item).toBeVisible();
				await page.goForward();
				await expect(back).toBeVisible({ timeout: 30_000 });
				await expect(page.locator(".he-book")).toHaveAttribute(
					"data-navigation-marker",
					"same-book",
				);
				await back.click();
				await expect(item).toBeVisible();
				await expect(page).toHaveURL(/\/929\/1\?book/);
			});
		}
	}

	for (const kind of ["perush", "article"] as const) {
		test(`opens ${kind} after a TOC jump to a different chapter`, async ({
			page,
		}) => {
			test.setTimeout(90_000);
			await page.goto("/929/2?book&toc");
			const chapter = page
				.locator('.he-book .page[data-page-index="2"] .toc-link[href]')
				.first();
			await expect(chapter).toBeVisible({ timeout: 60_000 });
			await chapter.click();
			const blank = page.locator('.he-book .page[data-page-index="4"]');
			await (kind === "article"
				? blank.locator("button#article-1")
				: blank.getByRole("button", { name: /רש"י/ })
			).click();
			await expect(
				blank.getByText(kind === "article" ? "פתיחה" : /אמר רבי יצחק/),
			).toBeVisible();
			await expect(page.locator(".flipbook-toolbar-indicator")).toHaveValue(
				"א / נ",
			);
		});

		test(`reopens the ${kind} deep link on reload and can open another item`, async ({
			page,
		}) => {
			test.setTimeout(90_000);
			const route =
				kind === "article"
					? "/929/1/1?book"
					: `/929/1/${encodeURIComponent('רש"י')}?book`;
			await page.goto(route);
			const blank = page.locator('.he-book .page[data-page-index="4"]');
			const back = blank.getByRole("button", {
				name: kind === "article" ? "חזרה למאמרים →" : "→ חזרה לפרשנים",
			});
			await expect(back).toBeVisible({ timeout: 60_000 });
			await expect(page).toHaveURL(
				new RegExp(
					kind === "article"
						? "/929/1/1\\?book"
						: "%D7%A8%D7%A9%22%D7%99\\?book",
				),
			);
			await page.reload();
			await expect(back).toBeVisible({ timeout: 60_000 });
			await back.click();
			await expect(
				blank.getByRole("button", { name: /אבן עזרא/ }),
			).toBeVisible();
			await blank.getByRole("button", { name: /אבן עזרא/ }).click();
			await expect(
				blank.getByRole("heading", { name: "אבן עזרא", exact: true }),
			).toBeVisible({ timeout: 30_000 });
			await expect(
				blank.locator('[class*="noteContent"]').first(),
			).toContainText("בראשית");
			await expect
				.poll(() => decodeURIComponent(new URL(page.url()).pathname))
				.toBe("/929/1/אבן עזרא");
		});
	}
});
