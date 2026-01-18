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

	test("Redirects to today's perek based on mocked date", async ({
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
		if (!mockResponse.ok()) {
			testInfo.skip(true, "Failed to set mock date - API may not be available");
		}

		// Verify the mock was actually set by checking the GET endpoint
		const verifyResponse = await request.get("/api/dev/mock-date");
		const verifyBody = await verifyResponse.json();
		if (!verifyBody.mockedDate) {
			testInfo.skip(true, "Mock date was not persisted - SSR may not see it");
		}

		await page.goto("/929");

		// Verify the URL redirected to the expected perek
		await expect(page).toHaveURL(`/929/${EXPECTED_PEREK_ID}`);

		// Verify the page rendered correctly with the breadcrumb
		const breadcrumb = page.getByTestId(
			`perek-breadcrumb-${EXPECTED_PEREK_ID}`,
		);
		await expect(breadcrumb).toBeVisible();
	});

	test("Redirects to a valid perek without mock", async ({ page }) => {
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

	test("Preserves single query parameter during redirect", async ({ page }) => {
		await page.goto("/929?foo=bar");

		// Verify the URL redirected to a valid perek and preserved the query param
		await expect(page).toHaveURL(/\/929\/\d+\?foo=bar/);
	});

	test("Preserves multiple query parameters during redirect", async ({
		page,
	}) => {
		await page.goto("/929?foo=bar&baz=qux");

		// Verify the URL preserved multiple query params
		const url = page.url();
		expect(url).toContain("foo=bar");
		expect(url).toContain("baz=qux");
	});

	test("Preserves array query parameters during redirect", async ({ page }) => {
		await page.goto("/929?arr=val1&arr=val2");

		// Verify the URL preserved array query params
		const url = page.url();
		expect(url).toContain("arr=val1");
		expect(url).toContain("arr=val2");
	});
});
