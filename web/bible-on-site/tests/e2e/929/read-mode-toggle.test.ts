// import { test, expect } from "@playwright/test";

import { expect, test } from "../../util/playwright/test-fixture";

const BASE_URL = "/929";
const togglerAnimationDuration = 300;
test("toggling to sefer view hides perek breadcrumbs", async ({ page }) => {
  const perekId = 1;
  await page.goto(BASE_URL + "/" + perekId);
  const perekBreadCrumbs = await page.getByTestId(`perek-breadcrumb-${perekId}`);
  expect(perekBreadCrumbs).toBeVisible();
  const seferViewButton = await page.getByTestId("read-mode-toggler-sefer-view-button");
  await seferViewButton.click();
  await page.waitForTimeout(togglerAnimationDuration);
  expect(perekBreadCrumbs).not.toBeInViewport;
});
