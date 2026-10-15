/**
 * @jest-environment jsdom
 *
 * Book blank-page perush view (issue #2191): notes group by their full
 * {perekId, pasuk} identity, canonical perek labels lead each perek's
 * first group inside a multi-perek unit, and pasuk labels scroll the
 * *facing* unit text page via the bookKey-scoped navigation — never a
 * global anchor jump.
 */

jest.mock("isomorphic-dompurify", () => ({
	__esModule: true,
	default: { sanitize: (html: string) => html },
}));

jest.mock("@/app/929/[number]/components/perushim-section.module.css", () => ({
	perushimSection: "perushimSection",
	fullViewHeader: "fullViewHeader",
	backButton: "backButton",
	fullViewTitle: "fullViewTitle",
	sectionTitle: "sectionTitle",
	parshanSubtitle: "parshanSubtitle",
	notesContainer: "notesContainer",
	pasukGroup: "pasukGroup",
	pasukLabel: "pasukLabel",
	pasukLink: "pasukLink",
	noteContent: "noteContent",
}));

jest.mock("@/app/929/[number]/components/sefer.module.css", () => ({
	perushFullViewInBook: "perushFullViewInBook",
	perushNotesInBook: "perushNotesInBook",
}));

jest.mock("@/app/components/reading/unit-book.module.css", () => ({
	perekContext: "perekContext",
	pasukButton: "pasukButton",
}));

import { fireEvent, render, screen } from "@testing-library/react";
import { UnitPerushFullView } from "../../../src/app/components/reading/UnitPerushFullView";
import type { RangedPerushNote } from "../../../src/lib/perushim";

const BOOK_KEY = "8:torah";

function note(perekId: number, pasuk: number, noteIdx = 0): RangedPerushNote {
	return {
		perekId,
		pasuk,
		noteIdx,
		// nosemgrep -- numeric-only fixture values, no user input
		noteContent: `<p>note ${perekId}-${pasuk}-${noteIdx}</p>`,
	};
}

function renderView(notes: RangedPerushNote[], extra = {}) {
	return render(
		<UnitPerushFullView
			name={'רש"י'}
			parshanName={'רש"י הקדוש'}
			notes={notes}
			onBack={jest.fn()}
			bookKey={BOOK_KEY}
			perekSources={{ 1: "בראשית א", 2: "בראשית ב" }}
			{...extra}
		/>,
	);
}

describe("UnitPerushFullView", () => {
	it("renders the perush names and calls onBack", () => {
		const onBack = jest.fn();
		renderView([note(1, 1)], { onBack });
		expect(screen.getByText('רש"י הקדוש')).toBeInTheDocument();
		fireEvent.click(screen.getByText(/חזרה לפרשנים/));
		expect(onBack).toHaveBeenCalled();
	});

	it("marks the panel with its bookKey for facing-page navigation", () => {
		const { container } = renderView([note(1, 1)]);
		expect(
			container.querySelector('[data-sefer-unit-perush="8:torah"]'),
		).toBeInTheDocument();
		expect(container.querySelector("[data-flipbook-no-flip]")).not.toBeNull();
	});

	it("renders a share button only when a share path is provided", () => {
		const view = renderView([note(1, 1)]);
		expect(screen.queryByLabelText("שיתוף")).toBeNull();
		view.unmount();

		renderView([note(1, 1)], { sharePath: "/מסורה/8?book=&perush=x" });
		expect(screen.getByLabelText("שיתוף")).toHaveAttribute(
			"href",
			"/מסורה/8?book=&perush=x",
		);
	});

	it("shows the empty message when the perush has no notes in bounds", () => {
		renderView([], { emptyMessage: "אין פירושים כאן" });
		expect(screen.getByText("אין פירושים כאן")).toBeInTheDocument();
	});

	it("merges consecutive notes of the same pasuk into one group", () => {
		const { container } = renderView([
			note(1, 5, 0),
			note(1, 5, 1),
			note(1, 6, 0),
		]);
		expect(container.querySelectorAll("[data-unit-perush-pasuk]")).toHaveLength(
			2,
		);
		expect(
			container.querySelector('[data-unit-perush-pasuk="1-5"]')?.children
				.length,
		).toBe(3); // pasuk button + two note divs
	});

	it("keeps identical pasuk numbers in different perakim in separate groups", () => {
		const { container } = renderView([note(1, 1), note(2, 1), note(2, 2)]);
		expect(
			container.querySelector('[data-unit-perush-pasuk="1-1"]'),
		).toBeInTheDocument();
		expect(
			container.querySelector('[data-unit-perush-pasuk="2-1"]'),
		).toBeInTheDocument();
		expect(container.querySelectorAll("[data-unit-perush-pasuk]")).toHaveLength(
			3,
		);
	});

	it("emits a canonical perek label before each perek's first group", () => {
		renderView([note(1, 1), note(2, 1), note(1, 3)]);
		const labels = screen.getAllByText(/בראשית [אב]/);
		// Perek 1 leads (first group), perek 2 leads its first group, and
		// perek 1 leads again when the notes return to it.
		expect(labels).toHaveLength(3);
	});

	it("hides perek labels for a single-perek unit", () => {
		renderView([note(1, 1), note(1, 2)]);
		expect(screen.queryByText(/בראשית/)).toBeNull();
	});

	it("hides a perek label when no source exists for that perek", () => {
		renderView([note(1, 1), note(2, 1)], {
			perekSources: { 1: "בראשית א" },
		});
		expect(screen.getByText("בראשית א")).toBeInTheDocument();
		expect(screen.queryByText("בראשית ב")).toBeNull();
	});

	it("scrolls the facing unit text to the clicked pasuk", () => {
		const scrollIntoView = jest.fn();
		Element.prototype.scrollIntoView = scrollIntoView;
		document.body.insertAdjacentHTML(
			"beforeend",
			`<div data-sefer-unit-text="8:torah">
				<span id="pasuk-1-2">v2</span>
			</div>
			<div data-sefer-unit-text="8:haftara">
				<span id="pasuk-1-2">other pane</span>
			</div>`,
		);
		try {
			renderView([note(1, 2)]);
			fireEvent.click(
				screen.getByRole("button", { name: "מעבר לפסוק ב בפרשה" }),
			);
			const verse = document.querySelector(
				'[data-sefer-unit-text="8:torah"] [id="pasuk-1-2"]',
			) as Element;
			expect(scrollIntoView.mock.contexts[0]).toBe(verse);
			expect(verse).toHaveAttribute("data-pasuk-highlight", "");
			expect(
				document.querySelector(
					'[data-sefer-unit-text="8:haftara"] [id="pasuk-1-2"]',
				),
			).not.toHaveAttribute("data-pasuk-highlight");
		} finally {
			for (const el of document.querySelectorAll("[data-sefer-unit-text]")) {
				el.remove();
			}
		}
	});

	it("renders sanitized note HTML", () => {
		renderView([{ ...note(1, 1), noteContent: "<b>bold</b>" }]);
		expect(document.querySelector("b")?.textContent).toBe("bold");
	});
});
