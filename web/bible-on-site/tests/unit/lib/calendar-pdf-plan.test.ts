/**
 * @jest-environment node
 */
import type { CalendarDay } from "@/data/learning-schedule";
import {
	buildCalendarPdfInput,
	getCalendarArtifactBounds,
} from "@/lib/download/calendar-artifacts";
import {
	buildCalendarPdfManifest,
	CALENDAR_PDF_MANIFEST_OBJECT,
	CALENDAR_PDF_S3_PREFIX,
	type CalendarPdfCacheIndex,
	calendarArtifactInputSha,
	calendarPdfArchivedManifestObject,
	calendarPdfObjectKey,
	carriedExtraKeys,
	parseCalendarPdfCacheIndex,
	parseCalendarPdfManifest,
	planCalendarPdfGeneration,
	serializeCalendarPdfInput,
	sha256Bytes,
} from "@/lib/download/calendar-pdf-plan";

const FP = "f".repeat(64);

/** Test helper: unwrap a buildCalendarPdfInput result or fail loudly. */
function mustInput(key: string) {
	const input = buildCalendarPdfInput(key);
	if (input === null) {
		throw new Error(`expected ${key} to build`);
	}
	return input;
}

function fakeInput(
	overrides: Partial<Parameters<typeof serializeCalendarPdfInput>[0]> = {},
) {
	return {
		title: "t",
		months: [
			{
				title: "m",
				cells: [{ day: undefined, blankColumn: 2 }],
			},
		],
		dayLabel: () => "א",
		...overrides,
	} as Parameters<typeof serializeCalendarPdfInput>[0];
}

describe("object keys", () => {
	it("derives content-addressed keys under the shared prefix", () => {
		const sha = "ab".repeat(32);
		expect(calendarPdfObjectKey(sha)).toBe(
			`${CALENDAR_PDF_S3_PREFIX}/objects/${sha}.pdf`,
		);
		expect(CALENDAR_PDF_MANIFEST_OBJECT).toBe(
			`${CALENDAR_PDF_S3_PREFIX}/manifest.json`,
		);
		expect(calendarPdfArchivedManifestObject("fp", "ab".repeat(32))).toBe(
			`${CALENDAR_PDF_S3_PREFIX}/manifest-fp-abababababab.json`,
		);
	});
});

describe("serializeCalendarPdfInput", () => {
	it("serializes the drawn payload — titles, cells, labels, dimming", () => {
		const input = fakeInput({
			title: "כותרת",
			subtitle: "משנה",
			months: [
				{
					title: "m",
					cells: [{ blankColumn: 2 }, {}],
				},
			],
		});
		const json = serializeCalendarPdfInput(input);
		expect(JSON.parse(json)).toEqual({
			t: "כותרת",
			s: "משנה",
			m: [{ t: "m", c: [{ b: 2 }, { b: 0 }] }],
		});
	});

	it("captures dim/label outputs so data changes invalidate selectively", () => {
		const day = {
			dateNumber: 57850101,
			day: 5,
			dayOfWeek: 3,
			status: "study",
			perekId: 10,
			cycle: 4,
		} as CalendarDay;
		const base = fakeInput({
			months: [{ title: "m", cells: [{ day }] }],
		});
		const dimmed = fakeInput({
			months: [{ title: "m", cells: [{ day }] }],
			dimmed: () => true,
		});
		const relabeled = fakeInput({
			months: [{ title: "m", cells: [{ day }] }],
			dayLabel: () => "שונה",
		});
		expect(serializeCalendarPdfInput(base)).not.toBe(
			serializeCalendarPdfInput(dimmed),
		);
		expect(serializeCalendarPdfInput(base)).not.toBe(
			serializeCalendarPdfInput(relabeled),
		);
		expect(serializeCalendarPdfInput(base)).toBe(
			serializeCalendarPdfInput(
				fakeInput({
					months: [{ title: "m", cells: [{ day }] }],
				}),
			),
		);
	});

	it("drives a real month payload that changes with the schedule", () => {
		const a = serializeCalendarPdfInput(mustInput("month:578512"));
		const b = serializeCalendarPdfInput(mustInput("month:578511"));
		expect(a).not.toBe(b);
		// Same key → identical payload (deterministic input computation).
		expect(a).toBe(serializeCalendarPdfInput(mustInput("month:578512")));
	});
});

