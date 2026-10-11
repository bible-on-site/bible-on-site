import { expect, test } from "@playwright/test";

test("bulletin-unapproved content remains public across website surfaces", async ({
	page,
	request,
}) => {
	// Fixture article 4 is FALSE; its author has no bulletin-approved articles.
	await page.goto("/929/authors");
	const author = page.getByRole("link", { name: /רב עם תיאור ארוך/ });
	await expect(author).toBeVisible();
	await author.click();
	await page.waitForURL(/\/929\/authors\/.+/, { timeout: 60_000 });
	await expect(page.locator('a[href="/929/1/4"]')).toBeVisible({
		timeout: 60_000,
	});
	await page.goto("/929/1");
	await expect(page.locator('a[href="/929/1/4"]').first()).toBeVisible();
	await page.goto("/929/1/4");
	await expect(
		page
			.getByRole("heading", { name: "מאמר עם תמונה - בראשית א", exact: true })
			.first(),
	).toBeVisible();
	const results = await request.get(
		"/api/search?q=מאמר%20עם%20תמונה&type=article",
	);
	expect(results.ok()).toBe(true);
	expect((await results.json()).results).toEqual(
		expect.arrayContaining([expect.objectContaining({ href: "/929/1/4" })]),
	);
});
