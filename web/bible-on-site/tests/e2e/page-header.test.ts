import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../util/playwright/test-fixture";

/**
 * Page/header contract e2e (issue #3161) — renders every declared family
 * policy and asserts the shared top bar is actually readable and operable,
 * not merely present in the DOM. A transparent white-on-white bar passes
 * `toBeVisible()`, so these checks assert the measured background, the
 * loaded logo bitmap, hit areas and the content clearance instead.
 *
 * The route families themselves are enumerated from the filesystem in
 * tests/unit/app/page-header-policy.test.ts — this suite renders one
 * representative URL per family/policy (catalogue + detail + aliases +
 * the deliberate error/fullscreen variants), so a family that resolves a
 * wrong or missing policy shows up here and in the unit check.
 */

const NAV_BG = "rgb(21, 82, 172)"; // --accent-600 (#1552ac)
const NAV_HEIGHT = 72;
const MIN_HIT_AREA = 40; // controls are 2.75rem = 44px; allow a small margin

type HeaderFamily = {
	/** Human label for the test title. */
	name: string;
	url: string;
	policy: "solid" | "overlay" | "none";
	/** The shared search button is hidden on reader sections (#2274). */
	search: boolean;
	/** Where the accessibility trigger docks on this family. */
	a11yDock: "search" | "prefs" | "edge";
	/** Selector for the first meaningful content the bar must not cover. */
	contentProbe?: string;
};

const FAMILIES: HeaderFamily[] = [
	{
		name: "homepage hero",
		url: "/",
		policy: "overlay",
		search: true,
		a11yDock: "search",
	},
	{
		name: "מועדים catalogue",
		url: `/${encodeURIComponent("מועדים")}`,
		policy: "solid",
		search: true,
		a11yDock: "search",
		contentProbe: "h1",
	},
	{
		name: "moed detail",
		url: `/${encodeURIComponent("מועדים")}/${encodeURIComponent("מועד-בדיקה")}`,
		policy: "solid",
		search: true,
		a11yDock: "search",
		contentProbe: "h1",
	},
	{
		name: "learning calendar (לוח rewrite)",
		url: `/${encodeURIComponent("לוח")}`,
		policy: "solid",
		search: true,
		a11yDock: "search",
		contentProbe: "h1",
	},
	{
		name: "pedia landing",
		url: "/pedia",
		policy: "solid",
		search: true,
		a11yDock: "search",
		contentProbe: "h1",
	},
	{
		name: "pedia entry",
		url: `/pedia/${encodeURIComponent("יהושע-בן-נון")}`,
		policy: "solid",
		search: true,
		a11yDock: "search",
		contentProbe: "article",
	},
	{
		name: "perek reader",
		url: "/929/1",
		policy: "solid",
		search: false,
		a11yDock: "prefs",
		contentProbe: '[class*="perekContainer"]',
	},
	{
		name: "article",
		url: "/929/1/1",
		policy: "solid",
		search: false,
		a11yDock: "prefs",
		contentProbe: "#article-view",
	},
	{
		name: "authors (gearless reader section)",
		url: "/929/authors",
		policy: "solid",
		search: false,
		a11yDock: "edge",
		contentProbe: "h1",
	},
	{
		name: "מסורה landing",
		url: `/${encodeURIComponent("מסורה")}`,
		policy: "solid",
		search: true,
		a11yDock: "search",
		contentProbe: "h1",
	},
	{
		name: "מסורה unit",
		url: `/${encodeURIComponent("מסורה")}/1`,
		policy: "solid",
		search: false,
		a11yDock: "prefs",
		contentProbe: '[class*="perekContainer"]',
	},
	{
		name: "פרשה landing",
		url: `/${encodeURIComponent("פרשה")}`,
		policy: "solid",
		search: true,
		a11yDock: "search",
		contentProbe: "h1",
	},
	{
		name: "פרשה unit",
		url: `/${encodeURIComponent("פרשה")}/${encodeURIComponent("בראשית")}`,
		policy: "solid",
		search: false,
		a11yDock: "prefs",
		contentProbe: '[class*="perekContainer"]',
	},
	{
		name: "bookshelf",
		url: "/bookshelf",
		policy: "solid",
		search: true,
		a11yDock: "search",
	},
	{
		name: "search",
		url: "/search",
		policy: "solid",
		search: true,
		a11yDock: "search",
		contentProbe: "h1",
	},
	{
		name: "accessibility statement",
		url: "/accessibility",
		policy: "solid",
		search: true,
		a11yDock: "search",
		contentProbe: "h1",
	},
	{
		name: "journalism",
		url: "/journalism",
		policy: "solid",
		search: true,
		a11yDock: "search",
		contentProbe: "h1",
	},
	{
		name: "rabbis blessing",
		url: "/rabbis-blessing",
		policy: "solid",
		search: true,
		a11yDock: "search",
		contentProbe: "h1",
	},
	{
		name: "not-found (error variant)",
		url: "/no-such-route-3161",
		policy: "solid",
		search: true,
		a11yDock: "search",
		contentProbe: "h1",
	},
	{
		name: "dev sefer (fullscreen)",
		url: "/dev/sefer/1",
		policy: "none",
		search: false,
		a11yDock: "search",
	},
];

