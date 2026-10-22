import type { Page } from "@playwright/test";
import { expect, test } from "../../util/playwright/test-fixture";

test.use({ hasTouch: true });

async function textPoint(page: Page) {
	const article = page.getByRole("article");
	await expect(article).toHaveAttribute("data-pasuk-navigation-ready", "");
	await article.scrollIntoViewIfNeeded();
	return article.evaluate((article) => {
		const box = article.getBoundingClientRect();
		const x = innerWidth / 2;
		for (
			let y = Math.max(100, box.top + 10);
			y < Math.min(innerHeight - 40, box.bottom);
			y += 10
		) {
			const target = document.elementFromPoint(x, y);
			if (target?.closest("article") === article && !target.closest("a")) {
				return { x, y };
			}
		}
		throw new Error("No visible plain text found for the reading gesture");
	});
}

/** Browser touch input exercises native scrolling/cancellation as well as the handler. */
async function touchDrag(page: Page, dx: number, dy = 0) {
	const start = await textPoint(page);
	const session = await page.context().newCDPSession(page);
	try {
		await session.send("Input.dispatchTouchEvent", {
			type: "touchStart",
			touchPoints: [{ ...start, id: 1 }],
		});
		for (let step = 1; step <= 6; step++) {
			await session.send("Input.dispatchTouchEvent", {
				type: "touchMove",
				touchPoints: [
					{ x: start.x + (dx * step) / 6, y: start.y + (dy * step) / 6, id: 1 },
				],
			});
		}
		await session.send("Input.dispatchTouchEvent", {
			type: "touchEnd",
			touchPoints: [],
		});
	} finally {
		await session.detach();
	}
}

test("touch swipes navigate chapters in RTL order and preserve browser history", async ({
	page,
}) => {
	const errors: Error[] = [];
	page.on("pageerror", (error) => errors.push(error));
	await page.goto("/929/2");
	await touchDrag(page, 120);
	await expect(page).toHaveURL(/\/929\/3$/);
	await touchDrag(page, -120);
	await expect(page).toHaveURL(/\/929\/2$/);
	await page.goBack();
	await expect(page).toHaveURL(/\/929\/3$/);
	await expect(page.getByTestId("perek-breadcrumb-3")).toBeVisible();
	expect(errors).toEqual([]);
});

test("mouse dragging on a touch-capable device never changes chapter", async ({
	page,
}) => {
	await page.goto("/929/2");
	const start = await textPoint(page);
	await page.mouse.move(start.x, start.y);
	await page.mouse.down();
	await page.mouse.move(start.x + 120, start.y, { steps: 6 });
	await page.mouse.up();
	await expect(page).toHaveURL(/\/929\/2$/);
	await expect(page.getByTestId("perek-breadcrumb-2")).toBeVisible();
});

test("vertical touch scrolling keeps the chapter and scrolls the reader", async ({
	page,
}) => {
	await page.goto("/929/2");
	await textPoint(page);
	const before = await page
		.getByRole("article")
		.evaluate((el) => el.parentElement?.scrollTop ?? 0);
	await touchDrag(page, 15, -90);
	await expect(page).toHaveURL(/\/929\/2$/);
	await expect
		.poll(() =>
			page
				.getByRole("article")
				.evaluate((el) => el.parentElement?.scrollTop ?? 0),
		)
		.toBeGreaterThan(before);
});

test("touch navigation stops at the first and last chapters", async ({
	page,
}) => {
	await page.goto("/929/1");
	await touchDrag(page, -120);
	await expect(page).toHaveURL(/\/929\/1$/);
	await touchDrag(page, 120);
	await expect(page).toHaveURL(/\/929\/2$/);
	await page.goto("/929/929");
	await touchDrag(page, 120);
	await expect(page).toHaveURL(/\/929\/929$/);
	await touchDrag(page, -120);
	await expect(page).toHaveURL(/\/929\/928$/);
});

test("phone text stays swipeable when a chapter link requests book view", async ({
	page,
	isWideEnough,
}) => {
	test.skip(isWideEnough, "Phone text view is the fallback for book links");
	await page.goto("/929/2?book");
	await expect(page.getByRole("article")).toBeVisible();
	await expect(page.locator("html")).not.toHaveAttribute("data-book-view");
	await touchDrag(page, 120);
	await expect(page).toHaveURL(/\/929\/3$/);
});
