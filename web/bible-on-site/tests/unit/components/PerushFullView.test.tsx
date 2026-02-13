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
	noteContent: "noteContent",
}));

jest.mock("@/app/929/[number]/components/sefer.module.css", () => ({
	perushFullViewInBook: "perushFullViewInBook",
	perushNotesInBook: "perushNotesInBook",
}));

import { fireEvent, render, screen } from "@testing-library/react";
import { PerushFullView } from "../../../src/app/929/[number]/components/PerushFullView";

const samplePerush = {
	id: 1,
	name: "רש״י",
	parshanName: "רש״י",
	notes: [
		{ pasuk: 1, noteIdx: 0, noteContent: "<p>note 1</p>" },
		{ pasuk: 2, noteIdx: 0, noteContent: "<p>note 2</p>" },
	],
};

describe("PerushFullView", () => {
	it("renders perush name and parshan name", () => {
		render(<PerushFullView perush={samplePerush} onBack={jest.fn()} />);
		expect(screen.getAllByText("רש״י").length).toBeGreaterThanOrEqual(1);
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

	it("shows parshanBirthYear when present", () => {
		const perush = { ...samplePerush, parshanBirthYear: 1040 };
		const { container } = render(
			<PerushFullView perush={perush} onBack={jest.fn()} />,
		);
		expect(container.innerHTML).toContain("1040");
	});

	it("groups notes by pasuk", () => {
		render(<PerushFullView perush={samplePerush} onBack={jest.fn()} />);
		// Hebrew letters for pasuk 1 and 2
		expect(screen.getByText(/פסוק א/)).toBeTruthy();
		expect(screen.getByText(/פסוק ב/)).toBeTruthy();
	});
});
