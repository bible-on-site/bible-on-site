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

		// The annual wheel is a nav landmark with one sector-link per moed.
		// Fixture moadim 90+92 carry no month, so the trailing "other" band
		// wraps the year and the canonical months label their own arcs.
		const wheelNav = page.getByRole("navigation", {
			name: "גלגל המועדים",
		});
		// 15 published catalogue moadim + fixtures 90 and 92 (#3254 added
		// עשרה בטבת, יום ירושלים, ט"ו באב; retired ל"ג בעומר, ט"ו בשבט).
		await expect(wheelNav.getByRole("link")).toHaveCount(17);
		// Exact match: the band label "תשרי" must not collide with the
		// "…בתשרי" date tspans inside the slice links.
		await expect(wheelNav.getByText("תשרי", { exact: true })).toBeVisible();
		await expect(wheelNav.getByText("אדר", { exact: true })).toBeVisible();
		await expect(wheelNav.getByText("טבת", { exact: true })).toBeVisible();
		await expect(
			wheelNav.getByText("מועדים נוספים", { exact: true }),
		).toBeVisible();
		await expect(wheelNav.getByRole("link", { name: /פסח/ })).toHaveAttribute(
			"href",
			"/מועדים/פסח",
		);
		// The new moadim ride the wheel; the retired pair is gone.
		await expect(
			wheelNav.getByRole("link", { name: /עשרה בטבת/ }),
		).toHaveAttribute("href", "/מועדים/עשרה-בטבת");
		await expect(
			wheelNav.getByRole("link", { name: /יום ירושלים/ }),
		).toHaveAttribute("href", "/מועדים/יום-ירושלים");
		await expect(
			wheelNav.getByRole("link", { name: /ט"ו באב/ }),
		).toHaveAttribute("href", "/מועדים/טו-באב");
		await expect(wheelNav.getByRole("link", { name: /ל"ג בעומר/ })).toHaveCount(
			0,
		);
		await expect(wheelNav.getByRole("link", { name: /ט"ו בשבט/ })).toHaveCount(
			0,
		);

		// Wheel anchors carry the canonical Hebrew href; ראש השנה opens the year.
		const index = page.getByRole("navigation", { name: "רשימת המועדים" });
		const indexLinks = index.getByRole("link");
		await expect(indexLinks).toHaveCount(17);
		await expect(indexLinks.first()).toContainText("ראש השנה");
		await expect(index.getByRole("link", { name: /פסח/ })).toBeVisible();
		await expect(index.getByRole("link", { name: /חנוכה/ })).toBeVisible();
		await expect(index.getByRole("link", { name: /עשרה בטבת/ })).toBeVisible();
		await expect(
			index.getByRole("link", { name: /ל"ג בעומר|ט"ו בשבט/ }),
		).toHaveCount(0);
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
		// The trailing hyphen binds the pasuk number so the prefix cannot
		// spill into 30/31 once a range ever covers them.
		await expect(section.locator('[id^="pasuk-1-3-"]')).toHaveCount(1);
		await expect(section.locator('[id^="pasuk-1-4-"]')).toHaveCount(0);

		// Unioned articles: article 1 is both linked and range-matched but
		// lists once; article 5 stays hidden — an explicit link cannot make
		// a non-routable chapter (perek 5000) render a dead card.
		await expect(
			page.getByRole("heading", { name: "מאמרים על מועד בדיקה" }),
		).toBeVisible();
		await expect(
			page.getByRole("link", { name: /בראשית ברא - עיון בפסוק הראשון/ }),
		).toBeVisible();
		await expect(page.getByRole("link", { name: /מאמר נסתר/ })).toHaveCount(0);
	});

	test("explicit-only linked article renders without any scripture overlap", async ({
		page,
	}) => {
		// Moed 92's stored range sits in בראשית ב — no fixture article's
		// coverage intersects it. Article 3 (primary perek בראשית א) can
		// appear only through the explicit article↔moed link.
		await page.goto(`${MOADIM_ROOT}/${encodeURIComponent("מועד-בדיקה-קישור")}`);
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

	// Regression for #3160 — the owner's editorial correction: the
	// conditional-haftarah wording is gone from the stored יום העצמאות
	// content, so it reaches neither visible copy nor generated metadata,
	// while the haftarah reading itself still renders bounded.
	test("יום העצמאות drops the conditional haftarah wording", async ({
		page,
	}) => {
		await page.goto(`${MOADIM_ROOT}/${encodeURIComponent("יום-העצמאות")}`);
		await expect(
			page.getByRole("heading", { name: "יום העצמאות", level: 1 }),
		).toBeVisible();

		// The summary is the bare editorial line, verbatim.
		await expect(
			page.getByText("יום העצמאות - ה' באייר, יום הכרזת מדינת ישראל."),
		).toBeVisible();

		// The reading section heading is exactly הפטרה — no qualification.
		await expect(
			page.getByRole("heading", {
				name: "הפטרה",
				level: 2,
				exact: true,
			}),
		).toBeVisible();

		// Neither removed phrase survives anywhere in the document — body
		// copy, description, Open Graph or Twitter metadata.
		const html = await page.content();
		expect(html).not.toContain("ההפטרה נקבעה מנהג");
		expect(html).not.toContain("כאשר נהוג לקרוא");

		// The stored haftarah range (ישעיהו י לב - יב ו) still renders
		// bounded: the opening and closing pesukim exist, the next does not.
		const section = page.getByRole("region", { name: "הפטרה" });
		await expect(section.locator('[id^="pasuk-344-32"]')).toHaveCount(1);
		await expect(section.locator('[id^="pasuk-346-6"]')).toHaveCount(1);
		await expect(section.locator('[id^="pasuk-346-7"]')).toHaveCount(0);
	});

	// #3266 — the detail page ditched its private two-level trail for the
	// shared breadcrumb shell: home → מועדים על הפרק → current moed, with
	// the current node opening the sibling picker over the catalogue.
	test("detail breadcrumb shares the site hierarchy and picks siblings", async ({
		page,
	}) => {
		await page.goto(`${MOADIM_ROOT}/${encodeURIComponent("מועד-בדיקה")}`);
		const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb" });
		await expect(breadcrumb).toBeVisible();

		// Ordered trail — the shared ol renders exactly three levels.
		const levels = breadcrumb.locator("ol > li");
		await expect(levels).toHaveCount(3);
		await expect(
			breadcrumb.getByRole("link", { name: 'תנ"ך על הפרק' }),
		).toHaveAttribute("href", "/");
		await expect(
			breadcrumb.getByRole("link", { name: "מועדים על הפרק" }),
		).toHaveAttribute("href", "/מועדים");
		await expect(levels.nth(2)).toHaveAttribute("aria-current", "page");

		// The current moed is the sibling picker — keyboard-operable.
		const currentButton = breadcrumb.getByRole("button", {
			name: /המועד הנוכחי: מועד בדיקה/,
		});
		await expect(currentButton).toHaveAttribute("aria-expanded", "false");
		await currentButton.press("Enter");
		await expect(currentButton).toHaveAttribute("aria-expanded", "true");

		// Every published moed appears by canonical link; the unpublished
		// fixture never leaks in.
		const drop = breadcrumb.getByRole("list").last();
		await expect(
			drop.getByRole("link", { name: "פסח", exact: true }),
		).toHaveAttribute("href", "/מועדים/פסח");
		await expect(
			drop.getByRole("link", { name: "מועד בדיקה קישור" }),
		).toHaveAttribute("href", "/מועדים/מועד-בדיקה-קישור");
		await expect(
			drop.getByRole("link", { name: /מועד לא מפורסם/ }),
		).toHaveCount(0);

		// Escape dismisses and returns focus to the current-page button.
		await page.keyboard.press("Escape");
		await expect(currentButton).toHaveAttribute("aria-expanded", "false");
		await expect(currentButton).toBeFocused();

		// A sibling link navigates to its canonical detail page.
		await currentButton.press("Enter");
		await breadcrumb.getByRole("link", { name: "פסח", exact: true }).click();
		await page.waitForURL(`**${MOADIM_ROOT}/${encodeURIComponent("פסח")}`);
		await expect(
			page.getByRole("heading", { name: "פסח", level: 1 }),
		).toBeVisible();
	});

	// #3254 — the hero row: on roomy screens heading+intro sit beside the
	// wheel (RTL — text first), and the wheel starts just under the top
	// bar instead of scrolling below the intro.
	test("wide viewport places the intro beside the wheel", async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 });
		await page.goto(MOADIM_ROOT);
		const heading = page.getByRole("heading", {
			name: "מועדים על הפרק",
			level: 1,
		});
		const wheelNav = page.getByRole("navigation", {
			name: "גלגל המועדים",
		});
		const headingBox = await heading.boundingBox();
		const wheelBox = await wheelNav.boundingBox();
		if (!headingBox || !wheelBox) throw new Error("hero row boxes missing");

		// Same row — vertical extents overlap; RTL puts the text column on
		// the right of the wheel.
		expect(wheelBox.y).toBeLessThan(headingBox.y + headingBox.height);
		expect(headingBox.x).toBeGreaterThan(wheelBox.x + wheelBox.width / 2);
		// The wheel begins just under the top bar — no intro pushing it.
		expect(wheelBox.y).toBeLessThan(200);
		// And the whole circle fits above the fold at this viewport.
		expect(wheelBox.y + wheelBox.height).toBeLessThanOrEqual(900);
	});

	test("narrow viewport keeps the stacked intro-above-wheel flow", async ({
		page,
	}) => {
		await page.setViewportSize({ width: 500, height: 800 });
		await page.goto(MOADIM_ROOT);
		const heading = page.getByRole("heading", {
			name: "מועדים על הפרק",
			level: 1,
		});
		const intro = page.locator("p").filter({
			hasText: "מעגל השנה של קריאות",
		});
		const wheelNav = page.getByRole("navigation", {
			name: "גלגל המועדים",
		});
		const headingBox = await heading.boundingBox();
		const introBox = await intro.boundingBox();
		const wheelBox = await wheelNav.boundingBox();
		if (!headingBox || !introBox || !wheelBox)
			throw new Error("stacked layout boxes missing");
		// Stacked — the wheel starts below the intro text.
		expect(wheelBox.y).toBeGreaterThanOrEqual(
			headingBox.y + headingBox.height,
		);
		expect(wheelBox.y).toBeGreaterThanOrEqual(
			introBox.y + introBox.height - 1,
		);
	});

	// #3254 — wheel month labels use the shared UI font: the SVG text
	// resolves the same family stack as the page body — no decorative face.
	test("wheel month labels render in the shared UI font", async ({ page }) => {
		await page.goto(MOADIM_ROOT);
		await page.evaluate(() => document.fonts.ready);
		const families = await page.evaluate(() => {
			const month = [...document.querySelectorAll("text")].find(
				(el) => el.textContent?.trim() === "תשרי",
			);
			if (!month) return null;
			return {
				month: getComputedStyle(month).fontFamily,
				body: getComputedStyle(document.body).fontFamily,
				heading: getComputedStyle(document.querySelector("h1") as HTMLElement)
					.fontFamily,
			};
		});
		if (!families) throw new Error("month label not found in wheel");
		expect(families.month).toBe(families.body);
		expect(families.month).toBe(families.heading);
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

	// #3254 — צום גדליה gained the full historical account ירמיהו מ-מא as a
	// labelled section next to the retained fast-day readings.
	test("צום גדליה carries the ירמיהו מ-מא historical section", async ({
		page,
	}) => {
		await page.goto(`${MOADIM_ROOT}/${encodeURIComponent("צום-גדליה")}`);
		await expect(
			page.getByRole("heading", { name: "צום גדליה", level: 1 }),
		).toBeVisible();

		// The Torah reading stayed; the new history section follows the
		// מנחה haftarah in ceremony order.
		await expect(
			page.getByRole("heading", { name: "סיפור הרצח - ירמיהו מ-מא" }),
		).toBeVisible();
		const history = page.getByRole("region", {
			name: "סיפור הרצח - ירמיהו מ-מא",
		});
		// The range spans ירמיהו מ (perek 440) through מא (perek 441) —
		// first and last canonical anchors bound it.
		await expect(history.locator('[id^="pasuk-440-1-"]')).toHaveCount(1);
		await expect(history.locator('[id^="pasuk-441-18-"]')).toHaveCount(1);
		await expect(history.locator('[id^="pasuk-441-19-"]')).toHaveCount(0);
	});

	// #3254 — שמיני עצרת ושמחת תורה is one day in Israel.
	test("שמיני עצרת ושמחת תורה shows the Israel date כב תשרי", async ({
		page,
	}) => {
		await page.goto(
			`${MOADIM_ROOT}/${encodeURIComponent("שמיני-עצרת-ושמחת-תורה")}`,
		);
		await expect(
			page.getByRole("heading", {
				name: "שמיני עצרת ושמחת תורה",
				level: 1,
			}),
		).toBeVisible();
		// date_label uses the seed's geresh convention ('א'-ב' בתשרי), not
		// ASCII double quotes.
		await expect(page.getByText("כ'ב בתשרי")).toBeVisible();
		expect(await page.content()).not.toContain("כ'ג בתשרי");
	});

	// #3254 — retired moadim keep their rows but leave public discovery:
	// the catalogue route answers not-found through the same policy as any
	// unpublished moed.
	test("retired moed routes answer not-found", async ({ page }) => {
		for (const slug of ["לג-בעומר", "טו-בשבט"]) {
			const response = await page.goto(
				`${MOADIM_ROOT}/${encodeURIComponent(slug)}`,
			);
			expect(response?.status()).toBe(404);
		}
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
