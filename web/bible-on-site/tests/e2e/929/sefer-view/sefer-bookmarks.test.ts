import { expect } from "@playwright/test";
import {
	isCI,
	shouldMeasureCov,
} from "../../../../../shared/tests-util/environment.mjs";
import { SeferPage } from "../../../util/playwright/page-objects/sefer-page";
import { test } from "../../../util/playwright/test-fixture";

const bookMountTimeoutMs = isCI || shouldMeasureCov ? 60_000 : 20_000;

/**
 * Chapter-tab bookmarks (issue #2543): the alpha.49 native bookmark layer
 * renders one tab per perek along the book's edges, tinted with the sefer's
 * cover color. Tabs navigate on click, expand on hover/focus with the perek
 * title, and follow the סימניות preferences in הגדרות קריאה.
 *
 * Screenshots attach as test artifacts for the visual record.
 */

test.beforeEach(({ skipOnNotWideEnough }) => {
	void skipOnNotWideEnough;
});

test.describe("Sefer chapter tabs", () => {
	test("renders one accent-colored tab per perek with canonical labels", async ({
		page,
	}) => {
		test.setTimeout(90_000);
		const seferPage = new SeferPage(page);
		await seferPage.openSeferViewForPerek(1);

		const tabs = page.locator(".flipbook-bookmark");
		// בראשית has 50 perakim — every one gets a tab.
		await expect(tabs).toHaveCount(50, { timeout: bookMountTimeoutMs });
		await expect(tabs.first()).toBeVisible();

		const perek1 = page.locator(
			'.flipbook-bookmark[data-bookmark-id="perek-1"]',
		);
		await expect(perek1).toHaveAttribute(
			"aria-label",
			"בראשית א - בריאת העולם",
		);
		await expect(perek1).toHaveAttribute("data-page-index", "3");

		await test.info().attach("sefer-bookmark-tabs", {
			body: await page.screenshot(),
			contentType: "image/png",
		});
	});

	test("clicking a tab flips to its perek and updates the URL", async ({
		page,
	}) => {
		test.setTimeout(90_000);
		const seferPage = new SeferPage(page);
		await seferPage.openSeferViewForPerek(1);

		// perekIds happen to equal chapter numbers in בראשית (1-50); pageIndex
		// is CONTENT_OFFSET + index*2 = 3 + 29*2 = 61 for פרק ל.
		// .first(): hovering opens the portaled preview, which clones the tab
		// with the same data-bookmark-id — the in-book original is earlier.
		const perek30 = page
			.locator('.flipbook-bookmark[data-bookmark-id="perek-30"]')
			.first();
		await expect(perek30).toBeVisible({ timeout: bookMountTimeoutMs });
		await perek30.click();

		await expect(page).toHaveURL(/\/929\/30\?book$/, { timeout: 30_000 });
	});

	test("hovering a tab expands it with the perek title", async ({ page }) => {
		test.setTimeout(90_000);
		const seferPage = new SeferPage(page);
		await seferPage.openSeferViewForPerek(1);

		const perek30 = page
			.locator('.flipbook-bookmark[data-bookmark-id="perek-30"]')
			.first();
		await expect(perek30).toBeVisible({ timeout: bookMountTimeoutMs });
		await perek30.hover();

		const preview = page.locator(".flipbook-bookmark-preview");
		await expect(preview).toHaveAttribute("data-open", "true", {
			timeout: 15_000,
		});
		await expect(preview.locator(".sefer-bookmark-expanded-perek")).toHaveText(
			"פרק ל",
		);
		await expect(
			preview.locator(".sefer-bookmark-expanded-source"),
		).toHaveCount(0);

		await test.info().attach("sefer-bookmark-expanded", {
			body: await page.screenshot({
				clip: (await preview.boundingBox()) ?? undefined,
			}),
			contentType: "image/png",
		});
	});

	test("keeps the additional with the chapter in an expanded Kings bookmark", async ({
		page,
	}) => {
		test.setTimeout(90_000);
		const seferPage = new SeferPage(page);
		// The canonical catalog places מלכים א טו at 302 and מלכים א יב at 299.
		await seferPage.openSeferViewForPerek(302);
		const tab = page.locator(
			'.flipbook-bookmark[data-bookmark-id="perek-299"]',
		);
		await expect(tab.locator(".sefer-bookmark-label")).toHaveText("א יב", {
			timeout: bookMountTimeoutMs,
		});
		await page
			.locator('.flipbook-bookmark-slot:has([data-bookmark-id="perek-299"])')
			.hover();
		const preview = page.locator(
			'.flipbook-bookmark-preview[data-open="true"]',
		);
		await expect(preview.locator(".sefer-bookmark-expanded-perek")).toHaveText(
			"פרק א יב",
		);
		await expect(
			preview.locator(".sefer-bookmark-expanded-title"),
		).toBeVisible();
		await expect(
			preview.locator(".sefer-bookmark-expanded-source"),
		).toHaveCount(0);
		await expect(tab).toHaveAttribute("aria-label", /^מלכים א יב(?: - |$)/);
		await expect(
			preview.locator(".flipbook-bookmark__expanded-content"),
		).toHaveCSS("opacity", "1");
		await test.info().attach("sefer-bookmark-kings-a12-after", {
			body: await page.screenshot(),
			contentType: "image/png",
		});
	});

	test("סימניות disabled in settings renders no tabs", async ({ page }) => {
		test.setTimeout(90_000);
		await page.addInitScript(() => {
			localStorage.setItem(
				"seferBookmarks",
				JSON.stringify({ enabled: false }),
			);
		});
		const seferPage = new SeferPage(page);
		await seferPage.openSeferViewForPerek(1);

		// The book mounts but the bookmark layer stays empty.
		await expect(page.locator(".he-book.flipbook")).toBeVisible({
			timeout: bookMountTimeoutMs,
		});
		await expect(page.locator(".flipbook-bookmark")).toHaveCount(0);
	});

	test("toolbar toggle hides and shows the tabs and persists across reload", async ({
		page,
	}) => {
		test.setTimeout(120_000);
		const seferPage = new SeferPage(page);
		await seferPage.openSeferViewForPerek(1);

		const tabs = page.locator(".flipbook-bookmark");
		await expect(tabs).toHaveCount(50, { timeout: bookMountTimeoutMs });

		// The built-in library toggle shares the persisted סימניות state.
		const hideToggle = page.getByRole("button", { name: "הסתרת סימניות" });
		await expect(hideToggle).toHaveAttribute("aria-pressed", "true");
		await hideToggle.click();
		await expect(tabs).toHaveCount(0);

		// The control stays reachable while tabs are hidden so they can return.
		const showToggle = page.getByRole("button", { name: "הצגת סימניות" });
		await expect(showToggle).toHaveAttribute("aria-pressed", "false");

		await page.reload();
		await expect(page.locator(".he-book.flipbook")).toBeVisible({
			timeout: bookMountTimeoutMs,
		});
		await expect(tabs).toHaveCount(0);
		await expect(showToggle).toBeVisible();

		await showToggle.click();
		await expect(tabs).toHaveCount(50);
		// Visibility toggles never move the reader: same chapter route.
		await expect(page).toHaveURL(/\/929\/1\?book$/);

		// Book fullscreen keeps the toolbar — and the toggle — reachable.
		await page
			.getByRole("button", { name: "Enter fullscreen" })
			.click();
		const hideToggleFs = page.getByRole("button", {
			name: "הסתרת סימניות",
		});
		await expect(hideToggleFs).toBeVisible();
		await hideToggleFs.click();
		await expect(tabs).toHaveCount(0);
		await page
			.getByRole("button", { name: "הצגת סימניות" })
			.click();
		await expect(tabs.first()).toBeVisible();
		await page
			.getByRole("button", { name: "Exit fullscreen" })
			.click();

		await test.info().attach("sefer-bookmarks-toolbar-toggle", {
			body: await page.screenshot(),
			contentType: "image/png",
		});
	});

	test("toolbar toggle and the סימניות preference share one persisted state", async ({
		page,
	}) => {
		test.setTimeout(120_000);
		const seferPage = new SeferPage(page);
		await seferPage.openSeferViewForPerek(1);
		const tabs = page.locator(".flipbook-bookmark");
		await expect(tabs).toHaveCount(50, { timeout: bookMountTimeoutMs });

		// Toolbar -> preference: hiding from the toolbar is reflected in the
		// הגדרות קריאה dialog on the flat page.
		await page.getByRole("button", { name: "הסתרת סימניות" }).click();
		await expect(tabs).toHaveCount(0);
		await seferPage.closeSeferView();
		await page
			.getByRole("button", { name: "הגדרות קריאה", exact: true })
			.click();
		const bookmarkToggle = page.getByRole("checkbox", {
			name: "סימניות פרקים",
		});
		await expect(bookmarkToggle).not.toBeChecked();

		// Preference -> toolbar: re-enabling in the dialog restores the tabs
		// and flips the toolbar control back to the hide action.
		await bookmarkToggle.check();
		await page.getByRole("button", { name: "סגירת הגדרות" }).click();
		await seferPage.openSeferView();
		await expect(tabs).toHaveCount(50, { timeout: bookMountTimeoutMs });
		await expect(
			page.getByRole("button", { name: "הסתרת סימניות" }),
		).toHaveAttribute("aria-pressed", "true");
	});
});
