import { expect } from "@playwright/test";
import sharp from "sharp";
import { test } from "../../../util/playwright/test-fixture";
import { waitForVisibleTurnContent } from "../../../util/turn-probe";

for (const mode of ["leaf", "pinned", "hidden"] as const) {
	for (const direction of ["backward", "forward"] as const) {
		test(`exposed paper keeps its text during a held ${direction} turn with ${mode} bookmarks`, async ({
			page,
			skipOnNotWideEnough,
		}, testInfo) => {
			void skipOnNotWideEnough;
			await page.setViewportSize({ width: 1440, height: 900 });
			await page.addInitScript((attachment) => {
				localStorage.setItem(
					"seferBookmarks",
					JSON.stringify({
						enabled: attachment !== "hidden",
						placement: "sides",
						orientation: "perpendicular",
						attachment: attachment === "pinned" ? "pinned" : "leaf",
						order: "page",
						upcomingOnly: false,
					}),
				);
			}, mode);
			// Kings I 20 has real text on both neighboring spreads, away from the TOC.
			await page.goto("/929/307?book", { waitUntil: "load" });
			await waitForVisibleTurnContent(page);
			await page.evaluate(() => document.fonts.ready);
			const spread = await page
				.locator(".he-book .page.current-page")
				.evaluateAll((pages) =>
					pages
						.map((page) => {
							const box = page.getBoundingClientRect();
							return {
								index: Number((page as HTMLElement).dataset.pageIndex),
								x: box.x,
								y: box.y,
								width: box.width,
								height: box.height,
							};
						})
						.sort((left, right) => left.x - right.x),
				);
			expect(spread).toHaveLength(2);
			const backward = direction === "backward";
			const paper = spread[backward ? 1 : 0];
			const sign = backward ? -1 : 1;
			const underlay = page.locator(
				`.he-book .page[data-page-index="${paper.index + sign * 2}"]`,
			);
			const content = underlay.locator(".flipbook-page-content");
			const x = paper.x + (backward ? paper.width - 10 : 10);
			const y = paper.y + paper.height * 0.82;
			await page.mouse.move(x, y);
			await page.mouse.down();
			try {
				for (const fraction of [0.55, 1.1]) {
					await page.mouse.move(
						x + sign * paper.width * fraction,
						y - paper.width * 0.08,
						{ steps: 8 },
					);
					await page.evaluate(
						() =>
							new Promise<void>((resolve) =>
								requestAnimationFrame(() =>
									requestAnimationFrame(() => resolve()),
								),
							),
					);
					await expect(page.locator(".he-book .page--flipping")).toHaveCount(2);
					await expect
						.poll(() =>
							content.evaluate((element) =>
								element.checkVisibility({
									checkOpacity: true,
									checkVisibilityCSS: true,
								}),
							),
						)
						.toBe(true);
					expect((await content.textContent())?.trim().length).toBeGreaterThan(
						100,
					);
					// The text must actually paint in the exposed area, not just exist in the DOM.
					const book = page.locator(".he-book");
					const visible = await book.screenshot({ animations: "disabled" });
					const originalOpacity = await underlay.evaluate((element) => {
						const page = element as HTMLElement;
						const original = [
							page.style.opacity,
							page.style.getPropertyPriority("opacity"),
						];
						page.style.setProperty("opacity", "0", "important");
						return original;
					});
					let blank: Buffer;
					try {
						blank = await book.screenshot({ animations: "disabled" });
					} finally {
						await underlay.evaluate((element, original) => {
							(element as HTMLElement).style.setProperty(
								"opacity",
								original[0],
								original[1],
							);
						}, originalOpacity);
					}
					const pixels = await sharp(visible).ensureAlpha().raw().toBuffer();
					const blankPixels = await sharp(blank).ensureAlpha().raw().toBuffer();
					expect(pixels.length).toBe(blankPixels.length);
					let changed = 0;
					for (let index = 0; index < pixels.length; index += 4) {
						if (
							!pixels
								.subarray(index, index + 4)
								.equals(blankPixels.subarray(index, index + 4))
						)
							changed++;
					}
					await testInfo.attach(`held-${fraction}`, {
						body: visible,
						contentType: "image/png",
					});
					await testInfo.attach(`blank-control-${fraction}`, {
						body: blank,
						contentType: "image/png",
					});
					expect(changed).toBeGreaterThan(100);
				}
			} finally {
				await page.mouse.up();
			}
		});
	}
}
