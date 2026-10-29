import { expect } from "@playwright/test";
import { SeferPage } from "../../../util/playwright/page-objects/sefer-page";
import { test } from "../../../util/playwright/test-fixture";

test.describe("Sefer left-page panel", () => {
	test.beforeEach(({ skipOnNotWideEnough }) => {
		void skipOnNotWideEnough;
	});

	test("shows פרשנים and מאמרים tabs flanking the date and switches panels", async ({
		page,
	}) => {
		test.setTimeout(90_000);
		const seferPage = new SeferPage(page);
		await seferPage.openSeferViewForPerek(1);
		const blank = page.locator('.he-book .page[data-page-index="4"]');
		const tablist = blank.getByRole("tablist", { name: "בחירת תצוגה" });
		const perushimTab = blank.getByRole("tab", { name: "פרשנים" });
		const articlesTab = blank.getByRole("tab", { name: "מאמרים" });

		await expect(perushimTab).toHaveAttribute("aria-selected", "true");
		const date = tablist.locator('[role="presentation"]');
		const geometry = await tablist.evaluate((header) => {
			const [right, date, left] = Array.from(header.children).map((el) =>
				el.getBoundingClientRect(),
			);
			return { clear: left.right <= date.left && date.right <= right.left };
		});
		expect(geometry.clear).toBe(true);
		await expect(date).toBeVisible();
		expect(
			await perushimTab.evaluate((el) => getComputedStyle(el).clipPath),
		).toContain("polygon");
		expect(
			await articlesTab.evaluate((el) => getComputedStyle(el).clipPath),
		).toContain("polygon");
		await expect(blank.getByText("התאמה לספר זה")).toHaveCount(0);
		const motion = await articlesTab.evaluate((el) => ({
			property: getComputedStyle(el, "::after").transitionProperty,
			inactive: getComputedStyle(el, "::after").clipPath,
			panel: getComputedStyle(
				document.getElementById(
					el.getAttribute("aria-controls") ?? "",
				) as HTMLElement,
			).transform,
		}));
		expect(motion.property).toBe("clip-path");
		expect(motion.inactive).toContain("polygon");
		expect(motion.panel).toBe("none");

		await expect(articlesTab).toHaveAttribute("aria-selected", "false");

		// The date sits between the two tabs inside the tablist.
		const headerOrder = await tablist.evaluate((el) =>
			Array.from(el.children).map((child) =>
				child.getAttribute("role") === "tab"
					? child.textContent?.trim()
					: "date",
			),
		);
		expect(headerOrder).toEqual(["פרשנים", "date", "מאמרים"]);

		await articlesTab.click();
		await expect
			.poll(() =>
				articlesTab.evaluate((el) => getComputedStyle(el, "::after").clipPath),
			)
			.not.toBe(motion.inactive);
		await expect(articlesTab).toHaveAttribute("aria-selected", "true");
		await expect(perushimTab).toHaveAttribute("aria-selected", "false");
		await expect(blank.locator('[data-tab="articles"]')).toHaveAttribute(
			"data-active",
			"true",
		);
		await expect(blank.locator("a#article-1")).toBeVisible();

		await perushimTab.click();
		await expect(blank.locator('[data-tab="perushim"]')).toHaveAttribute(
			"data-active",
			"true",
		);
		await expect(
			blank.getByRole("button", { name: 'בחירת רש"י' }),
		).toBeVisible();
		await test.info().attach("sefer-panel-perushim-tab", {
			body: await blank.screenshot(),
			contentType: "image/png",
		});
	});

	test("multi-selects perushim and groups their notes by pasuk", async ({
		page,
	}) => {
		test.setTimeout(90_000);
		const seferPage = new SeferPage(page);
		await seferPage.openSeferViewForPerek(1);
		const blank = page.locator('.he-book .page[data-page-index="4"]');
		const rashiToggle = blank.getByRole("button", { name: 'בחירת רש"י' });
		const ibnEzraToggle = blank.getByRole("button", {
			name: "בחירת אבן עזרא",
		});

		await rashiToggle.getByText('רש"י', { exact: true }).click();
		await expect(page).toHaveURL(/\/929\/1\?book/);
		await expect(blank.getByRole("link", { name: 'רש"י' })).toHaveCount(0);
		await expect(rashiToggle).toHaveAttribute("aria-pressed", "true");
		await expect(blank.locator('[data-perush-pasuk="1"]')).toBeVisible({
			timeout: 30_000,
		});
		await expect(blank.getByText(/אמר רבי יצחק/)).toBeVisible();

		await ibnEzraToggle.click();
		await expect(ibnEzraToggle).toHaveAttribute("aria-pressed", "true");
		// With two perushim selected each group labels the perush above its notes.
		const groupOne = blank.locator('[data-perush-pasuk="1"]');
		await expect(
			groupOne.locator('[class*="commentaryPerushName"]', {
				hasText: 'רש"י',
			}),
		).toBeVisible();
		await expect(
			groupOne.locator('[class*="commentaryPerushName"]', {
				hasText: "אבן עזרא",
			}),
		).toBeVisible();

		// Deselecting keeps the other perush rendered; a single perush can
		// carry several note segments on one pasuk (אבן עזרא has five here).
		await rashiToggle.click();
		await expect(rashiToggle).toHaveAttribute("aria-pressed", "false");
		await expect(
			groupOne.locator('[class*="noteContent"]').first(),
		).toContainText("בראשית");

		// The persisted selection survives a reload as the Tanach-wide default.
		await page.reload();
		const blankAfter = page.locator('.he-book .page[data-page-index="4"]');
		await expect(
			blankAfter.getByRole("button", { name: "בחירת אבן עזרא" }),
		).toHaveAttribute("aria-pressed", "true", { timeout: 60_000 });
		await expect(
			blankAfter.getByRole("button", { name: 'בחירת רש"י' }),
		).toHaveAttribute("aria-pressed", "false");
	});

	test("filters commentary by scripture-side pasuk selection and clears it", async ({
		page,
	}) => {
		test.setTimeout(90_000);
		const seferPage = new SeferPage(page);
		await seferPage.openSeferViewForPerek(1);
		const blank = page.locator('.he-book .page[data-page-index="4"]');
		const scripture = page.locator('[data-sefer-perek="1"]');

		await blank.getByRole("button", { name: 'בחירת רש"י' }).click();
		await expect(blank.locator("[data-perush-pasuk]").first()).toBeVisible({
			timeout: 30_000,
		});
		const groupCount = await blank.locator("[data-perush-pasuk]").count();
		expect(groupCount).toBeGreaterThan(1);

		// Entering pasuk-selection mode makes the scripture letters toggles.
		await blank.getByRole("button", { name: "בחירת פסוקים" }).click();
		await expect(scripture.getByRole("status")).toContainText(
			"סמנו פסוקים על הפרק",
		);

		await scripture
			.locator('[data-sefer-pasuk="1"]')
			.getByRole("button", { name: "בחירת פסוק א" })
			.click();
		await expect(scripture.getByRole("status")).toContainText("נבחרו 1 פסוקים");
		await expect(blank).toContainText("מסוננים: 1 פסוקים");
		await expect
			.poll(async () => blank.locator("[data-perush-pasuk]").count())
			.toBe(1);
		await expect(blank.locator('[data-perush-pasuk="1"]')).toBeVisible();

		// Clearing the filter restores the full chapter's commentary while the
		// pasuk-marking mode stays active until it is ended explicitly.
		await blank.getByRole("button", { name: "ניקוי בחירה" }).click();
		await expect(blank).toContainText("סמנו פסוקים על גבי הפרק");
		await expect
			.poll(async () => blank.locator("[data-perush-pasuk]").count())
			.toBe(groupCount);
		await blank.getByRole("button", { name: "סיום בחירה" }).click();
		await expect(blank).toContainText("כל פסוקי הפרק");
	});

	test("opens an article from the masonry grid and toggles article-only fullscreen", async ({
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
		const fullscreenButton = blank.getByRole("button", {
			name: "מסך מלא",
		});
		await expect(fullscreenButton).toBeVisible({ timeout: 30_000 });
		await expect(blank.getByText("פתיחה")).toBeVisible();

		// Article-only fullscreen is a dialog over the book, not book fullscreen.
		await fullscreenButton.click();
		const dialog = page.getByRole("dialog");
		await expect(dialog).toBeVisible();
		await expect(dialog.getByRole("button", {
			name: "יציאה ממסך מלא",
		})).toBeVisible();
		await test.info().attach("article-fullscreen-dialog", {
			body: await page.screenshot(),
			contentType: "image/png",
		});
		await dialog.getByRole("button", {
			name: "יציאה ממסך מלא",
		}).click();
		await expect(dialog).toBeHidden();

		// Back returns to the grid on the מאמרים tab.
		await blank.getByRole("button", { name: "חזרה למאמרים" }).click();
		await expect(blank.locator("a#article-1")).toBeVisible();
		await expect(blank.getByRole("tab", { name: "מאמרים" })).toHaveAttribute(
			"aria-selected",
			"true",
		);
	});

	test("deep-linked perush view selects only that perush without touching defaults", async ({
		page,
	}) => {
		test.setTimeout(90_000);
		await page.goto(`/929/1/${encodeURIComponent('רש"י')}?book`);
		const blank = page.locator('.he-book .page[data-page-index="4"]');

		await expect(blank.getByRole("tab", { name: "פרשנים" })).toHaveAttribute(
			"aria-selected",
			"true",
			{ timeout: 60_000 },
		);
		await expect(
			blank.getByRole("heading", { name: 'רש"י', exact: true }),
		).toBeVisible({ timeout: 30_000 });

		// Back to the flat panel: the deep link must not have written the
		// persisted selection, so no tag is pressed by default.
		await blank.getByRole("button", { name: "→ חזרה לפרשנים" }).click();
		await expect(
			blank.getByRole("button", { name: 'בחירת רש"י' }),
		).toHaveAttribute("aria-pressed", "false");
		await expect(
			blank.getByRole("button", { name: "בחירת אבן עזרא" }),
		).toHaveAttribute("aria-pressed", "false");
	});
});

test.describe("Sefer temporary navigation highlights", () => {
	test("keeps long-catalog commentary reachable and dismisses highlights on click or after fading", async ({
		page,
		skipOnNotWideEnough,
	}) => {
		void skipOnNotWideEnough;
		const book = new SeferPage(page);
		await book.openSeferViewForPerek(1);
		const blank = page.locator('.he-book .page[data-page-index="4"]');
		await blank.getByRole("button", { name: 'בחירת רש"י' }).click();
		const group = blank.locator('[data-perush-pasuk="1"]');
		await expect(group).toBeVisible();
		// Stress the real reader layout even when the local database has only
		// three commentaries. CI's full catalog originally covered the notes.
		await blank.locator('[class*="tagList"]').evaluate((list) => {
			const template = list.firstElementChild;
			if (!template) throw new Error("No commentary tags");
			while (list.childElementCount < 60) list.append(template.cloneNode(true));
		});
		const readingSpace = await blank
			.locator('[class*="commentaryScroll"]')
			.evaluate((el) => ({
				height: el.clientHeight,
				panelHeight: el.parentElement?.clientHeight ?? 0,
			}));
		expect(readingSpace.height).toBeGreaterThan(readingSpace.panelHeight * 0.4);
		const verse = page.locator('[data-sefer-perek="1"] [data-sefer-pasuk="1"]');
		await page.clock.install();
		await verse.getByRole("button", { name: /מעבר לפירוש/ }).click();
		await expect(group).toHaveAttribute("data-pasuk-highlight", "");
		await group.click({ position: { x: 12, y: 12 } });
		await expect(group).not.toHaveAttribute("data-pasuk-highlight");
		await group.getByRole("button", { name: /מעבר לפסוק/ }).click();
		await expect(verse).toHaveAttribute("data-pasuk-highlight", "");
		await page.clock.fastForward(4000);
		await expect(verse).toHaveAttribute("data-pasuk-highlight", "fading");
		await page.clock.fastForward(600);
		await expect(verse).not.toHaveAttribute("data-pasuk-highlight");
		await expect(verse).not.toHaveAttribute("aria-current");
		await verse.getByRole("button", { name: /מעבר לפירוש/ }).click();
		await page.clock.fastForward(4600);
		await expect(group).not.toHaveAttribute("data-pasuk-highlight");
	});
});
