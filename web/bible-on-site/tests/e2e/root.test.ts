import { test, expect } from "@playwright/test";

const ROOT_URL = "http://127.0.0.1:3000/";

test("has right title", async ({ page }) => {
  await page.goto(ROOT_URL);
  // Expect a title "to contain" a substring.
  await expect(page).toHaveTitle('תנ"ך על הפרק');
});
