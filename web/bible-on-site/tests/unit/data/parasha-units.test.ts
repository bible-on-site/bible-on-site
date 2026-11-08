/**
 * Unit tests for the פרשה על הפרק (weekly Torah parasha) reading-unit
 * provider. Runs against the canonical corpus: the source table
 * (parasha-division.json) resolves to canonical perekId/pasuk
 * coordinates at module load, so these assertions pin real boundaries
 * plus the Haftarah variant data — ordered multi-range readings,
 * cross-sefer jumps, source-table corrections, and intentional
 * repeated pesukim.
 */
import { sefarim } from "../../../src/data/db/sefarim";
import { getPerekByPerekId } from "../../../src/data/perek-dto";
import {
	getAdjacentParashaUnits,
	getAllParashaUnits,
	getParashaEntry,
	getParashaFirstUnitBySefer,
	getParashaOccasions,
	getParashaUnitById,
	getParashaUnitContaining,
	getParashaUnitCount,
	getParashaUnitsForSefer,
	PARASHA_CUSTOM_LABELS,
	PARASHA_DIVISION,
	PARASHA_GENERAL_NOTES,
	PARASHA_JOINED_NOTE,
	PARASHA_JOINED_PAIRS,
	parashaAuxiliaryRanges,
	parashaRefSpan,
	rangesRefSpans,
} from "../../../src/data/parasha/parasha-units";
import { READING_CONTRACT_VERSION } from "../../../src/lib/reading/contract";
import type { ScriptureCoordinate } from "../../../src/lib/reading/contract";
import { compareCoordinates } from "../../../src/lib/reading/ranges";

/** Canonical perekId of a printed perek inside a sefer (optionally an
 * additional such as מלכים ב). */
function perekIdOf(seferName: string, perek: number, additional?: string) {
	const sefer = sefarim.find((s) => s.name === seferName);
	if (!sefer) throw new Error(`missing sefer ${seferName}`);
	const part =
		additional === undefined
			? sefer
			: "additionals" in sefer
				? sefer.additionals.find((a) => a.letter === additional)
				: undefined;
	if (!part || !("perekFrom" in part)) {
		throw new Error(`missing part ${seferName} ${additional ?? ""}`);
	}
	return part.perekFrom + perek - 1;
}

/** The canonical pasuk coordinate right after a coordinate, or null at
 * the Torah corpus edge. */
function nextPasuk(
	coordinate: ScriptureCoordinate,
): ScriptureCoordinate | null {
	const perek = getPerekByPerekId(coordinate.perekId);
	if (coordinate.pasuk < perek.pesukim.length) {
		return { perekId: coordinate.perekId, pasuk: coordinate.pasuk + 1 };
	}
	// Only perakim inside the five Torah sefarim are walked here.
	const torahEnd = 187;
	const nextId = coordinate.perekId + 1;
	return nextId <= torahEnd ? { perekId: nextId, pasuk: 1 } : null;
}

describe("PARASHA_DIVISION", () => {
	it("declares the shared contract version and the /פרשה root", () => {
		expect(PARASHA_DIVISION.id).toBe("parasha");
		expect(PARASHA_DIVISION.version).toBe(READING_CONTRACT_VERSION);
		expect(PARASHA_DIVISION.rootPath).toBe("/פרשה");
		expect(PARASHA_DIVISION.menuLabel).toBe("פרשה על הפרק");
	});
});

