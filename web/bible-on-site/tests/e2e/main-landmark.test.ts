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
			await page.goto(f.url, { waitUntil: "domcontentloaded" });
			// Hydrated render — what assistive tech actually enumerates.
			await page.waitForLoadState("load");
			await expect(page.getByRole("main")).toHaveCount(1);
		});
	}
});
