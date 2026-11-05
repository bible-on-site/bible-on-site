import { expect } from "@playwright/test";
import {
	isCI,
	shouldMeasureCov,
} from "../../../../../shared/tests-util/environment.mjs";
import { SeferPage } from "../../../util/playwright/page-objects/sefer-page";
import { test } from "../../../util/playwright/test-fixture";

const bookMountTimeoutMs = isCI || shouldMeasureCov ? 60_000 : 20_000;

/**
 * In-leaf chrome contract (issues #2994 + #2974): every bounded reading
 * surface scrolls inside its own leaf, native scrollbars sit beside the
 * spine, the embedded article drops the standalone card frame, article
 * fullscreen is a single viewport scroller, commentary chips lost their
 * checkmark slot, and chapter-tab settings keep only the קיבוע choice.
 */
test.beforeEach(({ skipOnNotWideEnough }) => {
	void skipOnNotWideEnough;
});

test.describe("Sefer in-leaf chrome (#2994)", () => {
	test("leaf scrollers put their scrollbar on the spine edge and contain overscroll", async ({
		page,
	}) => {
		test.setTimeout(90_000);
		const seferPage = new SeferPage(page);
		await seferPage.openSeferViewForPerek(1);
		await expect(page.locator(".he-book.flipbook")).toBeVisible({
			timeout: bookMountTimeoutMs,
		});

		// Right (scripture) leaf: spine is its left edge, so the scrollport
		// runs RTL — the native bar lands left, next to the fold.
		const scriptureLeaf = page.locator('.he-book .page[data-page-index="3"]');
		await expect(scriptureLeaf).toHaveAttribute("data-scrollbar-side", "left");
		const scriptureScroll = scriptureLeaf.locator(
			'[class*="perekTextScrollWrapper"]',
		);
		const scriptureStyles = await scriptureScroll.evaluate((el) => {
			const computed = getComputedStyle(el);
			return {
				direction: computed.direction,
				overscroll: computed.overscrollBehavior,
				canScroll: el.scrollHeight > el.clientHeight,
			};
		});
		expect(scriptureStyles.direction).toBe("rtl");
		expect(scriptureStyles.overscroll).toBe("contain");
		expect(scriptureStyles.canScroll).toBe(true);

		// Left (panel) leaf: the articles grid adopts the leaf's ltr scroll
		// direction — the bar sits right, beside the spine.
		const panelLeaf = page.locator('.he-book .page[data-page-index="4"]');
		await expect(panelLeaf).toHaveAttribute("data-scrollbar-side", "right");
		await panelLeaf.getByRole("tab", { name: "מאמרים" }).click();
		const articlesScroll = panelLeaf.locator('[class*="articlesScroll"]');
		await expect(articlesScroll).toBeVisible();
		const articlesStyles = await articlesScroll.evaluate((el) => {
			const computed = getComputedStyle(el);
			const firstChild = el.firstElementChild;
			return {
				direction: computed.direction,
				overscroll: computed.overscrollBehavior,
				contentDirection: firstChild
					? getComputedStyle(firstChild).direction
					: null,
			};
		});
		expect(articlesStyles.direction).toBe("ltr");
		expect(articlesStyles.overscroll).toBe("contain");
		// Content stays Hebrew-ordered inside the flipped scroller.
		expect(articlesStyles.contentDirection).toBe("rtl");
	});

	test("embedded article drops the card frame and fullscreen owns one scroller", async ({
		page,
	}) => {
		test.setTimeout(90_000);
		const seferPage = new SeferPage(page);
		await seferPage.openSeferViewForPerek(1);
		const blank = page.locator('.he-book .page[data-page-index="4"]');
		await blank.getByRole("tab", { name: "מאמרים" }).click();
		await expect(blank.locator('[class*="articlesMasonry"]')).toBeVisible();
		await blank
			.locator("a#article-1")
			.locator('[class*="articleCardAbstract"]')
			.click();

		const article = blank.locator("[data-article-view]");
		await expect(article).toBeVisible({ timeout: 30_000 });
		// The standalone-reader card treatment never reaches the book: no
		// rounded/bordered/shadowed wrapper, no outer inset gap.
		await expect(blank.locator('[class*="expandedArticle"]')).toHaveCount(0);
		const fit = await article.evaluate((el) => {
			const leaf = el.closest(".page") as HTMLElement;
			const articleBox = el.getBoundingClientRect();
			const leafBox = leaf.getBoundingClientRect();
			return { articleBox, leafBox };
		});
		// The article hugs the leaf's usable rect — no doubled inset frame.
		expect(fit.articleBox.top - fit.leafBox.top).toBeLessThan(60);
		expect(fit.leafBox.right - fit.articleBox.right).toBeLessThan(24);
		expect(fit.leafBox.left - fit.articleBox.left).toBeLessThan(24);

		// Exactly one active article scroller inside the leaf — elements
		// clipped with overflow:hidden do not take wheel gestures, so only
		// auto/scroll boxes count as scroll owners.
		const scrollers = await article.evaluate((el) => {
			return Array.from(el.querySelectorAll("*")).filter(
				(node) =>
					node.scrollHeight > node.clientHeight + 4 &&
					["auto", "scroll"].includes(getComputedStyle(node).overflowY),
			).length;
		});
		expect(scrollers).toBe(1);

		// Article-only fullscreen covers the viewport and keeps a single
		// scrolling surface.
		await blank.getByRole("button", { name: "מסך מלא" }).click();
		const dialog = page.getByRole("dialog");
		await expect(dialog).toBeVisible();
		const fs = await dialog.evaluate((el) => {
			const box = el.getBoundingClientRect();
			const viewport = {
				w: document.documentElement.clientWidth,
				h: document.documentElement.clientHeight,
			};
			const scrolling = Array.from(el.querySelectorAll("*")).filter(
				(node) =>
					node.scrollHeight > node.clientHeight + 4 &&
					["auto", "scroll"].includes(getComputedStyle(node).overflowY),
			);
			return { box, viewport, scrollerCount: scrolling.length };
		});
		expect(Math.round(fs.box.left)).toBeLessThanOrEqual(1);
		expect(Math.round(fs.box.top)).toBeLessThanOrEqual(1);
		expect(Math.round(fs.box.width)).toBeGreaterThanOrEqual(fs.viewport.w - 2);
		expect(Math.round(fs.box.height)).toBeGreaterThanOrEqual(fs.viewport.h - 2);
		expect(fs.scrollerCount).toBe(1);

		// Scrolling inside the dialog never reaches the outer document.
		await dialog.locator('[class*="articleBodyWrapper"]').hover();
		await page.mouse.wheel(0, 4000);
		expect(await page.evaluate(() => document.documentElement.scrollTop)).toBe(
			0,
		);

		await dialog.getByRole("button", { name: "יציאה ממסך מלא" }).click();
		await expect(dialog).toBeHidden();
	});

	test("commentary chips drop the checkmark slot and keep equal inline padding", async ({
		page,
	}) => {
		test.setTimeout(90_000);
		const seferPage = new SeferPage(page);
		await seferPage.openSeferViewForPerek(1);
		const blank = page.locator('.he-book .page[data-page-index="4"]');
		const chip = blank.getByRole("button", { name: 'בחירת רש"י' });
		await expect(chip).toBeVisible({ timeout: bookMountTimeoutMs });

		// The ✓ indicator and its reserved slot are gone — the label is the
		// only inline content, with symmetric padding on both states.
		const chipMeta = await chip.evaluate((el) => {
			const computed = getComputedStyle(el);
			return {
				html: el.innerHTML,
				padStart: computed.paddingInlineStart,
				padEnd: computed.paddingInlineEnd,
			};
		});
		expect(chipMeta.html).not.toContain("✓");
		expect(chipMeta.html).not.toMatch(/chipCheck|checkmark/i);
		expect(chipMeta.padStart).toBe(chipMeta.padEnd);
		expect(Number.parseFloat(chipMeta.padStart)).toBeGreaterThan(0);

		await chip.click();
		const selected = await chip.evaluate((el) => ({
			pressed: el.getAttribute("aria-pressed"),
			padStart: getComputedStyle(el).paddingInlineStart,
			padEnd: getComputedStyle(el).paddingInlineEnd,
		}));
		expect(selected.pressed).toBe("true");
		expect(selected.padStart).toBe(selected.padEnd);
	});
});

