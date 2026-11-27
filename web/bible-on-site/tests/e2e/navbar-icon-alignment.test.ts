import { expect, test } from "../util/playwright/test-fixture";

// Regression coverage for #2726 and #3839: every destination row — including
// the nested storefront rows — shares one icon/text grid. Measure real boxes,
// not class/property presence: each icon centers on its title line and the
// text column starts at the same inset across rows of the same level.

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
				const anchor = Array.from(li.children).find(
					(child): child is HTMLAnchorElement =>
						child instanceof HTMLAnchorElement,
				);
				const img = anchor?.querySelector("img");
				const title = anchor?.children[1]?.firstElementChild;
				if (!img || !anchor || !title) return [];
				const icon = img.getBoundingClientRect();
				// The title's line box, not the glyph extent: alignment is
				// defined against the rendered text line.
				const label = title.getBoundingClientRect();
				const link = anchor.getBoundingClientRect();
				return [
					{
						label: title.textContent?.trim() ?? "",
						store: Boolean(title.getAttribute("dir")),
						delta:
							icon.top +
							icon.height / 2 -
							(label.top + label.height / 2),
						textInset: link.right - label.right,
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
		for (const store of [false, true]) {
			const insets = rows
				.filter((row) => row.store === store)
				.map((row) => row.textInset);
			expect(Math.max(...insets) - Math.min(...insets)).toBeLessThanOrEqual(
				2,
			);
		}
	});
});
