import { describe, expect, it } from "vitest";
import {
	MAX_PLACE_OCCURRENCES,
	type PlaceProfileBase,
	type PlaceProfileChange,
	placeIdentificationCitations,
	placeProfileHasEffect,
	validatePlaceProfile,
	validatePlaceProfileBase,
} from "~/lib/tanahpedia/contribution-place-profile";

const placeId = "PLACE001-0000-0000-0000-000000000001";
const identificationId = "POINT001-0000-0000-0000-000000000001";
const anchor = {
	perekId: 51,
	pasukNumber: 11,
	segmentStart: 12,
	segmentEnd: 12,
	text: "פִּתֹ֖ם",
};
const entry = {
	title: "פיתום",
	uniqueName: "פיתום",
	displayName: "פיתום",
};
const identification = {
	modernName: "טאניס",
	latitude: 30.987654321,
	longitude: 31.876543219,
	basis: "commentary",
	citation: "תרגום ירושלמי שמות א יא",
	coordinateCitation: "מקור מדידה",
} satisfies NonNullable<PlaceProfileChange["identification"]>;

describe("place proposal validation", () => {
	it("normalizes the address and coordinates and preserves the exact pointed word and separate evidence", () => {
		const decomposedName = "Pithe\u0301m";
		expect(
			validatePlaceProfile({
				after: {
					entry: { ...entry, uniqueName: decomposedName },
					occurrences: [anchor],
					identification,
				},
			}),
		).toEqual({
			kind: "place_profile",
			targetId: undefined,
			after: {
				entry: { ...entry, uniqueName: "Pithém" },
				occurrences: [anchor],
				identification: {
					...identification,
					latitude: 30.98765432,
					longitude: 31.87654322,
				},
			},
		});
	});

	it("accepts a cited point without new words for an existing place", () => {
		const point = { ...identification, latitude: 0, longitude: 180 };
		expect(
			validatePlaceProfile({
				targetId: placeId,
				after: { entry: null, occurrences: [], identification: point },
			}),
		).toEqual({
			kind: "place_profile",
			targetId: placeId,
			after: { entry: null, occurrences: [], identification: point },
		});
	});

	it.each([
		{ badAnchor: { ...anchor, perekId: "51" }, field: "perekId" },
		{ badAnchor: { ...anchor, pasukNumber: 0 }, field: "pasukNumber" },
		{ badAnchor: { ...anchor, segmentStart: 0.5 }, field: "segmentStart" },
		{ badAnchor: { ...anchor, segmentEnd: 11 }, field: "segmentEnd" },
	])("rejects an invalid occurrence $field", ({ badAnchor, field }) => {
		expect(() =>
			validatePlaceProfile({ after: { entry, occurrences: [badAnchor] } }),
		).toThrow(`Invalid place occurrence ${field}`);
	});

	it("requires a bounded list of unique word anchors", () => {
		for (const occurrences of [
			null,
			Array.from({ length: MAX_PLACE_OCCURRENCES + 1 }, () => anchor),
		]) {
			expect(() =>
				validatePlaceProfile({ after: { entry, occurrences } }),
			).toThrow(`at most ${MAX_PLACE_OCCURRENCES} exact word occurrences`);
		}
		expect(() =>
			validatePlaceProfile({
				after: { entry, occurrences: [anchor, { ...anchor, text: "פתם" }] },
			}),
		).toThrow("Each word occurrence can only appear once");
	});

	it.each([
		{ latitude: "30", longitude: 31 },
		{ latitude: Number.POSITIVE_INFINITY, longitude: 31 },
		{ latitude: -90.1, longitude: 31 },
		{ latitude: 30, longitude: "31" },
		{ latitude: 30, longitude: Number.NaN },
		{ latitude: 30, longitude: 180.1 },
	])("rejects invalid coordinates $latitude, $longitude", (coordinates) => {
		expect(() =>
			validatePlaceProfile({
				after: {
					entry,
					occurrences: [],
					identification: { ...identification, ...coordinates },
				},
			}),
		).toThrow("valid latitude and longitude");
	});

	it("requires an explicit basis and both citations for an identification", () => {
		for (const [point, error] of [
			[{ ...identification, basis: "unknown" }, "explicit evidence basis"],
			[{ ...identification, coordinateCitation: "" }, "coordinate citation"],
		] as const) {
			expect(() =>
				validatePlaceProfile({
					after: { entry, occurrences: [anchor], identification: point },
				}),
			).toThrow(error);
		}
	});

	it("requires a destination with a safe address and a change to review", () => {
		expect(() =>
			validatePlaceProfile({ after: { entry: null, occurrences: [anchor] } }),
		).toThrow("Choose an existing place or propose a new entry");
		expect(() =>
			validatePlaceProfile({
				after: {
					entry: { ...entry, uniqueName: "פיתום/טאניס" },
					occurrences: [anchor],
				},
			}),
		).toThrow("uniqueName must be a plain path segment");
		const empty = {
			targetId: placeId,
			after: { entry: null, occurrences: [] },
		};
		expect(() => validatePlaceProfile(empty)).toThrow(
			"A place profile requires an occurrence or an identification",
		);
		expect(validatePlaceProfile(empty, true).after).toEqual({
			entry: null,
			occurrences: [],
			identification: null,
		});
	});
});

