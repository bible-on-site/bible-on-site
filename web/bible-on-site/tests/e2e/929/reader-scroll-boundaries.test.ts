import type { CDPSession, Page } from "@playwright/test";
import { expect, test } from "../../util/playwright/test-fixture";

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

async function touchScroll(page: Page, session: CDPSession, distance: number) {
	await session.send("Input.dispatchTouchEvent", {
		type: "touchStart",
		touchPoints: [{ x: 195, y: 422, id: 1 }],
	});
	for (let step = 1; step <= 8; step++) {
		await session.send("Input.dispatchTouchEvent", {
			type: "touchMove",
			touchPoints: [{ x: 195, y: 422 + (distance * step) / 8, id: 1 }],
		});
		await page.evaluate(() => new Promise(requestAnimationFrame));
	}
	await session.send("Input.dispatchTouchEvent", {
		type: "touchEnd",
		touchPoints: [],
	});
}

async function expectReaderControlsAligned(page: Page) {
	const header = await page.locator(".top-nav").boundingBox();
	const settings = await page
		.getByRole("button", { name: "הגדרות קריאה", exact: true })
		.boundingBox();
	const menu = await page
		.getByRole("button", { name: "תפריט ראשי", exact: true })
		.boundingBox();
	expect(header).not.toBeNull();
	expect(header?.y).toBe(0);
	expect(header?.height).toBe(72);
	for (const control of [settings, menu]) {
		expect(control).not.toBeNull();
		expect(control?.y).toBeGreaterThanOrEqual(header?.y ?? 0);
		expect((control?.y ?? 0) + (control?.height ?? 0)).toBeLessThanOrEqual(
			(header?.y ?? 0) + (header?.height ?? 0),
		);
	}
	expect(await page.evaluate(() => window.scrollY)).toBe(0);
}

test("bottom overscroll and scrolling back keep the header and settings aligned", async ({
	page,
}) => {
	await page.goto("/929/350", { waitUntil: "domcontentloaded" });
	const article = page.getByRole("article");
	await expect(article).toHaveAttribute("data-pasuk-navigation-ready", "");
	const reader = article.locator("..");

	// Headless Chromium has no retracting address bar. Give the outer document
	// the extra scroll range that a mobile 100vh reader creates with the bar open.
	await page.evaluate(() => {
		document.body.style.minHeight = `${window.innerHeight + 80}px`;
	});
	await expectReaderControlsAligned(page);
	await reader.evaluate((element) => {
		element.scrollTop = element.scrollHeight;
	});
	const bottom = await reader.evaluate((element) => element.scrollTop);
	expect(bottom).toBeGreaterThan(0);

	const session = await page.context().newCDPSession(page);
	try {
		await touchScroll(page, session, -250);
		await expectReaderControlsAligned(page);
		await touchScroll(page, session, 200);
		await expect
			.poll(() => reader.evaluate((element) => element.scrollTop))
			.toBeLessThan(bottom);
		await expectReaderControlsAligned(page);
		await expect(page).toHaveURL(/\/929\/350$/);
	} finally {
		await session.detach();
	}

	await page.getByRole("button", { name: "הגדרות קריאה", exact: true }).click();
	await expect(
		page.getByRole("dialog", { name: "הגדרות קריאה" }),
	).toBeVisible();
});

test("the reader fits below the header as the mobile viewport changes", async ({
	page,
}) => {
	await page.goto("/929/350#pasuk-12", { waitUntil: "domcontentloaded" });
	await expect(page.locator("#pasuk-12")).toHaveAttribute(
		"aria-current",
		"location",
	);
	const reader = page.getByRole("article").locator("..");
	for (const height of [844, 744, 844]) {
		await page.setViewportSize({ width: 390, height });
		await expectReaderControlsAligned(page);
		const bounds = await reader.boundingBox();
		expect(bounds?.y).toBe(72);
		expect((bounds?.y ?? 0) + (bounds?.height ?? 0)).toBe(height);
		await expect(page.locator("#pasuk-12")).toBeInViewport();
	}
});
