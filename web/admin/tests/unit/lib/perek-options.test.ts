import { describe, expect, it } from "vitest";
import {
	buildPerekOptions,
	filterPerekOptions,
	PEREK_OPTION_LIMIT,
} from "~/lib/perek-options";
import type { Perek } from "~/server/perakim";

const perek = (patch: Partial<Perek> = {}): Perek => ({
	id: 1,
	perek_id: 1,
	sefer_id: 1,
	sefer_name: "בראשית",
	perek_in_context: 1,
	perek: 1,
	additional_letter: null,
	pasuk_count: null,
	...patch,
});

describe("buildPerekOptions", () => {
	it("builds the sefer/label haystack for every numbered perek", () => {
		const options = buildPerekOptions([
			perek(),
			perek({
				perek_id: 300,
				sefer_name: "מלכים",
				perek_in_context: 1,
				additional_letter: "ב",
			}),
			perek({ id: 2, perek_id: null }),
		]);
		expect(options).toHaveLength(2);
		expect(options[1]).toEqual({
			perekId: 300,
			seferName: "מלכים",
			label: "ב א",
			text: "מלכים ב א",
		});
	});

	it("falls back to the raw perek number and a generic sefer name", () => {
		const [option] = buildPerekOptions([
			perek({
				perek_id: 40,
				sefer_name: null,
				perek_in_context: null,
				perek: 40,
			}),
		]);
		expect(option.seferName).toBe("אחר");
		expect(option.label).toBe("מ");
	});
});

describe("filterPerekOptions", () => {
	const options = buildPerekOptions([
		perek(),
		perek({ perek_id: 2, perek_in_context: 2, perek: 2 }),
		perek({ perek_id: 300, sefer_name: "מלכים", additional_letter: "א" }),
	]);

	it("returns the leading options for an empty query", () => {
		expect(filterPerekOptions(options, "")).toEqual(options);
		expect(filterPerekOptions(options, "   ")).toEqual(options);
	});

	it("matches Hebrew substrings across sefer and label", () => {
		expect(
			filterPerekOptions(options, "מלכים").map((option) => option.perekId),
		).toEqual([300]);
		expect(
			filterPerekOptions(options, "בראשית ב").map(
				(option) => option.perekId,
			),
		).toEqual([2]);
	});

	it("matches digit queries against the canonical perek number", () => {
		expect(filterPerekOptions(options, "300")).toEqual([options[2]]);
		expect(filterPerekOptions(options, "30")).toEqual([]);
	});

	it("caps the result list", () => {
		const many = Array.from({ length: 80 }, (_, i) => ({
			perekId: i + 1,
			seferName: "ספר",
			label: "א",
			text: "ספר א",
		}));
		expect(filterPerekOptions(many, "ספר")).toHaveLength(PEREK_OPTION_LIMIT);
		expect(filterPerekOptions(many, "ספר", 5)).toHaveLength(5);
	});
});
