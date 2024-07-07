// import { test, expect } from "@playwright/test";

import { test, expect } from "../util/playwright/test-fixture";

const ROOT_URL = "/";

test("has right title", async ({ page }) => {
  await page.goto(ROOT_URL);
  // Expect a title "to contain" a substring.
  await expect(page).toHaveTitle('תנ"ך על הפרק');
});