describe("unit integrity", () => {
	it("produces exactly the 54 weekly parashot with contiguous ids", () => {
		const units = getAllParashaUnits();
		expect(units).toHaveLength(54);
		units.forEach((unit, index) => {
			expect(unit.unitId).toBe(index + 1);
			// The canonical slug is the unit's Hebrew name hyphenated —
			// never the decimal id (issue #2738); the dedicated slug tests
			// pin the full 54-slug table.
			expect(unit.slug).toBe(unit.heading.replace(/ /g, "-"));
			expect(unit.slug).toMatch(/^[א-ת-]+$/);
			expect(unit.division).toBe("parasha");
			expect(unit.ranges).toHaveLength(1);
		});
		expect(units[0].heading).toBe("בראשית");
		expect(units[2].slug).toBe("לך-לך");
		expect(units[16].heading).toBe("יתרו");
		expect(units[28].slug).toBe("אחרי-מות");
		expect(units[51].heading).toBe("וילך");
		expect(units[53].heading).toBe("וזאת הברכה");
		expect(units[53].slug).toBe("וזאת-הברכה");
	});

	it("covers only the five Torah sefarim, in order", () => {
		const units = getAllParashaUnits();
		expect(new Set(units.map((unit) => unit.seferName))).toEqual(
			new Set(["בראשית", "שמות", "ויקרא", "במדבר", "דברים"]),
		);
		const counts = new Map<string, number>();
		for (const unit of units) {
			counts.set(unit.seferName, (counts.get(unit.seferName) ?? 0) + 1);
		}
		expect(counts).toEqual(
			new Map([
				["בראשית", 12],
				["שמות", 11],
				["ויקרא", 10],
				["במדבר", 10],
				["דברים", 11],
			]),
		);
	});

	it("assigns sequential per-sefer order numbers", () => {
		let expectedOrder = 0;
		let currentSefer = "";
		for (const unit of getAllParashaUnits()) {
			if (unit.seferName !== currentSefer) {
				currentSefer = unit.seferName;
				expectedOrder = 0;
			}
			expectedOrder += 1;
			expect(unit.order).toBe(expectedOrder);
		}
	});

	it("tiles the Torah corpus contiguously, pasuk after pasuk", () => {
		const units = getAllParashaUnits();
		expect(units[0].ranges[0].start).toEqual({ perekId: 1, pasuk: 1 });
		for (let i = 0; i < units.length - 1; i++) {
			const end = units[i].ranges[0].end;
			const nextStart = units[i + 1].ranges[0].start;
			expect(nextStart).toEqual(nextPasuk(end));
		}
		// וזאת הברכה closes the Torah: דברים לד יב.
		const last = units[units.length - 1].ranges[0].end;
		expect(last.perekId).toBe(187);
		expect(last.pasuk).toBe(12);
		expect(nextPasuk(last)).toBeNull();
	});

	it("keeps every primary range inside its own sefer", () => {
		for (const unit of getAllParashaUnits()) {
			const sefer = sefarim.find((s) => s.name === unit.seferName);
			expect(sefer).toBeDefined();
			expect(unit.ranges[0].start.perekId).toBeGreaterThanOrEqual(
				sefer?.perekFrom ?? 0,
			);
			expect(unit.ranges[0].end.perekId).toBeLessThanOrEqual(
				sefer?.perekTo ?? 0,
			);
		}
	});
});

describe("lookup helpers", () => {
	it("resolves a canonical position to its containing parasha", () => {
		expect(getParashaUnitContaining({ perekId: 1, pasuk: 1 })?.unitId).toBe(1);
		// Boundary pasuk stays inside the unit it ends.
		expect(getParashaUnitContaining({ perekId: 6, pasuk: 8 })?.unitId).toBe(1);
		expect(getParashaUnitContaining({ perekId: 6, pasuk: 9 })?.unitId).toBe(2);
	});

	it("returns null for positions outside the Torah", () => {
		// יהושע א is perekId 188 — prophetic territory, never a parasha.
		expect(getParashaUnitContaining({ perekId: 188, pasuk: 1 })).toBeNull();
		expect(getParashaUnitContaining({ perekId: 929, pasuk: 1 })).toBeNull();
	});

	it("returns prev/next units across the Torah edges", () => {
		const { prev, next } = getAdjacentParashaUnits(1);
		expect(prev).toBeNull();
		expect(next?.heading).toBe("נח");
		const last = getAdjacentParashaUnits(54);
		expect(last.next).toBeNull();
		expect(last.prev?.heading).toBe("האזינו");
	});

	it("throws for an unknown unit id", () => {
		expect(() => getParashaUnitById(0)).toThrow("Invalid parasha unitId");
		expect(() => getParashaUnitById(55)).toThrow("Invalid parasha unitId");
		expect(() => getParashaEntry(0)).toThrow("Invalid parasha unitId");
	});

	it("lists the first parasha of each Torah sefer", () => {
		const firsts = getParashaFirstUnitBySefer();
		expect(firsts.map((unit) => unit.unitId)).toEqual([1, 13, 24, 34, 44]);
		expect(firsts.map((unit) => unit.seferName)).toEqual([
			"בראשית",
			"שמות",
			"ויקרא",
			"במדבר",
			"דברים",
		]);
	});

	it("lists the units of one sefer in order", () => {
		const shemot = getParashaUnitsForSefer("שמות");
		expect(shemot).toHaveLength(11);
		expect(shemot[0].unitId).toBe(13);
		expect(shemot[10].heading).toBe("פקודי");
		expect(getParashaUnitsForSefer("יהושע")).toHaveLength(0);
	});
});

