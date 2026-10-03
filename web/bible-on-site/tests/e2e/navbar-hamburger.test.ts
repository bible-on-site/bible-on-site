import { expect, test } from "../util/playwright/test-fixture";

const MENU_ITEMS = [
	["הרבנים", "/929/authors"],
	["תנכפדיה", "/pedia"],
	["עלון יומי", "/dailyBulletin"],
	["קבוצת ווטסאפ", "/whatsappGroup"],
	["תנאי שימוש", "/tos"],
	["יישומון", "/app"],
	["צור קשר", "/contact"],
	["תרומות", "/donation"],
] as const;

test.describe("NavBar hamburger menu", () => {
	test("opens and closes from the keyboard", async ({ page }) => {
		await page.goto("/");
		const trigger = page.getByRole("button", { name: "תפריט ראשי" });
		const menu = page.locator("#main-menu");
		const firstLink = menu.getByRole("link", { name: "הרבנים" });

		await expect(trigger).toHaveAttribute("aria-expanded", "false");
		// Closed menu links are out of the tab order.
		await expect(menu).toHaveAttribute("inert", "");

		await trigger.focus();
		await page.keyboard.press("Enter");
		await expect(trigger).toHaveAttribute("aria-expanded", "true");
		await expect(menu).not.toHaveAttribute("inert");
		await expect(firstLink).toBeInViewport();

		await page.keyboard.press("Escape");
		await expect(trigger).toHaveAttribute("aria-expanded", "false");
		await expect(trigger).toBeFocused();
	});

	test("closes on overlay click and returns focus to the trigger", async ({
		page,
	}) => {
		await page.goto("/");
		const trigger = page.getByRole("button", { name: "תפריט ראשי" });
		await trigger.click();
		await expect(trigger).toHaveAttribute("aria-expanded", "true");
		// The menu sits at the right edge (RTL); click the overlay on the left.
		await page.mouse.click(10, 400);
		await expect(trigger).toHaveAttribute("aria-expanded", "false");
		await expect(trigger).toBeFocused();
	});

	for (const [name, href] of MENU_ITEMS) {
		test(`after visiting ${href} from the menu, Back and the logo return home`, async ({
			page,
		}) => {
			await page.goto("/");
			const trigger = page.getByRole("button", { name: "תפריט ראשי" });
			await trigger.click();
			await page
				.locator("#main-menu")
				.getByRole("link", { name, exact: true })
				.click();
			await page.waitForURL(`**${href}`);
			await expect(trigger).toHaveAttribute("aria-expanded", "false");

			await page.locator("nav.top-nav a[href='/']").click();
			await page.waitForURL((url) => url.pathname === "/");
			const homeHeading = page
				.getByRole("heading", { name: 'תנ"ך על הפרק' })
				.first();
			await expect(homeHeading).toBeInViewport();

			await page.goBack();
			await page.waitForURL(`**${href}`);
			await page.goBack();
			await page.waitForURL((url) => url.pathname === "/");
			await expect(trigger).toHaveAttribute("aria-expanded", "false");
			await expect(homeHeading).toBeVisible();
		});
	}
});