// WCAG relative luminance + contrast ratio — same math the accessibility
// suite uses for its measured-pair evidence.
const luminance = (rgb: number[]) => {
	const chan = (v: number) => {
		const s = v / 255;
		return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * chan(rgb[0]) + 0.7152 * chan(rgb[1]) + 0.0722 * chan(rgb[2]);
};
const ratio = (fg: number[], bg: number[]) =>
	(Math.max(luminance(fg), luminance(bg)) + 0.05) /
	(Math.min(luminance(fg), luminance(bg)) + 0.05);
const rgb = (css: string): number[] => {
	const channels = css.match(/\d+(\.\d+)?/g)?.map(Number) ?? [];
	if (channels.length < 3) throw new Error(`Not a color: "${css}"`);
	return channels.slice(0, 3);
};

const boxOrFail = async (locator: Locator, what: string) => {
	const box = await locator.boundingBox();
	if (!box) throw new Error(`Expected a rendered box for ${what}`);
	return box;
};

async function expectReadableHeader(
	page: Page,
	family: HeaderFamily,
	viewportWidth: number,
) {
	// The declaration itself is on a direct body child — the outermost
	// element the family mounts.
	const shell = page.locator("body > [data-page-header]");
	await expect(shell).toHaveCount(1);
	await expect(shell).toHaveAttribute("data-page-header", family.policy);

	const nav = page.getByRole("navigation", { name: "ניווט עליון" });
	const hamburger = page.getByRole("button", { name: "תפריט ראשי" });
	if (family.policy === "none") {
		// Intentional header-less route: the bar leaves the render tree
		// entirely rather than sitting invisible under the fullscreen surface.
		await expect(nav).toBeHidden();
		// The hamburger is the deliberate escape hatch — still operable.
		await expect(hamburger).toBeVisible();
		await hamburger.click();
		await expect(hamburger).toHaveAttribute("aria-expanded", "true");
		await page.keyboard.press("Escape");
		await expect(hamburger).toHaveAttribute("aria-expanded", "false");
		return;
	}
	// Exactly one top-navigation landmark (the sidebar menu is a different
	// landmark and only opens on demand).
	await expect(nav).toHaveCount(1);

	// The bar fills the viewport's top edge.
	const navBox = await boxOrFail(nav, "top nav");
	expect(navBox.y).toBe(0);
	expect(navBox.x).toBe(0);
	expect(navBox.height).toBe(NAV_HEIGHT);
	expect(navBox.width).toBe(viewportWidth);

	// Logo: real loaded bitmap inside a home link with a usable hit area —
	// the readable-white check below covers what toBeVisible() cannot.
	// Scoped to the bar: page content can link home with the same label.
	const logo = nav.getByRole("link", { name: 'תנ"ך על הפרק' });
	await expect(logo).toHaveCount(1);
	const logoBox = await boxOrFail(logo, "logo link");
	expect(logoBox.width).toBeGreaterThanOrEqual(MIN_HIT_AREA);
	expect(logoBox.height).toBeGreaterThanOrEqual(MIN_HIT_AREA);
	const logoImg = logo.locator("img");
	await expect(logoImg).toBeVisible();
	const naturalWidth = await logoImg.evaluate(
		(el) => (el as HTMLImageElement).naturalWidth,
	);
	expect(naturalWidth).toBeGreaterThan(0);

	if (family.policy === "solid") {
		// Measured treatment — white foreground on the brand bar (~7.4:1).
		await expect(nav).toHaveCSS("background-color", NAV_BG);
		const fg = await page
			.getByRole("button", { name: "התאמות נגישות" })
			.evaluate((el) => getComputedStyle(el).color);
		expect(ratio(rgb(fg), rgb(NAV_BG))).toBeGreaterThan(4.5);
	} else {
		// Overlay: the bar is transparent by declaration — assert the page
		// paints a dark backdrop under the white controls (the exact failure
		// this contract prevents). elementsFromPoint returns the paint stack
		// under the logo; the first opaque background beneath the bar is the
		// backdrop the white logo and controls actually sit on.
		await expect(nav).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
		const backdropColor = await logo.evaluate((el) => {
			const box = el.getBoundingClientRect();
			const stack = document.elementsFromPoint(
				box.x + box.width / 2,
				box.y + box.height / 2,
			);
			const navEl = el.closest("nav");
			const navIndex = navEl ? stack.indexOf(navEl) : stack.length;
			for (const node of stack.slice(Math.max(navIndex, 0) + 1)) {
				const bg = getComputedStyle(node).backgroundColor;
				if (bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") return bg;
			}
			return null;
		});
		if (!backdropColor) {
			throw new Error("no opaque backdrop found under the overlay header");
		}
		expect(ratio([255, 255, 255], rgb(backdropColor))).toBeGreaterThan(4.5);
	}

	// Operable controls with real hit areas.
	await expect(hamburger).toBeVisible();
	const hamBox = await boxOrFail(hamburger, "hamburger");
	expect(hamBox.width).toBeGreaterThanOrEqual(MIN_HIT_AREA);
	expect(hamBox.height).toBeGreaterThanOrEqual(MIN_HIT_AREA);
	await hamburger.click();
	await expect(hamburger).toHaveAttribute("aria-expanded", "true");
	await page.keyboard.press("Escape");
	await expect(hamburger).toHaveAttribute("aria-expanded", "false");

	const search = page.getByRole("link", { name: "חיפוש" });
	if (family.search) {
		await expect(search).toHaveCount(1);
		await expect(search).toBeVisible();
		const searchBox = await boxOrFail(search, "search link");
		expect(searchBox.width).toBeGreaterThanOrEqual(MIN_HIT_AREA);
		expect(searchBox.height).toBeGreaterThanOrEqual(MIN_HIT_AREA);
	} else {
		// Reader routes mount no clickable remnant at all (#2274).
		await expect(search).toHaveCount(0);
		expect(await page.locator(".top-nav-search").count()).toBe(0);
	}

	const a11y = page.getByRole("button", { name: "התאמות נגישות" });
	await expect(a11y).toHaveCount(1);
	await expect(a11y).toBeVisible();
	const a11yBox = await boxOrFail(a11y, "accessibility trigger");
	expect(a11yBox.width).toBeGreaterThanOrEqual(MIN_HIT_AREA);
	expect(a11yBox.height).toBeGreaterThanOrEqual(MIN_HIT_AREA);
	const dockClass = {
		search: "",
		prefs: "top-nav-accessibility--after-prefs",
		edge: "top-nav-accessibility--edge",
	}[family.a11yDock];
	if (dockClass) {
		await expect(a11y).toContainClass(dockClass);
	}
	// Operable: enabled once hydrated, opens and dismisses the menu.
	await expect(a11y).toBeEnabled();
	await a11y.click();
	const menu = page.getByRole("dialog", { name: "התאמות נגישות" });
	await expect(menu).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(menu).toBeHidden();

	// No overlap: the first meaningful content starts at or below the bar.
	if (family.contentProbe) {
		const content = page.locator(family.contentProbe).first();
		await expect(content).toBeVisible();
		const contentBox = await boxOrFail(content, "first content");
		expect(contentBox.y).toBeGreaterThanOrEqual(navBox.y + NAV_HEIGHT - 1);
	}
}

const family = (name: string): HeaderFamily => {
	const found = FAMILIES.find((f) => f.name === name);
	if (!found) throw new Error(`No header family named ${name}`);
	return found;
};

test.describe("page header contract", () => {
	// DB-backed routes compile cold after the launcher's fresh populate.
	test.describe.configure({ timeout: 120_000 });

	for (const f of FAMILIES) {
		test(`${f.name} (${f.url}) renders the ${f.policy} header`, async ({
			page,
		}) => {
			const viewportWidth = page.viewportSize()?.width ?? 1280;
			// Initial SSR paint — the CSS-driven policy must already be right
			// at domcontentloaded, before any hydration (no flash).
			await page.goto(f.url, { waitUntil: "domcontentloaded" });
			const nav = page.locator("nav.top-nav");
			if (f.policy === "none") {
				await expect(nav).toBeHidden();
			} else if (f.policy === "solid") {
				await expect(nav).toHaveCSS("background-color", NAV_BG);
			} else {
				await expect(nav).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
			}
			// Hydrated render — the assertions the user actually sees.
			await page.waitForLoadState("load");
			await expectReadableHeader(page, f, viewportWidth);
		});
	}

	test("client navigation switches the declared treatment without a flash", async ({
		page,
	}) => {
		const viewportWidth = page.viewportSize()?.width ?? 1280;
		const nav = page.locator("nav.top-nav");
		// Start on the overlay hero — transparent bar over the brand hero.
		await page.goto("/");
		await expect(nav).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");

		// Client-navigate into a solid family through the sidebar menu.
		await page.getByRole("button", { name: "תפריט ראשי" }).click();
		await page
			.getByRole("navigation", { name: "תפריט ראשי" })
			.getByRole("link", { name: "לוח לימוד יומי" })
			.click();
		await page.waitForURL(`**/${encodeURIComponent("לוח")}`);
		await expect(nav).toHaveCSS("background-color", NAV_BG);
		await expectReadableHeader(
			page,
			family("learning calendar (לוח rewrite)"),
			viewportWidth,
		);

		// And back through the logo to the overlay family (scoped to the
		// bar — page content can link home with the same label).
		await nav.getByRole("link", { name: 'תנ"ך על הפרק' }).click();
		await page.waitForURL("**/");
		await expect(nav).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
	});

	test("narrow viewport keeps the declared treatment and hit areas", async ({
		page,
	}) => {
		const narrow = { width: 390, height: 844 };
		await page.setViewportSize(narrow);
		for (const name of ["מועדים catalogue", "homepage hero", "perek reader"]) {
			await page.goto(family(name).url);
			await expectReadableHeader(page, family(name), narrow.width);
		}
	});

	test("dark color scheme keeps the solid bar readable", async ({ page }) => {
		await page.emulateMedia({ colorScheme: "dark" });
		await page.goto(`/${encodeURIComponent("מועדים")}`);
		const nav = page.locator("nav.top-nav");
		// The brand bar is scheme-independent — the white controls must
		// still read on it when the page itself goes dark.
		await expect(nav).toHaveCSS("background-color", NAV_BG);
		const fg = await page
			.getByRole("button", { name: "התאמות נגישות" })
			.evaluate((el) => getComputedStyle(el).color);
		expect(ratio(rgb(fg), rgb(NAV_BG))).toBeGreaterThan(4.5);
	});

	test("header controls are keyboard-operable on a solid family", async ({
		page,
	}) => {
		await page.goto(`/${encodeURIComponent("מועדים")}`);
		// The a11y trigger is disabled until its client controls hydrate.
		const a11y = page.getByRole("button", { name: "התאמות נגישות" });
		await expect(a11y).toBeEnabled();
		// Tab reaches the bar controls in DOM order: logo → search → a11y.
		await page.keyboard.press("Tab");
		const logo = page
			.locator("nav.top-nav")
			.getByRole("link", { name: 'תנ"ך על הפרק' });
		await expect(logo).toBeFocused();
		await page.keyboard.press("Tab");
		await expect(page.getByRole("link", { name: "חיפוש" })).toBeFocused();
		await page.keyboard.press("Tab");
		await expect(a11y).toBeFocused();
		// Enter opens the a11y dialog; Escape dismisses back to the trigger.
		await page.keyboard.press("Enter");
		await expect(
			page.getByRole("dialog", { name: "התאמות נגישות" }),
		).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(a11y).toBeFocused();
		// The hamburger toggles and restores from the keyboard too.
		const hamburger = page.getByRole("button", { name: "תפריט ראשי" });
		await hamburger.focus();
		await page.keyboard.press("Enter");
		await expect(hamburger).toHaveAttribute("aria-expanded", "true");
		await page.keyboard.press("Escape");
		await expect(hamburger).toHaveAttribute("aria-expanded", "false");
	});
});
