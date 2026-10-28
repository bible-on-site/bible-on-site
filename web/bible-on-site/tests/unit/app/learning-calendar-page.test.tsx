/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useRouter, useSearchParams } from "next/navigation";

jest.mock("next/navigation", () => ({
	useRouter: jest.fn(),
	useSearchParams: jest.fn(),
}));

import { LearningCalendar } from "@/app/calendar/components/LearningCalendar";
import {
	getCycle,
	getCycleStartMonth,
	nextMonth,
} from "@/data/learning-schedule";
import { resetCalendarPdfAssetCache } from "@/lib/download/calendar-pdf-client";

const mockReplace = jest.fn();
const mockPush = jest.fn();

function setSearchParam(value: string | null, extra?: Record<string, string>) {
	const params = new URLSearchParams();
	if (value !== null) {
		params.set("month", value);
	}
	for (const [key, val] of Object.entries(extra ?? {})) {
		params.set(key, val);
	}
	(useSearchParams as jest.Mock).mockReturnValue(params);
}

function q(container: HTMLElement, selector: string): Element {
	const el = container.querySelector(selector);
	if (el === null) {
		throw new Error(`Missing element: ${selector}`);
	}
	return el;
}

const cycleStartProps = {
	initialYear: 5785,
	initialMonth: 12,
	todayDateNumber: 57851207,
};

