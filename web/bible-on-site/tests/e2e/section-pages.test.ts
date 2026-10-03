import { expect, test } from "../util/playwright/test-fixture";

/**
 * E2E tests for section pages (e.g. /contact, /tos, /app).
 * These routes render app/[section]/page.tsx and exercise ScrollToSection,
 * ContactSection, TosSection, AppSection.
 */

test.describe("Section pages", () => {
	test("contact section page loads and shows contact content", async ({
		page,
	}) => {
		await page.goto("/contact");
		await expect(page).toHaveTitle('צור קשר | תנ"ך על הפרק');
		// Section page includes the main heading and contact/donation/tos sections
		const heading = page.getByRole("heading", { name: 'תנ"ך על הפרק' }).first();
		await expect(heading).toBeVisible();
		// Contact section is present on this page
		const contactHeading = page.getByRole("heading", {
			name: "יצירת קשר",
		});
		await expect(contactHeading).toBeVisible();
	});

	test("tos section page loads and shows terms content", async ({ page }) => {
		await page.goto("/tos");
		await expect(page).toHaveTitle('תנאי שימוש | תנ"ך על הפרק');
		const tosHeading = page.getByRole("heading", { name: "תנאי שימוש" });
		await expect(tosHeading).toBeVisible();
	});

	test("app section page loads and shows app section", async ({ page }) => {
		await page.goto("/app");
		await expect(page).toHaveTitle('יישומון | תנ"ך על הפרק');
		const appHeading = page.getByRole("heading", {
			name: 'ישומון תנ"ך על הפרק',
		});
		await expect(appHeading).toBeVisible();
	});

	for (const section of ["donation", "dailyBulletin", "whatsappGroup"]) {
		test(`${section} has its own title and canonical and scrolls to contact`, async ({
			page,
		}) => {
			await page.goto(`/${section}`);
			await expect(page).not.toHaveTitle('תנ"ך על הפרק');
			await expect(page).toHaveTitle(/ \| תנ"ך על הפרק$/);
			const canonical = await page
				.locator('link[rel="canonical"]')
				.getAttribute("href");
			expect(new URL(canonical ?? "", page.url()).pathname).toBe(`/${section}`);
			await expect(page.locator("#contact")).toBeInViewport();
		});
	}

	test("unknown section returns 404", async ({ page }) => {
		const response = await page.goto("/no-such-section");
		expect(response?.status()).toBe(404);
	});
});
