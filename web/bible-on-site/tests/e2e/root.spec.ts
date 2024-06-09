import { test, expect } from "@playwright/test";

test("has right title", async ({ page }) => {
  await page.goto("http://127.0.0.1:3000/");

  // Expect a title "to contain" a substring.
  await expect(page).toHaveTitle('תנ"ך על הפרק');
});
