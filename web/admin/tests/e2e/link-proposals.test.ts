import { expect, test } from "../util/test-fixture";

/**
 * The link-proposal pipeline (#3103) end-to-end: generation persists
 * evidence-backed drafts only — review, approval and rejection never write
 * live relationships. Apply stays gated on ARTICLE_API_KEY, which the e2e
 * environment intentionally lacks.
 */
test.describe("Link Proposals", () => {
	test("queue page renders the pipeline surface and generate form", async ({
		page,
	}) => {
		await page.goto("/link-proposals");

		await expect(page.locator("h1")).toContainText("הצעות קישור מאמרים");
		await expect(page.getByPlaceholder("123, 456")).toBeVisible();
		await expect(page.getByRole("button", { name: "הפק הצעות" })).toBeVisible();
	});

	test("generates heuristic drafts, then approves and rejects them", async ({
		page,
	}) => {
		test.setTimeout(90_000);
		await page.goto("/link-proposals");

		// Fixture article 6 cites בראשית יח, ב and שמואל ב ה, ז.
		await page.getByPlaceholder("123, 456").fill("6");
		await page.getByRole("button", { name: "הפק הצעות" }).click();

		const cards = page.getByTestId("link-proposal-card");
		await expect(cards.first()).toBeVisible({ timeout: 60_000 });
		const count = await cards.count();
		expect(count).toBeGreaterThanOrEqual(2);
		await expect(page.getByText("בראשית יח").first()).toBeVisible();

		// Approve a pending proposal — a human decision, recorded. On a
		// previously-mutated dev DB nothing may be pending; the gate checks
		// below then simply stand on earlier runs' state.
		const pendingCards = page.locator(
			'[data-testid="link-proposal-card"][data-status="pending"]',
		);
		if ((await pendingCards.count()) > 0) {
			await pendingCards
				.first()
				.getByRole("button", { name: "אשר", exact: true })
				.click();
			await expect(
				page.locator(
					'[data-testid="link-proposal-card"][data-status="approved"]',
				),
			).toBeVisible();
		}

		// Apply is gated on the server-side API key, not configured in e2e:
		// the attempt must surface the failure, never a silent write.
		const applyButton = page.getByRole("button", { name: "החל על המאמר" });
		if ((await applyButton.count()) > 0) {
			await applyButton.first().click();
			// The queue also shows a standing "ARTICLE_API_KEY חסר" warning —
			// assert on the apply error itself, not that banner.
			await expect(page.getByText(/שגיאה בהחלה/)).toBeVisible();
		}

		// Reject another pending proposal — live data untouched by design.
		const stillPending = page.locator(
			'[data-testid="link-proposal-card"][data-status="pending"]',
		);
		if ((await stillPending.count()) > 0) {
			await stillPending.first().getByRole("button", { name: "דחה" }).click();
			await expect(
				page.locator(
					'[data-testid="link-proposal-card"][data-status="rejected"]',
				),
			).toBeVisible();
		}
	});

	test("article edit page links to its proposal queue", async ({ page }) => {
		await page.goto("/articles/6");
		const link = page.getByRole("link", {
			name: /הצעות קישור למאמר זה/,
		});
		await expect(link).toBeVisible();
		await link.click();
		await expect(page).toHaveURL(/\/link-proposals/);
		await expect(page.locator("h1")).toContainText("הצעות קישור מאמרים");
	});
});
