/**
 * Unit tests for the מסורה (Masoretic parasha) reading-unit provider.
 * Runs against the canonical corpus: derivation is deterministic, so
 * these assertions pin real boundaries from the ptuha/stuma markers.
 */
import { sefarim } from "../../../src/data/db/sefarim";
import {
	formatMasoraUnitHeading,
	getAdjacentMasoraUnits,
	getAllMasoraUnits,
	getMasoraUnitById,
	getMasoraUnitContaining,
	getMasoraUnitCount,
	getMasoraUnitsForSefer,
	MASORA_DIVISION,
	masoraPasukCount,
} from "../../../src/data/masora/masora-units";
import { READING_CONTRACT_VERSION } from "../../../src/lib/reading/contract";
import {
	rangePerekSlices,
	unitEquivalentPerekId,
} from "../../../src/lib/reading/ranges";

function markerCount(): number {
	let count = 0;
	for (const sefer of sefarim) {
		const parts = "perakim" in sefer ? [sefer] : sefer.additionals;
		for (const part of parts) {
			for (const perek of part.perakim) {
				for (const pasuk of perek.pesukim) {
					for (const seg of pasuk.segments) {
						if (seg.type === "ptuha" || seg.type === "stuma") count += 1;
					}
				}
			}
		}
	}
	return count;
}

describe("MASORA_DIVISION", () => {
	it("declares the shared contract version and the /מסורה root", () => {
		expect(MASORA_DIVISION.id).toBe("masora");
		expect(MASORA_DIVISION.version).toBe(READING_CONTRACT_VERSION);
		expect(MASORA_DIVISION.rootPath).toBe("/מסורה");
		expect(MASORA_DIVISION.menuLabel).toBe("מסורה על הפרק");
	});
});

describe("derivation integrity", () => {
	it("produces markers + one unit per sefer, with contiguous unit ids", () => {
		const units = getAllMasoraUnits();
		expect(units).toHaveLength(markerCount() + sefarim.length);
		units.forEach((unit, index) => {
			expect(unit.unitId).toBe(index + 1);
			expect(unit.slug).toBe(String(unit.unitId));
			expect(unit.division).toBe("masora");
			expect(unit.ranges).toHaveLength(1);
		});
	});

	it("covers the corpus exactly once, in order, without gaps", () => {
		// For each sefer, every qri/ktiv segment must belong to exactly one
		// unit, and units must tile the sefer's text contiguously.
		for (const sefer of sefarim) {
			const parts = "perakim" in sefer ? [sefer] : sefer.additionals;
			const units = getMasoraUnitsForSefer(sefer.name);
			expect(units.length).toBeGreaterThan(0);

			// Flatten expected (perekId, pasuk, textSegmentIndex) coverage.
			const expected: string[] = [];
			for (const part of parts) {
				for (let pi = 0; pi < part.perakim.length; pi++) {
					const perekId = part.perekFrom + pi;
					part.perakim[pi].pesukim.forEach((pasuk, vi) => {
						pasuk.segments.forEach((seg, si) => {
							if (seg.type === "qri" || seg.type === "ktiv") {
								expected.push(`${perekId}:${vi + 1}:${si}`);
							}
						});
					});
				}
			}

			const actual: string[] = [];
			for (const unit of units) {
				const range = unit.ranges[0];
				for (
					let perekId = range.start.perekId;
					perekId <= range.end.perekId;
					perekId++
				) {
					const part = parts.find(
						(p) => perekId >= p.perekFrom && perekId <= p.perekTo,
					);
					const perek = part?.perakim[perekId - (part?.perekFrom ?? 0)];
					if (!perek) continue;
					const startPasuk =
						perekId === range.start.perekId ? range.start.pasuk : 1;
					const endPasuk =
						perekId === range.end.perekId
							? range.end.pasuk
							: perek.pesukim.length;
					perek.pesukim.forEach((pasuk, vi) => {
						const pasukNum = vi + 1;
						if (pasukNum < startPasuk || pasukNum > endPasuk) return;
						const startSeg =
							perekId === range.start.perekId &&
							pasukNum === range.start.pasuk
								? (range.start.segmentIndex ?? 0)
								: 0;
						const endSeg =
							perekId === range.end.perekId &&
							pasukNum === range.end.pasuk
								? (range.end.segmentIndex ?? pasuk.segments.length - 1)
								: pasuk.segments.length - 1;
						for (let si = startSeg; si <= endSeg; si++) {
							if (
								pasuk.segments[si].type === "qri" ||
								pasuk.segments[si].type === "ktiv"
							) {
								actual.push(`${perekId}:${pasukNum}:${si}`);
							}
						}
					});
				}
			}
			expect(actual).toEqual(expected);
		}
	});

	it("assigns every unit to its own sefer and keeps order sequential", () => {
		let expectedOrder = 0;
		let currentSefer = "";
		for (const unit of getAllMasoraUnits()) {
			if (unit.seferName !== currentSefer) {
				currentSefer = unit.seferName;
				expectedOrder = 0;
			}
			expectedOrder += 1;
			expect(unit.order).toBe(expectedOrder);
		}
	});
});

