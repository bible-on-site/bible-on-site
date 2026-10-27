import { expect, test } from "../util/playwright/test-fixture";

// Regression coverage for #2726: .menuItem is a wrapping flex row and kept
// the default align-items: stretch. The 16px icon has a fixed height, so
// stretch could not size it to the taller label line and it stayed pinned to
// the row's top edge — every icon sat ~3.5px above its label's text line.
// The shared row rule (align-items: center) must keep each icon centered on
// its label's line box; measure real boxes, not class/property presence.

test.describe("NavBar menu icon alignment", () => {
	test("centers each icon vertically on its label's text line", async ({
		page,
	}) => {
		await page.goto("/accessibility");
		await page.getByRole("button", { name: "תפריט ראשי" }).click();
		const menu = page.locator("#main-menu");

		// Measure only after the slide-in transition and webfonts settle.
		await page.waitForFunction(async () => {
			const rect = document
				.getElementById("main-menu")
				?.getBoundingClientRect();
			if (!rect || Math.abs(rect.right - window.innerWidth) > 1)
				return false;
			await document.fonts.ready;
			return true;
		});

		const rows = await menu.locator("li").evaluateAll((lis) =>
			lis.flatMap((li) => {
				const img = li.querySelector("img");
				const anchor = li.querySelector("a");
				const span = anchor?.querySelector("span");
				if (!img || !anchor || !span) return [];
				const icon = img.getBoundingClientRect();
				// The label's line box, not the glyph extent: alignment is
				// defined against the rendered text line.
				const label = span.getBoundingClientRect();
				return [
					{
						label: anchor.textContent?.trim() ?? "",
						delta:
							icon.top +
							icon.height / 2 -
							(label.top + label.height / 2),
					},
				];
			}),
		);

		expect(rows.length).toBeGreaterThan(0);
		for (const row of rows) {
			// Pre-fix offset was ~3.5px; sub-pixel rounding keeps this < 1px.
			expect(
				Math.abs(row.delta),
				`icon of "${row.label}" must center on its text line`,
			).toBeLessThanOrEqual(2);
		}
	});
});