describe("calendarArtifactInputSha", () => {
	it("changes with the render fingerprint, key or payload", () => {
		const input = mustInput("month:578512");
		const sha = calendarArtifactInputSha(FP, "month:578512", input);
		expect(sha).toMatch(/^[a-f0-9]{64}$/);
		expect(calendarArtifactInputSha(FP, "month:578511", input)).not.toBe(sha);
		expect(
			calendarArtifactInputSha("e".repeat(64), "month:578512", input),
		).not.toBe(sha);
	});
});

describe("planCalendarPdfGeneration", () => {
	const artifact = (inputSha: string, sha = "a".repeat(64)) => ({
		inputSha,
		object: `generated/calendar-pdf/objects/${sha}.pdf`,
		sha256: sha,
		bytes: 10,
		filename: "f.pdf",
	});

	it("reuses fresh entries and regenerates missing or stale ones", () => {
		const cache: CalendarPdfCacheIndex = {
			version: 1,
			fingerprint: FP,
			artifacts: {
				"month:578512": artifact("keep"),
				"month:578511": artifact("stale"),
				"month:578510": artifact("evicted-input", "c".repeat(64)),
			},
		};
		const present = new Set(["a".repeat(64)]);
		const desired = new Map([
			["month:578512", "keep"],
			["month:578511", "new-sha"],
			["month:578510", "evicted-input"],
			["month:578509", "never-generated"],
		]);
		const plan = planCalendarPdfGeneration(desired, cache, (sha) =>
			present.has(sha),
		);
		// keep matches inputSha and its object exists → fresh.
		// stale: inputSha changed → regenerate.
		// evicted-input: inputSha matches but the object file was evicted → regenerate.
		// never-generated: no cache entry → regenerate.
		expect(plan.fresh).toEqual(["month:578512"]);
		expect(plan.regenerate).toEqual([
			"month:578511",
			"month:578510",
			"month:578509",
		]);
		expect(plan.reused["month:578512"].inputSha).toBe("keep");
	});

	it("treats an evicted object file as needing regeneration", () => {
		const cache: CalendarPdfCacheIndex = {
			version: 1,
			fingerprint: FP,
			artifacts: { "cycle:1": artifact("same", "d".repeat(64)) },
		};
		const desired = new Map([["cycle:1", "same"]]);
		const plan = planCalendarPdfGeneration(desired, cache, () => false);
		expect(plan.fresh).toEqual([]);
		expect(plan.regenerate).toEqual(["cycle:1"]);
	});

	it("handles a cold cache", () => {
		const desired = new Map([["month:578512", "x"]]);
		const plan = planCalendarPdfGeneration(desired, null, () => false);
		expect(plan.fresh).toEqual([]);
		expect(plan.regenerate).toEqual(["month:578512"]);
	});
});

describe("carriedExtraKeys", () => {
	const cacheWith = (...keys: string[]): CalendarPdfCacheIndex => ({
		version: 1,
		fingerprint: FP,
		artifacts: Object.fromEntries(
			keys.map((k) => [
				k,
				{
					inputSha: "i",
					object: "o",
					sha256: "s",
					bytes: 1,
					filename: "f",
				},
			]),
		),
	});

	it("carries only keys outside the bounded set", () => {
		const base = ["month:578512", "cycle:4"];
		const cache = cacheWith(
			"month:578512",
			"cycle:4",
			"cycle:99",
			"month:999912",
		);
		expect(carriedExtraKeys(base, cache)).toEqual(["cycle:99", "month:999912"]);
	});

	it("returns nothing for a cold or bounded-only cache", () => {
		expect(carriedExtraKeys(["cycle:1"], null)).toEqual([]);
		expect(carriedExtraKeys(["cycle:1"], cacheWith("cycle:1"))).toEqual([]);
	});
});