describe("specific corpus boundaries", () => {
	it("opens בראשית with the canonical first parasha (א א-ה)", () => {
		const first = getMasoraUnitById(1);
		expect(first.seferName).toBe("בראשית");
		expect(first.order).toBe(1);
		expect(first.ranges[0].start).toEqual({ perekId: 1, pasuk: 1 });
		expect(first.ranges[0].end.perekId).toBe(1);
		expect(first.ranges[0].end.pasuk).toBe(5);
		expect(first.closingBreak).toBe("ptuha");
	});

	it("marks a mid-pasuk break with a segment bound (בראשית לה כב)", () => {
		const units = getMasoraUnitsForSefer("בראשית");
		const ending = units.find(
			(unit) =>
				unit.ranges[0].end.perekId === 35 &&
				unit.ranges[0].end.pasuk === 22 &&
				unit.ranges[0].end.segmentIndex !== undefined,
		);
		expect(ending).toBeDefined();
		expect(ending?.closingBreak).toBe("ptuha");

		// The corpus pasuk holds a ptuha marker at the unit's end segment.
		const markerIndex = ending?.ranges[0].end.segmentIndex ?? -1;
		const bereshit = sefarim[0];
		const corpusPerek =
			"perakim" in bereshit ? bereshit.perakim[34] : undefined;
		expect(corpusPerek?.pesukim[21].segments[markerIndex].type).toBe(
			"ptuha",
		);

		const following = getMasoraUnitById((ending?.unitId ?? 0) + 1);
		expect(following.ranges[0].start.perekId).toBe(35);
		expect(following.ranges[0].start.pasuk).toBe(22);
		expect(following.ranges[0].start.segmentIndex).toBe(markerIndex + 1);
	});

	it("keeps a marker-free sefer as a single whole-sefer unit", () => {
		const ovadia = sefarim.find((s) => s.name === "עובדיה");
		const units = getMasoraUnitsForSefer("עובדיה");
		expect(units).toHaveLength(1);
		const [unit] = units;
		expect(unit.closingBreak).toBeNull();
		expect(unit.ranges[0].start).toEqual({
			perekId: ovadia?.perekFrom,
			pasuk: 1,
		});
		expect(unit.ranges[0].end.perekId).toBe(ovadia?.perekTo);
	});

	it("ends each sefer with a unit closed by the sefer end, not a marker", () => {
		for (const sefer of sefarim) {
			const units = getMasoraUnitsForSefer(sefer.name);
			const last = units[units.length - 1];
			expect(last.closingBreak).toBeNull();
			expect(last.ranges[0].end.segmentIndex).toBeUndefined();
		}
	});

	it("keeps every unit inside its sefer's canonical perek range", () => {
		for (const sefer of sefarim) {
			for (const unit of getMasoraUnitsForSefer(sefer.name)) {
				expect(unit.ranges[0].start.perekId).toBeGreaterThanOrEqual(
					sefer.perekFrom,
				);
				expect(unit.ranges[0].end.perekId).toBeLessThanOrEqual(
					sefer.perekTo,
				);
			}
		}
		// A sefer with additionals (שמואל) lets a parasha cross the א/ב
		// boundary when the corpus has no marker exactly at the seam.
		const shmuel = sefarim.find((s) => s.name === "שמואל");
		const seamEnd =
			shmuel && "additionals" in shmuel
				? shmuel.additionals[0].perekTo
				: null;
		const seamStart =
			shmuel && "additionals" in shmuel
				? shmuel.additionals[1].perekFrom
				: null;
		expect(seamEnd).not.toBeNull();
		const crossing = getMasoraUnitsForSefer("שמואל").filter(
			(unit) =>
				unit.ranges[0].start.perekId <= (seamEnd ?? 0) &&
				unit.ranges[0].end.perekId >= (seamStart ?? 0),
		);
		for (const unit of crossing) {
			expect(unit.seferName).toBe("שמואל");
		}
	});
});

