/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useRouter, useSearchParams } from "next/navigation";

jest.mock("next/navigation", () => ({
	useRouter: jest.fn(),
	useSearchParams: jest.fn(),
}));

// The day grid is the suite's heaviest render — a full-cycle mount builds
// ~1500 day cells (~700 ms per mount on a loaded machine, which pushed this
// describe past jest's 5 s timeout under full-suite contention, #2765) — and
// nothing the download action does reads it. Empty months keep the toolbar,
// pickers, cycle resolution and the action itself fully wired while the
// mount drops to the cost of a monthly view.
jest.mock("@/data/learning-calendar-policy", () => ({
	...jest.requireActual("@/data/learning-calendar-policy"),
	buildVisibleCalendarMonth: () => [],
}));

import { LearningCalendar } from "@/app/calendar/components/LearningCalendar";
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

describe("LearningCalendar", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		(useRouter as jest.Mock).mockReturnValue({
			replace: mockReplace,
			push: mockPush,
		});
		setSearchParam(null);
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

		// The full-cycle view renders thousands of day buttons; a role query
		// computes every one's accessible name, so the full-cycle tests address
		// the action directly.
		function pdfButton(container: HTMLElement): Element {
			return q(container, '[aria-label^="הורדת PDF"]');
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
			const { container } = render(<LearningCalendar {...pdfProps} />);

			expect(pdfButton(container)).toHaveAccessibleName(/הורדת PDF: מחזור ד'/);
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
			const { container } = render(
				<LearningCalendar {...pdfProps} pdfManifestUrl={MANIFEST_URL} />,
			);

			fireEvent.click(pdfButton(container));

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
