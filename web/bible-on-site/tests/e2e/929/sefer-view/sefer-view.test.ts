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

	test.describe("Sefarim without additionals", () => {
		test("Bereshit: sefer view shows pesukim", async ({ page }) => {
			const seferPage = new SeferPage(page);
			await seferPage.openSeferViewForPerek(1); // First perek of Bereshit
			await seferPage.verifySeferViewIsOpen();
			await seferPage.verifyPesukimAreVisible();
		});
	});

	test.describe("Sefarim with additionals", () => {
		test("Shemuel: sefer view shows pesukim", async ({ page }) => {
			const seferPage = new SeferPage(page);
			await seferPage.openSeferViewForPerek(188); // First perek of Shemuel א
			await seferPage.verifySeferViewIsOpen();
			await seferPage.verifyPesukimAreVisible();
		});

		test("Melachim: sefer view shows pesukim", async ({ page }) => {
			const seferPage = new SeferPage(page);
			await seferPage.openSeferViewForPerek(250); // First perek of Melachim א
			await seferPage.verifySeferViewIsOpen();
			await seferPage.verifyPesukimAreVisible();
		});

		test("Ezra: sefer view shows pesukim", async ({ page }) => {
			const seferPage = new SeferPage(page);
			await seferPage.openSeferViewForPerek(764); // First perek of Ezra
			await seferPage.verifySeferViewIsOpen();
			await seferPage.verifyPesukimAreVisible();
		});

		test("Divrei Hayamim: sefer view shows pesukim", async ({ page }) => {
			const seferPage = new SeferPage(page);
			await seferPage.openSeferViewForPerek(727); // First perek of Divrei Hayamim א
			await seferPage.verifySeferViewIsOpen();
			await seferPage.verifyPesukimAreVisible();
		});
	});
});