describe("lookup helpers", () => {
	it("resolves a canonical position to its containing unit", () => {
		// בראשית 1:5 ends with a ptuha: pasuk-level position belongs to unit 1.
		const unit = getMasoraUnitContaining({ perekId: 1, pasuk: 5 });
		expect(unit?.unitId).toBe(1);
		// Position on the break marker itself belongs to the closing unit.
		const closing = getMasoraUnitsForSefer("בראשית").find(
			(u) =>
				u.ranges[0].end.perekId === 35 &&
				u.ranges[0].end.pasuk === 22 &&
				u.ranges[0].end.segmentIndex !== undefined,
		);
		const markerIndex = closing?.ranges[0].end.segmentIndex ?? -1;
		const atMarker = getMasoraUnitContaining({
			perekId: 35,
			pasuk: 22,
			segmentIndex: markerIndex,
		});
		expect(atMarker?.unitId).toBe(closing?.unitId);
		// Right after the marker starts the next unit.
		const afterMarker = getMasoraUnitContaining({
			perekId: 35,
			pasuk: 22,
			segmentIndex: markerIndex + 1,
		});
		expect(afterMarker?.unitId).toBe((closing?.unitId ?? 0) + 1);
	});

	it("returns prev/next units across the corpus edges", () => {
		const { prev, next } = getAdjacentMasoraUnits(1);
		expect(prev).toBeNull();
		expect(next?.unitId).toBe(2);
		const last = getAdjacentMasoraUnits(getMasoraUnitCount());
		expect(last.next).toBeNull();
		expect(last.prev?.unitId).toBe(getMasoraUnitCount() - 1);
	});

	it("throws for an unknown unit id", () => {
		expect(() => getMasoraUnitById(0)).toThrow("Invalid masora unitId");
		expect(() => getMasoraUnitById(getMasoraUnitCount() + 5)).toThrow(
			"Invalid masora unitId",
		);
	});
});

describe("headings and pasuk counts", () => {
	it("formats same-perek headings as a collapsed pasuk range", () => {
		// perek 1 of בראשית is global perekId 1.
		expect(
			formatMasoraUnitHeading(
				{ perekId: 1, pasuk: 1 },
				{ perekId: 1, pasuk: 5 },
			),
		).toBe("בראשית א א-ה");
	});

	it("formats cross-perek headings with both endpoints", () => {
		expect(
			formatMasoraUnitHeading(
				{ perekId: 1, pasuk: 30 },
				{ perekId: 2, pasuk: 4 },
			),
		).toBe("בראשית א ל - ב ד");
	});

	it("exposes the canonical pasuk count for the resolver", () => {
		expect(masoraPasukCount(1)).toBeGreaterThan(0);
	});
});

describe("canonical consolidation policy", () => {
	it("treats marker-free-sefer units as whole-perek equivalents only when exact", () => {
		// עובדיה has one perek and one marker-free unit -> equivalent to /929.
		const ovadiaUnit = getMasoraUnitsForSefer("עובדיה")[0];
		expect(unitEquivalentPerekId(ovadiaUnit, masoraPasukCount)).toBe(
			ovadiaUnit.ranges[0].start.perekId,
		);
		// A mid-pasuk or partial unit never consolidates.
		const first = getMasoraUnitById(1);
		expect(unitEquivalentPerekId(first, masoraPasukCount)).toBeNull();
	});

	it("derives per-perek slices for the commentary query path", () => {
		const first = getMasoraUnitById(1);
		expect(
			rangePerekSlices(first.ranges[0], masoraPasukCount),
		).toHaveLength(1);
	});
});
