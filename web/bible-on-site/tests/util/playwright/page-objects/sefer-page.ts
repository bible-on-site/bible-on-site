import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

/**
 * Page Object Model for Sefer view functionality
 * Handles navigation and interactions with the sefer view
 */
export class SeferPage {
	private readonly page: Page;
	private readonly baseUrl = "http://localhost:3001/929";

	constructor(page: Page) {
		this.page = page;
	}

	/**
	 * Navigate to a specific perek by its ID
	 */
	async navigateToPerek(perekId: number): Promise<void> {
		await this.page.goto(`${this.baseUrl}/${perekId}`);
	}

	/**
	 * Convenience method: Navigate to a perek and open sefer view
	 * This represents the common user journey of opening a sefer view from a perek
	 */
	async openSeferViewForPerek(perekId: number): Promise<void> {
		await this.navigateToPerek(perekId);
		await this.openSeferView();
	}

	/**
	 * Click the sefer view toggle button to open sefer view.
	 * Uses a retry loop because on SSG pages the click can land before
	 * React has hydrated the controlled checkbox, in which case the
	 * onChange handler never fires and the overlay stays hidden.
	 */
	async openSeferView(): Promise<void> {
		const toggler = this.page.getByTestId("read-mode-toggler");
		const checkbox = toggler.locator("input");
		const overlay = this.page.locator('[class*="seferOverlay"]');

		await toggler.scrollIntoViewIfNeeded();

		await expect(async () => {
			if (!(await checkbox.isChecked())) {
				await toggler.click();
			}
			await expect(overlay).toBeVisible();
		}).toPass({ timeout: 15_000 });

		await this.verifySeferViewIsOpen();
	}

	/**
	 * Verify that the sefer overlay is visible and the FlipBook has mounted.
	 * The overlay displays immediately but the FlipBook is lazy-loaded inside
	 * a React startTransition, so we must wait for bookWrapper before checking
	 * any nested content (articles, qri spans, etc.).
	 */
	async verifySeferViewIsOpen(): Promise<void> {
		const seferOverlay = this.page.locator('[class*="seferOverlay"]');
		await expect(seferOverlay).toBeVisible({ timeout: 10_000 });
		await expect(
			seferOverlay.locator('[class*="bookWrapper"]'),
		).toBeVisible({ timeout: 15_000 });
	}

	/**
	 * Verify that pesukim (verses) are visible in the sefer view
	 * Checks that there are multiple article elements with text content
	 */
	async verifyPesukimAreVisible(): Promise<void> {
		const visibleArticles = this.page.locator("article:visible");

		// Wait for any article to become visible; flipbook renders hidden pages too
		await expect(visibleArticles.first()).toBeVisible({ timeout: 10_000 });

		const count = await visibleArticles.count();
		expect(count).toBeGreaterThan(0);

		// Verify a visible page has meaningful text (avoid hidden cover pages)
		const firstVisibleArticle = visibleArticles.first();
		const textContent = await firstVisibleArticle.textContent();
		expect(textContent).toBeTruthy();
		// biome-ignore lint/style/noNonNullAssertion: assured by previous check
		expect(textContent!.length).toBeGreaterThan(50);
	}

	/**
	 * Close the sefer view (if needed for future tests)
	 */
	async closeSeferView(): Promise<void> {
		const closeButton = this.page.getByTestId("sefer-overlay-close");
		if (await closeButton.isVisible()) {
			await closeButton.click();
			// Wait for overlay to become hidden instead of fixed timeout
			const seferOverlay = this.page.locator('[class*="seferOverlay"]');
			await expect(seferOverlay).toBeHidden({ timeout: 10_000 });
		}
	}

	/**
	 * Get the number of pages in the sefer view
	 */
	async getPageCount(): Promise<number> {
		const articles = this.page.locator("article");
		return await articles.count();
	}

	/**
	 * Verify that qri elements are visible in the sefer view
	 * Qri elements are rendered with parentheses when they differ from ktiv
	 */
	async verifyQriElementsAreVisible(): Promise<void> {
		// Qri elements have a specific CSS class
		const qriElements = this.page.locator('[class*="qri"]');
		await expect(qriElements.first()).toBeVisible({ timeout: 10_000 });
		const count = await qriElements.count();
		expect(count).toBeGreaterThan(0);
	}
}
