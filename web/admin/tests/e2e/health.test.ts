import { expect, test } from "../util/test-fixture";

test.describe("Admin App Health", () => {
	test("homepage opens the work queues directly", async ({ page }) => {
		await page.goto("/");

		await expect(page.locator("h1")).toContainText("פניות");
		await expect(
			page.getByRole("link", { name: "+ פנייה חדשה" }),
		).toBeVisible();
		await expect(page.getByText("ברוכים הבאים")).toHaveCount(0);
		await page.getByRole("link", { name: /Pull requests/ }).click();
		await expect(page).toHaveURL(
			(url) => url.pathname === "/" && url.searchParams.get("tab") === "prs",
		);
		await expect(page.locator("h1")).toContainText("הצעות שינוי");
		await page.reload();
		await expect(page.locator("h1")).toContainText("הצעות שינוי");
	});
	test("preserves bookmarked queue filters when redirecting to home", async ({
		page,
	}) => {
		for (const [path, tab] of [
			["issues", "issues"],
			["pull-requests", "prs"],
		]) {
			await page.goto(`/${path}?q=bookmarked&state=closed&assignee=human`);
			await expect(page).toHaveURL(
				(url) =>
					url.pathname === "/" &&
					url.searchParams.get("tab") === tab &&
					url.searchParams.get("q") === "bookmarked" &&
					url.searchParams.get("state") === "closed" &&
					url.searchParams.get("assignee") === "human",
			);
			await expect(
				page.getByRole("textbox", { name: "חיפוש דיונים" }),
			).toHaveValue("bookmarked");
			await expect(
				page.getByRole("combobox", { name: "סינון לפי אחראי" }),
			).toHaveValue("human");
		}
	});
	test("keeps the desktop header compact and exposes the mobile menu", async ({
		page,
	}, testInfo) => {
		await page.setViewportSize({ width: 1280, height: 844 });
		await page.goto("/");
		await expect(
			page.getByText("טוען דיונים...", { exact: true }),
		).toBeHidden();
		const navigation = page.getByRole("navigation", { name: "ניווט ראשי" });
		const brand = navigation.locator(".admin-header-brand");
		const logout = navigation.getByRole("link", { name: "התנתק", exact: true });
		const brandBox = await brand.boundingBox();
		const logoutBox = await logout.boundingBox();
		expect(brandBox).not.toBeNull();
		expect(logoutBox).not.toBeNull();
		expect(
			Math.abs(
				(brandBox?.y ?? 0) +
					(brandBox?.height ?? 0) / 2 -
					(logoutBox?.y ?? 0) -
					(logoutBox?.height ?? 0) / 2,
			),
		).toBeLessThan(2);
		expect((await navigation.boundingBox())?.height).toBeLessThanOrEqual(76);
		await expect(
			navigation.getByRole("link", { name: "מאמרים", exact: true }),
		).toBeVisible();
		await expect(
			navigation.getByRole("link", { name: "פניות ושינויים" }),
		).toHaveCount(0);
		await expect(
			navigation.getByRole("link", { name: "הצעות קישור" }),
		).toHaveCount(0);
		const desktop = testInfo.outputPath("home-workspace-desktop.png");
		await page.screenshot({ path: desktop, fullPage: true });
		await testInfo.attach("home-workspace-desktop", {
			path: desktop,
			contentType: "image/png",
		});
		await page.setViewportSize({ width: 390, height: 844 });
		const toggle = navigation.getByRole("button", {
			name: "פתיחת תפריט הניווט",
		});
		await expect(toggle).toBeVisible();
		await expect(logout).toBeVisible();
		await expect(
			navigation.getByRole("link", { name: "מאמרים", exact: true }),
		).toBeHidden();
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= innerWidth,
			),
		).toBe(true);
		const mobile = testInfo.outputPath("home-workspace-mobile.png");
		await page.screenshot({ path: mobile, fullPage: true });
		await testInfo.attach("home-workspace-mobile", {
			path: mobile,
			contentType: "image/png",
		});
		await toggle.click();
		await expect(
			navigation.getByRole("button", { name: "סגירת תפריט הניווט" }),
		).toHaveAttribute("aria-expanded", "true");
		await navigation.getByRole("link", { name: "סוכנים", exact: true }).click();
		await expect(page).toHaveURL("/contribution-agents");
		await expect(
			navigation.getByRole("button", { name: "פתיחת תפריט הניווט" }),
		).toHaveAttribute("aria-expanded", "false");
	});

	test("navigation works", async ({ page }) => {
		await page.goto("/");

		// Navigate to rabbis via navbar (first link with that name)
		await page.getByRole("link", { name: "רבנים" }).first().click();
		await expect(page).toHaveURL("/rabbis");
		// Wait for page to fully load
		await expect(page.locator("h1")).toContainText("ניהול רבנים", {
			timeout: 10000,
		});

		// Navigate to articles via navbar
		await page.getByRole("link", { name: "מאמרים" }).first().click();
		await expect(page).toHaveURL("/articles");
		await expect(page.locator("h1")).toContainText("ניהול מאמרים", {
			timeout: 10000,
		});

		// Navigate back home
		await page.getByRole("link", { name: "בית" }).click();
		await expect(page).toHaveURL(
			(url) => url.pathname === "/" && url.searchParams.get("tab") === "issues",
		);
	});
});
