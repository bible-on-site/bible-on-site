/**
 * @jest-environment jsdom
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
	shareButton: "shareButton",
}));

jest.mock("@/app/929/[number]/components/sefer.module.css", () => ({
	perushFullViewInBook: "perushFullViewInBook",
	perushNotesInBook: "perushNotesInBook",
}));

import { fireEvent, render, screen } from "@testing-library/react";
import { PerushFullView } from "../../../src/app/929/[number]/components/PerushFullView";

const samplePerush = {
	id: 1,
	name: 'רש"י',
	parshanName: 'רש"י',
	notes: [
		{ pasuk: 1, noteIdx: 0, noteContent: "<p>note 1</p>" },
		{ pasuk: 2, noteIdx: 0, noteContent: "<p>note 2</p>" },
	],
};

describe("PerushFullView", () => {
	it("renders perush name and parshan name", () => {
		render(<PerushFullView perush={samplePerush} onBack={jest.fn()} />);
		expect(screen.getAllByText('רש"י').length).toBeGreaterThanOrEqual(1);
	});

	it("demotes h1 headings inside note content (#2393)", () => {
		const { container } = render(
			<PerushFullView
				perush={{
					...samplePerush,
					notes: [{ pasuk: 1, noteIdx: 0, noteContent: "<h1>כותרת</h1>" }],
				}}
				onBack={jest.fn()}
			/>,
		);
		expect(container.querySelector("h1")).toBeNull();
		expect(screen.getByRole("heading", { level: 2, name: "כותרת" })).toBeTruthy();
	});

	it("renders back button that calls onBack", () => {
		const onBack = jest.fn();
		render(<PerushFullView perush={samplePerush} onBack={onBack} />);
		fireEvent.click(screen.getByText(/חזרה לפרשנים/));
		expect(onBack).toHaveBeenCalled();
	});

	it("applies fullPage CSS classes when fullPage is true", () => {
		const { container } = render(
			<PerushFullView perush={samplePerush} onBack={jest.fn()} fullPage />,
		);
		expect(container.innerHTML).toContain("perushFullViewInBook");
		expect(container.innerHTML).toContain("perushNotesInBook");
	});

	it("does NOT apply fullPage CSS classes when fullPage is false", () => {
		const { container } = render(
			<PerushFullView perush={samplePerush} onBack={jest.fn()} />,
		);
		expect(container.innerHTML).not.toContain("perushFullViewInBook");
		expect(container.innerHTML).not.toContain("perushNotesInBook");
	});

	it("does not show parshanBirthYear in display", () => {
		const perush = { ...samplePerush, parshanBirthYear: 1040 };
		const { container } = render(
			<PerushFullView perush={perush} onBack={jest.fn()} />,
		);
		expect(container.innerHTML).not.toContain("1040");
	});

	it("groups notes by pasuk", () => {
		render(<PerushFullView perush={samplePerush} onBack={jest.fn()} />);
		// Hebrew letters for pasuk 1 and 2
		expect(screen.getByText(/פסוק א/)).toBeTruthy();
		expect(screen.getByText(/פסוק ב/)).toBeTruthy();
	});

	it("renders share button when perekId is provided", () => {
		render(
			<PerushFullView perush={samplePerush} onBack={jest.fn()} perekId={5} />,
		);
		const shareLink = screen.getByLabelText("שיתוף");
		expect(shareLink).toBeTruthy();
		expect(shareLink.getAttribute("href")).toBe(
			`/929/5/${encodeURIComponent('רש"י')}`,
		);
	});

	it("does not render share button when perekId is not provided", () => {
		render(<PerushFullView perush={samplePerush} onBack={jest.fn()} />);
		expect(screen.queryByLabelText("שיתוף")).toBeNull();
	});

	it("marks the panel and pasuk groups for sefer pasuk navigation", () => {
		const { container } = render(
			<PerushFullView perush={samplePerush} onBack={jest.fn()} perekId={5} />,
		);
		expect(
			container.querySelector('[data-sefer-perush-perek="5"]'),
		).toHaveAttribute("data-sefer-perush", 'רש"י');
		expect(
			container.querySelectorAll("[data-perush-pasuk]"),
		).toHaveLength(2);
		expect(container.querySelector('[data-perush-pasuk="1"]')).not.toBeNull();
	});

	it("jumps to the matching sefer pasuk when a pasuk label is clicked", () => {
		const scrollIntoView = jest.fn();
		Element.prototype.scrollIntoView = scrollIntoView;
		document.body.insertAdjacentHTML(
			"beforeend",
			`<div data-sefer-perek="5">
				<span data-sefer-pasuk="1">v1</span>
				<span data-sefer-pasuk="2">v2</span>
			</div>
			<div data-sefer-perek="6">
				<span data-sefer-pasuk="2">other-perek v2</span>
			</div>`,
		);
		try {
			render(
				<PerushFullView
					perush={samplePerush}
					onBack={jest.fn()}
					perekId={5}
				/>,
			);
			const verse = document.querySelector(
				'[data-sefer-perek="5"] [data-sefer-pasuk="2"]',
			) as Element;
			fireEvent.click(
				screen.getByRole("button", { name: "מעבר לפסוק ב בפרק" }),
			);
			expect(scrollIntoView.mock.contexts[0]).toBe(verse);
			expect(verse).toHaveAttribute("data-pasuk-highlight", "");
			expect(verse).toHaveAttribute("aria-current", "location");
			// Identical pasuk number in another perek stays untouched.
			expect(
				document.querySelector(
					'[data-sefer-perek="6"] [data-sefer-pasuk="2"]',
				),
			).not.toHaveAttribute("data-pasuk-highlight");
		} finally {
			for (const el of document.querySelectorAll("[data-sefer-perek]")) {
				el.remove();
			}
		}
	});

	it("renders plain pasuk labels without perek navigation when perekId is missing", () => {
		render(<PerushFullView perush={samplePerush} onBack={jest.fn()} />);
		expect(screen.getByText(/פסוק א/)).toBeTruthy();
		expect(
			screen.queryByRole("button", { name: /מעבר לפסוק/ }),
		).toBeNull();
	});
});
