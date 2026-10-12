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
				const { x, y } = await page
					.locator('.he-book .page[data-page-index="6"]')
					.getByRole("region", { name: "עמוד ריק (פירושים ומאמרים)" })
					.evaluate((contentPage) => {
						const rect = contentPage.getBoundingClientRect();
						// Carousels may fill the page in the full dataset. Start in its
						// padding, where dragging is allowed regardless of their height.
						const padding = Number.parseFloat(
							getComputedStyle(contentPage).paddingRight,
						);
						return {
							x: Math.round(rect.right - padding / 2),
							y: Math.round(rect.top + rect.height * 0.7),
						};
					});
				const distance = await page
					.locator(".he-book")
					.evaluate((book) => book.clientWidth * 0.75);
				expect(
					await page.evaluate(
						({ x, y }) => {
							const target = document.elementFromPoint(x, y);
							return (
								!!target?.closest('.page[data-page-index="6"]') &&
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
				for (let step = 1; step <= 12; step++) {
					await client.send("Input.dispatchTouchEvent", {
						type: "touchMove",
						touchPoints: [{ x: x - Math.round((step * distance) / 12), y }],
					});
					if (step === 6) {
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
				// Complete the held turn by distance, independent of CI's input speed.
				// Flick velocity has separate mouse/touch gesture coverage.
				await page.waitForTimeout(200);
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
						? blank.locator("a#article-1")
						: blank.getByRole("link", { name: /רש"י/ });
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
						? blank.locator("a#article-1")
						: blank.getByRole("link", { name: /רש"י/ });
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

	test("keeps the perushim carousel position across open, back, and browser Back", async ({
		page,
	}) => {
		test.setTimeout(90_000);
		const seferPage = new SeferPage(page);
		await seferPage.openSeferViewForPerek(1);
		const blank = page.locator('.he-book .page[data-page-index="4"]');
		const perushLink = blank.getByRole("link", { name: /אבן עזרא/ });
		const scroller = perushLink.locator("..");
		const back = blank.getByRole("button", { name: "→ חזרה לפרשנים" });

		// Scroll the carousel off its start edge (RTL scrollLeft is negative).
		const position = await scroller.evaluate((el) => {
			el.scrollLeft = -Math.min(
				300,
				Math.max(0, el.scrollWidth - el.clientWidth),
			);
			return el.scrollLeft;
		});
		expect(position).toBeLessThan(0);

		// DOM click() never scrolls the link into view, so the carousel stays
		// put until the open perush replaces it.
		await perushLink.evaluate((el: HTMLElement) => el.click());
		await expect(back).toBeVisible({ timeout: 30_000 });
		await back.click();
		await expect(perushLink).toBeVisible();
		await expect
			.poll(() => scroller.evaluate((el) => el.scrollLeft))
			.toBe(position);

		// The same position must survive leaving through the browser Back.
		await perushLink.evaluate((el: HTMLElement) => el.click());
		await expect(back).toBeVisible({ timeout: 30_000 });
		await page.goBack();
		await expect(perushLink).toBeVisible();
		await expect
			.poll(() => scroller.evaluate((el) => el.scrollLeft))
			.toBe(position);
	});

	test.describe("Bidirectional pasuk navigation", () => {
		test("jumps between scripture pasuk numbers and the open perush in both directions", async ({
			page,
		}) => {
			test.setTimeout(90_000);
			const seferPage = new SeferPage(page);
			await seferPage.openSeferViewForPerek(1);
			const perekPage = page.locator('.he-book .page[data-page-index="3"]');
			const blank = page.locator('.he-book .page[data-page-index="4"]');
			await blank.getByRole("link", { name: /רש"י/ }).click();
			await expect(
				blank.getByRole("button", { name: "→ חזרה לפרשנים" }),
			).toBeVisible({ timeout: 30_000 });
			const perushUrl = page.url();

			// Deepest commentary pasuk, so its group starts below the fold.
			const pasuk = await blank
				.locator("[data-perush-pasuk]")
				.last()
				.getAttribute("data-perush-pasuk");
			expect(pasuk).toBeTruthy();

			// Scripture → perush: the group scrolls into view and is highlighted.
			await perekPage
				.locator(`[data-sefer-pasuk="${pasuk}"]`)
				.getByRole("button", { name: /מעבר לפירוש/ })
				.click();
			const group = blank.locator(`[data-perush-pasuk="${pasuk}"]`);
			await expect(group).toHaveAttribute("data-pasuk-highlight", "");
			await expect(group).toHaveAttribute("aria-current", "location");
			await expect(group).toBeInViewport();
			// The perush stays open and the book route is untouched.
			await expect(
				blank.getByRole("button", { name: "→ חזרה לפרשנים" }),
			).toBeVisible();
			expect(page.url()).toBe(perushUrl);
			await test.info().attach("scripture-pasuk-click-jumps-to-perush-group", {
				body: await page.screenshot(),
				contentType: "image/png",
			});

			// Perush → scripture: the pasuk in the perek text highlights in place.
			await group.getByRole("button", { name: /מעבר לפסוק/ }).click();
			const verse = perekPage.locator(`[data-sefer-pasuk="${pasuk}"]`);
			await expect(verse).toHaveAttribute("data-pasuk-highlight", "");
			await expect(verse).toHaveAttribute("aria-current", "location");
			await expect(verse).toBeInViewport();
			await expect(
				blank.getByRole("button", { name: "→ חזרה לפרשנים" }),
			).toBeVisible();
			expect(page.url()).toBe(perushUrl);
			await test.info().attach("perush-pasuk-click-jumps-to-scripture-verse", {
				body: await page.screenshot(),
				contentType: "image/png",
			});
		});

		test("scopes pasuk navigation to the perek whose perush is open across page flips", async ({
			page,
		}) => {
			test.setTimeout(90_000);
			const seferPage = new SeferPage(page);
			await seferPage.openSeferViewForPerek(1);
			const blank = page.locator('.he-book .page[data-page-index="4"]');
			await blank.getByRole("link", { name: /רש"י/ }).click();
			await expect(
				blank.getByRole("button", { name: "→ חזרה לפרשנים" }),
			).toBeVisible({ timeout: 30_000 });
			const pasuk = await blank
				.locator("[data-perush-pasuk]")
				.first()
				.getAttribute("data-perush-pasuk");
			expect(pasuk).toBeTruthy();

			// Flip to perek 2's spread: its text reuses the same pasuk numbers
			// but has no open perush, so none of them offer navigation into
			// perek 1's perush.
			await page.locator(".flipbook-toolbar-next").click();
			await expect(page).toHaveURL(/\/929\/2\?book/);
			const perek2Text = page.locator('.he-book .page[data-page-index="5"]');
			await expect(
				perek2Text.locator(`[data-sefer-pasuk="${pasuk}"]`),
			).toBeAttached();
			await expect(
				perek2Text.getByRole("button", { name: /מעבר לפירוש/ }),
			).toHaveCount(0);
		});

		test("updates the target mapping when switching perushim", async ({
			page,
		}) => {
			test.setTimeout(90_000);
			const seferPage = new SeferPage(page);
			await seferPage.openSeferViewForPerek(1);
			const perekPage = page.locator('.he-book .page[data-page-index="3"]');
			const blank = page.locator('.he-book .page[data-page-index="4"]');
			const back = blank.getByRole("button", { name: "→ חזרה לפרשנים" });
			await blank.getByRole("link", { name: /רש"י/ }).click();
			await expect(back).toBeVisible({ timeout: 30_000 });
			// The panel is located by its perek marker: the perush name itself can
			// contain quotes (רש"י), which would break a CSS attribute selector.
			const panel = blank.locator('[data-sefer-perush-perek="1"]');
			await expect(panel).toHaveAttribute("data-sefer-perush", 'רש"י');
			await expect(panel.locator("[data-perush-pasuk]").first()).toBeAttached();

			// Switch to אבן עזרא: the old panel unmounts and the registry follows
			// the newly selected perush — exactly one panel stays mounted.
			await back.click();
			await blank.getByRole("link", { name: /אבן עזרא/ }).click();
			await expect(back).toBeVisible({ timeout: 30_000 });
			await expect(panel).toHaveCount(1);
			await expect(panel).toHaveAttribute("data-sefer-perush", "אבן עזרא");

			// Scripture → perush now targets אבן עזרא's own annotated pesukim.
			const ezraPasuk = await panel
				.locator("[data-perush-pasuk]")
				.first()
				.getAttribute("data-perush-pasuk");
			expect(ezraPasuk).toBeTruthy();
			await perekPage
				.locator(`[data-sefer-pasuk="${ezraPasuk}"]`)
				.getByRole("button", { name: /מעבר לפירוש/ })
				.click();
			await expect(
				panel.locator(`[data-perush-pasuk="${ezraPasuk}"]`),
			).toHaveAttribute("data-pasuk-highlight", "");
		});

		test("keeps the perush untouched when it has no note for a pasuk", async ({
			page,
		}) => {
			test.setTimeout(90_000);
			const seferPage = new SeferPage(page);
			await seferPage.openSeferViewForPerek(1);
			const perekPage = page.locator('.he-book .page[data-page-index="3"]');
			const blank = page.locator('.he-book .page[data-page-index="4"]');
			await blank.getByRole("link", { name: /רש"י/ }).click();
			await expect(
				blank.getByRole("button", { name: "→ חזרה לפרשנים" }),
			).toBeVisible({ timeout: 30_000 });
			const perushUrl = page.url();

			// Find a scripture pasuk that the open perush does not annotate. The
			// data sets differ between environments, so compute it live.
			const missingPasuk = await page.evaluate(() => {
				const panel = document.querySelector('[data-sefer-perush-perek="1"]');
				const perekPageEl = document.querySelector(
					'.he-book .page[data-page-index="3"]',
				);
				if (!panel || !perekPageEl) return null;
				const covered = new Set(
					Array.from(panel.querySelectorAll("[data-perush-pasuk]")).map((el) =>
						el.getAttribute("data-perush-pasuk"),
					),
				);
				for (const el of perekPageEl.querySelectorAll("[data-sefer-pasuk]")) {
					const pasuk = el.getAttribute("data-sefer-pasuk");
					if (pasuk && !covered.has(pasuk)) return pasuk;
				}
				return null;
			});
			test.skip(
				!missingPasuk,
				"the open perush annotates every pasuk of this perek",
			);

			// It offers no commentary navigation at all (keeping its recitation
			// behaviour), and the open perush stays untouched.
			await expect(
				perekPage
					.locator(`[data-sefer-pasuk="${missingPasuk}"]`)
					.getByRole("button", { name: /מעבר לפירוש/ }),
			).toHaveCount(0);
			await expect(blank.locator("[data-pasuk-highlight]")).toHaveCount(0);
			await expect(
				blank.getByRole("button", { name: "→ חזרה לפרשנים" }),
			).toBeVisible();
			expect(page.url()).toBe(perushUrl);
		});
	});

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
				? blank.locator("a#article-1")
				: blank.getByRole("link", { name: /רש"י/ })
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
				kind === "article"
					? /\/929\/1\/1\?book/
					: /%D7%A8%D7%A9%22%D7%99\?book/,
			);
			await page.reload();
			await expect(back).toBeVisible({ timeout: 60_000 });
			await back.click();
			await expect(blank.getByRole("link", { name: /אבן עזרא/ })).toBeVisible();
			await blank.getByRole("link", { name: /אבן עזרא/ }).click();
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