test.describe("Sefer bookmark settings (#2974)", () => {
	test("settings keep only the קיבוע choice and normalize legacy values", async ({
		page,
	}) => {
		test.setTimeout(90_000);
		await page.addInitScript(() => {
			localStorage.setItem(
				"seferBookmarks",
				JSON.stringify({
					enabled: true,
					attachment: "pinned",
					// Retired knobs persisted by older builds — must normalize
					// away rather than render controls for them.
					placement: "top",
					orientation: "parallel",
					order: "title",
					upcomingOnly: true,
				}),
			);
		});
		await page.goto("/929/1");
		await page
			.getByRole("button", { name: "הגדרות קריאה", exact: true })
			.click();
		const dialog = page.getByRole("dialog");
		await expect(dialog).toBeVisible();

		await expect(
			dialog.getByRole("checkbox", { name: "סימניות פרקים" }),
		).toBeChecked();
		// Valid persisted values survive normalization.
		const attachment = dialog.getByRole("combobox", {
			name: "קיבוע סימניות",
		});
		await expect(attachment).toHaveValue("pinned");
		await expect(attachment.locator("option")).toHaveText([
			"מסתובב עם הדף",
			"קבוע לספר",
		]);
		// The retired knobs are gone from the UI entirely.
		await expect(
			dialog.getByRole("combobox", { name: "מיקום סימניות" }),
		).toHaveCount(0);
		await expect(
			dialog.getByRole("combobox", { name: "כיוון סימניות" }),
		).toHaveCount(0);
		await expect(
			dialog.getByRole("combobox", { name: "סדר סימניות" }),
		).toHaveCount(0);
		await expect(
			dialog.getByRole("checkbox", { name: "הצג רק פרקים הבאים" }),
		).toHaveCount(0);
	});
});
