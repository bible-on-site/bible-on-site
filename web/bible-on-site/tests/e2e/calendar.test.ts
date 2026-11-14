import { devices, type Page } from "@playwright/test";
import { getCalendarCycleWindow } from "../../src/data/learning-calendar-policy";
import { getCycle, getMonthOrder } from "../../src/data/learning-schedule";
import { constructTsetAwareHDate } from "../../src/util/hebdates-util";
import { expect, test } from "../util/playwright/test-fixture";
import { TOP_NAV_BLUE, topNavBackground } from "../util/playwright/top-nav";

function liveWindow() {
	return getCalendarCycleWindow(constructTsetAwareHDate(new Date()));
}

test.describe("/לוח learning calendar", () => {
	test("renders the shared blue top bar on direct load", async ({ page }) => {
		await page.goto("/לוח");
		await expect(
			page.getByRole("heading", { name: "לוח לימוד יומי" }),
		).toBeVisible();

		expect(await topNavBackground(page)).toBe(TOP_NAV_BLUE);
	});

	test("keeps the shared blue top bar when navigating from another page", async ({
		page,
	}) => {
		await page.goto("/");
		await page.getByRole("button", { name: "תפריט ראשי" }).click();
		await page
			.locator("#main-menu")
			.getByRole("link", { name: "לוח לימוד יומי", exact: true })
			.click();
		await page.waitForURL((url) => decodeURIComponent(url.pathname) === "/לוח");
		await expect(
			page.getByRole("heading", { name: "לוח לימוד יומי" }),
		).toBeVisible();

		expect(await topNavBackground(page)).toBe(TOP_NAV_BLUE);
	});

	test("keeps the shared blue top bar after switching month", async ({
		page,
	}) => {
		await page.goto("/לוח");
		await page.getByRole("button", { name: "חודש הבא" }).click();

		expect(await topNavBackground(page)).toBe(TOP_NAV_BLUE);
	});
});

test.describe("/לוח cycle visibility and export limits", () => {
	test("clamps a future shared link and stops at the next cycle", async ({
		page,
	}) => {
		const window = liveWindow();
		await page.goto(`/לוח?view=cycle&cycle=${window.next.number + 5}`);
		const picker = page.getByRole("combobox", { name: "בחירת מחזור לימוד" });
		await expect(picker).toHaveValue(String(window.next.number));
		await expect(picker.locator("option")).toHaveCount(window.next.number);
		await expect(
			page.getByRole("button", { name: "מחזור הבא", exact: true }),
		).toBeDisabled();
		await page.getByRole("button", { name: "היום", exact: true }).click();
		await expect(picker).toHaveValue(
			String(window.current?.number ?? window.next.number),
		);
		await expect(page.getByRole("button", { name: /הורדת PDF/ })).toBeEnabled();
	});

	test("keeps historical cycles readable without fetching an export", async ({
		page,
	}) => {
		const window = liveWindow();
		const historical = (window.current?.number ?? window.next.number) - 1;
		const hits: string[] = [];
		page.on("request", (request) => {
			if (request.url().includes("calendar-pdf")) hits.push(request.url());
		});
		await page.goto(`/לוח?view=cycle&cycle=${historical}`);
		await expect(
			page.getByRole("combobox", { name: "בחירת מחזור לימוד" }),
		).toHaveValue(String(historical));
		await expect(
			page.getByRole("button", { name: /הורדת PDF/ }),
		).toBeDisabled();
		await expect(page.getByRole("status")).toContainText(
			"החל משנה לפני תחילתו",
		);
		expect(hits).toEqual([]);
	});

	test("limits month/year navigation without showing later cycle assignments", async ({
		page,
	}) => {
		const window = liveWindow();
		await page.goto(`/לוח?month=${window.maxMonth.year + 5}01`);
		await expect(
			page.getByRole("combobox", { name: "שנה", exact: true }),
		).toHaveValue(String(window.maxMonth.year));
		await expect(
			page.getByRole("combobox", { name: "חודש", exact: true }),
		).toHaveValue(String(window.maxMonth.month));
		await expect(
			page.getByRole("button", { name: "חודש הבא", exact: true }),
		).toBeDisabled();
		await page.getByRole("button", { name: "שנתי", exact: true }).click();
		await expect(page.locator("main h3")).toHaveCount(
			getMonthOrder(window.maxMonth.year).indexOf(window.maxMonth.month) + 1,
		);
		await expect(
			page.getByRole("button", { name: "שנה הבאה", exact: true }),
		).toBeDisabled();
		await expect(
			page.getByRole("button", { name: /הורדת PDF/ }),
		).toBeDisabled();
	});
});

