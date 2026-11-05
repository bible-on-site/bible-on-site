import { expect, test } from "../util/playwright/test-fixture";

const MOADIM_ROOT = `/${encodeURIComponent("מועדים")}`;

/**
 * מועדים על הפרק e2e (#3101) — the DB-backed annual wheel and the moed
 * detail pages. Fixture moed 90 ("מועד בדיקה", range בראשית א 1-3 +
 * explicit links to articles 1 and 5) exercises range-match + dedupe;
 * moed 92 ("מועד בדיקה קישור", range בראשית ב with no fixture articles +
 * an explicit link to perek-1 article 3) exercises the explicit-only
 * union branch; moed 91 is unpublished for the 404 path.
 */
test.describe("מועדים על הפרק", () => {
	// DB-backed routes compile cold after the launcher's fresh populate
	// (same budget the parasha suite uses).
	test.describe.configure({ timeout: 120_000 });
	test("wheel lists every published moed as a real link in annual order", async ({
		page,
	}) => {
		await page.goto(MOADIM_ROOT);
		await expect(
			page.getByRole("heading", { name: "מועדים על הפרק", level: 1 }),
		).toBeVisible();
		await expect(page).toHaveTitle(/מועדים על הפרק/);

		// Wheel anchors carry the canonical Hebrew href; ראש השנה opens the year.
		const index = page.getByRole("navigation", { name: "רשימת המועדים" });
		const indexLinks = index.getByRole("link");
		await expect(indexLinks).toHaveCount(16);
		await expect(indexLinks.first()).toContainText("ראש השנה");
		await expect(
			index.getByRole("link", { name: /פסח/ }),
		).toBeVisible();
		await expect(
			index.getByRole("link", { name: /חנוכה/ }),
		).toBeVisible();
		// Exact name — fixture moed 92 is named "מועד בדיקה קישור" and would
		// match a bare substring regex alongside moed 90.
		await expect(
			index.getByRole("link", { name: "מועד בדיקה", exact: true }),
		).toBeVisible();
		const href = await index
			.getByRole("link", { name: /פסח/ })
			.getAttribute("href");
		expect(href).toBe(`/מועדים/פסח`);
	});

	test("detail page renders sections, bounded scripture, perushim and the unioned articles", async ({
		page,
	}) => {
		await page.goto(`${MOADIM_ROOT}/${encodeURIComponent("מועד-בדיקה")}`);
		await expect(
			page.getByRole("heading", { name: "מועד בדיקה", level: 1 }),
		).toBeVisible();
		await expect(page).toHaveTitle(/מועד בדיקה/);
		await expect(
			page.getByRole("heading", { name: "סעיף בדיקה", level: 2 }),
		).toBeVisible();

		// Canonical verses bounded to בראשית א 1-3 — the stored range —
		// rendered through the shared unit text with pedia entity refs.
		const section = page.getByRole("region", { name: "סעיף בדיקה" });
		await expect(
			section.getByRole("link", { name: "א-להים" }).first(),
		).toBeVisible();
		// The stored range ends at pasuk 3 — pasuk 4's anchor never renders.
		await expect(section.locator('[id^="pasuk-1-3"]')).toHaveCount(1);
		await expect(section.locator('[id^="pasuk-1-4"]')).toHaveCount(0);

		// Unioned articles: article 1 is both linked and range-matched but
		// lists once; article 5 stays hidden — an explicit link cannot make
		// a non-routable chapter (perek 5000) render a dead card.
		await expect(
			page.getByRole("heading", { name: "מאמרים על מועד בדיקה" }),
		).toBeVisible();
		await expect(
			page.getByRole("link", { name: /בראשית ברא - עיון בפסוק הראשון/ }),
		).toBeVisible();
		await expect(
			page.getByRole("link", { name: /מאמר נסתר/ }),
		).toHaveCount(0);
	});

	test("explicit-only linked article renders without any scripture overlap", async ({
		page,
	}) => {
		// Moed 92's stored range sits in בראשית ב — no fixture article's
		// coverage intersects it. Article 3 (primary perek בראשית א) can
		// appear only through the explicit article↔moed link.
		await page.goto(
			`${MOADIM_ROOT}/${encodeURIComponent("מועד-בדיקה-קישור")}`,
		);
		await expect(
			page.getByRole("heading", { name: "מועד בדיקה קישור", level: 1 }),
		).toBeVisible();
		await expect(
			page.getByRole("heading", { name: "מאמרים על מועד בדיקה קישור" }),
		).toBeVisible();
		await expect(
			page.getByRole("link", { name: /מאמר שני של הרב לדוגמא/ }),
		).toBeVisible();
		// And no range-matched article sneaks in: the union holds exactly
		// the one explicit link.
		await expect(
			page.getByRole("link", { name: /בראשית ברא - עיון בפסוק הראשון/ }),
		).toHaveCount(0);
	});

	test("canonical slug navigates between wheel and detail", async ({
		page,
	}) => {
		await page.goto(MOADIM_ROOT);
		await page
			.getByRole("navigation", { name: "רשימת המועדים" })
			.getByRole("link", { name: "מועד בדיקה", exact: true })
			.click();
		await page.waitForURL(
			`**${MOADIM_ROOT}/${encodeURIComponent("מועד-בדיקה")}`,
		);
		await expect(
			page.getByRole("heading", { name: "מועד בדיקה", level: 1 }),
		).toBeVisible();
	});

	test("unpublished moed does not resolve publicly", async ({ page }) => {
		const response = await page.goto(
			`${MOADIM_ROOT}/${encodeURIComponent("מועד-לא-מפורסם")}`,
		);
		expect(response?.status()).toBe(404);
	});

	test("unknown slug returns not-found", async ({ page }) => {
		const response = await page.goto(`${MOADIM_ROOT}/no-such-moed`);
		expect(response?.status()).toBe(404);
	});
});
