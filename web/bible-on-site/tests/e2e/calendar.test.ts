import { devices, type Page } from "@playwright/test";
import { getCalendarCycleWindow } from "../../src/data/learning-calendar-policy";
import {
	getCycle,
	getMonthName,
	getMonthOrder,
} from "../../src/data/learning-schedule";
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
			.getByRole("link", {
				name: "לוח לימוד יומי לוח עזר פרקים לפי תאריך",
				exact: true,
			})
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

	test("switches the yearly view between overview grid and vertical flip book", async ({
		page,
	}) => {
		await page.goto("/לוח?view=year");
		await expect(
			page.getByRole("heading", { name: /שנת/ }),
		).toBeVisible();

		// Overview is the default presentation: the mini-month grid renders.
		await expect(page.locator(".cal-book")).toHaveCount(0);

		await page.getByRole("button", { name: "דפדוף" }).click();

		// The lazy-loaded vertical book mounts with its toolbar and spiral
		// binding, and the shareable URL records the presentation.
		const book = page.locator(".cal-book.flipbook--vertical");
		await expect(book).toBeVisible({ timeout: 30_000 });
		await expect(
			page.getByRole("toolbar", { name: "FlipBook navigation" }),
		).toBeVisible();
		await expect(page).toHaveURL(/flip=1/);
		// One readable month sheet per visible face.
		await expect(
			book.locator(".page.current-page .cal-sheet__title").first(),
		).toBeVisible();

		// Toolbar navigation advances the month and keeps ?month= in sync.
		const monthBefore = page.url();
		await page.locator(".flipbook-toolbar-next").click();
		await expect
			.poll(() => page.url(), { timeout: 15_000 })
			.not.toBe(monthBefore);
		await expect(page).toHaveURL(/month=\d+/);

		// Returning to the overview restores the grid, clears flip=1, and
		// returns focus to the persistent presentation toggle.
		await page
			.getByRole("button", { name: "מעבר לתצוגת הסקירה" })
			.click();
		await expect(page.locator(".cal-book")).toHaveCount(0);
		await expect(page).not.toHaveURL(/flip=1/);
		await expect(
			page.getByRole("button", { name: "סקירה", exact: true }),
		).toBeFocused();
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

/**
 * Engine-owned accessibility contract of the vertical calendar book (#3615):
 * since html-flip-book alpha.121 the engine itself marks covered `.page`
 * wrappers inert + aria-hidden at mount, jump and every committed turn, and
 * restores authored values at teardown — the app no longer runs its own
 * exposure pass. These tests exercise the published engine end-to-end so the
 * removal stays verified against real layout, gestures and hotkeys.
 */
test.describe("/לוח vertical flip book — engine-owned exposure (#3615)", () => {
	const BOOK = ".cal-book.flipbook--vertical";
	const FACES = `${BOOK} .page`;
	/** The readable month face of the visible pair (a `.page.current-page`). */
	const SHEET_FACE = `${BOOK} .page.current-page:has(.cal-sheet)`;

	async function openFlipBook(page: Page, url = "/לוח?view=year&flip=1") {
		await page.goto(url);
		const book = page.locator(BOOK);
		await expect(book).toBeVisible({ timeout: 30_000 });
		// Engine init stamps the visible pair before this resolves.
		await expect(
			book.locator(".page.current-page .cal-sheet"),
		).toBeVisible({ timeout: 15_000 });
	}

	/** `.page` exposure snapshot: index, inert flag and aria-hidden value. */
	async function exposureSnapshot(page: Page) {
		return page.locator(FACES).evaluateAll((elements) =>
			elements.map((el) => ({
				index: Number((el as HTMLElement).dataset.pageIndex),
				inert: (el as HTMLElement).inert,
				hidden: el.getAttribute("aria-hidden"),
			})),
		);
	}

	/**
	 * Polls until the engine settles on exactly `indices` exposed: those
	 * `.page` wrappers carry aria-hidden="false" and no inert flag, every
	 * other wrapper inert + aria-hidden="true". Covers mount, jumps and the
	 * settle after animated turns — the whole ownership contract.
	 */
	async function expectExposedPages(page: Page, indices: number[]) {
		await expect
			.poll(
				async () => {
					const faces = await exposureSnapshot(page);
					return {
						compliant: faces.every((face) =>
							face.inert
								? face.hidden === "true"
								: face.hidden === "false",
						),
						exposed: faces
							.filter((face) => !face.inert)
							.map((face) => face.index),
					};
				},
				{ timeout: 15_000 },
			)
			.toEqual({ compliant: true, exposed: indices });
	}

	async function sheetPageIndex(page: Page) {
		const index = await page
			.locator(SHEET_FACE)
			.getAttribute("data-page-index");
		if (index === null) throw new Error("No readable sheet face");
		return Number(index);
	}

	async function boundingBox(
		locator: ReturnType<Page["locator"]>,
	): Promise<{ x: number; y: number; width: number; height: number }> {
		await locator.scrollIntoViewIfNeeded();
		const box = await locator.boundingBox();
		if (!box) throw new Error("Element has no layout box");
		return box;
	}

	/** Waits for an in-flight leaf animation to settle before the next input. */
	async function waitForFlipSettled(page: Page) {
		await page.waitForFunction(
			(selector) => !document.querySelector(`${selector} .page--flipping`),
			BOOK,
			{ timeout: 15_000 },
		);
	}

	test("exposes only the visible face pair at mount and across committed turns", async ({
		page,
	}, testInfo) => {
		await openFlipBook(page);
		const sheet = page.locator(SHEET_FACE);
		const first = await sheetPageIndex(page);
		// Each month owns a visible pair: readable sheet + its card back.
		await expectExposedPages(page, [first, first + 1]);
		// Visual evidence for the PR record (CI report attachments).
		await testInfo.attach("book-initial", {
			body: await page.screenshot(),
			contentType: "image/png",
		});

		await page.locator(".flipbook-toolbar-next").click();
		await expect(sheet).toHaveAttribute(
			"data-page-index",
			String(first + 2),
		);
		await expectExposedPages(page, [first + 2, first + 3]);
		await testInfo.attach("book-after-turn", {
			body: await page.screenshot(),
			contentType: "image/png",
		});

		await page.locator(".flipbook-toolbar-prev").click();
		await expect(sheet).toHaveAttribute("data-page-index", String(first));
		await expectExposedPages(page, [first, first + 1]);
	});

	test("exposes only the end faces at each book end and holds the boundaries", async ({
		page,
	}) => {
		await openFlipBook(page);
		const lastIndex = (await page.locator(FACES).count()) - 1;

		await page.locator(".flipbook-toolbar-first").click();
		await expectExposedPages(page, [0]);
		await expect(page.locator(".flipbook-toolbar-first")).toBeDisabled();
		await expect(page.locator(".flipbook-toolbar-prev")).toBeDisabled();

		await page.locator(".flipbook-toolbar-last").click();
		// The engine lands on the final spread (endpaper + back cover). The
		// spread's start index is below the last face index, so the vertical
		// engine keeps forward controls enabled — but a forward turn from
		// here cannot commit: exposure must not move.
		await expectExposedPages(page, [lastIndex - 1, lastIndex]);
		await page.locator(".flipbook-toolbar-next").click();
		await waitForFlipSettled(page);
		await expectExposedPages(page, [lastIndex - 1, lastIndex]);

		// …while the backward boundary turn still works from the same spot.
		await page.locator(".flipbook-toolbar-prev").click();
		await expectExposedPages(page, [lastIndex - 3, lastIndex - 2]);
	});

	test("turns on ArrowUp/ArrowDown command hotkeys with stable focus and editable-target exclusion", async ({
		page,
	}) => {
		await openFlipBook(page);
		const sheet = page.locator(SHEET_FACE);
		const start = await sheetPageIndex(page);
		const next = page.locator(".flipbook-toolbar-next");

		await next.focus();
		// Horizontal arrows no longer turn a vertical book — if either had,
		// the ArrowUp below would land on a different page index.
		await page.keyboard.press("ArrowRight");
		await page.keyboard.press("ArrowLeft");
		await page.keyboard.press("ArrowUp");
		await expect(sheet).toHaveAttribute(
			"data-page-index",
			String(start + 2),
		);
		// Focus stays on the turn control for repeated keyboard turns.
		await expect(next).toBeFocused();
		await page.keyboard.press("ArrowDown");
		await expect(sheet).toHaveAttribute("data-page-index", String(start));

		// Editable targets are excluded from hotkeys: inside the jump field,
		// three arrow presses net-zero then — had any leaked into a turn, the
		// final ArrowUp would land on a different index.
		await page.getByRole("textbox", { name: "עבור לחודש" }).focus();
		await page.keyboard.press("ArrowUp");
		await page.keyboard.press("ArrowDown");
		await page.keyboard.press("ArrowUp");
		await next.focus();
		await page.keyboard.press("ArrowUp");
		await expect(sheet).toHaveAttribute(
			"data-page-index",
			String(start + 2),
		);
	});

	test("opens a deep-linked month, follows external selection and semantic jump editing", async ({
		page,
	}) => {
		const today = constructTsetAwareHDate(new Date());
		const year = today.year;
		const todayMonth = today.getUniformMonth();
		const order = getMonthOrder(year);
		// A non-current month inside the displayed year proves the deep link
		// steers the mount rather than landing on today's default.
		const target = order.find((month) => month !== todayMonth);
		if (target === undefined) throw new Error("Single-month year");

		await openFlipBook(
			page,
			`/לוח?month=${year}${String(target).padStart(2, "0")}&view=year&flip=1`,
		);
		const sheet = page.locator(SHEET_FACE);
		const targetIndex = 3 + order.indexOf(target) * 2;
		await expect(sheet).toHaveAttribute(
			"data-page-index",
			String(targetIndex),
		);
		await expectExposedPages(page, [targetIndex, targetIndex + 1]);

		// Accessible jump editing: type another month's semantic name. The
		// indicator selects its whole display value on focus via a deferred
		// rAF — wait for that selection, or the typed name splices into the
		// middle of the old value and matches nothing.
		const jumped = target === order[0] ? order[1] : order[0];
		const indicator = page.getByRole("textbox", { name: "עבור לחודש" });
		await indicator.click();
		await page.waitForFunction(() => {
			const el = document.activeElement;
			return (
				el instanceof HTMLInputElement &&
				el.selectionStart === 0 &&
				el.selectionEnd === el.value.length
			);
		});
		await indicator.pressSequentially(getMonthName(year, jumped));
		await indicator.press("Enter");
		const jumpedIndex = 3 + order.indexOf(jumped) * 2;
		await expect(sheet).toHaveAttribute(
			"data-page-index",
			String(jumpedIndex),
		);
		await expect(page).toHaveURL(
			(url) =>
				url.searchParams.get("month") ===
				`${year}${String(jumped).padStart(2, "0")}`,
		);
		await expectExposedPages(page, [jumpedIndex, jumpedIndex + 1]);

		// External same-scope selection flows through requestedMonth into
		// the mounted engine — Today returns to the live month.
		await page.getByRole("button", { name: "היום" }).click();
		const todayIndex = 3 + order.indexOf(todayMonth) * 2;
		await expect(sheet).toHaveAttribute(
			"data-page-index",
			String(todayIndex),
		);
		await expectExposedPages(page, [todayIndex, todayIndex + 1]);
	});

	test("turns on real pointer drags over the free edges and ignores content drags", async ({
		page,
	}, testInfo) => {
		await openFlipBook(page);
		const sheet = page.locator(SHEET_FACE);
		const start = await sheetPageIndex(page);

		// Forward turn: grab the lower face's bottom free edge (the even
		// index of the exposed pair — the odd face is the turned sheet above
		// the binding) and lift it over the spiral.
		const lowerBox = await boundingBox(
			page.locator(`${FACES}[data-page-index="${start + 1}"]`),
		);
		const cx = lowerBox.x + lowerBox.width / 2;
		// Releasing after a small, slow lift cancels the turn without
		// committing. Touch contexts map the synthetic mouse to a finger
		// flick whose release velocity commits, so the cancel contract is
		// asserted on pointer input only.
		const hasTouch = await page.evaluate(() => navigator.maxTouchPoints > 0);
		if (!hasTouch) {
			await page.mouse.move(cx, lowerBox.y + lowerBox.height - 8);
			await page.mouse.down();
			await page.mouse.move(cx, lowerBox.y + lowerBox.height - 40, {
				steps: 6,
			});
			await page.mouse.up();
			await waitForFlipSettled(page);
			await expect(sheet).toHaveAttribute(
				"data-page-index",
				String(start),
			);
		}

		await page.mouse.move(cx, lowerBox.y + lowerBox.height - 8);
		await page.mouse.down();
		// Hold mid-lift: the sheet rides over the spiral binding — captured
		// for the PR record before the release commits the turn.
		await page.mouse.move(cx, lowerBox.y + lowerBox.height * 0.3, {
			steps: 6,
		});
		await testInfo.attach("book-held-turn", {
			body: await page.screenshot(),
			contentType: "image/png",
		});
		await page.mouse.move(cx, lowerBox.y - lowerBox.height * 0.5, {
			steps: 6,
		});
		await page.mouse.up();
		await expect(sheet).toHaveAttribute(
			"data-page-index",
			String(start + 2),
		);
		await expectExposedPages(page, [start + 2, start + 3]);

		// Backward turn: pull the turned sheet's upper free edge back down.
		const upperBox = await boundingBox(
			page.locator(`${FACES}[data-page-index="${start + 2}"]`),
		);
		const ucx = upperBox.x + upperBox.width / 2;
		await page.mouse.move(ucx, upperBox.y + 8);
		await page.mouse.down();
		await page.mouse.move(ucx, upperBox.y + upperBox.height * 1.5, {
			steps: 12,
		});
		await page.mouse.up();
		await expect(sheet).toHaveAttribute("data-page-index", String(start));
		await expectExposedPages(page, [start, start + 1]);

		// Real touch events reach the same free-edge affordance — drag the
		// lower edge forward with a finger, then the upper edge back.
		const cdp = await page.context().newCDPSession(page);
		const touch = async (
			type: "touchStart" | "touchMove" | "touchEnd",
			x: number,
			y: number,
		) =>
			cdp.send("Input.dispatchTouchEvent", {
				type,
				touchPoints: type === "touchEnd" ? [] : [{ x, y }],
			});
		const touchEdge = await boundingBox(
			page.locator(`${FACES}[data-page-index="${start + 1}"]`),
		);
		const tx = Math.round(touchEdge.x + touchEdge.width / 2);
		const ty = Math.round(touchEdge.y + touchEdge.height - 8);
		const tLift = Math.round(touchEdge.y - touchEdge.height * 0.5);
		await touch("touchStart", tx, ty);
		for (let step = 1; step <= 8; step++) {
			await touch(
				"touchMove",
				tx,
				Math.round(ty + (tLift - ty) * (step / 8)),
			);
		}
		await touch("touchEnd", tx, tLift);
		await expect(sheet).toHaveAttribute(
			"data-page-index",
			String(start + 2),
		);
		const touchUpper = await boundingBox(
			page.locator(`${FACES}[data-page-index="${start + 2}"]`),
		);
		const tux = Math.round(touchUpper.x + touchUpper.width / 2);
		const tuy = Math.round(touchUpper.y + 8);
		const tPull = Math.round(touchUpper.y + touchUpper.height * 1.5);
		await touch("touchStart", tux, tuy);
		for (let step = 1; step <= 8; step++) {
			await touch(
				"touchMove",
				tux,
				Math.round(tuy + (tPull - tuy) * (step / 8)),
			);
		}
		await touch("touchEnd", tux, tPull);
		await expect(sheet).toHaveAttribute("data-page-index", String(start));
		await expectExposedPages(page, [start, start + 1]);

		// Ordinary content gestures away from the free edges do not turn —
		// month grids keep their pan/scroll behaviour.
		const sheetBox = await boundingBox(sheet);
		await page.mouse.move(
			sheetBox.x + sheetBox.width / 2,
			sheetBox.y + sheetBox.height * 0.55,
		);
		await page.mouse.down();
		await page.mouse.move(
			sheetBox.x + sheetBox.width / 2,
			sheetBox.y + sheetBox.height * 0.2,
			{ steps: 8 },
		);
		await page.mouse.up();
		await waitForFlipSettled(page);
		await expect(sheet).toHaveAttribute("data-page-index", String(start));

		// Wheel scrolling over the book is not a turn gesture — the page
		// index stays put (the host document may scroll, that's fine).
		await page.mouse.move(
			sheetBox.x + sheetBox.width / 2,
			sheetBox.y + sheetBox.height * 0.5,
		);
		await page.mouse.wheel(0, 400);
		await page.mouse.wheel(0, -400);
		await waitForFlipSettled(page);
		await expect(sheet).toHaveAttribute("data-page-index", String(start));
	});

	test("opens a perek on tap but suppresses the click ending a real drag", async ({
		page,
	}) => {
		await openFlipBook(page);
		const start = await sheetPageIndex(page);
		const cell = page.locator(`${SHEET_FACE} button.cal-cell`).first();
		const cellBox = await boundingBox(cell);
		const lowerBox = await boundingBox(
			page.locator(`${FACES}[data-page-index="${start + 1}"]`),
		);

		// Drag from the lower free edge up over a perek cell: the release
		// lands on a different face, so the trailing click can only reach a
		// common ancestor. This half proves the committed turn settles and
		// never navigates — the same-element drag below is the part that
		// actually exercises the engine's click suppression.
		await page.mouse.move(
			lowerBox.x + lowerBox.width / 2,
			lowerBox.y + lowerBox.height - 8,
		);
		await page.mouse.down();
		await page.mouse.move(
			cellBox.x + cellBox.width / 2,
			cellBox.y + cellBox.height / 2,
			{ steps: 12 },
		);
		await page.mouse.up();
		// The drag commits a turn — the ?month sync proves the engine settled.
		await expect(page).toHaveURL(/[?&]month=\d+/);
		await expect(page).not.toHaveURL(/\/929\//);

		// Suppression probe: press and release on the SAME cell with a real
		// drag between. The browser then dispatches `click` on that cell —
		// proven by the capture recorder — so the engine's post-drag swallow
		// is the only thing keeping it from opening a perek. Cells are plain
		// buttons (no Link → no prefetch), so any /929 request is a real
		// leaked navigation: watching for the request beats watching the URL,
		// which only updates after the RSC fetch resolves.
		await page.evaluate(() => {
			const w = window as unknown as { __cellClicks: number };
			w.__cellClicks = 0;
			document.addEventListener(
				"click",
				(e) => {
					if (
						e.target instanceof Element &&
						e.target.closest("button.cal-cell")
					) {
						w.__cellClicks += 1;
					}
				},
				true,
			);
		});
		const dragCell = page
			.locator(`${SHEET_FACE} button.cal-cell`)
			.first();
		const dragBox = await boundingBox(dragCell);
		const pressX = dragBox.x + dragBox.width * 0.3;
		const pressY = dragBox.y + dragBox.height / 2;
		const sheetIndex = await sheetPageIndex(page);
		const leakedNav = page
			.waitForRequest(/\/929\/\d+/, { timeout: 3_000 })
			.then(() => true)
			.catch(() => false);
		await page.mouse.move(pressX, pressY);
		await page.mouse.down();
		await page.mouse.move(
			pressX + Math.min(24, dragBox.width * 0.4),
			pressY,
			{ steps: 6 },
		);
		await page.mouse.up();
		await waitForFlipSettled(page);
		// A click really was dispatched at the cell …
		expect(
			await page.evaluate(
				() =>
					(window as unknown as { __cellClicks: number }).__cellClicks,
			),
		).toBe(1);
		// … and the engine swallowed it: no perek navigation, no turn.
		expect(await leakedNav).toBe(false);
		await expect(page).not.toHaveURL(/\/929\//);
		await expect(page.locator(SHEET_FACE)).toHaveAttribute(
			"data-page-index",
			String(sheetIndex),
		);

		// A plain tap on a study-day cell still opens its perek: the click
		// reaches onOpen → router.push, whose RSC request proves navigation
		// fired (the /929 document itself is covered by the reader suites).
		const currentCell = page
			.locator(`${SHEET_FACE} button.cal-cell`)
			.first();
		const navRequest = page.waitForRequest(/\/929\/\d+/);
		await currentCell.click();
		await navRequest;
	});

	test("settles under reduced motion, survives rapid navigation and remounts cleanly", async ({
		page,
	}) => {
		await page.emulateMedia({ reducedMotion: "reduce" });
		await openFlipBook(page);
		const sheet = page.locator(SHEET_FACE);
		const start = await sheetPageIndex(page);

		await page.locator(".flipbook-toolbar-next").click();
		await expect(sheet).toHaveAttribute(
			"data-page-index",
			String(start + 2),
		);

		// Rapid presses chain through the engine's consecutive-turn handling;
		// wait for the sheet index to stay put and flipping to clear, then
		// the landed pair must hold the exposure contract.
		await page.locator(".flipbook-toolbar-next").click();
		await page.locator(".flipbook-toolbar-next").click();
		await page.waitForFunction(
			(selector) => {
				if (document.querySelector(`${selector} .page--flipping`)) {
					return false;
				}
				const sheet = document.querySelector(
					`${selector} .page.current-page:has(.cal-sheet)`,
				);
				const index = sheet?.getAttribute("data-page-index") ?? null;
				const state = (
					window as unknown as {
						__flipStable?: { index: string | null; since: number };
					}
				).__flipStable;
				if (!state || state.index !== index) {
					(
						window as unknown as {
							__flipStable?: { index: string | null; since: number };
						}
					).__flipStable = { index, since: performance.now() };
					return false;
				}
				return performance.now() - state.since > 500;
			},
			BOOK,
			{ timeout: 15_000, polling: 100 },
		);
		const landed = await sheetPageIndex(page);
		expect(landed).toBe(start + 6);
		await expectExposedPages(page, [landed, landed + 1]);

		// Mount/unmount round-trip keeps the ownership contract: overview →
		// flip remounts the engine and re-syncs exposure.
		await page
			.getByRole("button", { name: "מעבר לתצוגת הסקירה" })
			.click();
		await expect(page.locator(BOOK)).toHaveCount(0);
		await page.getByRole("button", { name: "דפדוף" }).click();
		await expect(page.locator(BOOK)).toBeVisible({ timeout: 30_000 });
		const remounted = await sheetPageIndex(page);
		await expectExposedPages(page, [remounted, remounted + 1]);
	});

	test("keeps the vertical-axis toolbar contract: rotated chevrons and a readable indicator", async ({
		page,
	}, testInfo) => {
		await openFlipBook(page);
		const toolbar = page.locator(".flipbook-toolbar");
		await expect(toolbar).toHaveAttribute("data-flip-axis", "vertical");

		// Built-in chevrons rotate 90° on a vertical book: next/last point
		// up, previous/first point down — rotate(-90deg) as a matrix.
		const iconTransform = await page
			.locator(".flipbook-toolbar-next .flipbook-toolbar-navigation-icon")
			.evaluate((el) => getComputedStyle(el).transform);
		expect(iconTransform).toMatch(/^matrix\(/);
		const parts = iconTransform
			.replace(/^matrix\(|\)$/g, "")
			.split(",")
			.map(Number);
		// rotate(-90deg) → matrix(0,-1,1,0,0,0): b≈-1, c≈1.
		expect(Math.abs(parts[1] + 1)).toBeLessThan(0.01);
		expect(Math.abs(parts[2] - 1)).toBeLessThan(0.01);

		// #3484 / upstream #416: vertical books paint toolbar text white,
		// so the scoped calendar rule keeps the jump input dark-on-light.
		const indicator = page.getByRole("textbox", { name: "עבור לחודש" });
		await expect(indicator).toHaveCSS("color", "rgb(26, 26, 26)");
		await expect(indicator).toHaveCSS(
			"background-color",
			"rgb(255, 255, 255)",
		);

		// Evidence attachments for the PR record: the shipped dark-on-light
		// field, then the same field with the scoped rule stripped — the
		// white-on-white regression upstream #416 still tracks.
		await testInfo.attach("indicator-fixed", {
			body: await indicator.screenshot(),
			contentType: "image/png",
		});
		await page.evaluate(() => {
			for (const sheet of document.styleSheets) {
				for (let i = sheet.cssRules.length - 1; i >= 0; i--) {
					const css = sheet.cssRules[i].cssText;
					if (
						css.includes("cal-book-wrap") &&
						css.includes("flipbook-toolbar-indicator")
					) {
						sheet.deleteRule(i);
					}
				}
			}
		});
		await expect(indicator).toHaveCSS("color", "rgb(255, 255, 255)");
		await testInfo.attach("indicator-upstream-416-regression", {
			body: await indicator.screenshot(),
			contentType: "image/png",
		});

		// Short-viewport evidence: the book must still fit its sheet.
		await page.setViewportSize({ width: 1280, height: 640 });
		await testInfo.attach("book-short-viewport", {
			body: await page.screenshot(),
			contentType: "image/png",
		});
	});
});