test.describe("/לוח calendar PDF download (#2621)", () => {
	let STUDY_MONTH: string;
	let currentCycle: number;
	let MONTH_FILENAME: string;
	let YEAR_FILENAME: string;
	let CYCLE_FILENAME: string;
	test.beforeAll(() => {
		const window = liveWindow();
		currentCycle = window.current?.number ?? window.next.number;
		// A complete interior month/year avoids intentionally ineligible boundaries.
		const interior = getCycle(currentCycle).start.add(450);
		STUDY_MONTH = `${interior.year}${String(interior.getUniformMonth()).padStart(2, "0")}`;
		MONTH_FILENAME = `learning-calendar-${STUDY_MONTH}.pdf`;
		YEAR_FILENAME = `learning-calendar-year-${interior.year}.pdf`;
		CYCLE_FILENAME = `learning-calendar-cycle-${currentCycle}.pdf`;
	});
	const PDF_URL_PATTERN = "**/api/calendar-pdf**";
	const PDF_BODY = "%PDF-1.4 browser-test stub";

	/**
	 * Replaces the shared `/api/calendar-pdf` contract with a stub that
	 * records every request URL and answers with the scope-appropriate
	 * filename the published artifacts carry (see calendarArtifactFilename).
	 * `delayMs` holds the response open so the pending-state behaviour is
	 * observable mid-flight; `failFirst` answers the first request with a
	 * generic server failure — 503/404 map onto the honest preparing/
	 * unavailable statuses (#2622), so only another status exercises the
	 * failure path.
	 */
	async function stubCalendarPdf(
		page: Page,
		hits: string[],
		options: { delayMs?: number; failFirst?: boolean } = {},
	) {
		// Exercise the API fallback deterministically; a real public manifest
		// must never let this browser test download production assets.
		await page.route("**/generated/calendar-pdf/manifest.json", (route) =>
			route.fulfill({ status: 503 }),
		);
		return page.route(PDF_URL_PATTERN, async (route) => {
			const requestUrl = route.request().url();
			hits.push(requestUrl);
			if (options.delayMs) {
				await new Promise((resolve) => setTimeout(resolve, options.delayMs));
			}
			if (options.failFirst && hits.length === 1) {
				await route.fulfill({
					status: 500,
					json: { error: "calendar artifact generation failed" },
				});
				return;
			}
			const params = new URL(requestUrl).searchParams;
			const filename =
				params.get("view") === "cycle"
					? `learning-calendar-cycle-${params.get("cycle")}.pdf`
					: params.get("view") === "year"
						? `learning-calendar-year-${params.get("month")?.slice(0, 4)}.pdf`
						: `learning-calendar-${params.get("month")}.pdf`;
			await route.fulfill({
				body: PDF_BODY,
				contentType: "application/pdf",
				headers: {
					"Content-Disposition": `attachment; filename="${filename}"`,
				},
			});
		});
	}

	function downloadAction(page: Page) {
		return page.getByRole("button", { name: /הורדת PDF/ });
	}

	test("downloads the selected month's PDF on keyboard activation — browsing fetches nothing", async ({
		page,
	}) => {
		const hits: string[] = [];
		await stubCalendarPdf(page, hits);
		await page.goto(`/לוח?month=${STUDY_MONTH}`);
		const action = downloadAction(page);
		await expect(action).toBeVisible();

		// Browsing the calendar must not eagerly fetch a PDF.
		await page.getByRole("button", { name: "חודש הבא" }).click();
		await page.getByRole("button", { name: "חודש קודם" }).click();
		await expect(page).toHaveURL(
			(url) => url.searchParams.get("month") === STUDY_MONTH,
		);
		expect(hits).toHaveLength(0);

		await action.focus();
		const [download] = await Promise.all([
			page.waitForEvent("download"),
			action.press("Enter"),
		]);

		expect(hits).toHaveLength(1);
		const requested = new URL(hits[0]);
		expect(requested.searchParams.get("view")).toBe("month");
		expect(requested.searchParams.get("month")).toBe(STUDY_MONTH);
		expect(download.suggestedFilename()).toBe(MONTH_FILENAME);
	});

	test("requests the selected year in yearly view", async ({ page }) => {
		const hits: string[] = [];
		await stubCalendarPdf(page, hits);
		await page.goto(`/לוח?month=${STUDY_MONTH}&view=year`);

		const [download] = await Promise.all([
			page.waitForEvent("download"),
			downloadAction(page).click(),
		]);

		expect(hits).toHaveLength(1);
		const requested = new URL(hits[0]);
		expect(requested.searchParams.get("view")).toBe("year");
		expect(requested.searchParams.get("month")).toBe(STUDY_MONTH);
		expect(download.suggestedFilename()).toBe(YEAR_FILENAME);
	});

	test("requests the selected cycle in full-cycle view", async ({ page }) => {
		const hits: string[] = [];
		await stubCalendarPdf(page, hits);
		await page.goto(
			`/לוח?month=${STUDY_MONTH}&view=cycle&cycle=${currentCycle}`,
		);

		const [download] = await Promise.all([
			page.waitForEvent("download"),
			downloadAction(page).click(),
		]);

		expect(hits).toHaveLength(1);
		const requested = new URL(hits[0]);
		expect(requested.searchParams.get("view")).toBe("cycle");
		expect(requested.searchParams.get("cycle")).toBe(String(currentCycle));
		expect(download.suggestedFilename()).toBe(CYCLE_FILENAME);
	});

	test("blocks duplicate requests while pending and keeps the started scope when the view changes", async ({
		page,
	}) => {
		const hits: string[] = [];
		// A slow response keeps the request in flight across the assertions.
		await stubCalendarPdf(page, hits, { delayMs: 500 });
		await page.goto(`/לוח?month=${STUDY_MONTH}`);
		const action = downloadAction(page);

		await action.click();
		await expect(action).toBeDisabled();
		// A real pointer press on a disabled control cannot re-fire it.
		await action.click({ force: true });
		// The user may navigate meanwhile; the started request keeps its scope.
		await page.getByRole("button", { name: "חודש הבא" }).click();

		const download = await page.waitForEvent("download");
		expect(hits).toHaveLength(1);
		expect(new URL(hits[0]).searchParams.get("month")).toBe(STUDY_MONTH);
		expect(download.suggestedFilename()).toBe(MONTH_FILENAME);
	});

	test("reports a failure without claiming success and recovers on retry", async ({
		page,
	}) => {
		const hits: string[] = [];
		await stubCalendarPdf(page, hits, { failFirst: true });
		await page.goto(`/לוח?month=${STUDY_MONTH}`);
		const action = downloadAction(page);
		const status = action.locator("..").getByRole("status");

		await action.click();
		await expect(status).toContainText("נכשלה");
		await expect(action).toBeEnabled();

		const [download] = await Promise.all([
			page.waitForEvent("download"),
			action.click(),
		]);
		expect(hits).toHaveLength(2);
		expect(download.suggestedFilename()).toBe(MONTH_FILENAME);
	});

	test("activates on touch", async ({ browser }, testInfo) => {
		// The Desktop project's context has no touchscreen, so spin up a
		// mobile-emulated one — a real tap drives the same activation path.
		const context = await browser.newContext({
			...devices["Pixel 5"],
			baseURL: testInfo.project.use.baseURL,
		});
		try {
			const page = await context.newPage();
			const hits: string[] = [];
			await stubCalendarPdf(page, hits);
			await page.goto(`/לוח?month=${STUDY_MONTH}`);
			const action = downloadAction(page);
			await expect(action).toBeVisible();
			const [download] = await Promise.all([
				page.waitForEvent("download"),
				action.tap(),
			]);
			expect(hits).toHaveLength(1);
			expect(download.suggestedFilename()).toBe(MONTH_FILENAME);
		} finally {
			await context.close();
		}
	});
});
