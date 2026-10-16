import { expect } from "./test-fixture";
import type { Page } from "@playwright/test";

export const TOP_NAV_BLUE = "rgb(21, 82, 172)"; // #1552ac, the shared site top bar

/**
 * Computed background color of the shared `.top-nav` bar. Routes opt into the
 * blue bar via `body:has(.<page>-layout) .top-nav`; routes without the opt-in
 * render it transparent over a white page (issue #2295).
 */
export async function topNavBackground(page: Page) {
	const topNav = page.locator("nav.top-nav");
	await expect(topNav).toBeVisible();
	return topNav.evaluate((el) => window.getComputedStyle(el).backgroundColor);
}
