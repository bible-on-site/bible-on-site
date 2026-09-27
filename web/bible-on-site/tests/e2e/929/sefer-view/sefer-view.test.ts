import { expect } from "@playwright/test";
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

test.describe("Sefer view", () => {
	// Skip all tests in this suite on mobile viewports - sefer view requires tablet+
	test.beforeEach(({ skipOnNotWideEnough }) => {
		void skipOnNotWideEnough;
	});

	test("Selects verse text without turning the page", async ({ page }) => {
		const seferPage = new SeferPage(page);
		await seferPage.openSeferViewForPerek(1);
		await seferPage.verifyPesukimAreVisible();
		const text = page.locator(".he-book article:visible").first();
		const indicator = page.locator(".flipbook-toolbar-indicator");
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
