import { expect } from "@playwright/test";
import { SeferPage } from "../../../util/playwright/page-objects/sefer-page";
import { test } from "../../../util/playwright/test-fixture";

test.describe("Sefer commentary navigation", () => {
	test.beforeEach(({ skipOnNotWideEnough }) => {
		void skipOnNotWideEnough;
	});

	for (const mouseMode of ["turn", "select"] as const) {
		for (const kind of ["perush", "article"] as const) {
			test(`opens ${kind} after paging in mouse ${mouseMode} mode and restores it with history`, async ({ page }) => {
				test.setTimeout(90_000);
				const seferPage = new SeferPage(page);
				await seferPage.openSeferViewForPerek(1);
				await page.locator(".flipbook-toolbar-next").click();
				await expect(page).toHaveURL(/\/929\/2\?book/);
				await page.locator(".flipbook-toolbar-prev").click();
				await expect(page).toHaveURL(/\/929\/1\?book/);
				if (mouseMode === "select") {
					await page.getByRole("button", { name: "בחירת טקסט עם העכבר" }).click();
				}
				await page.locator(".he-book").evaluate((book) => {
					book.setAttribute("data-navigation-marker", "same-book");
				});
				const blank = page.locator('.he-book .page[data-page-index="4"]');
				const item = kind === "article"
					? blank.locator("button#article-1")
					: blank.getByRole("button", { name: /רש"י/ });
				const back = blank.getByRole("button", {
					name: kind === "article" ? "חזרה למאמרים →" : "→ חזרה לפרשנים",
				});
				await item.click();
				await expect(back).toBeVisible({ timeout: 30_000 });
				await expect(blank.getByText(kind === "article" ? "פתיחה" : /אמר רבי יצחק/)).toBeVisible();
				await expect.poll(() => decodeURIComponent(new URL(page.url()).pathname))
					.toBe(kind === "article" ? "/929/1/1" : '/929/1/רש"י');
				await page.goBack();
				await expect(page).toHaveURL(/\/929\/1\?book/);
				await expect(back).toHaveCount(0);
				await expect(item).toBeVisible();
				await page.goForward();
				await expect(back).toBeVisible({ timeout: 30_000 });
				await expect(page.locator(".he-book")).toHaveAttribute("data-navigation-marker", "same-book");
				await back.click();
				await expect(item).toBeVisible();
				await expect(page).toHaveURL(/\/929\/1\?book/);
			});
		}
	}

	for (const kind of ["perush", "article"] as const) {
		test(`opens ${kind} after a TOC jump to a different chapter`, async ({ page }) => {
			test.setTimeout(90_000);
			await page.goto("/929/2?book&toc");
			const chapter = page.locator('.he-book .page[data-page-index="2"] .toc-link[href]').first();
			await expect(chapter).toBeVisible({ timeout: 60_000 });
			await chapter.click();
			const blank = page.locator('.he-book .page[data-page-index="4"]');
			await (kind === "article" ? blank.locator("button#article-1") : blank.getByRole("button", { name: /רש"י/ })).click();
			await expect(blank.getByText(kind === "article" ? "פתיחה" : /אמר רבי יצחק/)).toBeVisible();
			await expect(page.locator(".flipbook-toolbar-indicator")).toHaveValue("א / נ");
		});

		test(`reopens the ${kind} deep link on reload and can open another item`, async ({ page }) => {
			test.setTimeout(90_000);
			const route = kind === "article" ? "/929/1/1?book" : `/929/1/${encodeURIComponent('רש"י')}?book`;
			await page.goto(route);
			const blank = page.locator('.he-book .page[data-page-index="4"]');
			const back = blank.getByRole("button", {
				name: kind === "article" ? "חזרה למאמרים →" : "→ חזרה לפרשנים",
			});
			await expect(back).toBeVisible({ timeout: 60_000 });
			await expect(page).toHaveURL(new RegExp(kind === "article" ? "/929/1/1\\?book" : "%D7%A8%D7%A9%22%D7%99\\?book"));
			await page.reload();
			await expect(back).toBeVisible({ timeout: 60_000 });
			await back.click();
			await expect(blank.getByRole("button", { name: /אבן עזרא/ })).toBeVisible();
			await blank.getByRole("button", { name: /אבן עזרא/ }).click();
			await expect(blank.getByText(/יש אומרים כי המילה/)).toBeVisible();
			await expect.poll(() => decodeURIComponent(new URL(page.url()).pathname)).toBe("/929/1/אבן עזרא");
		});
	}
});
