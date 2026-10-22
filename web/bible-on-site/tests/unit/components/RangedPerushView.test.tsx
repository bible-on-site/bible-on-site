/**
 * @jest-environment jsdom
 *
 * RangedPerushView renders commentary bounded to a reading unit's
 * canonical verse bounds (issue #2190): notes group by their complete
 * {perekId, pasuk} identity, pasuk labels hash-link to the unit text's
 * canonical anchors, and perek labels carry the same source mapping
 * the scripture applies on perek boundaries.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { RangedPerushView } from "../../../src/app/components/reading/RangedPerushView";
import type { RangedPerushNote } from "../../../src/lib/perushim";

function note(perekId: number, pasuk: number, content: string, idx = 0) {
	return { perekId, pasuk, noteIdx: idx, noteContent: content };
}

const crossPerekNotes: RangedPerushNote[] = [
	note(2, 4, "<p>note-2-4</p>"),
	note(3, 4, "<p>note-3-4-a</p>"),
	note(3, 4, "<p>note-3-4-b</p>", 1),
	note(3, 15, "<p>note-3-15</p>"),
];

const perekSources = { 2: "בראשית ב", 3: "בראשית ג" };

describe("RangedPerushView", () => {
	it("groups notes by complete {perekId, pasuk} identity", () => {
		render(
			<RangedPerushView
				name='רש"י'
				parshanName='רש"י'
				notes={crossPerekNotes}
				onBack={jest.fn()}
			/>,
		);
		const groups = document.querySelectorAll("[data-perush-perek]");
		expect(groups).toHaveLength(3);
		// Equal pasuk numbers in different perakim stay distinct groups.
		expect(groups[0]).toHaveAttribute("data-perush-perek", "2");
		expect(groups[0]).toHaveAttribute("data-perush-pasuk", "4");
		expect(groups[1]).toHaveAttribute("data-perush-perek", "3");
		expect(groups[1]).toHaveAttribute("data-perush-pasuk", "4");
		expect(groups[2]).toHaveAttribute("data-perush-pasuk", "15");
	});

	it("keeps every note of a pasuk inside its single group", () => {
		render(
			<RangedPerushView
				name='רש"י'
				parshanName='רש"י'
				notes={crossPerekNotes}
				onBack={jest.fn()}
			/>,
		);
		const second = document.querySelectorAll("[data-perush-perek]")[1];
		expect(second.textContent).toContain("note-3-4-a");
		expect(second.textContent).toContain("note-3-4-b");
	});

	it("links pasuk labels to the canonical unit-text anchors", () => {
		render(
			<RangedPerushView
				name='רש"י'
				parshanName='רש"י'
				notes={crossPerekNotes}
				onBack={jest.fn()}
			/>,
		);
		const hrefs = [...document.querySelectorAll("a")].map((a) =>
			a.getAttribute("href"),
		);
		expect(hrefs).toContain("#pasuk-2-4");
		expect(hrefs).toContain("#pasuk-3-4");
		expect(hrefs).toContain("#pasuk-3-15");
	});

	it("emits canonical perek labels on perek boundaries when mapped", () => {
		render(
			<RangedPerushView
				name='רש"י'
				parshanName='רש"י'
				notes={crossPerekNotes}
				onBack={jest.fn()}
				perekSources={perekSources}
			/>,
		);
		expect(screen.getByText("בראשית ב")).toBeInTheDocument();
		expect(screen.getByText("בראשית ג")).toBeInTheDocument();
	});

	it("omits perek labels for a single-perek commentary", () => {
		render(
			<RangedPerushView
				name='רש"י'
				parshanName='רש"י'
				notes={[note(2, 4, "<p>a</p>"), note(2, 7, "<p>b</p>")]}
				onBack={jest.fn()}
				perekSources={perekSources}
			/>,
		);
		expect(screen.queryByText("בראשית ב")).toBeNull();
	});

	it("calls onBack from the back button", () => {
		const onBack = jest.fn();
		render(
			<RangedPerushView
				name='רש"י'
				parshanName='רש"י'
				notes={crossPerekNotes}
				onBack={onBack}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: /חזרה לפרשנים/ }));
		expect(onBack).toHaveBeenCalled();
	});

	it("renders the share link at the canonical /929 perush path", () => {
		render(
			<RangedPerushView
				name='רש"י'
				parshanName='רש"י'
				notes={crossPerekNotes}
				onBack={jest.fn()}
				sharePath={`/929/2/${encodeURIComponent('רש"י')}`}
			/>,
		);
		expect(
			screen.getByRole("link", { name: "שיתוף" }),
		).toHaveAttribute("href", `/929/2/${encodeURIComponent('רש"י')}`);
	});

	it("shows the empty message when no notes fall inside the bounds", () => {
		render(
			<RangedPerushView
				name='רש"י'
				parshanName='רש"י'
				notes={[]}
				onBack={jest.fn()}
				emptyMessage="אין פרשנות לפרשה זו"
			/>,
		);
		expect(screen.getByText("אין פרשנות לפרשה זו")).toBeInTheDocument();
	});
});
