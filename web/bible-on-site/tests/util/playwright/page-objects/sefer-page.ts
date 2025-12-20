import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

/**
 * Page Object Model for Sefer view functionality
 * Handles navigation and interactions with the sefer view
 */
export class SeferPage {
	private readonly page: Page;
	private readonly baseUrl = "http://localhost:3001/929";
	private readonly togglerAnimationDuration = 300;

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
	 * Click the sefer view toggle button to open sefer view
	 * Note: This assumes the test is running on tablet+ viewport where the toggle is visible
	 */
	async openSeferView(): Promise<void> {
		const seferViewButton = this.page.getByTestId(
			"read-mode-toggler-sefer-view-button",
		);
		await seferViewButton.scrollIntoViewIfNeeded();
		await seferViewButton.click({ timeout: 10_000 });
		await this.page.waitForTimeout(this.togglerAnimationDuration);
	}

	/**
	 * Verify that the sefer overlay is visible
	 */
	async verifySeferViewIsOpen(): Promise<void> {
		const seferOverlay = this.page.locator('[class*="seferOverlay"]');
		await expect(seferOverlay).toBeVisible();
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
			await this.page.waitForTimeout(this.togglerAnimationDuration);
		}
	}

	/**
	 * Get the number of pages in the sefer view
	 */
	async getPageCount(): Promise<number> {
		const articles = this.page.locator("article");
		return await articles.count();
	}
}
