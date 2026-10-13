import { describe, expect, it } from "vitest";
import {
	coverageFieldsForSave,
	coveringSourceKey,
	duplicateCoveringSourceKeys,
	perekSourceLabel,
	sortCoveringSources,
	summarizeCoverage,
} from "~/lib/covering-sources";
import type { CoveringSource } from "~/server/covering-sources";
import type { Perek } from "~/server/perakim";

const perek = (overrides: Partial<Perek>): Perek => ({
	id: 1,
	perek_id: 1,
	sefer_id: 1,
	sefer_name: "בראשית",
	perek: 1,
	perek_in_context: 1,
	additional_letter: null,
	pasuk_count: 31,
	...overrides,
});

describe("perekSourceLabel", () => {
	it("renders sefer name plus the perek-in-context label", () => {
		expect(perekSourceLabel(perek({}))).toBe("בראשית א");
		expect(perekSourceLabel(perek({ perek_in_context: 10 }))).toBe("בראשית י");
	});

	it("renders additionals inside the sefer label", () => {
		expect(
			perekSourceLabel(
				perek({
					sefer_name: "שמואל",
					additional_letter: "ב",
					perek_in_context: 5,
				}),
			),
		).toBe("שמואל ב ה");
	});

	it("falls back to the bare label when the sefer name is missing", () => {
		expect(perekSourceLabel(perek({ sefer_name: null }))).toBe("א");
	});

	it("falls back to the absolute perek number when context is missing", () => {
		expect(
			perekSourceLabel(
				perek({ sefer_name: null, perek_in_context: null, perek: 2 }),
			),
		).toBe("ב");
	});

	it("falls back to zero when both perek numbers are missing", () => {
		expect(
			perekSourceLabel(
				perek({ sefer_name: null, perek_in_context: null, perek: null }),
			),
		).toBe("");
	});
});

describe("sortCoveringSources", () => {
	it("orders by perek id then pasuk without mutating the input", () => {
		const rows: CoveringSource[] = [
			{ perek_id: 3, pasuk: 1 },
			{ perek_id: 1, pasuk: 9 },
			{ perek_id: 1, pasuk: 2 },
		];

		const sorted = sortCoveringSources(rows);

		expect(sorted).toEqual([
			{ perek_id: 1, pasuk: 2 },
			{ perek_id: 1, pasuk: 9 },
			{ perek_id: 3, pasuk: 1 },
		]);
		expect(rows[0]).toEqual({ perek_id: 3, pasuk: 1 });
	});
});

describe("summarizeCoverage", () => {
	it("counts total pesukim and distinct perakim", () => {
		expect(
			summarizeCoverage([
				{ perek_id: 1, pasuk: 5 },
				{ perek_id: 1, pasuk: 7 },
				{ perek_id: 2, pasuk: 1 },
			]),
		).toEqual({ perekCount: 2, pasukCount: 3 });
		expect(summarizeCoverage([])).toEqual({ perekCount: 0, pasukCount: 0 });
	});
});

describe("duplicateCoveringSourceKeys", () => {
	it("flags only the repeated coordinates", () => {
		const duplicates = duplicateCoveringSourceKeys([
			{ perek_id: 1, pasuk: 5 },
			{ perek_id: 1, pasuk: 7 },
			{ perek_id: 1, pasuk: 5 },
		]);

		expect(duplicates).toEqual(
			new Set([coveringSourceKey({ perek_id: 1, pasuk: 5 })]),
		);
	});

	it("treats equal pasuk numbers in different perakim as distinct", () => {
		expect(
			duplicateCoveringSourceKeys([
				{ perek_id: 1, pasuk: 5 },
				{ perek_id: 2, pasuk: 5 },
			]).size,
		).toBe(0);
	});
});

describe("coverageFieldsForSave", () => {
	it("omits both fields when the schema did not report covering sources", () => {
		expect(coverageFieldsForSave(undefined, true)).toEqual({});
	});

	it("passes the explicit set and flag through when coverage is editable", () => {
		const sources = [{ perek_id: 1, pasuk: 5 }];
		expect(coverageFieldsForSave(sources, true)).toEqual({
			coveringSources: sources,
			coverageVerified: true,
		});
		expect(coverageFieldsForSave([], false)).toEqual({
			coveringSources: [],
			coverageVerified: false,
		});
	});

	it("sends the set in canonical coordinate order", () => {
		expect(
			coverageFieldsForSave(
				[
					{ perek_id: 2, pasuk: 1 },
					{ perek_id: 1, pasuk: 9 },
					{ perek_id: 1, pasuk: 5 },
				],
				false,
			).coveringSources,
		).toEqual([
			{ perek_id: 1, pasuk: 5 },
			{ perek_id: 1, pasuk: 9 },
			{ perek_id: 2, pasuk: 1 },
		]);
	});
});
