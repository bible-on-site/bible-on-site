import { expect, test } from "../util/playwright/test-fixture";

/**
 * Main-landmark contract — every primary page renders exactly one <main>
 * element (implicit ARIA role `main`), so screen-reader users can jump
 * straight to the page's content. One URL per page family, matching the
 * representative set the page-header contract renders (issue #3161).
 */

const FAMILIES: { name: string; url: string }[] = [
	{ name: "homepage hero", url: "/" },
	{ name: "מועדים catalogue", url: `/${encodeURIComponent("מועדים")}` },
	{
		name: "moed detail",
		url: `/${encodeURIComponent("מועדים")}/${encodeURIComponent("מועד-בדיקה")}`,
	},
	{ name: "learning calendar (לוח rewrite)", url: `/${encodeURIComponent("לוח")}` },
	{ name: "pedia landing", url: "/pedia" },
	{
		name: "pedia entry",
		url: `/pedia/${encodeURIComponent("יהושע-בן-נון")}`,
	},
	{ name: "perek reader", url: "/929/1" },
	{ name: "article", url: "/929/1/1" },
	{ name: "authors", url: "/929/authors" },
	{ name: "מסורה landing", url: `/${encodeURIComponent("מסורה")}` },
	{ name: "מסורה unit", url: `/${encodeURIComponent("מסורה")}/1` },
	{ name: "פרשה landing", url: `/${encodeURIComponent("פרשה")}` },
	{
		name: "פרשה unit",
		url: `/${encodeURIComponent("פרשה")}/${encodeURIComponent("בראשית")}`,
	},
	{ name: "bookshelf", url: "/bookshelf" },
	{ name: "search", url: "/search" },
	{ name: "accessibility statement", url: "/accessibility" },
	{ name: "journalism", url: "/journalism" },
	{ name: "rabbis blessing", url: "/rabbis-blessing" },
	{ name: "not-found (error variant)", url: "/no-such-route-3161" },
	{ name: "dev sefer (fullscreen)", url: "/dev/sefer/1" },
];

test.describe("main landmark contract", () => {
	// DB-backed routes compile cold after the launcher's fresh populate.
	test.describe.configure({ timeout: 120_000 });

	for (const f of FAMILIES) {
		test(`${f.name} (${f.url}) exposes exactly one main landmark`, async ({
			page,
		}) => {
			const response = await page.goto(f.url, {
				waitUntil: "domcontentloaded",
			});
			// biome-ignore lint/style/noNonNullAssertion: page.goto resolves a Response for document navigations
			const status = response!.status();
			// The not-found boundary itself emits one <main>, so a fixture URL
			// that silently 404s would pass the count check — pin the status.
			if (f.name.startsWith("not-found")) {
				expect(status).toBe(404);
			} else {
				expect(status).toBeLessThan(400);
			}
			// Hydrated render — what assistive tech actually enumerates.
			await page.waitForLoadState("load");
			await expect(page.getByRole("main")).toHaveCount(1);
		});
	}

	// Book view replaces the flat page: the seo-content main is display:none'd
	// and the sefer overlay becomes the page's main landmark — still exactly one.
	test("perek book view exposes exactly one main landmark", async ({
		page,
	}) => {
		const response = await page.goto("/929/1?book", {
			waitUntil: "domcontentloaded",
		});
		// biome-ignore lint/style/noNonNullAssertion: page.goto resolves a Response for document navigations
		expect(response!.status()).toBeLessThan(400);
		await page.waitForLoadState("load");
		// The overlay must actually supply the landmark — if the book never
		// opened, the flat reader's main would still satisfy the count.
		await expect(page.locator("main.seo-content")).toBeHidden();
		await expect(
			page.locator("main:not(.seo-content)"),
		).toBeVisible();
		await expect(page.getByRole("main")).toHaveCount(1);
	});
});