describe("reference formatting", () => {
	it("renders a cross-perek parasha span", () => {
		expect(parashaRefSpan(getParashaUnitById(1))).toBe("בראשית א א - ו ח");
	});

	it("renders each range of a multi-range reading in order", () => {
		const unit = getParashaUnitById(17); // יתרו
		const ashkenazi = unit.auxiliaryReadings?.find((aux) =>
			aux.id.includes("ashkenazi"),
		);
		expect(ashkenazi?.ranges).toHaveLength(2);
		expect(rangesRefSpans(ashkenazi?.ranges ?? [])).toEqual([
			"ישעיהו ו א - ז ו",
			"ישעיהו ט ה-ו",
		]);
	});
});

describe("Haftarah auxiliary readings", () => {
	it("attaches ordered variants with stable ids and labels", () => {
		const unit = getParashaUnitById(1);
		const aux = unit.auxiliaryReadings ?? [];
		expect(aux.map((a) => a.id)).toEqual([
			"haftara-sefaradi",
			"haftara-ashkenazi",
			"haftara-temani",
		]);
		expect(aux.map((a) => a.label)).toEqual(["ספרדים", "אשכנזים", "תימנים"]);
	});

	it("keeps every Haftarah range inside the prophetic corpus", () => {
		for (const unit of getAllParashaUnits()) {
			for (const range of parashaAuxiliaryRanges(unit)) {
				// Torah ends at perekId 187; Haftarot live in נביאים.
				expect(range.start.perekId).toBeGreaterThan(187);
				expect(range.end.perekId).toBeGreaterThan(187);
			}
		}
	});

	it("resolves a combined-custom variant to one auxiliary reading", () => {
		// וילך — sefaradi+temani share one reading.
		const unit = getParashaUnitById(52);
		const shared = getParashaEntry(52).haftarot.find((haftara) =>
			haftara.customs.includes("sefaradi"),
		);
		expect(shared?.customs).toEqual(["sefaradi", "temani"]);
		expect(shared?.label).toBe("ספרדים ותימנים");
		expect(shared?.id).toBe("haftara-sefaradi-temani");
		expect(unit.auxiliaryReadings?.map((aux) => aux.id)).toContain(
			"haftara-sefaradi-temani",
		);
	});

	it("preserves cross-sefer jumps within one reading", () => {
		// וילך sefaradi+temani: הושע יד then מיכה ז — a sefer jump.
		const shared = getParashaEntry(52).haftarot.find((haftara) =>
			haftara.customs.includes("temani"),
		);
		expect(shared?.ranges).toHaveLength(2);
		expect(shared?.ranges[0].start.perekId).toBe(perekIdOf("הושע", 14));
		expect(shared?.ranges[1].start.perekId).toBe(perekIdOf("מיכה", 7));
	});

	it("preserves backwards perek jumps in declared order", () => {
		// משפטים sefaradi+ashkenazi: ירמיהו לד then לג — order is the
		// declared reading order, not canonical sorting.
		const shared = getParashaEntry(18).haftarot[0];
		expect(shared.ranges).toHaveLength(2);
		expect(
			compareCoordinates(shared.ranges[1].start, shared.ranges[0].end),
		).toBeLessThan(0);
	});

	it("applies the מטות Yemenite endpoint correction (ירמיהו א:יט)", () => {
		const temani = getParashaEntry(42).haftarot.find((haftara) =>
			haftara.customs.includes("temani"),
		);
		expect(temani?.ranges).toHaveLength(1);
		expect(temani?.ranges[0].start).toEqual({
			perekId: perekIdOf("ירמיהו", 1),
			pasuk: 1,
		});
		expect(temani?.ranges[0].end).toEqual({
			perekId: perekIdOf("ירמיהו", 1),
			pasuk: 19,
		});
		expect(temani?.note).toContain("ירמיהו א יט");
	});

	it("applies the ויקהל Yemenite range correction (מלכים א ז:יג-כב)", () => {
		const temani = getParashaEntry(22).haftarot.find((haftara) =>
			haftara.customs.includes("temani"),
		);
		expect(temani?.ranges[0].start).toEqual({
			perekId: perekIdOf("מלכים", 7, "א"),
			pasuk: 13,
		});
		expect(temani?.ranges[0].end).toEqual({
			perekId: perekIdOf("מלכים", 7, "א"),
			pasuk: 22,
		});
	});

	it("validates every resolved coordinate against the corpus", () => {
		for (const unit of getAllParashaUnits()) {
			const allRanges = [...unit.ranges, ...parashaAuxiliaryRanges(unit)];
			for (const range of allRanges) {
				expect(
					compareCoordinates(range.start, range.end, "end"),
				).toBeLessThanOrEqual(0);
				for (const coordinate of [range.start, range.end]) {
					const perek = getPerekByPerekId(coordinate.perekId);
					expect(coordinate.pasuk).toBeGreaterThanOrEqual(1);
					expect(coordinate.pasuk).toBeLessThanOrEqual(perek.pesukim.length);
				}
			}
		}
	});
});

