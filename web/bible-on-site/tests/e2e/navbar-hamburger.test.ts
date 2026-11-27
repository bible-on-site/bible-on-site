import { expect, test } from "../util/playwright/test-fixture";

// Hebrew roots arrive percent-encoded in the URL; the navigation wait below
// decodes the pathname before comparing it to each item's semantic href.
// Item names are the full accessible names — label plus the visible subtitle
// added in #3731. The קבוצת ווטסאפ row left the drawer in that issue; its
// join action keeps living on the bulletin card.
const MENU_ITEMS = [
	["מסורה על הפרק חלוקת המסורה היהודית הקדומה", "/מסורה"],
	["לוח לימוד יומי לוח עזר פרקים לפי תאריך", "/לוח"],
	["הרבנים איתור מאמרים לפי המחברים", "/929/authors"],
	['תנכפדיה אנציקלופדיה תנ"כית', "/pedia"],
	["עלון יומי הפרק היומי והמאמרים ישירות אליכם", "/dailyBulletin"],
	["תנאי שימוש והצהרות פרטיות ונגישות", "/tos"],
	["יישומון", "/app"],
	["צור קשר", "/contact"],
	["תרומות", "/donation"],
] as const;

// Preserve the original runtime/network evidence when a retry passes (#2005).
test.use({ trace: "retain-on-failure" });

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

	test("exposes the labeled close button and keyboard-focusable store links", async ({
		page,
	}) => {
		await page.goto("/929/authors");
		const trigger = page.getByRole("button", { name: "תפריט ראשי" });
		const menu = page.locator("#main-menu");
		await trigger.click();
		await expect(trigger).toHaveAttribute("aria-expanded", "true");

		await expect(menu.getByRole("button", { name: "סגור" })).toBeVisible();
		await expect(menu.getByRole("link", { name: "App Store" })).toBeVisible();
		await expect(menu.getByRole("link", { name: "Google Play" })).toBeVisible();
		await expect(
			menu.getByRole("link", { name: "Microsoft Store" }),
		).toBeVisible();

		await menu.getByRole("button", { name: "סגור" }).focus();
		await expect(menu.getByRole("button", { name: "סגור" })).toBeFocused();
		for (let step = 0; step < 12; step += 1) {
			const activeText = await page.evaluate(
				() => document.activeElement?.textContent,
			);
			if (activeText === "App Store") break;
			await page.keyboard.press("Tab");
		}
		await expect(menu.getByRole("link", { name: "App Store" })).toBeFocused();

		await menu.getByRole("button", { name: "סגור" }).click();
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
			// Non-ASCII paths (e.g. /לוח) arrive percent-encoded in the URL.
			const reached = (url: URL) => decodeURIComponent(url.pathname) === href;
			await page.waitForURL(reached);
			await expect(trigger).toHaveAttribute("aria-expanded", "false");

			await page.locator("nav.top-nav a[href='/']").click();
			await page.waitForURL((url) => url.pathname === "/");
			const homeHeading = page
				.getByRole("heading", { name: 'תנ"ך על הפרק' })
				.first();
			await expect(homeHeading).toBeInViewport();

			await page.goBack();
			await page.waitForURL(reached);
			await page.goBack();
			await page.waitForURL((url) => url.pathname === "/");
			await expect(trigger).toHaveAttribute("aria-expanded", "false");
			await expect(homeHeading).toBeVisible();
		});
	}

	test("after visiting /accessibility from the accessibility menu, Back and the logo return home", async ({
		page,
	}) => {
		// The statement lives in the top-nav accessibility menu — the side
		// navigation deliberately no longer carries it.
		await page.goto("/");
		await page.getByRole("button", { name: "התאמות נגישות" }).click();
		await page
			.getByTestId("accessibility-menu")
			.getByRole("link", { name: "הצהרת נגישות" })
			.click();
		await page.waitForURL((url) => url.pathname === "/accessibility");

		await page.locator("nav.top-nav a[href='/']").click();
		await page.waitForURL((url) => url.pathname === "/");
		const homeHeading = page
			.getByRole("heading", { name: 'תנ"ך על הפרק' })
			.first();
		await expect(homeHeading).toBeInViewport();

		await page.goBack();
		await page.waitForURL((url) => url.pathname === "/accessibility");
		await page.goBack();
		await page.waitForURL((url) => url.pathname === "/");
		await expect(homeHeading).toBeVisible();
	});
});