describe("parseCalendarPdfCacheIndex", () => {
	const valid: CalendarPdfCacheIndex = {
		version: 1,
		fingerprint: FP,
		artifacts: {
			"month:578512": {
				inputSha: "x",
				object: "o",
				sha256: "s",
				bytes: 1,
				filename: "f",
			},
		},
	};

	it("parses a valid index", () => {
		const parsed = parseCalendarPdfCacheIndex(JSON.stringify(valid));
		expect(parsed.ok).toBe(true);
		if (parsed.ok) {
			expect(parsed.index.fingerprint).toBe(FP);
		}
	});

	it("rejects corrupt indexes so callers fall back to cold generation", () => {
		for (const text of [
			"not json{",
			"null",
			"42",
			JSON.stringify({ ...valid, version: 2 }),
			JSON.stringify({ ...valid, artifacts: null }),
			JSON.stringify({ ...valid, artifacts: { k: { inputSha: 1 } } }),
		]) {
			expect(parseCalendarPdfCacheIndex(text).ok).toBe(false);
		}
	});
});

describe("parseCalendarPdfManifest", () => {
	const bounds = getCalendarArtifactBounds();
	const valid = buildCalendarPdfManifest({
		fingerprint: FP,
		bounds,
		generatedAt: "2026-01-01T00:00:00.000Z",
		artifacts: {
			"month:578512": {
				inputSha: "i",
				object: "o",
				sha256: "s",
				bytes: 3,
				filename: "f.pdf",
			},
		},
	});

	it("parses a manifest produced by buildCalendarPdfManifest", () => {
		// This is wire-format input, not an object key or content fingerprint.
		// nosemgrep
		const serialized = JSON.stringify(valid);
		const parsed = parseCalendarPdfManifest(serialized);
		expect(parsed).toEqual(valid);
		expect(parsed?.fingerprint).toBe(FP);
		expect(parsed?.artifacts["month:578512"].object).toBe(
			calendarPdfObjectKey("s"),
		);
	});

	it("rejects malformed manifests", () => {
		for (const text of [
			"nope",
			"{}",
			JSON.stringify({ ...valid, version: 99 }),
			JSON.stringify({ ...valid, artifacts: { k: { object: 1 } } }),
			JSON.stringify({ ...valid, bounds: null }),
		]) {
			expect(parseCalendarPdfManifest(text)).toBeNull();
		}
	});
});

describe("buildCalendarPdfManifest", () => {
	it("maps cache artifacts to published object references", () => {
		const manifest = buildCalendarPdfManifest({
			fingerprint: FP,
			bounds: getCalendarArtifactBounds(),
			generatedAt: "now",
			artifacts: {
				"cycle:4": {
					inputSha: "internal",
					object: "ignored",
					sha256: "ab".repeat(32),
					bytes: 42,
					filename: "learning-calendar-cycle-4.pdf",
				},
			},
		});
		expect(manifest.artifacts["cycle:4"]).toEqual({
			object: calendarPdfObjectKey("ab".repeat(32)),
			sha256: "ab".repeat(32),
			bytes: 42,
			filename: "learning-calendar-cycle-4.pdf",
		});
	});
});

describe("sha256Bytes", () => {
	it("hashes bytes deterministically", () => {
		const bytes = new Uint8Array([1, 2, 3]);
		expect(sha256Bytes(bytes)).toBe(sha256Bytes(bytes));
		expect(sha256Bytes(bytes)).not.toBe(sha256Bytes(new Uint8Array([4])));
	});
});
