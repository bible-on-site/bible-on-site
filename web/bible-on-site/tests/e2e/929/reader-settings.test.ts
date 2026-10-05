import { expect, test } from "../../util/playwright/test-fixture";

test("saved display settings apply when entering the reader from another page", async ({
	page,
}) => {
	await page.addInitScript(() => {
		localStorage.setItem(
			"perekReaderSettings",
			JSON.stringify({ fontStep: 3, wordStep: 2, lineStep: 2 }),
		);
	});
	await page.goto("/");
	await page.getByRole("button", { name: "תפריט ראשי", exact: true }).click();
	await page
		.getByRole("navigation", { name: "תפריט ראשי", exact: true })
		.getByRole("link", { name: "על הפרק", exact: true })
		.click();
	await expect(page).toHaveURL(/\/929\/[1-9]\d*$/);
	await expect(page.getByRole("article")).toBeVisible();
	await expect
		.poll(() =>
			page.evaluate(() => {
				const style = document.documentElement.style;
				return [
					style.getPropertyValue("--perek-font-scale"),
					style.getPropertyValue("--perek-word-spacing"),
					style.getPropertyValue("--perek-line-height"),
				];
			}),
		)
		.toEqual(["1.15", "0.28em", "2"]);
});

test("display settings independently change font and both spacing directions, persisting across reload", async ({
	page,
}) => {
	await page.goto("/929/1");
	await page.getByRole("article").first().waitFor({ state: "visible" });
	const button = page.getByRole("button", {
		name: "הגדרות קריאה",
		exact: true,
	});
	const settingsBox = await button.boundingBox();
	const articleBox = await page.getByRole("article").first().boundingBox();
	expect(
		settingsBox &&
			articleBox &&
			settingsBox.y + settingsBox.height <= articleBox.y + 1,
	).toBe(true);
	await button.click();
	const dialog = page.getByRole("dialog", { name: "הגדרות קריאה" });
	await expect(dialog).toBeVisible();
	await page.getByRole("slider", { name: "גודל גופן" }).fill("3");
	await page.getByRole("slider", { name: "ריווח אופקי" }).fill("2");
	await page.getByRole("slider", { name: "ריווח אנכי" }).fill("2");
	expect(
		await page
			.getByRole("article")
			.first()
			.evaluate((e) => {
				const s = getComputedStyle(e);
				return [s.wordSpacing, s.lineHeight, s.fontSize];
			}),
	).not.toContain("normal");
	await page.keyboard.press("Escape");
	await expect(dialog).not.toBeVisible();
	await expect(button).toBeFocused();
	await page.reload();
	await page.getByRole("article").first().waitFor({ state: "visible" });
	expect(
		await page.evaluate(() => ({
			font: document.documentElement.style.getPropertyValue(
				"--perek-font-scale",
			),
			horizontal: document.documentElement.style.getPropertyValue(
				"--perek-word-spacing",
			),
			vertical: document.documentElement.style.getPropertyValue(
				"--perek-line-height",
			),
		})),
	).toEqual({ font: "1.15", horizontal: "0.28em", vertical: "2" });
	await button.click();
	await expect(page.getByRole("slider", { name: "גודל גופן" })).toHaveValue(
		"3",
	);
	await page.getByRole("button", { name: "קריינות", exact: true }).click();
	await expect(page.getByRole("slider", { name: "מהירות" })).toBeFocused();
	await page.getByRole("slider", { name: "מהירות" }).fill("1.5");
	await page.getByRole("slider", { name: "עוצמה" }).fill("0.4");
	await page
		.getByRole("combobox", { name: "אורך הפסקה בין פסוקים" })
		.selectOption("1000");
	await page.getByRole("button", { name: "סגירת הגדרות" }).click();
	await page.reload();
	await button.click();
	await page.getByRole("button", { name: "קריינות", exact: true }).click();
	await expect(page.getByRole("slider", { name: "מהירות" })).toHaveValue("1.5");
	await expect(page.getByRole("slider", { name: "עוצמה" })).toHaveValue("0.4");
	await expect(
		page.getByRole("combobox", { name: "אורך הפסקה בין פסוקים" }),
	).toHaveValue("1000");
	const bounds = await dialog.boundingBox();
	const viewport = page.viewportSize();
	expect(
		bounds &&
			viewport &&
			bounds.x >= 0 &&
			bounds.y >= 0 &&
			bounds.x + bounds.width <= viewport.width &&
			bounds.y + bounds.height <= viewport.height,
	).toBe(true);
	// Clicking outside the dropdown closes the native modal.
	await page.mouse.click((viewport?.width ?? 1000) - 5, 5);
	await expect(dialog).not.toBeVisible();
});