describe("LearningCalendar", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		(useRouter as jest.Mock).mockReturnValue({
			replace: mockReplace,
			push: mockPush,
		});
		setSearchParam(null);
	});

	it("renders the current Hebrew month with study and review days", () => {
		render(<LearningCalendar {...cycleStartProps} />);

		expect(
			screen.getByRole("heading", { name: "לוח לימוד יומי" }),
		).toBeInTheDocument();
		// אלול ה'תשפ"ה
		expect(
			screen.getByRole("heading", { name: /אלול ה'תשפ/ }),
		).toBeInTheDocument();
		// Cycle 4 starts ז אלול with בראשית א (perek 1).
		expect(
			screen.getByRole("button", {
				name: (name) => /אלול.*בראשית א/.test(name) && !name.includes("חזרה"),
			}),
		).toBeInTheDocument();
		// 12-13 Elul (Friday/Saturday) review the whole studied week (#2365):
		// one merged block covering both dates, not two duplicate cells.
		const reviewDays = screen.getAllByRole("button", { name: /חזרה/ });
		expect(reviewDays.length).toBeGreaterThanOrEqual(1);
		const merged = screen.getByRole("button", {
			name: /י"ב אלול.*י"ג אלול.*חזרה: בראשית א-ה/,
		});
		expect(merged).toBeInTheDocument();
		expect(merged.textContent).toContain('י"ב');
		expect(merged.textContent).toContain('י"ג');
		// Saturday's cell is folded into Friday's block, not rendered alone.
		expect(
			screen.queryByRole("button", { name: /^י"ג אלול/ }),
		).not.toBeInTheDocument();
	});

	it("merges Friday/Saturday review cells in the yearly view", () => {
		render(<LearningCalendar {...cycleStartProps} />);

		fireEvent.click(screen.getByRole("button", { name: "שנתי" }));

		// אלול's mini-month shows the merged 12-13 pair as one block (#2365).
		const merged = screen.getAllByRole("button", {
			name: /י"ב אלול.*י"ג אלול.*חזרה: בראשית א-ה/,
		});
		expect(merged.length).toBe(1);
		expect(merged[0].textContent).toContain('י"ב');
		expect(merged[0].textContent).toContain('י"ג');
	});

	it("navigates to the next month and syncs the ?month= query", () => {
		render(<LearningCalendar {...cycleStartProps} />);

		fireEvent.click(screen.getByRole("button", { name: "חודש הבא" }));

		expect(mockReplace).toHaveBeenCalledWith("?month=578601", {
			scroll: false,
		});
		expect(
			screen.getByRole("heading", { name: /תשרי ה'תשפ/ }),
		).toBeInTheDocument();
	});

	it("navigates to the previous month across a leap-year boundary", () => {
		render(
			<LearningCalendar
				initialYear={5784}
				initialMonth={14}
				todayDateNumber={57851207}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "חודש קודם" }));

		expect(mockReplace).toHaveBeenCalledWith("?month=578413", {
			scroll: false,
		});
	});

	it("restores the viewed month from the ?month= query param", () => {
		setSearchParam("577504");
		render(<LearningCalendar {...cycleStartProps} />);

		expect(
			screen.getByRole("heading", { name: /טבת ה'תשע/ }),
		).toBeInTheDocument();
	});

	it("ignores malformed ?month= params", () => {
		setSearchParam("578513"); // Adar I does not exist in non-leap 5785
		render(<LearningCalendar {...cycleStartProps} />);

		expect(
			screen.getByRole("heading", { name: /אלול ה'תשפ/ }),
		).toBeInTheDocument();
	});

	it("opens the perek reader when a study day is clicked", () => {
		render(<LearningCalendar {...cycleStartProps} />);

		fireEvent.click(
			screen.getByRole("button", {
				name: (name) => /אלול.*בראשית א/.test(name) && !name.includes("חזרה"),
			}),
		);
		expect(mockPush).toHaveBeenCalledWith("/929/1");
	});

	it("marks today's cell", () => {
		render(<LearningCalendar {...cycleStartProps} />);

		const todayCell = screen.getByRole("button", {
			name: (name) => /אלול.*בראשית א/.test(name) && !name.includes("חזרה"),
		});
		expect(todayCell.textContent).toContain("היום");
	});

	it("marks a merged review block when today is one of its dates", () => {
		// 12 Elul is the Friday half of the merged 12-13 review pair (#2365).
		render(
			<LearningCalendar {...cycleStartProps} todayDateNumber={57851212} />,
		);

		const merged = screen.getByRole("button", {
			name: /י"ב אלול.*י"ג אלול.*חזרה: בראשית א-ה/,
		});
		expect(merged.textContent).toContain("היום");
	});

	it("returns to today's month via the היום button", () => {
		render(<LearningCalendar {...cycleStartProps} />);

		fireEvent.click(screen.getByRole("button", { name: "חודש הבא" }));
		fireEvent.click(screen.getByRole("button", { name: "היום" }));

		expect(mockReplace).toHaveBeenLastCalledWith("?month=578512&cycle=4", {
			scroll: false,
		});
	});

	it("jumps to a cycle's first month via the cycle picker", () => {
		render(<LearningCalendar {...cycleStartProps} />);

		fireEvent.change(
			screen.getByRole("combobox", { name: "בחירת מחזור לימוד" }),
			{ target: { value: "1" } },
		);

		expect(mockReplace).toHaveBeenCalledWith("?month=577503", {
			scroll: false,
		});
	});

	it("follows ?month= changes while mounted (back/forward navigation)", () => {
		const { rerender } = render(<LearningCalendar {...cycleStartProps} />);
		expect(
			screen.getByRole("heading", { name: /אלול ה'תשפ/ }),
		).toBeInTheDocument();

		setSearchParam("578407");
		rerender(<LearningCalendar {...cycleStartProps} />);

		expect(
			screen.getByRole("heading", { name: /ניסן ה'תשפ"ד/ }),
		).toBeInTheDocument();
	});

	it("navigates via the month picker", () => {
		render(<LearningCalendar {...cycleStartProps} />);

		fireEvent.change(screen.getByRole("combobox", { name: "חודש" }), {
			target: { value: "5" },
		});

		expect(mockReplace).toHaveBeenCalledWith("?month=578505", {
			scroll: false,
		});
		expect(
			screen.getByRole("heading", { name: /שבט ה'תשפ/ }),
		).toBeInTheDocument();
	});

	it("keeps the viewed month when picking a year where it exists", () => {
		render(<LearningCalendar {...cycleStartProps} />);

		fireEvent.change(screen.getByRole("combobox", { name: "שנה" }), {
			target: { value: "5784" },
		});

		expect(mockReplace).toHaveBeenCalledWith("?month=578412", {
			scroll: false,
		});
	});

	it("falls back to Adar when picking a non-leap year while viewing Adar II", () => {
		render(
			<LearningCalendar
				initialYear={5784}
				initialMonth={14}
				todayDateNumber={57851207}
			/>,
		);

		fireEvent.change(screen.getByRole("combobox", { name: "שנה" }), {
			target: { value: "5785" },
		});

		expect(mockReplace).toHaveBeenCalledWith("?month=578506", {
			scroll: false,
		});
	});

	it("includes projected cycles once today has reached them", () => {
		// The month after cycle 11's start lies entirely inside the cycle, so it
		// anchors the picker on the projected cycle rather than cycle 10's tail.
		const projected = nextMonth(getCycleStartMonth(getCycle(11)));
		render(
			<LearningCalendar
				initialYear={projected.year}
				initialMonth={projected.month}
				todayDateNumber={
					getCycle(11).start.year * 10000 +
					getCycle(11).start.getUniformMonth() * 100 +
					getCycle(11).start.day
				}
			/>,
		);

		const picker = screen.getByRole("combobox", {
			name: "בחירת מחזור לימוד",
		});
		expect(picker).toHaveValue("11");
		expect(
			screen.getByRole("option", { name: 'מחזור י"א (משוער)' }),
		).toBeInTheDocument();
		// The projected cycle's label is shown next to the picker.
		expect(screen.getByText(/מחזור י"א \(משוער\):/)).toBeInTheDocument();
	});

	describe("view modes", () => {
		it("limits shared links, pickers and navigation to the cycle after today's", () => {
			setSearchParam("590001", { view: "cycle", cycle: "999" });
			render(<LearningCalendar {...cycleStartProps} />);
			const picker = screen.getByRole("combobox", {
				name: "בחירת מחזור לימוד",
			});
			expect(picker).toHaveValue("5");
			expect(picker.querySelectorAll("option")).toHaveLength(5);
			expect(screen.getByRole("button", { name: "מחזור הבא" })).toBeDisabled();
			expect(screen.getByRole("button", { name: /הורדת PDF/ })).toBeDisabled();
			fireEvent.click(screen.getByRole("button", { name: "היום" }));
			expect(picker).toHaveValue("4");
			expect(screen.getByRole("button", { name: /הורדת PDF/ })).toBeEnabled();
		});

		it("keeps history readable while blocking its export", () => {
			setSearchParam("578301", { view: "cycle", cycle: "3" });
			render(<LearningCalendar {...cycleStartProps} />);
			expect(
				screen.getByRole("combobox", { name: "בחירת מחזור לימוד" }),
			).toHaveValue("3");
			expect(screen.getByRole("button", { name: /הורדת PDF/ })).toBeDisabled();
			expect(screen.getByRole("status")).toHaveTextContent(
				"החל משנה לפני תחילתו",
			);
		});

		it("opens the next cycle and all of its supported future years at the anniversary", () => {
			setSearchParam("579101", { view: "year" });
			const props = { ...cycleStartProps, todayDateNumber: 57880708 };
			const { rerender } = render(<LearningCalendar {...props} />);
			expect(screen.getByRole("button", { name: /הורדת PDF/ })).toBeDisabled();
			rerender(<LearningCalendar {...props} todayDateNumber={57880709} />);
			expect(screen.getByRole("button", { name: /הורדת PDF/ })).toBeEnabled();
		});

		it("ends month/year navigation at the end of the next cycle", () => {
			setSearchParam("590001");
			const { container } = render(<LearningCalendar {...cycleStartProps} />);
			expect(screen.getByRole("combobox", { name: "שנה" })).toHaveValue("5793");
			expect(screen.getByRole("combobox", { name: "חודש" })).toHaveValue("2");
			expect(screen.getByRole("button", { name: "חודש הבא" })).toBeDisabled();
			fireEvent.click(screen.getByRole("button", { name: "שנתי" }));
			expect(container.querySelectorAll("h3")).toHaveLength(2);
			expect(screen.getByRole("button", { name: "שנה הבאה" })).toBeDisabled();
		});

		it("renders a view toggle with monthly/yearly/full-cycle options", () => {
			render(<LearningCalendar {...cycleStartProps} />);

			expect(screen.getByRole("button", { name: "חודשי" })).toHaveAttribute(
				"aria-pressed",
				"true",
			);
			expect(screen.getByRole("button", { name: "שנתי" })).toHaveAttribute(
				"aria-pressed",
				"false",
			);
			expect(screen.getByRole("button", { name: "מחזור מלא" })).toHaveAttribute(
				"aria-pressed",
				"false",
			);
		});

		it("switches to the yearly view and syncs the ?view= query", () => {
			const { container } = render(<LearningCalendar {...cycleStartProps} />);

			fireEvent.click(screen.getByRole("button", { name: "שנתי" }));

			expect(mockReplace).toHaveBeenCalledWith(
				expect.stringContaining("view=year"),
				{ scroll: false },
			);
			// Every month of תשפ"ה appears as a mini-month section.
			const headings = [...container.querySelectorAll("h3")].map(
				(h) => h.textContent,
			);
			for (const name of ["תשרי", "חשוון", "אלול"]) {
				expect(headings).toContain(name);
			}
		});

		it("renders the yearly view from the ?view=year query", () => {
			setSearchParam("578512", { view: "year" });
			const { container } = render(<LearningCalendar {...cycleStartProps} />);

			expect(
				container.querySelector('button[aria-pressed="true"]')?.textContent,
			).toBe("שנתי");
			expect(container.querySelector("h2")?.textContent).toMatch(/שנת ה'תשפ/);
			// Study days stay navigable inside mini-months.
			expect(
				container.querySelectorAll('button[aria-label*="חזרה"]').length,
			).toBeGreaterThanOrEqual(2);
		});

		it("switches to the full-cycle view and renders its months", () => {
			const { container } = render(<LearningCalendar {...cycleStartProps} />);

			fireEvent.click(screen.getByRole("button", { name: "מחזור מלא" }));

			expect(mockReplace).toHaveBeenCalledWith(
				expect.stringContaining("view=cycle"),
				{ scroll: false },
			);
			// אלול 5785 belongs to cycle 4; the heading shows the full range.
			expect(container.querySelector("h2")?.textContent).toMatch(/מחזור ד'/);
			expect(container.querySelectorAll("h3").length).toBeGreaterThan(30);
		});

		it("shows a single selected-cycle description in full-cycle view (#2725)", () => {
			setSearchParam("578512", { view: "cycle", cycle: "4" });
			const { container } = render(<LearningCalendar {...cycleStartProps} />);

			// The h2 is the one authoritative description with the range —
			// nothing beside the picker repeats it.
			expect(container.querySelector("h2")?.textContent).toMatch(/מחזור ד':/);
			expect(screen.getAllByText(/מחזור ד':/)).toHaveLength(1);
			expect(
				screen.getByRole("combobox", { name: "בחירת מחזור לימוד" }),
			).toHaveValue("4");
		});

		it("navigates to the next cycle in full-cycle view", () => {
			setSearchParam("578512", { view: "cycle", cycle: "4" });
			const { container } = render(<LearningCalendar {...cycleStartProps} />);

			fireEvent.click(q(container, 'button[aria-label="מחזור הבא"]'));

			expect(mockReplace).toHaveBeenCalledWith(
				expect.stringContaining("cycle=5"),
				{ scroll: false },
			);
			expect(container.querySelector("h2")?.textContent).toMatch(/מחזור ה'/);
		});

		it("navigates to the next year in yearly view", () => {
			setSearchParam("578512", { view: "year" });
			const { container } = render(<LearningCalendar {...cycleStartProps} />);

			fireEvent.click(q(container, 'button[aria-label="שנה הבאה"]'));

			// אלול exists in every year, so the month is preserved.
			expect(mockReplace).toHaveBeenCalledWith(
				expect.stringContaining("month=578612"),
				{ scroll: false },
			);
		});

		it("jumps between cycles via the cycle picker in full-cycle view", () => {
			setSearchParam("578512", { view: "cycle", cycle: "4" });
			const { container } = render(<LearningCalendar {...cycleStartProps} />);

			fireEvent.change(q(container, 'select[aria-label="בחירת מחזור לימוד"]'), {
				target: { value: "2" },
			});

			expect(mockReplace).toHaveBeenCalledWith(
				expect.stringContaining("cycle=2"),
				{ scroll: false },
			);
			expect(container.querySelector("h2")?.textContent).toMatch(/מחזור ב'/);
		});

		it("disables previous-cycle navigation on the first cycle", () => {
			setSearchParam("578512", { view: "cycle", cycle: "1" });
			const { container } = render(<LearningCalendar {...cycleStartProps} />);

			expect(
				container.querySelector('button[aria-label="מחזור קודם"]'),
			).toBeDisabled();
		});

		it("keeps scheduled perakim navigable in yearly view", () => {
			setSearchParam("578512", { view: "year" });
			const { container } = render(<LearningCalendar {...cycleStartProps} />);

			const studyDay = [
				...container.querySelectorAll('button[aria-label*="בראשית א"]'),
			].find((b) => !b.getAttribute("aria-label")?.includes("חזרה"));
			expect(studyDay).toBeDefined();
			fireEvent.click(studyDay as Element);

			expect(mockPush).toHaveBeenCalledWith("/929/1");
		});
	});

	describe("PDF download action (#2621, #2622)", () => {
		const pdfProps = {
			initialYear: 5786,
			initialMonth: 1,
			todayDateNumber: 57860115,
		};
		const MANIFEST_URL =
			"https://assets.example/generated/calendar-pdf/manifest.json";

		function manifestWith(artifacts: Record<string, unknown>) {
			// jsdom has no fetch Response class — a structural stub is enough.
			return {
				ok: true,
				status: 200,
				headers: new Headers(),
				text: () =>
					Promise.resolve(
						JSON.stringify({
							version: 1,
							fingerprint: "fp",
							generatedAt: "2026-10-26T00:00:00.000Z",
							bounds: {},
							artifacts,
						}),
					),
			} as Response;
		}

		beforeEach(() => {
			resetCalendarPdfAssetCache();
			global.fetch = jest.fn();
			URL.createObjectURL = jest.fn(() => "blob:mock");
			URL.revokeObjectURL = jest.fn();
		});

		it("names the selected month on the download action", () => {
			render(<LearningCalendar {...pdfProps} />);

			expect(
				screen.getByRole("button", {
					name: /הורדת PDF: תשרי ה'תשפ/,
				}),
			).toBeInTheDocument();
		});

		it("names the selected year in yearly view", () => {
			setSearchParam("578601", { view: "year" });
			render(<LearningCalendar {...pdfProps} />);

			expect(
				screen.getByRole("button", { name: /הורדת PDF: שנת ה'תשפ/ }),
			).toBeInTheDocument();
		});

		it("names the selected cycle in full-cycle view", () => {
			setSearchParam("578601", { view: "cycle", cycle: "4" });
			render(<LearningCalendar {...pdfProps} />);

			expect(
				screen.getByRole("button", { name: /הורדת PDF: מחזור ד'/ }),
			).toBeInTheDocument();
		});

		it("fetches nothing while the calendar is browsed", () => {
			render(<LearningCalendar {...pdfProps} pdfManifestUrl={MANIFEST_URL} />);

			fireEvent.click(screen.getByRole("button", { name: "חודש הבא" }));
			fireEvent.click(screen.getByRole("button", { name: "שנתי" }));

			expect(global.fetch).not.toHaveBeenCalled();
		});

		it("hands the published month artifact straight to the browser", async () => {
			const clickSpy = jest
				.spyOn(HTMLAnchorElement.prototype, "click")
				.mockImplementation(() => {});
			(global.fetch as jest.Mock).mockImplementation((url: unknown) =>
				url === MANIFEST_URL
					? Promise.resolve(
							manifestWith({
								"month:578601": {
									object: "generated/calendar-pdf/objects/x.pdf",
									sha256: "x",
									bytes: 10,
									filename: "learning-calendar-578601.pdf",
								},
							}),
						)
					: Promise.reject(new Error("unexpected fetch")),
			);
			render(<LearningCalendar {...pdfProps} pdfManifestUrl={MANIFEST_URL} />);

			fireEvent.click(screen.getByRole("button", { name: /הורדת PDF/ }));

			await waitFor(() =>
				expect(screen.getByRole("status")).toHaveTextContent("החלה"),
			);
			// One static manifest GET — never the dynamic API or a resolver call.
			expect(global.fetch).toHaveBeenCalledTimes(1);
			const anchor = clickSpy.mock.contexts[0] as HTMLAnchorElement;
			expect(anchor.href).toBe(
				"https://assets.example/generated/calendar-pdf/objects/x.pdf",
			);
			expect(anchor.download).toBe("learning-calendar-578601.pdf");
		});

		it("resolves a full-cycle selection to its cycle artifact", async () => {
			const clickSpy = jest
				.spyOn(HTMLAnchorElement.prototype, "click")
				.mockImplementation(() => {});
			(global.fetch as jest.Mock).mockImplementation((url: unknown) =>
				url === MANIFEST_URL
					? Promise.resolve(
							manifestWith({
								"cycle:4": {
									object: "generated/calendar-pdf/objects/cycle4.pdf",
									sha256: "y",
									bytes: 999,
									filename: "learning-calendar-cycle-4.pdf",
								},
							}),
						)
					: Promise.reject(new Error("unexpected fetch")),
			);
			setSearchParam("578601", { view: "cycle", cycle: "4" });
			render(<LearningCalendar {...pdfProps} pdfManifestUrl={MANIFEST_URL} />);

			fireEvent.click(screen.getByRole("button", { name: /הורדת PDF/ }));

			await waitFor(() => expect(clickSpy).toHaveBeenCalled());
			expect((clickSpy.mock.contexts[0] as HTMLAnchorElement).href).toBe(
				"https://assets.example/generated/calendar-pdf/objects/cycle4.pdf",
			);
			expect(global.fetch).toHaveBeenCalledTimes(1);
		});

		it("uses the legacy API URL when the artifact is not in the manifest", async () => {
			const clickSpy = jest
				.spyOn(HTMLAnchorElement.prototype, "click")
				.mockImplementation(() => {});
			(global.fetch as jest.Mock).mockImplementation((url: unknown) =>
				url === MANIFEST_URL
					? Promise.resolve(manifestWith({}))
					: Promise.resolve({
							ok: true,
							status: 200,
							headers: new Headers({
								"Content-Disposition":
									'attachment; filename="learning-calendar-578601.pdf"',
							}),
							blob: () =>
								Promise.resolve(
									new Blob(["%PDF"], { type: "application/pdf" }),
								),
						} as Response),
			);
			render(<LearningCalendar {...pdfProps} pdfManifestUrl={MANIFEST_URL} />);

			fireEvent.click(screen.getByRole("button", { name: /הורדת PDF/ }));

			await waitFor(() =>
				expect(screen.getByRole("status")).toHaveTextContent("החלה"),
			);
			expect(global.fetch).toHaveBeenCalledWith(
				expect.stringContaining("/api/calendar-pdf"),
			);
			expect((clickSpy.mock.contexts[0] as HTMLAnchorElement).href).toBe(
				"blob:mock",
			);
		});
	});
});
