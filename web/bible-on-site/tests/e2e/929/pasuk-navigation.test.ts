import { expect, test } from "../../util/playwright/test-fixture";

test("highlights the cited verse after navigating from Tanahpedia", async ({
	page,
}) => {
	await page.goto(`/pedia/${encodeURIComponent("יעקב")}`);
	const source = page.locator('a[href^="/929/"][href*="#pasuk-"]').first();
	await expect(source).toBeVisible();
	const href = await source.getAttribute("href");
	if (!href) throw new Error("Expected a verse citation in the fixture entry");
	await source.click();
	await expect(page).toHaveURL(new URL(href, page.url()).href, { timeout: 15_000 });
	const verse = page.locator(`#${href.split("#")[1]}`);
	await expect(verse).toHaveAttribute("aria-current", "location");
	await expect(verse).toHaveCSS(
		"background-color",
		"rgba(254, 243, 199, 0.95)",
	);
	await expect(verse).toBeInViewport();
	await page.goBack();
	await expect(source).toBeVisible();
	await page.goForward();
	await expect(verse).toHaveAttribute("aria-current", "location");
});

test("direct verse links remain highlighted and visible with a saved book preference", async ({
	page,
}) => {
	await page.addInitScript(() => localStorage.setItem("perekViewMode", "book"));
	await page.goto("/929/197#pasuk-23");
	const verse = page.locator("#pasuk-23");
	await expect(verse).toHaveAttribute("aria-current", "location");
	await expect(verse).toHaveCSS(
		"background-color",
		"rgba(254, 243, 199, 0.95)",
	);
	await expect(verse).toBeInViewport();
	await expect(page).toHaveURL(/\/929\/197#pasuk-23$/);
	await page.reload();
	await expect(verse).toHaveAttribute("aria-current", "location");
	await expect(verse).toBeInViewport();
});
