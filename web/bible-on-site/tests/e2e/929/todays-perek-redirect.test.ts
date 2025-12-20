import { expect, test } from "../../util/playwright/test-fixture";

// Test that navigating to /929 redirects to today's perek.
// We use the /api/dev/mock-date API to set a specific date on the server.
// 27/June/2024 = 21 Sivan 5784 => Perek 625 (verified in unit tests)

const MOCKED_DATE = "2024-06-27T12:00:00+03:00"; // Jerusalem timezone
const EXPECTED_PEREK_ID = 625;

test.describe("Today's Perek redirect", () => {
	test.afterEach(async ({ request }) => {
		// Clean up: reset the mocked date after each test
		await request.delete("/api/dev/mock-date");
	});

	test("navigating to /929 redirects to today's perek based on mocked date", async ({
		page,
		request,
	}, testInfo) => {
		// The mock-date API only works in development mode.
		// Skip this test when running against the production server.
		const checkResponse = await request.get("/api/dev/mock-date");
		if (!checkResponse.ok()) {
			testInfo.skip(
				true,
				"Mock-date API not available (requires development server)",
			);
		}

		// Set the mocked date on the server
		const mockResponse = await request.post("/api/dev/mock-date", {
			data: { date: MOCKED_DATE },
		});
		expect(mockResponse.ok()).toBe(true);

		await page.goto("/929");

		// Verify the URL redirected to the expected perek
		await expect(page).toHaveURL(`/929/${EXPECTED_PEREK_ID}`);

		// Verify the page rendered correctly with the breadcrumb
		const breadcrumb = page.getByTestId(
			`perek-breadcrumb-${EXPECTED_PEREK_ID}`,
		);
		await expect(breadcrumb).toBeVisible();
	});

	test("navigating to /929 without mock redirects to a valid perek", async ({
		page,
	}) => {
		await page.goto("/929");

		// Verify the URL redirected to a valid perek ID (1-929)
		await expect(page).toHaveURL(/\/929\/\d+/);

		// Extract the perek ID from the URL
		const url = page.url();
		const match = url.match(/\/929\/(\d+)/);
		expect(match).not.toBeNull();
		// biome-ignore lint/style/noNonNullAssertion: Already checked for null above
		const perekId = Number.parseInt(match![1], 10);
		expect(perekId).toBeGreaterThanOrEqual(1);
		expect(perekId).toBeLessThanOrEqual(929);

		// Verify the page rendered correctly with the breadcrumb
		const breadcrumb = page.getByTestId(`perek-breadcrumb-${perekId}`);
		await expect(breadcrumb).toBeVisible();
	});
});
