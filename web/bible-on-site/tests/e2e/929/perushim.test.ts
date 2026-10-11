import { expect, test } from "../../util/playwright/test-fixture";

/**
 * E2E tests for the PerushimSection (commentaries carousel and full view).
 *
 * - Section heading "פרשנים על הפרק" is always present.
 * - When no perushim for the perek: empty message "אין פרשנות לפרק זה".
 * - When perushim exist: carousel items are real links to the dedicated
 *   /929/{perek}/{perush} page, which renders the full commentary once,
 *   above the scripture (issue #2115).
 */

const perushimSection = (page: import("@playwright/test").Page) =>
	page.locator("section").filter({
		has: page.locator("text=פרשנים על הפרק"),
	});

test.describe("Perushim Section", () => {
	test("shows perushim section with heading on 929 perek page", async ({
		page,
	}) => {
		await page.goto("/929/1");

		await expect(perushimSection(page)).toBeVisible();
	});

	test("shows empty message or carousel when perushim section visible", async ({
		page,
	}) => {
		await page.goto("/929/2");

		const section = perushimSection(page);
		await expect(section).toBeVisible();

		// Either empty message or at least one carousel item (link in SEO mode)
		const emptyMsg = section.getByText("אין פרשנות לפרק זה");
		const anyCarouselItem = section.locator("a").first();
		await expect(emptyMsg.or(anyCarouselItem)).toBeVisible();
	});

	test("carousel items navigate to the dedicated perush page", async ({
		page,
	}) => {
		await page.goto("/929/1");

		const section = perushimSection(page);
		await expect(section).toBeVisible();

		const firstCarouselLink = section.locator("a").first();
		const emptyMessage = section.getByText("אין פרשנות לפרק זה");

		if (await emptyMessage.isVisible()) {
			test.skip();
			return;
		}

		const href = await firstCarouselLink.getAttribute("href");
		expect(href).toMatch(/^\/929\/1\/.+/);
		await firstCarouselLink.click();
		await page.waitForURL((url) => url.pathname === href);

		// The dedicated page presents the full commentary exactly once,
		// above the scripture — never a second instance below it (#2115).
		const perushView = page.locator("#perush-view");
		await expect(perushView).toHaveCount(1);
		await expect(
			perushView.getByRole("heading", { level: 1 }),
		).toBeVisible();
		const isAboveScripture = await perushView.evaluate((el) => {
			const firstPasuk = document.getElementById("pasuk-1");
			return (
				firstPasuk !== null &&
				(el.compareDocumentPosition(firstPasuk) &
					Node.DOCUMENT_POSITION_FOLLOWING) !==
					0
			);
		});
		expect(isAboveScripture).toBe(true);
	});

	test("selecting the already-active perush keeps a single full view", async ({
		page,
	}) => {
		await page.goto("/929/1");

		const section = perushimSection(page);
		const firstCarouselLink = section.locator("a").first();
		if (!(await firstCarouselLink.isVisible())) {
			test.skip();
			return;
		}

		const href = await firstCarouselLink.getAttribute("href");
		await firstCarouselLink.click();
		await page.waitForURL((url) => url.pathname === href);
		await expect(page.locator("#perush-view")).toHaveCount(1);

		// Regression for #2115: re-selecting the active perush must not add a
		// second rendering of its content below the scripture.
		const activeLink = section.locator(`a[href="${href}"]`);
		await activeLink.scrollIntoViewIfNeeded();
		await activeLink.click();

		await expect(page.locator("#perush-view")).toHaveCount(1);
		expect(new URL(page.url()).pathname).toBe(href);
		// The carousel is still rendered once, under the chapter text.
		await expect(perushimSection(page)).toHaveCount(1);
	});

	test("selecting a different perush replaces the top content and Back restores", async ({
		page,
	}) => {
		await page.goto("/929/1");

		const section = perushimSection(page);
		const links = section.locator("a");
		if ((await links.count()) < 2) {
			test.skip();
			return;
		}

		const firstHref = await links.first().getAttribute("href");
		await links.first().click();
		await page.waitForURL((url) => url.pathname === firstHref);
		const firstTitle = await page
			.locator("#perush-view h1")
			.textContent();

		// Pick a carousel item that is not the currently displayed perush.
		const otherLink = section.locator(`a:not([href="${firstHref}"])`).first();
		const otherHref = await otherLink.getAttribute("href");
		expect(otherHref).not.toBe(firstHref);
		await otherLink.scrollIntoViewIfNeeded();
		await otherLink.click();
		await page.waitForURL((url) => url.pathname === otherHref);

		// The previous selection is replaced, not duplicated.
		await expect(page.locator("#perush-view")).toHaveCount(1);
		const secondTitle = await page
			.locator("#perush-view h1")
			.textContent();
		expect(secondTitle).not.toBe(firstTitle);

		// Browser Back returns to the first selection.
		await page.goBack();
		await page.waitForURL((url) => url.pathname === firstHref);
		await expect(page.locator("#perush-view")).toHaveCount(1);
		await expect(page.locator("#perush-view h1")).toHaveText(
			firstTitle ?? "",
		);
	});

	test("dedicated page back link returns to the perek carousel", async ({
		page,
	}) => {
		await page.goto("/929/1");

		const section = perushimSection(page);
		const firstLink = section.locator("a").first();
		if (!(await firstLink.isVisible())) {
			test.skip();
			return;
		}

		const href = await firstLink.getAttribute("href");
		await firstLink.click();
		await page.waitForURL((url) => url.pathname === href);
		await expect(page.locator("#perush-view")).toBeVisible();

		await page.getByRole("link", { name: /חזרה לפרק/ }).click();
		await page.waitForURL((url) => url.pathname === "/929/1");

		// Back on the perek the carousel is present and no full view remains.
		await expect(perushimSection(page)).toBeVisible();
		await expect(page.locator("#perush-view")).toHaveCount(0);
	});
});
