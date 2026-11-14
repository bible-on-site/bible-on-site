// import { test, expect } from "@playwright/test";

import sharp from "sharp";
import { expect, test } from "../../util/playwright/test-fixture";

const ROOT_URL = "/";

test.describe("Root page", () => {
	test("Has correct title", async ({ page }) => {
		await page.goto(ROOT_URL);
		await expect(page).toHaveTitle('תנ"ך על הפרק');
	});

	test("Shows daily learning link", async ({ page }) => {
		await page.goto(ROOT_URL);
		const dailyLearningLink = page.getByRole("link", {
			name: "לימוד יומי על הפרק",
		});
		await expect(dailyLearningLink).toBeVisible();
	});

	test("Shows app section", async ({ page }) => {
		await page.goto(ROOT_URL);
		const appSection = page.getByRole("heading", {
			name: 'ישומון תנ"ך על הפרק',
		});
		await expect(appSection).toBeVisible();
	});

	test("Shows מספרים על הפרק counters with database totals", async ({
		page,
	}) => {
		await page.goto(ROOT_URL);
		const section = page.locator("#numbers");
		await expect(
			section.getByRole("heading", { name: "מספרים על הפרק" }),
		).toBeVisible();
		// Scroll trigger starts the shared count-up; fixture data (4 public
		// articles) must settle at the exact totals. רבנים is the fixed word
		// עשרות by design, never a number (#2397).
		await section.scrollIntoViewIfNeeded();
		const expected: [string, RegExp][] = [
			["רבנים כותבים על הפרק", /^עשרות$/],
			["מאמרים על הפרק", /^4$/],
			["ערכים על הפרק בתנכפדיה", /^\d[\d,]*$/],
			["איורים על הפרק", /^\d[\d,]*$/],
			["פרקים מוקלטים", /^\d[\d,]*$/],
			["שנים שהתוכנית רצה", /^\d+$/],
		];
		for (const [label, value] of expected) {
			const stat = section.locator("dl > div", { hasText: label });
			await expect(stat.locator('[aria-hidden="true"]')).toHaveText(value, {
				timeout: 10_000,
			});
		}
	});

	test("Counters link to real public destinations only", async ({
		page,
	}) => {
		await page.goto(ROOT_URL);
		const section = page.locator("#numbers");
		const expected: [RegExp, string][] = [
			[/^רבנים כותבים על הפרק: עשרות$/, "/929/authors"],
			[/^ערכים על הפרק בתנכפדיה: /, "/pedia"],
			[/^שנים שהתוכנית רצה: /, "/calendar"],
		];
		for (const [name, href] of expected) {
			await expect(
				section.getByRole("link", { name }),
			).toHaveAttribute("href", href);
		}
		// מאמרים (no collection route), איורים and פרקים מוקלטים (no
		// gallery/recording browse) must stay ordinary text (#2397).
		for (const label of [
			"מאמרים על הפרק",
			"איורים על הפרק",
			"פרקים מוקלטים",
		]) {
			const stat = section.locator("dl > div", { hasText: label });
			await expect(stat.locator("a")).toHaveCount(0);
		}
	});

	test("Counters section keeps a distinct background from the app section", async ({
		page,
	}) => {
		await page.goto(ROOT_URL);
		const numbersBg = await page
			.locator("#numbers")
			.evaluate((el) => getComputedStyle(el).backgroundColor);
		const appBg = await page
			.getByRole("heading", { name: 'ישומון תנ"ך על הפרק' })
			.evaluate((el) =>
				getComputedStyle(el.closest("section") as Element).backgroundColor,
			);
		expect(numbersBg).not.toBe(appBg);
	});

	// #3267: the daily bulletin and the sefarim shelf are independent
	// features, so they must not share one continuous band — distinct
	// surfaces joined by the shared shaped edge.
	test("Daily bulletin and sefarim shelf are separate bands joined by a shaped edge", async ({
		page,
	}) => {
		await page.goto(ROOT_URL);
		const bulletin = page.locator("#bulletin");
		const shelf = page.locator("#tanah-sefarim");
		const bulletinBg = await bulletin.evaluate(
			(el) => getComputedStyle(el).backgroundColor,
		);
		const shelfBg = await shelf.evaluate(
			(el) => getComputedStyle(el).backgroundColor,
		);
		expect(bulletinBg).not.toBe(shelfBg);

		// The shared edge is decorative (hidden, non-interactive), painted
		// with the shelf's own surface through a shaped mask so the boundary
		// is a seamless curve, not a straight seam.
		const divider = page.locator('#bulletin > div[aria-hidden="true"]');
		const edge = await divider.evaluate((el) => {
			const cs = getComputedStyle(el);
			const r = el.getBoundingClientRect();
			return {
				paint: cs.backgroundColor,
				pointerEvents: cs.pointerEvents,
				mask: cs.maskImage || cs.getPropertyValue("-webkit-mask-image"),
				top: r.top,
				bottom: r.bottom,
				height: r.height,
			};
		});
		expect(edge.paint).toBe(shelfBg);
		expect(edge.pointerEvents).toBe("none");
		expect(edge.mask).toContain(".svg");
		expect(edge.height).toBeGreaterThan(10);

		// The mask asset must actually resolve — a missing SVG would still
		// leave a url() in computed style while the boundary renders
		// unshaped (Devin Review #3293).
		const maskUrl = /url\(["']?([^"')]+)/.exec(edge.mask)?.[1];
		expect(maskUrl).toBeTruthy();
		const maskResponse = await page.request.get(
			new URL(maskUrl ?? "", page.url()).href,
		);
		expect(maskResponse.ok()).toBe(true);

		// Straddles the seam without covering any join-card action.
		const seam = await shelf.evaluate(
			(el) => el.getBoundingClientRect().top,
		);
		expect(edge.top).toBeLessThan(seam);
		expect(Math.abs(edge.bottom - seam)).toBeLessThan(2);
		const telegramAction = bulletin.getByRole("link", {
			name: "הצטרפות לערוץ",
		});
		const actionBox = await telegramAction.boundingBox();
		expect(actionBox).not.toBeNull();
		// biome-ignore lint/style/noNonNullAssertion: asserted non-null above
		expect(actionBox!.y + actionBox!.height).toBeLessThanOrEqual(
			edge.top + 1,
		);

		// No horizontal overflow from the edge or the bands.
		const overflow = await page.evaluate(
			() =>
				document.documentElement.scrollWidth -
				document.documentElement.clientWidth,
		);
		expect(overflow).toBeLessThanOrEqual(1);

		// SVG viewBox letterboxing can leave an unpainted strip even when
		// the mask loads and its element meets the shelf. Check real pixels
		// along the rendered edge, not only the element's geometry.
		const { data, info } = await sharp(await divider.screenshot())
			.raw()
			.toBuffer({ resolveWithObject: true });
		const shelfRgb = (shelfBg.match(/\d+/g) ?? []).map(Number);
		for (const fraction of [0.25, 0.5, 0.75]) {
			const x = Math.floor(info.width * fraction);
			const offset = ((info.height - 2) * info.width + x) * info.channels;
			expect([...data.subarray(offset, offset + 3)]).toEqual(shelfRgb);
		}
	});

	test("Bulletin→shelf edge tracks the shelf surface in dark mode", async ({
		page,
	}) => {
		await page.emulateMedia({ colorScheme: "dark" });
		await page.goto(ROOT_URL);
		// The shelf band darkens; the shared edge must repaint the same dark
		// surface or the boundary would show a light seam in dark mode.
		const shelfBg = await page
			.locator("#tanah-sefarim")
			.evaluate((el) => getComputedStyle(el).backgroundColor);
		const edgePaint = await page
			.locator('#bulletin > div[aria-hidden="true"]')
			.evaluate((el) => getComputedStyle(el).backgroundColor);
		expect(edgePaint).toBe(shelfBg);
		// The bulletin band stays a light island by design.
		const bulletinBg = await page
			.locator("#bulletin")
			.evaluate((el) => getComputedStyle(el).backgroundColor);
		expect(bulletinBg).toBe("rgb(255, 255, 255)");
	});

	// Guard for the landing-section convention (#3267): every adjacent pair
	// of top-level landing feature sections must keep a shaped boundary, so
	// a future feature cannot silently merge into its neighbor's band.
	test("Every adjacent landing feature section keeps a shaped boundary", async ({
		page,
	}) => {
		await page.goto(ROOT_URL);
		const seams = await page.evaluate(() => {
			const sections = [
				...document.querySelectorAll("main > section"),
			] as Element[];
			return sections.slice(1).map((section, i) => {
				const prev = sections[i].getBoundingClientRect();
				const cur = section.getBoundingClientRect();
				const seam = (prev.bottom + cur.top) / 2;
				const edges = [
					...sections[i].querySelectorAll("[class*=ivider]"),
					...section.querySelectorAll("[class*=ivider]"),
				];
				const hasEdge = edges.some((edge) => {
					const r = edge.getBoundingClientRect();
					return (
						r.height > 0 && r.top <= seam + 4 && r.bottom >= seam - 4
					);
				});
				const label = (el: Element) =>
					el.id || el.className.toString().split(" ")[0];
				return {
					pair: `${label(sections[i])} → ${label(section)}`,
					hasEdge,
				};
			});
		});
		expect(seams.length).toBeGreaterThanOrEqual(6);
		for (const { pair, hasEdge } of seams) {
			expect(hasEdge, `missing shaped boundary at ${pair}`).toBe(true);
		}
	});

	test("Footer links to the accessibility statement", async ({ page }) => {
		await page.goto(ROOT_URL);
		const link = page
			.locator("footer")
			.getByRole("link", { name: "הצהרת נגישות" });
		await expect(link).toHaveAttribute("href", "/accessibility");
	});
});
