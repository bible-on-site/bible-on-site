import { expect, type Page } from "@playwright/test";
import { SeferPage } from "../../../util/playwright/page-objects/sefer-page";
import { test } from "../../../util/playwright/test-fixture";

/**
 * Test suite for sefer view functionality
 * Tests both sefarim with additionals (parts א and ב) and regular sefarim
 *
 * Note: Currently just verifying that pesukim are visible when opening sefer view.
 * Future improvements will include:
 * - Titles inside the sefer for easy identification
 * - Opening the sefer on the correct page
 *
 * Sefer view is only available on tablet and larger viewports (>= 768px)
 * Tests use the skipOnMobile fixture to automatically skip on mobile viewports.
 */

function activePageAngle(page: Page) {
	return page.evaluate(() => {
		const turningPage = Array.from(
			document.querySelectorAll<HTMLElement>(".he-book .page"),
		).find((page) => page.style.willChange === "transform");
		const angle = turningPage?.style.transform.match(
			/rotateY\((-?[\d.]+)deg\)/,
		);
		return angle ? Math.abs(Number(angle[1])) : 0;
	});
}

test.describe("Sefer view", () => {
	// Skip all tests in this suite on mobile viewports - sefer view requires tablet+
	test.beforeEach(({ skipOnNotWideEnough }) => {
		void skipOnNotWideEnough;
	});

	test("TOC links open chapter routes with modifiers and turn pages on regular click", async ({
		page,
	}) => {
		const seferPage = new SeferPage(page);
		await seferPage.openSeferViewForPerek(1);
		await page.locator(".flipbook-toolbar-toc").click();
		const chapter = page
			.locator('.he-book .page[data-page-index="2"] .toc-link[href]')
			.nth(1);
		await expect(chapter).toBeVisible();
		await expect(chapter).toHaveAttribute("href", "/929/2?book");
		const originalUrl = page.url();

		const ctrlPagePromise = page.context().waitForEvent("page");
		await chapter.click({ modifiers: ["Control"] });
		const ctrlPage = await ctrlPagePromise;
		await expect(ctrlPage).toHaveURL(/\/929\/2\?book/);
		await expect(page).toHaveURL(originalUrl);
		await ctrlPage.close();

		const shiftPagePromise = page.context().waitForEvent("page");
		await chapter.click({ modifiers: ["Shift"] });
		const shiftPage = await shiftPagePromise;
		await expect(shiftPage).toHaveURL(/\/929\/2\?book/);
		await expect(page).toHaveURL(originalUrl);
		await shiftPage.close();

		await chapter.click();
		await expect(page).toHaveURL(/\/929\/2\?book/);
		await expect(page.locator(".flipbook-toolbar-indicator")).toHaveValue(
			"ב / נ",
		);
	});

	test("browser Back restores a prior book page without reloading the document", async ({
		page,
	}) => {
		test.setTimeout(90_000);
		const seferPage = new SeferPage(page);
		await seferPage.openSeferViewForPerek(1);
		await page.evaluate(() => {
			(
				window as Window & { __bookHistoryMarker?: string }
			).__bookHistoryMarker = "same-document";
			document
				.querySelector(".he-book")
				?.setAttribute("data-book-instance", "same-book");
		});

		await page.locator(".flipbook-toolbar-next").click();
		await expect(page).toHaveURL(/\/929\/2\?book/);
		await page.locator(".flipbook-toolbar-toc").click();
		await expect
			.poll(() => decodeURIComponent(new URL(page.url()).pathname))
			.toBe("/929/בראשית/תוכן");
		await page.goBack();
		await expect(page).toHaveURL(/\/929\/2\?book/);
		await page.goForward();
		await expect
			.poll(() => decodeURIComponent(new URL(page.url()).pathname))
			.toBe("/929/בראשית/תוכן");
		await page.goBack();
		await expect(page).toHaveURL(/\/929\/2\?book/);
		await page.goBack();
		await expect(page).toHaveURL(/\/929\/1\?book=?$/);
		expect(
			await page.evaluate(
				() =>
					(window as Window & { __bookHistoryMarker?: string })
						.__bookHistoryMarker,
			),
		).toBe("same-document");
		await expect(
			page.locator('.he-book[data-book-instance="same-book"]'),
		).toHaveCount(1);
		await expect(page.locator(".flipbook-toolbar-indicator")).toHaveValue(
			"א / נ",
		);
	});

	test("TOC has a shareable URL that opens at the contents page", async ({
		page,
	}) => {
		test.setTimeout(90_000);
		const seferPage = new SeferPage(page);
		await seferPage.openSeferViewForPerek(1);
		await page.locator(".flipbook-toolbar-toc").click();
		await expect
			.poll(() => decodeURIComponent(new URL(page.url()).pathname))
			.toBe("/929/בראשית/תוכן");
		await page.reload();
		await expect(
			page
				.locator('.he-book .page[data-page-index="2"] .toc-link[href]')
				.first(),
		).toBeVisible();
	});

	test("Shmuel semantic book routes load the requested spread", async ({
		page,
	}) => {
		await page.goto("/929/שמואל/תוכן?book");
		await expect(
			page
				.locator('.he-book .page[data-page-index="2"] .toc-link[href]')
				.first(),
		).toBeVisible();
		await page.goto("/929/שמואל/כריכה?book");
		await expect(
			page.locator('.he-book section[aria-label="עטיפה קדמית"]'),
		).toBeVisible();
		await page.goto("/929/שמואל/גב?book");
		await expect(
			page.locator('.he-book section[aria-label="עטיפה אחורית"]'),
		).toBeVisible();
	});

	test("front and back covers have shareable URLs that reopen the same spread", async ({
		page,
	}) => {
		test.setTimeout(90_000);
		const seferPage = new SeferPage(page);
		await seferPage.openSeferViewForPerek(1);
		const dragLeafBackward = async (pageIndex: number) => {
			const visiblePage = await page
				.locator(`.he-book .page[data-page-index="${pageIndex}"]`)
				.boundingBox();
			if (!visiblePage) throw new Error(`Page ${pageIndex} is not visible`);
			const x = visiblePage.x + visiblePage.width * 0.85;
			const y = visiblePage.y + visiblePage.height / 2;
			const bookWidth = await page
				.locator(".he-book")
				.evaluate((book) => book.clientWidth);
			await page.mouse.move(x, y);
			await page.mouse.down();
			await page.mouse.move(x - bookWidth * 0.7, y, { steps: 15 });
			await page.mouse.up();
		};
		await dragLeafBackward(3);
		await expect
			.poll(() => decodeURIComponent(new URL(page.url()).pathname))
			.toBe("/929/בראשית/תוכן");
		await expect(page.locator(".he-book .page--flipping")).toHaveCount(0);
		await dragLeafBackward(1);
		await expect
			.poll(() => decodeURIComponent(new URL(page.url()).pathname))
			.toBe("/929/בראשית/כריכה");
		await page.reload();
		await expect(
			page.locator('.he-book .page[data-page-index="0"]'),
		).toBeVisible();
		await page.locator(".flipbook-toolbar-last").click();
		await expect
			.poll(() => decodeURIComponent(new URL(page.url()).pathname))
			.toBe("/929/בראשית/גב");
		await page.reload();
		await expect(
			page.locator('.he-book .page[data-page-index="103"]'),
		).toBeVisible();
		await page.locator(".flipbook-toolbar-prev").click();
		await expect(page).toHaveURL(/\/929\/50\?book/);
		await page.locator(".flipbook-toolbar-next").click();
		await expect
			.poll(() => decodeURIComponent(new URL(page.url()).pathname))
			.toBe("/929/בראשית/גב");
	});

	test("Selects verse text without turning the page", async ({ page }) => {
		const seferPage = new SeferPage(page);
		await seferPage.openSeferViewForPerek(1);
		await seferPage.verifyPesukimAreVisible();
		const selectButton = page.getByRole("button", {
			name: "בחירת טקסט עם העכבר",
		});
		await expect(selectButton).toContainText("אב");
		await expect(
			selectButton.locator(".flipbook-toolbar-mouse-mode-caret"),
		).toBeVisible();
		await expect(
			selectButton.locator(".flipbook-toolbar-mouse-mode-caret"),
		).toHaveCSS("mask-image", /data:image\/png;base64/);
		await expect(selectButton).toHaveAttribute("aria-pressed", "false");
		await selectButton.click();
		await expect(selectButton).toHaveAttribute("aria-pressed", "true");
		const text = page.locator(".he-book article:visible").first();
		const indicator = page.locator(".flipbook-toolbar-indicator");
		await expect(indicator).toHaveValue("א / נ");
		const initialPage = await indicator.inputValue();
		const initialUrl = page.url();
		const word = await text.evaluate((article) => {
			const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT);
			let node = walker.nextNode();
			while (node && (node.textContent?.trim().length ?? 0) < 8) {
				node = walker.nextNode();
			}
			if (!node) throw new Error("No verse text found");
			const range = document.createRange();
			range.selectNodeContents(node);
			const rect = range.getBoundingClientRect();
			return {
				left: rect.left,
				right: rect.right,
				y: rect.top + rect.height / 2,
			};
		});
		// Drag across an actual Hebrew word in reading order (right to left).
		await page.mouse.move(word.right - 1, word.y);
		await page.mouse.down();
		await page.mouse.move(word.left + 1, word.y, { steps: 15 });
		await page.mouse.up();
		await expect
			.poll(() =>
				page.evaluate(() => window.getSelection()?.toString().length ?? 0),
			)
			.toBeGreaterThan(3);
		await expect(indicator).toHaveValue(initialPage);
		await expect(page).toHaveURL(initialUrl);
		await expect(page.locator(".he-book .page--flipping")).toHaveCount(0);

		// Navigation still works after a selection gesture.
		await page.locator(".flipbook-toolbar-next").click();
		await expect(indicator).not.toHaveValue(initialPage);
	});

	test("Slow drag across verse text still selects it", async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 });
		const seferPage = new SeferPage(page);
		await seferPage.openSeferViewForPerek(1);
		await seferPage.verifyPesukimAreVisible();
		await page.getByRole("button", { name: "בחירת טקסט עם העכבר" }).click();
		const rect = await page
			.locator(".he-book article:visible")
			.first()
			.boundingBox();
		if (!rect) throw new Error("Verse text is not visible");
		const x = rect.x + 60;
		const y = rect.y + 45;
		const indicator = page.locator(".flipbook-toolbar-indicator");
		await expect(indicator).toHaveValue("א / נ");
		await page.mouse.move(x, y);
		await page.mouse.down();
		await page.waitForTimeout(500);
		await page.mouse.move(x + 200, y, { steps: 5 });
		expect(
			await page
				.locator(".he-book .page")
				.evaluateAll((pages) =>
					pages.some(
						(page) => (page as HTMLElement).style.willChange === "transform",
					),
				),
		).toBe(false);
		await page.mouse.up();
		await expect
			.poll(() =>
				page.evaluate(() => window.getSelection()?.toString().length ?? 0),
			)
			.toBeGreaterThan(3);
		await expect(indicator).toHaveValue("א / נ");
	});

	test("Fast mouse swipe over verse text turns the page", async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 });
		const seferPage = new SeferPage(page);
		await seferPage.openSeferViewForPerek(1);
		await seferPage.verifyPesukimAreVisible();
		const rect = await page
			.locator(".he-book article:visible")
			.first()
			.boundingBox();
		if (!rect) throw new Error("Verse text is not visible");
		const x = rect.x + 60;
		const y = rect.y + 45;
		expect(
			await page.evaluate(
				({ x, y }) =>
					document.elementFromPoint(x, y)?.closest("article") !== null,
				{ x, y },
			),
		).toBe(true);
		const indicator = page.locator(".flipbook-toolbar-indicator");
		await expect(indicator).toHaveValue("א / נ");
		const before = await indicator.inputValue();
		await page.mouse.move(x, y);
		await page.mouse.down();
		await page.mouse.move(x + 600, y, { steps: 6 });
		await page.mouse.up();
		await expect(indicator).not.toHaveValue(before);
		expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(
			"",
		);
	});

	test("Dragging verse content holds and moves the page before release", async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1440, height: 900 });
		const seferPage = new SeferPage(page);
		await seferPage.openSeferViewForPerek(1);
		await seferPage.verifyPesukimAreVisible();
		const rect = await page
			.locator(".he-book article:visible")
			.first()
			.boundingBox();
		if (!rect) throw new Error("Verse text is not visible");
		const x = rect.x + 60;
		const y = rect.y + 45;
		expect(
			await page.evaluate(
				({ x, y }) =>
					document.elementFromPoint(x, y)?.closest("article") !== null,
				{ x, y },
			),
		).toBe(true);
		const indicator = page.locator(".flipbook-toolbar-indicator");
		await expect(indicator).toHaveValue("א / נ");
		const turningAngle = () => activePageAngle(page);

		await page.mouse.move(x, y);
		await page.mouse.down();
		await page.waitForTimeout(550);
		await page.mouse.move(x + 80, y, { steps: 8 });
		await expect.poll(turningAngle).toBeGreaterThan(2);
		await page.mouse.move(x + 300, y, { steps: 6 });
		await expect.poll(turningAngle).toBeGreaterThan(10);
		const heldAt = await turningAngle();
		await page.waitForTimeout(250);
		expect(await turningAngle()).toBeGreaterThan(10);
		await page.mouse.move(x + 480, y, { steps: 4 });
		await expect
			.poll(async () => Math.abs((await turningAngle()) - heldAt))
			.toBeGreaterThan(10);
		const fartherAngle = await turningAngle();
		await page.waitForTimeout(250);
		await page.mouse.move(x + 200, y, { steps: 8 });
		await expect
			.poll(async () => Math.abs((await turningAngle()) - fartherAngle))
			.toBeGreaterThan(10);
		await expect(indicator).toHaveValue("א / נ");
		await page.mouse.move(x + 600, y, { steps: 3 });
		await page.waitForTimeout(250);
		await page.mouse.up();
		await expect(indicator).toHaveValue("א / נ");
		await expect.poll(turningAngle).toBe(0);
	});

	test("Mouse selection mode can be toggled back to native page dragging", async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1440, height: 900 });
		const seferPage = new SeferPage(page);
		await seferPage.openSeferViewForPerek(1);
		await seferPage.verifyPesukimAreVisible();
		const selectButton = page.getByRole("button", {
			name: "בחירת טקסט עם העכבר",
		});
		await selectButton.click();
		await expect(selectButton).toHaveAttribute("aria-pressed", "true");
		await page.reload();
		await expect(selectButton).toHaveAttribute("aria-pressed", "true");
		await selectButton.click();
		await expect(selectButton).toHaveAttribute("aria-pressed", "false");
		const rect = await page
			.locator(".he-book article:visible")
			.first()
			.boundingBox();
		if (!rect) throw new Error("Verse text is not visible");
		const x = rect.x + 60;
		const y = rect.y + 45;
		await page.mouse.move(x, y);
		await page.mouse.down();
		await page.mouse.move(x + 300, y, { steps: 8 });
		await expect.poll(() => activePageAngle(page)).toBeGreaterThan(10);
		await page.mouse.up();
	});

	test("Mouse swipe over verse text turns back to the previous page", async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1440, height: 900 });
		const seferPage = new SeferPage(page);
		await seferPage.openSeferViewForPerek(2);
		await seferPage.verifyPesukimAreVisible();
		const rect = await page
			.locator(".he-book .page.current-page article")
			.first()
			.boundingBox();
		if (!rect) throw new Error("Verse text is not visible");
		const x = rect.x + rect.width - 40;
		const y = rect.y + 45;
		expect(
			await page.evaluate(
				({ x, y }) =>
					document.elementFromPoint(x, y)?.closest("article") !== null,
				{ x, y },
			),
		).toBe(true);
		const indicator = page.locator(".flipbook-toolbar-indicator");
		await expect(indicator).toHaveValue("ב / נ");
		await page.mouse.move(x, y);
		await page.mouse.down();
		await page.mouse.move(x - 600, y, { steps: 6 });
		await page.mouse.up();
		await expect(indicator).toHaveValue("א / נ");
	});

	test.describe("Touch swipe", () => {
		test.use({ hasTouch: true });

		test("Swiping verse text drags and turns the page", async ({ page }) => {
			await page.setViewportSize({ width: 1440, height: 900 });
			const seferPage = new SeferPage(page);
			await seferPage.openSeferViewForPerek(1);
			await seferPage.verifyPesukimAreVisible();
			const rect = await page
				.locator(".he-book article:visible")
				.first()
				.boundingBox();
			if (!rect) throw new Error("Verse text is not visible");
			const x = Math.round(rect.x + 40);
			const y = Math.round(rect.y + 45);
			expect(
				await page.evaluate(
					({ x, y }) =>
						document.elementFromPoint(x, y)?.closest("article") !== null,
					{ x, y },
				),
			).toBe(true);
			const indicator = page.locator(".flipbook-toolbar-indicator");
			await expect(indicator).toHaveValue("א / נ");
			const before = await indicator.inputValue();
			const client = await page.context().newCDPSession(page);
			await client.send("Input.dispatchTouchEvent", {
				type: "touchStart",
				touchPoints: [{ x, y }],
			});
			for (let step = 1; step <= 6; step++) {
				await client.send("Input.dispatchTouchEvent", {
					type: "touchMove",
					touchPoints: [{ x: x + Math.round((step * 650) / 6), y }],
				});
				if (step === 3) {
					await expect.poll(() => activePageAngle(page)).toBeGreaterThan(10);
					await page.waitForTimeout(150);
					expect(await activePageAngle(page)).toBeGreaterThan(10);
				}
			}
			await client.send("Input.dispatchTouchEvent", {
				type: "touchEnd",
				touchPoints: [],
			});
			await expect(indicator).not.toHaveValue(before);
		});
	});

	test.describe("Sefarim without additionals", () => {
		test("Shows pesukim", async ({ page }) => {
			const seferPage = new SeferPage(page);
			await seferPage.openSeferViewForPerek(1); // First perek of Bereshit
			await seferPage.verifySeferViewIsOpen();
			await seferPage.verifyPesukimAreVisible();
		});
	});

	test.describe("Sefarim with additionals", () => {
		test("Shemuel: Shows pesukim", async ({ page }) => {
			const seferPage = new SeferPage(page);
			await seferPage.openSeferViewForPerek(188); // First perek of Shemuel א
			await seferPage.verifySeferViewIsOpen();
			await seferPage.verifyPesukimAreVisible();
		});

		test("Melachim: Shows pesukim", async ({ page }) => {
			const seferPage = new SeferPage(page);
			await seferPage.openSeferViewForPerek(250); // First perek of Melachim א
			await seferPage.verifySeferViewIsOpen();
			await seferPage.verifyPesukimAreVisible();
		});

		test("Ezra: Shows pesukim", async ({ page }) => {
			const seferPage = new SeferPage(page);
			await seferPage.openSeferViewForPerek(764); // First perek of Ezra
			await seferPage.verifySeferViewIsOpen();
			await seferPage.verifyPesukimAreVisible();
		});

		test("Divrei Hayamim: Shows pesukim", async ({ page }) => {
			const seferPage = new SeferPage(page);
			await seferPage.openSeferViewForPerek(727); // First perek of Divrei Hayamim א
			await seferPage.verifySeferViewIsOpen();
			await seferPage.verifyPesukimAreVisible();
		});
	});

	test.describe("Qri/Ktiv rendering", () => {
		test("Shows qri elements with parentheses when different from ktiv", async ({
			page,
		}) => {
			const seferPage = new SeferPage(page);
			// Perek 406 (Mishlei 19) has qri sequences that differ from ktiv
			await seferPage.openSeferViewForPerek(406);
			await seferPage.verifySeferViewIsOpen();
			await seferPage.verifyPesukimAreVisible();
			await seferPage.verifyQriElementsAreVisible();
		});
	});
});
