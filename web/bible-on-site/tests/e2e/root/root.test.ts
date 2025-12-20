// import { test, expect } from "@playwright/test";

import { expect, test } from "../../util/playwright/test-fixture";

const ROOT_URL = "/";

test("Has correct title", async ({ page }) => {
	await page.goto(ROOT_URL);
	await expect(page).toHaveTitle('תנ"ך על הפרק');
});