describe("existing place profile comparisons", () => {
	it("accepts a saved destination, canonical occurrence, and cited identification", () => {
		const base = {
			entryAddresses: ["פיתום"],
			occurrences: [anchor],
			identification: {
				id: identificationId,
				citations: ["  מקור לזיהוי  ", "מפת מדידה"],
			},
		};
		expect(validatePlaceProfileBase(base)).toEqual({
			...base,
			identification: {
				id: identificationId,
				citations: ["מקור לזיהוי", "מפת מדידה"],
			},
		});
		expect(
			validatePlaceProfileBase({ ...base, identification: null })
				.identification,
		).toBeNull();
	});

	it.each([
		{
			fields: { entryAddresses: "פיתום" },
			error: "Invalid place entry addresses",
		},
		{
			fields: { entryAddresses: ["פיתום", ""] },
			error: "Invalid place entry addresses",
		},
		{
			fields: { entryAddresses: [51] },
			error: "Invalid place entry addresses",
		},
		{
			fields: { identification: { id: identificationId, citations: "מקור" } },
			error: "Invalid place identification citations",
		},
		{
			fields: {
				identification: { id: identificationId, citations: ["א", "ב", "ג"] },
			},
			error: "Invalid place identification citations",
		},
	])(
		"rejects an unreadable saved destination with $error",
		({ fields, error }) => {
			expect(() =>
				validatePlaceProfileBase({
					entryAddresses: ["פיתום"],
					identification: null,
					occurrences: [anchor],
					...fields,
				}),
			).toThrow(error);
		},
	);

	it("detects adding evidence to a saved point and handles maps serving both evidence roles", () => {
		const base: PlaceProfileBase = {
			entryAddresses: ["פיתום"],
			occurrences: [anchor],
			identification: {
				id: identificationId,
				citations: [identification.citation],
			},
		};
		const after: PlaceProfileChange = {
			entry: null,
			occurrences: [anchor],
			identification,
		};
		const bothRoles = {
			...identification,
			coordinateCitation: identification.citation,
		};
		expect(placeIdentificationCitations(bothRoles)).toEqual([
			identification.citation,
		]);
		expect(placeProfileHasEffect(base, after)).toBe(true);
		expect(
			placeProfileHasEffect(base, { ...after, identification: bothRoles }),
		).toBe(false);
		expect(
			placeProfileHasEffect({ ...base, identification: null }, after),
		).toBe(true);
		expect(
			placeProfileHasEffect(base, { ...after, identification: null }),
		).toBe(false);
		expect(placeProfileHasEffect({ ...base, occurrences: [] }, after)).toBe(
			true,
		);
		expect(placeProfileHasEffect(null, after)).toBe(true);
	});
});
