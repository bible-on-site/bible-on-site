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
	 */
	async openSeferView(): Promise<void> {
		const seferViewButton = this.page.getByTestId(
			"read-mode-toggler-sefer-view-button",
		);

		// Try different click strategies for reliability across devices
		try {
			await seferViewButton.scrollIntoViewIfNeeded();
			await seferViewButton.click({ timeout: 5000 });
		} catch (firstError) {
			try {
				// Try force click
				await seferViewButton.click({ force: true });
			} catch (secondError) {
				// Last resort: JavaScript click
				await seferViewButton.evaluate((el) => (el as HTMLElement).click());
			}
		}

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
		const articles = this.page.locator("article");

		// Wait for articles to be loaded
		await this.page.waitForSelector("article", { state: "visible" });

		// Wait a bit more for the flipbook to initialize and render all pages
		// TODO: Reduce this timeout when sefer view supports lazy loading
		await this.page.waitForTimeout(1000);

		const count = await articles.count();

		// Should have at least one page visible
		expect(count).toBeGreaterThan(0);

		// Verify the first article has meaningful text
		const firstArticle = articles.first();
		await expect(firstArticle).toBeVisible();

		const textContent = await firstArticle.textContent();
		expect(textContent).toBeTruthy();
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
