/**
 * Unit tests for UnitTextBody — the resolver-injected scripture
 * renderer used by both flat unit pages and the parasha sefer book.
 * Ordered ranges decompose into per-perek slices; intentionally
 * repeated pesukim render text again without emitting a second anchor
 * id, and mid-pasuk range bounds clip at segment level.
 */
import { render, screen } from "@testing-library/react";
import {
	UnitTextBody,
	type UnitTextPerek,
} from "../../../../src/app/components/reading/UnitTextBody";
import type { Pasuk } from "../../../../src/data/db/tanah-view-types";
import type { ScriptureRange } from "../../../../src/lib/reading/contract";

const recordingTimeFrame = { from: "00:00:00", to: "00:00:00" };

// Word values are unique per segment so clipped segments are observable;
// pasuk numerals (א ב ג ...) also render, so plain letters cannot be used.
const pasuk = (...words: string[]): Pasuk => ({
	segments: words.map((value) => ({
		type: "qri" as const,
		value,
		recordingTimeFrame,
	})),
});

const perekOne: UnitTextPerek = {
	source: "בראשית א",
	pesukim: [
		pasuk("א1"),
		pasuk("א2"),
		pasuk("א3ראשון", "א3שני"),
		pasuk("א4"),
		pasuk("א5"),
	],
};

const perekTwo: UnitTextPerek = {
	source: "בראשית ב",
	pesukim: [pasuk("ב1ראשון", "ב1שני"), pasuk("ב2")],
};

const resolvePerek = (perekId: number): UnitTextPerek | undefined =>
	perekId === 1 ? perekOne : perekId === 2 ? perekTwo : undefined;

const pasukCount = (perekId: number) =>
	resolvePerek(perekId)?.pesukim.length ?? 0;

describe("UnitTextBody", () => {
	it("anchors each pasuk with canonical coordinates plus the scope suffix", () => {
		const ranges: ScriptureRange[] = [
			{ start: { perekId: 1, pasuk: 1 }, end: { perekId: 1, pasuk: 3 } },
		];
		const { container } = render(
			<UnitTextBody
				ranges={ranges}
				entityRefsByPerek={{}}
				pasukCount={pasukCount}
				resolvePerek={resolvePerek}
				anchorScope="haftara-x"
			/>,
		);
		expect(container.querySelector("#pasuk-1-1-haftara-x")).not.toBeNull();
		expect(container.querySelector("#pasuk-1-2-haftara-x")).not.toBeNull();
		expect(container.querySelector("#pasuk-1-3-haftara-x")).not.toBeNull();
	});

	it("renders a repeated pasuk's text again without a second anchor", () => {
		const ranges: ScriptureRange[] = [
			{ start: { perekId: 1, pasuk: 1 }, end: { perekId: 1, pasuk: 3 } },
			// Intentional repeat of pasuk 3 — happens in real Haftarah data.
			{ start: { perekId: 1, pasuk: 3 }, end: { perekId: 1, pasuk: 3 } },
		];
		const { container } = render(
			<UnitTextBody
				ranges={ranges}
				entityRefsByPerek={{}}
				pasukCount={pasukCount}
				resolvePerek={resolvePerek}
			/>,
		);
		// Only the first occurrence emits the anchor id.
		expect(container.querySelectorAll("#pasuk-1-3")).toHaveLength(1);
		expect(container.querySelectorAll('[id^="pasuk-"]')).toHaveLength(3);
		// The pasuk's segments render a second time, anchorless.
		expect(screen.getAllByText("א3ראשון")).toHaveLength(2);
		expect(screen.getAllByText("א3שני")).toHaveLength(2);
	});

	it("skips slices whose perek the resolver cannot supply", () => {
		const ranges: ScriptureRange[] = [
			{ start: { perekId: 9, pasuk: 1 }, end: { perekId: 9, pasuk: 2 } },
			{ start: { perekId: 1, pasuk: 4 }, end: { perekId: 1, pasuk: 5 } },
		];
		const { container } = render(
			<UnitTextBody
				ranges={ranges}
				entityRefsByPerek={{}}
				pasukCount={() => 5}
				resolvePerek={resolvePerek}
			/>,
		);
		expect(container.querySelector("#pasuk-1-4")).not.toBeNull();
		expect(container.querySelector("#pasuk-9-1")).toBeNull();
		expect(container.textContent).toContain("א4");
	});

	it("labels perek boundaries when a range spans perakim", () => {
		const ranges: ScriptureRange[] = [
			{ start: { perekId: 1, pasuk: 4 }, end: { perekId: 2, pasuk: 1 } },
		];
		render(
			<UnitTextBody
				ranges={ranges}
				entityRefsByPerek={{}}
				pasukCount={pasukCount}
				resolvePerek={resolvePerek}
			/>,
		);
		expect(screen.getByText("בראשית ב")).toBeTruthy();
	});

	it("clips mid-pasuk range bounds at segment level", () => {
		const ranges: ScriptureRange[] = [
			{
				start: { perekId: 1, pasuk: 3, segmentIndex: 1 },
				end: { perekId: 2, pasuk: 1, segmentIndex: 0 },
			},
		];
		render(
			<UnitTextBody
				ranges={ranges}
				entityRefsByPerek={{}}
				pasukCount={pasukCount}
				resolvePerek={resolvePerek}
			/>,
		);
		// Pasuk 1:3 starts mid-pasuk — only its second segment renders.
		expect(screen.queryByText("א3ראשון")).toBeNull();
		expect(screen.getByText("א3שני")).toBeTruthy();
		// Pasuk 2:1 ends mid-pasuk — only its first segment renders.
		expect(screen.getByText("ב1ראשון")).toBeTruthy();
		expect(screen.queryByText("ב1שני")).toBeNull();
	});
});