describe("parasha entries and notes", () => {
	it("carries the אחרי מות/קדושים swap note on both parashot", () => {
		for (const unitId of [29, 30]) {
			const entry = getParashaEntry(unitId);
			expect(entry.notes.join(" ")).toContain("אחרי מות וקדושים");
		}
	});

	it("exposes the joined-parasha pairs and the default-custom note", () => {
		expect(PARASHA_JOINED_PAIRS).toHaveLength(6);
		expect(PARASHA_JOINED_PAIRS).toContainEqual(["נצבים", "וילך"]);
		expect(PARASHA_JOINED_PAIRS).toContainEqual(["ויקהל", "פקודי"]);
		expect(PARASHA_JOINED_NOTE).toContain("הפרשה השניה");
		expect(PARASHA_GENERAL_NOTES.length).toBeGreaterThan(0);
		expect(PARASHA_CUSTOM_LABELS).toEqual({
			sefaradi: "ספרדים",
			ashkenazi: "אשכנזים",
			temani: "תימנים",
		});
	});
});

describe("special-occasion readings", () => {
	it("lists the special-Shabbat and festival occasions", () => {
		const names = getParashaOccasions().map((occasion) => occasion.name);
		expect(names).toContain("שבת ראש חודש");
		expect(names).toContain("שבת שקלים");
		expect(names).toContain("שבת זכור");
		expect(names).toContain("שבת הגדול");
		expect(names).toContain("שבועות");
		expect(names).toContain("יום העצמאות");
		expect(names).toHaveLength(23);
	});

	it("keeps the intentional repeated pasuk in שבת ראש חודש", () => {
		const occasion = getParashaOccasions().find(
			(o) => o.name === "שבת ראש חודש",
		);
		const haftara = occasion?.haftarot[0];
		expect(haftara?.ranges).toHaveLength(2);
		const [first, repeat] = haftara?.ranges ?? [];
		expect(first.start.perekId).toBe(perekIdOf("ישעיהו", 66));
		// ישעיהו סו:כג is intentionally read again after the closing pasuk.
		expect(repeat.start).toEqual({
			perekId: perekIdOf("ישעיהו", 66),
			pasuk: 23,
		});
		expect(repeat.end).toEqual(repeat.start);
	});

	it("carries the multi-sefer יום כיפור מנחה reading", () => {
		const occasion = getParashaOccasions().find(
			(o) => o.name === "יום כיפור - מנחה",
		);
		const ranges = occasion?.haftarot[0].ranges ?? [];
		expect(ranges).toHaveLength(2);
		expect(ranges[0].start.perekId).toBe(perekIdOf("יונה", 1));
		expect(ranges[0].end.perekId).toBe(perekIdOf("יונה", 4));
		expect(ranges[1].start.perekId).toBe(perekIdOf("מיכה", 7));
	});
});

describe("unit counts", () => {
	it("matches the closed unit list", () => {
		expect(getParashaUnitCount()).toBe(54);
	});
});

