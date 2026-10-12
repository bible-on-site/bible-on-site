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

/**
 * alpha.46 turns paper leaves as a clipped corner fold, not a rotateY:
 * both faces of the turning leaf carry .page--folded — the flat remainder
 * keeps a translateX plus a clip-path polygon while the reflected flap gets
 * a matrix() transform (covers keep rigid rotateY and no .page--folded).
 * Returns null while no paper leaf is folding; otherwise a signature string
 * of the live fold geometry that changes as the fold follows the pointer
 * and stays stable while the fold is held.
 */
function foldSignature(page: Page) {
	return page.evaluate(() => {
		const folded = Array.from(
			document.querySelectorAll<HTMLElement>(".he-book .page--folded"),
		);
		if (folded.length === 0) return null;
		return folded
			.map((el) => `${el.style.transform}|${el.style.clipPath}`)
			.join("~");
	});
}

async function fastMouseSwipe(page: Page, x: number, y: number, delta: number) {
	// Native CDP input avoids trace snapshots between move and release, which
	// would otherwise turn this velocity-sensitive swipe into a slow drag.
	const client = await page.context().newCDPSession(page);
	await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
	await client.send("Input.dispatchMouseEvent", {
		type: "mousePressed",
		x,
		y,
		button: "left",
		buttons: 1,
		clickCount: 1,
	});
	// Hammer samples velocity over intervals longer than 25ms. Leave a short
	// press, then confirm the first move so Chromium cannot coalesce the entire
	// gesture into a panstart followed by a release, without any panmove.
	await new Promise((resolve) => setTimeout(resolve, 30));
	await client.send("Input.dispatchMouseEvent", {
		type: "mouseMoved",
		x: x + delta / 6,
		y,
		buttons: 1,
	});
	// Send the remaining motion together: awaiting every acknowledgement can
	// turn a fast swipe into a slow drag under load or trace recording.
	const inputs: Promise<unknown>[] = [];
	for (let step = 2; step <= 6; step++) {
		inputs.push(client.send("Input.dispatchMouseEvent", {
			type: "mouseMoved",
			x: x + (step * delta) / 6,
			y,
			buttons: 1,
		}));
	}
	inputs.push(client.send("Input.dispatchMouseEvent", {
		type: "mouseReleased",
		x: x + delta,
		y,
		button: "left",
		buttons: 0,
		clickCount: 1,
	}));
	await Promise.all(inputs);
	await client.detach();
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
		await seferPage.verifySeferViewIsOpen();
		await expect(
			page
				.locator('.he-book .page[data-page-index="2"] .toc-link[href]')
				.first(),
		).toBeVisible();
	});

	test("Shmuel semantic book routes load the requested spread", async ({
		page,
	}) => {
		test.setTimeout(90_000);
		const seferPage = new SeferPage(page);
		await page.goto("/929/שמואל/תוכן?book");
		await seferPage.verifySeferViewIsOpen();
		await expect(
			page
				.locator('.he-book .page[data-page-index="2"] .toc-link[href]')
				.first(),
		).toBeVisible();
		await page.goto("/929/שמואל/כריכה?book");
		await seferPage.verifySeferViewIsOpen();
		await expect(
			page.locator('.he-book section[aria-label="עטיפה קדמית"]'),
		).toBeVisible();
		await page.goto("/929/שמואל/גב?book");
		await seferPage.verifySeferViewIsOpen();
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
		await expect(
			page.locator('.he-book .page[data-page-index="1"]'),
		).toHaveClass(/current-page/);
		await expect
			.poll(() => decodeURIComponent(new URL(page.url()).pathname))
			.toBe("/929/בראשית/תוכן");
		await expect(page.locator(".he-book .page--flipping")).toHaveCount(0);
		await dragLeafBackward(1);
		await expect(
			page.locator('.he-book .page[data-page-index="0"]'),
		).toHaveClass(/current-page/);
		await expect
			.poll(() => decodeURIComponent(new URL(page.url()).pathname))
			.toBe("/929/בראשית/כריכה");
		await page.reload();
		await seferPage.verifySeferViewIsOpen();
		await expect(
			page.locator('.he-book .page[data-page-index="0"]'),
		).toBeVisible();
		await page.locator(".flipbook-toolbar-last").click();
		await expect
			.poll(() => decodeURIComponent(new URL(page.url()).pathname))
			.toBe("/929/בראשית/גב");
		await page.reload();
		await seferPage.verifySeferViewIsOpen();
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
		await fastMouseSwipe(page, x, y, 600);
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
		const fold = () => foldSignature(page);

		await page.mouse.move(x, y);
		await page.mouse.down();
		await page.waitForTimeout(550);
		await page.mouse.move(x + 80, y, { steps: 8 });
		// The leaf lifts into a fold that tracks the pointer directly.
		await expect.poll(fold).not.toBeNull();
		const nearFold = await fold();
		await page.mouse.move(x + 300, y, { steps: 6 });
		await expect.poll(fold).not.toBe(nearFold);
		const heldFold = await fold();
		await page.waitForTimeout(250);
		expect(await fold()).toBe(heldFold);
		await page.mouse.move(x + 480, y, { steps: 4 });
		await expect.poll(fold).not.toBe(heldFold);
		const fartherFold = await fold();
		await page.waitForTimeout(250);
		await page.mouse.move(x + 200, y, { steps: 8 });
		await expect.poll(fold).not.toBe(fartherFold);
		await expect(indicator).toHaveValue("א / נ");
		await page.mouse.move(x + 600, y, { steps: 3 });
		await page.waitForTimeout(250);
		await page.mouse.up();
		// Released short of halfway: the turn cancels and the page flattens back.
		await expect(indicator).toHaveValue("א / נ");
		await expect.poll(fold).toBeNull();
		await expect(page.locator(".he-book .page--flipping")).toHaveCount(0);
	});

	test("Mouse selection mode can be toggled back to native page dragging", async ({
		page,
	}) => {
		// Reload mounts the lazy book a second time before the drag assertions.
		test.setTimeout(60_000);
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
		await seferPage.verifySeferViewIsOpen();
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
		await expect.poll(() => foldSignature(page)).not.toBeNull();
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
		await fastMouseSwipe(page, x, y, -600);
		await expect(indicator).toHaveValue("א / נ");
	});

	test("locks outer page scrolling while open and restores it on close", async ({
		page,
	}) => {
		const seferPage = new SeferPage(page);
		await page.goto("/929/1");
		// The flat reader scrolls inside its own container before the book opens.
		const flatScrolls = await page.evaluate(() => {
			const container = document.querySelector<HTMLElement>(
				'[class*="perekContainer"]',
			);
			if (!container) return false;
			container.scrollTop = 400;
			return container.scrollTop > 0;
		});
		expect(flatScrolls).toBe(true);

		await seferPage.openSeferView();
		await expect(page.locator("html")).toHaveAttribute("data-sefer-view", "");
		const lockedOverflow = await page.evaluate(
			() => getComputedStyle(document.documentElement).overflowY,
		);
		expect(lockedOverflow).toBe("hidden");
		// Real wheel input over the book must not move the outer document —
		// programmatic scrollTo is not checked because overflow:hidden still
		// allows it by design; the issue concerns user-driven scrolling.
		await page.mouse.move(720, 450);
		const yBefore = await page.evaluate(() => window.scrollY);
		for (let i = 0; i < 8; i++) {
			await page.mouse.wheel(0, 500);
			await page.waitForTimeout(50);
		}
		expect(await page.evaluate(() => window.scrollY)).toBe(yBefore);

		// The scripture pane inside the book still scrolls from real wheel input.
		const paneBox = await page.evaluate(() => {
			const pane = document.querySelector<HTMLElement>(
				'.he-book .page.current-page [class*="perekTextScrollWrapper"]',
			);
			if (!pane) return null;
			const r = pane.getBoundingClientRect();
			return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
		});
		expect(paneBox).not.toBeNull();
		if (!paneBox) return;
		await page.mouse.move(paneBox.x, paneBox.y);
		for (let i = 0; i < 4; i++) {
			await page.mouse.wheel(0, 400);
			await page.waitForTimeout(50);
		}
		const paneTop = await page.evaluate(
			() =>
				document.querySelector<HTMLElement>(
					'.he-book .page.current-page [class*="perekTextScrollWrapper"]',
				)?.scrollTop ?? -1,
		);
		expect(paneTop).toBeGreaterThan(0);

		// Closing the book unlocks the document and re-enables the flat reader.
		const toggler = page.getByTestId("read-mode-toggler");
		await toggler.click();
		const overlay = page.locator('[class*="seferOverlay"]');
		await expect(overlay).not.toBeVisible();
		await expect(page.locator("html[data-sefer-view]")).toHaveCount(0);
		const unlocked = await page.evaluate(() => {
			const container = document.querySelector<HTMLElement>(
				'[class*="perekContainer"]',
			);
			if (!container) return { overflow: "", scrolls: false };
			container.scrollTop = 400;
			return {
				overflow: getComputedStyle(document.documentElement).overflowY,
				scrolls: container.scrollTop > 0,
			};
		});
		expect(unlocked.overflow).not.toBe("hidden");
		expect(unlocked.scrolls).toBe(true);
	});

	test("synchronizes the tab title with the visible book page and history", async ({
		page,
	}) => {
		test.setTimeout(90_000);
		const seferPage = new SeferPage(page);
		await seferPage.openSeferViewForPerek(1);
		await expect(page).toHaveTitle('בראשית א | תנ"ך על הפרק');

		await page.locator(".flipbook-toolbar-next").click();
		await expect(page).toHaveURL(/\/929\/2\?book/);
		await expect(page).toHaveTitle('בראשית ב | תנ"ך על הפרק');

		await page.locator(".flipbook-toolbar-toc").click();
		await expect
			.poll(() => decodeURIComponent(new URL(page.url()).pathname))
			.toBe("/929/בראשית/תוכן");
		await expect(page).toHaveTitle(
			'ספר בראשית - תוכן העניינים | תנ"ך על הפרק',
		);

		// Browser history restoration returns the matching title.
		await page.goBack();
		await expect(page).toHaveURL(/\/929\/2\?book/);
		await expect(page).toHaveTitle('בראשית ב | תנ"ך על הפרק');

		// Leaving Sefer view hands the title back to the flat perek page.
		const toggler = page.getByTestId("read-mode-toggler");
		await toggler.click();
		await expect(
			page.locator('[class*="seferOverlay"]'),
		).not.toBeVisible();
		await expect(page).toHaveTitle('בראשית א | תנ"ך על הפרק');
	});

	test.describe("Touch swipe", () => {
		test.use({ hasTouch: true });

		test("Swiping verse text drags and turns the page", async ({ page }) => {
			await page.setViewportSize({ width: 1440, height: 900 });
			const seferPage = new SeferPage(page);
			await seferPage.openSeferViewForPerek(2);
			await seferPage.verifyPesukimAreVisible();
			const rect = await page
				.locator(".he-book .page.current-page article")
				.first()
				.boundingBox();
			if (!rect) throw new Error("Verse text is not visible");
			const x = Math.round(rect.x + rect.width - 40);
			const y = Math.round(rect.y + 45);
			expect(
				await page.evaluate(
					({ x, y }) =>
						document.elementFromPoint(x, y)?.closest("article") !== null,
					{ x, y },
				),
			).toBe(true);
			const indicator = page.locator(".flipbook-toolbar-indicator");
			await expect(indicator).toHaveValue("ב / נ");
			const client = await page.context().newCDPSession(page);
			await client.send("Input.dispatchTouchEvent", {
				type: "touchStart",
				touchPoints: [{ x, y }],
			});
			// Start near the verse's right edge and drag left across the book's
			// midpoint. A 650px rightward drag from the first chapter never reaches
			// halfway at this viewport; it only turns if release velocity is high,
			// which tracing and runner load can change.
			for (const offset of [20, 40, 300, 500, x - 20]) {
				await client.send("Input.dispatchTouchEvent", {
					type: "touchMove",
					touchPoints: [{ x: x - offset, y }],
				});
				if (offset === 300) {
					// alpha.46 lifts the leaf into a fold that tracks the pointer
					// directly; a held finger freezes the fold geometry in place.
					await expect.poll(() => foldSignature(page)).not.toBeNull();
					const held = await foldSignature(page);
					await page.waitForTimeout(150);
					expect(await foldSignature(page)).toBe(held);
				}
			}
			// Confirm a real drag beyond halfway before releasing, so completion
			// checks distance rather than a timing-sensitive flick: the final
			// touch point sits left of the spine, and under direct pointer
			// tracking the lifted corner follows it. When the drag already rests
			// at the destination edge the fold has visually settled (classes
			// clear), but the turn still commits only on release.
			await expect(indicator).toHaveValue("ב / נ");
			await client.send("Input.dispatchTouchEvent", {
				type: "touchEnd",
				touchPoints: [],
			});
			await expect(indicator).toHaveValue("א / נ");
			await client.detach();
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