describe("source-table validation", () => {
	// Re-import the module with a mocked source table so each invalid row
	// exercises its own validation branch. The real JSON is spread so only
	// units/occasions differ.
	function importModuleWith(
		mockUnits: unknown[],
		mockOccasions: unknown[] = [],
	) {
		jest.resetModules();
		jest.doMock("../../../src/data/parasha/parasha-division.json", () => ({
			...(jest.requireActual(
				"../../../src/data/parasha/parasha-division.json",
			) as Record<string, unknown>),
			units: mockUnits,
			occasions: mockOccasions,
		}));
		return require("../../../src/data/parasha/parasha-units") as typeof import(
			"../../../src/data/parasha/parasha-units"
		);
	}

	afterEach(() => {
		jest.dontMock("../../../src/data/parasha/parasha-division.json");
	});

	const validUnit = (overrides: Record<string, unknown> = {}) => ({
		name: "פלוני",
		slug: "פלוני",
		sefer: "בראשית",
		start: { perek: 1, pasuk: 1 },
		end: { perek: 1, pasuk: 2 },
		haftarot: [],
		...overrides,
	});

	const haftaraRange = (overrides: Record<string, unknown> = {}) => ({
		sefer: "בראשית",
		start: { perek: 1, pasuk: 1 },
		end: { perek: 1, pasuk: 2 },
		...overrides,
	});

	it("rejects a unit in an unknown sefer", () => {
		const mod = importModuleWith([validUnit({ sefer: "דמיון" })]);
		expect(() => mod.getAllParashaUnits()).toThrow(
			'parasha data: unknown sefer "דמיון"',
		);
	});

	it("requires an additional marker for split sefarim", () => {
		const mod = importModuleWith([
			validUnit({
				haftarot: [{ customs: ["sefaradi"], ranges: [haftaraRange({ sefer: "מלכים" })] }],
			}),
		]);
		expect(() => mod.getAllParashaUnits()).toThrow(
			'"additional" is required',
		);
	});

	it("rejects an additional on a non-split sefer", () => {
		const mod = importModuleWith([
			validUnit({
				haftarot: [
					{
						customs: ["sefaradi"],
						ranges: [haftaraRange({ additional: "א" })],
					},
				],
			}),
		]);
		expect(() => mod.getAllParashaUnits()).toThrow(
			'"בראשית" has no additional "א"',
		);
	});

	it("rejects an unknown additional letter", () => {
		const mod = importModuleWith([
			validUnit({
				haftarot: [
					{
						customs: ["sefaradi"],
						ranges: [haftaraRange({ sefer: "מלכים", additional: "ג" })],
					},
				],
			}),
		]);
		expect(() => mod.getAllParashaUnits()).toThrow(
			'"מלכים" has no additional "ג"',
		);
	});

	it("rejects a perek beyond the sefer's bounds", () => {
		const mod = importModuleWith([
			validUnit({ end: { perek: 51, pasuk: 1 } }),
		]);
		expect(() => mod.getAllParashaUnits()).toThrow(
			"exceeds בראשית's perek count",
		);
	});

	it.each([
		["zero", { perek: 1, pasuk: 0 }],
		["beyond the perek's pasuk count", { perek: 1, pasuk: 5000 }],
	])("rejects a pasuk %s", (_case, start) => {
		const mod = importModuleWith([validUnit({ start })]);
		expect(() => mod.getAllParashaUnits()).toThrow(
			"is outside the canonical",
		);
	});

	it("rejects a backwards range", () => {
		const mod = importModuleWith([
			validUnit({
				start: { perek: 2, pasuk: 1 },
				end: { perek: 1, pasuk: 1 },
			}),
		]);
		expect(() => mod.getAllParashaUnits()).toThrow("backwards range");
	});

	it("resolves a variant with no customs", () => {
		const mod = importModuleWith([
			validUnit({
				haftarot: [{ customs: [], ranges: [haftaraRange()] }],
			}),
		]);
		const unit = mod.getParashaUnitById(1);
		expect(unit.auxiliaryReadings?.[0].ranges).toHaveLength(1);
	});

	it("returns no ranges for a unit without auxiliary readings", () => {
		const unit = {
			...getParashaUnitById(1),
			auxiliaryReadings: undefined,
		};
		expect(parashaAuxiliaryRanges(unit)).toEqual([]);
	});
});
