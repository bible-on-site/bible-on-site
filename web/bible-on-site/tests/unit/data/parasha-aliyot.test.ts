/**
 * Unit tests for the aliyah boundary layer over the פרשה division
 * (issue #2519). The curated source (parasha-aliyot.json, imported
 * from @hebcal/leyning's BSD-2-Clause aliyot.json and corroborated
 * against Sefaria's get_aliyot API where it responds) resolves to
 * canonical coordinates at module load — these assertions pin real
 * coverage: standalone + joined readings, Shabbat/weekday schemes,
 * intentional maftir repetition, documented alternative splits, and
 * the marker layer the readers consume.
 */
import { sefarim } from "../../../src/data/db/sefarim";
import {
	ALIYAH_PROVENANCE,
	ALIYAH_SCHEMES,
	aliyahContaining,
	aliyahStartMarkers,
	DEFAULT_ALIYAH_SCHEME,
	getAliyot,
	getJoinedReadingsForUnit,
	getParashaReadingById,
	getStandaloneReading,
	getUnitAliyahMarkers,
	getUnitShabbatAliyahMarkers,
} from "../../../src/data/parasha/parasha-aliyot";
import { getAllParashaUnits } from "../../../src/data/parasha/parasha-units";
import { getPerekByPerekId } from "../../../src/data/perek-dto";
import type { ScriptureCoordinate } from "../../../src/lib/reading/contract";
import { rangeContainsCoordinate } from "../../../src/lib/reading/ranges";

function perekIdOf(seferName: string, perek: number): number {
	const sefer = sefarim.find((s) => s.name === seferName);
	if (!sefer || !("perekFrom" in sefer)) {
		throw new Error(`missing sefer ${seferName}`);
	}
	return sefer.perekFrom + perek - 1;
}

function nextPasuk(
	coordinate: ScriptureCoordinate,
): ScriptureCoordinate | null {
	const perek = getPerekByPerekId(coordinate.perekId);
	if (coordinate.pasuk < perek.pesukim.length) {
		return { perekId: coordinate.perekId, pasuk: coordinate.pasuk + 1 };
	}
	const nextId = coordinate.perekId + 1;
	return nextId <= 187 ? { perekId: nextId, pasuk: 1 } : null;
}

function must<T>(value: T | null | undefined): T {
	if (value == null) throw new Error("expected a value");
	return value;
}

const units = getAllParashaUnits();
const unitByName = (name: string) => {
	const unit = units.find((u) => u.heading === name);
	if (!unit) throw new Error(`missing unit ${name}`);
	return unit;
};

describe("aliyah source and provenance", () => {
	it("declares the hebcal source, license and commit", () => {
		expect(ALIYAH_PROVENANCE.name).toContain("hebcal");
		expect(ALIYAH_PROVENANCE.license).toContain("BSD");
		expect(ALIYAH_PROVENANCE.commit).toMatch(/^[0-9a-f]{10,}$/);
		expect(ALIYAH_PROVENANCE.notes.length).toBeGreaterThan(0);
	});

	it("exposes the Shabbat and weekday schemes", () => {
		expect(ALIYAH_SCHEMES.map((s) => s.id)).toEqual(["shabbat", "weekday"]);
		expect(DEFAULT_ALIYAH_SCHEME).toBe("shabbat");
	});
});

describe("standalone readings", () => {
	it("throws for a unit id that has no reading", () => {
		expect(() => getStandaloneReading(99999)).toThrow(/aliyah data/);
	});

	it("resolves one per parasha unit, preserving unit identity", () => {
		for (const unit of units) {
			const reading = getStandaloneReading(unit.unitId);
			expect(reading.kind).toBe("standalone");
			expect(reading.unitIds).toEqual([unit.unitId]);
			expect(reading.unitNames).toEqual([unit.heading]);
			expect(reading.seferName).toBe(unit.seferName);
		}
	});

	it("gives every parasha except וזאת הברכה a Shabbat seven plus מפטיר", () => {
		for (const unit of units) {
			const boundaries = must(getAliyot(getStandaloneReading(unit.unitId)));
			const regular = boundaries.filter((b) => b.role === "aliyah");
			const maftir = boundaries.filter((b) => b.role === "maftir");
			expect(regular.map((b) => b.ordinal)).toEqual([1, 2, 3, 4, 5, 6, 7]);
			if (unit.heading === "וזאת הברכה") {
				expect(maftir).toHaveLength(0);
				expect(boundaries).toHaveLength(7);
			} else {
				expect(maftir).toHaveLength(1);
				expect(maftir[0].label).toBe("מפטיר");
				expect(boundaries).toHaveLength(8);
				// Maftir intentionally repeats the tail of the seventh aliyah.
				expect(maftir[0].range.end).toEqual(regular[6].range.end);
			}
		}
	});

	it("tiles each reading contiguously — no holes, no overlap", () => {
		for (const unit of units) {
			const boundaries = must(getAliyot(getStandaloneReading(unit.unitId)));
			const regular = boundaries.filter((b) => b.role === "aliyah");
			expect(regular[0].range.start).toEqual(unit.ranges[0].start);
			expect(regular[6].range.end).toEqual(unit.ranges[0].end);
			for (let i = 1; i < regular.length; i++) {
				expect(regular[i].range.start).toEqual(
					nextPasuk(regular[i - 1].range.end),
				);
			}
		}
	});

	it("gives standalone readings a three-aliyah weekday scheme", () => {
		for (const unit of units) {
			const weekday = must(
				getAliyot(getStandaloneReading(unit.unitId), "weekday"),
			);
			expect(weekday.map((b) => b.ordinal)).toEqual([1, 2, 3]);
			expect(weekday.every((b) => b.role === "aliyah")).toBe(true);
		}
	});
});

describe("joined readings", () => {
	it("covers the standard joins including חוקת-בלק", () => {
		const joinedIds = [
			"Vayakhel-Pekudei",
			"Tazria-Metzora",
			"Achrei Mot-Kedoshim",
			"Behar-Bechukotai",
			"Chukat-Balak",
			"Matot-Masei",
			"Nitzavim-Vayeilech",
		];
		for (const id of joinedIds) {
			const reading = getParashaReadingById(id);
			expect(reading).not.toBeNull();
			expect(reading?.kind).toBe("joined");
			expect(reading?.unitIds).toHaveLength(2);
			// Joined readings are Shabbat-only — no weekday split.
			expect(getAliyot(must(reading), "weekday")).toBeNull();
			const shabbat = must(getAliyot(must(reading), "shabbat"));
			expect(
				shabbat.filter((b) => b.role === "aliyah").map((b) => b.ordinal),
			).toEqual([1, 2, 3, 4, 5, 6, 7]);
		}
	});

	it("keeps constituent unit identities on both sides of a join", () => {
		const vayakhel = unitByName("ויקהל");
		const pekudei = unitByName("פקודי");
		for (const unit of [vayakhel, pekudei]) {
			const joined = getJoinedReadingsForUnit(unit.unitId);
			expect(joined).toHaveLength(1);
			expect(joined[0].id).toBe("Vayakhel-Pekudei");
			expect(joined[0].unitIds).toEqual([vayakhel.unitId, pekudei.unitId]);
		}
	});

	it("splits joined readings differently than the standalone pair", () => {
		const vayakhel = getStandaloneReading(unitByName("ויקהל").unitId);
		const joined = must(getParashaReadingById("Vayakhel-Pekudei"));
		const standaloneStarts = must(getAliyot(vayakhel)).map(
			(b) => `${b.range.start.perekId}:${b.range.start.pasuk}`,
		);
		const joinedStarts = must(getAliyot(joined))
			.filter((b) => b.role === "aliyah")
			.map((b) => `${b.range.start.perekId}:${b.range.start.pasuk}`);
		// The joined first aliyah is the full combined span's first split —
		// not Vayakhel's standalone first+continuation.
		expect(joinedStarts[0]).toBe("85:1"); // שמות לה א
		expect(joinedStarts).not.toEqual(standaloneStarts);
		// Joined maftir ends at פקודי's end: שמות מ לח.
		const maftir = must(
			must(getAliyot(joined)).find((b) => b.role === "maftir"),
		);
		expect(maftir.range.end).toEqual({
			perekId: perekIdOf("שמות", 40),
			pasuk: 38,
		});
	});

	it("marks חוקת-בלק as the only חוץ לארץ-restricted context", () => {
		const chukat = must(getParashaReadingById("Chukat-Balak"));
		expect(chukat.applicability).toBe("חוץ לארץ בלבד");
		const balak = unitByName("בלק");
		const layer = getUnitAliyahMarkers(balak.unitId);
		const joinedCtx = must(layer.contexts.find((c) => c.kind === "joined"));
		expect(joinedCtx.contextId).toBe("Chukat-Balak");
		expect(joinedCtx.applicability).toBe("חוץ לארץ בלבד");
		expect(joinedCtx.label).toContain("חוץ לארץ");
		// Every other context is unrestricted.
		for (const unit of units) {
			for (const ctx of getUnitAliyahMarkers(unit.unitId).contexts) {
				if (ctx.contextId !== "Chukat-Balak") {
					expect(ctx.applicability).toBeUndefined();
				}
			}
		}
	});

	it("resolves אחרי מות-קדושים — a Sefaria API hole the source fills", () => {
		const reading = must(getParashaReadingById("Achrei Mot-Kedoshim"));
		const shabbat = must(getAliyot(reading, "shabbat"));
		expect(shabbat[0].range.start).toEqual({
			perekId: perekIdOf("ויקרא", 16),
			pasuk: 1,
		});
		expect(shabbat[6].range.end).toEqual({
			perekId: perekIdOf("ויקרא", 20),
			pasuk: 27,
		});
	});
});

describe("documented alternative splits", () => {
	it("carries the source's variant notes on בראשית aliyot 5 and 6", () => {
		const boundaries = must(
			getAliyot(getStandaloneReading(unitByName("בראשית").unitId)),
		);
		const withNotes = boundaries.filter((b) => b.note);
		expect(withNotes.map((b) => b.ordinal)).toEqual([5, 6]);
		expect(withNotes[0].note).toContain("4:19");
		expect(withNotes[1].note).toContain("5:1");
	});

	it("carries the variant notes on תרומה aliyot 2 and 3", () => {
		const boundaries = must(
			getAliyot(getStandaloneReading(unitByName("תרומה").unitId)),
		);
		expect(boundaries.filter((b) => b.note).map((b) => b.ordinal)).toEqual([
			2, 3,
		]);
	});
});

describe("marker layer", () => {
	it("builds coord-keyed markers tagged by reading and scheme", () => {
		const layer = getUnitAliyahMarkers(unitByName("בראשית").unitId);
		expect(layer.defaultKey).toBe("Bereshit:shabbat");
		expect(layer.contexts.map((c) => c.contextId)).toEqual(["Bereshit"]);
		expect(layer.contexts[0].schemes.map((s) => s.schemeId)).toEqual([
			"shabbat",
			"weekday",
		]);
		// שני begins בראשית ב ד under shabbat, but the weekday split
		// starts it elsewhere — both layers coexist at their own coords.
		const shabbat2 = layer.markers["2:4"];
		expect(shabbat2).toHaveLength(1);
		expect(shabbat2[0]).toMatchObject({
			key: "Bereshit:shabbat",
			label: "שני",
			role: "aliyah",
		});
	});

	it("marks aliyah 1 at the unit's first pasuk", () => {
		const layer = getUnitAliyahMarkers(unitByName("בראשית").unitId);
		expect(layer.markers["1:1"]?.[0]).toMatchObject({
			key: "Bereshit:shabbat",
			label: "ראשון",
		});
	});

	it("clips joined-context markers to the unit's own ranges", () => {
		const vayakhel = unitByName("ויקהל");
		const layer = getUnitAliyahMarkers(vayakhel.unitId);
		const joinedCtx = layer.contexts.find((c) => c.kind === "joined");
		expect(joinedCtx?.contextId).toBe("Vayakhel-Pekudei");
		// Joined context offers only the Shabbat scheme.
		expect(joinedCtx?.schemes.map((s) => s.schemeId)).toEqual(["shabbat"]);
		const joined = must(getParashaReadingById("Vayakhel-Pekudei"));
		const joinedBoundariesInUnit = must(getAliyot(joined)).filter((b) =>
			vayakhel.ranges.some((r) => rangeContainsCoordinate(r, b.range.start)),
		);
		const joinedMarkers = Object.values(layer.markers)
			.flat()
			.filter((m) => m.key === "Vayakhel-Pekudei:shabbat");
		expect(joinedMarkers).toHaveLength(joinedBoundariesInUnit.length);
		// Every clipped marker's coordinate is inside the unit's ranges.
		for (const [coord, specs] of Object.entries(layer.markers)) {
			if (!specs.some((m) => m.key === "Vayakhel-Pekudei:shabbat")) continue;
			const [perekId, pasuk] = coord.split(":").map(Number);
			expect(
				vayakhel.ranges.some((r) =>
					rangeContainsCoordinate(r, { perekId, pasuk }),
				),
			).toBe(true);
		}
	});

	it("labels joined markers with the joined numbering — never remapped", () => {
		const pekudei = unitByName("פקודי");
		const layer = getUnitAliyahMarkers(pekudei.unitId);
		const joinedMarkers = Object.values(layer.markers)
			.flat()
			.filter((m) => m.key === "Vayakhel-Pekudei:shabbat");
		// The joined reading's later aliyot start inside פקודי; their
		// labels are the joined ordinals (e.g. החמישי may start פקודי's
		// text), never renumbered from 1 as if standalone.
		expect(joinedMarkers.length).toBeGreaterThan(0);
		expect(joinedMarkers[0].label).not.toBe("ראשון");
	});

	it("exposes the fixed standalone Shabbat layer for the book view", () => {
		const markers = getUnitShabbatAliyahMarkers(unitByName("בראשית").unitId);
		expect(Object.keys(markers)).toContain("1:1");
		expect(markers["2:4"]?.[0]).toMatchObject({
			key: "Bereshit:shabbat",
			label: "שני",
		});
		// No weekday or joined keys leak into the fixed book layer.
		for (const specs of Object.values(markers)) {
			for (const spec of specs) {
				expect(spec.key).toBe("Bereshit:shabbat");
			}
		}
	});
});

describe("boundary helpers", () => {
	it("aliyahStartMarkers keys every boundary by start coordinate", () => {
		const boundaries = must(
			getAliyot(getStandaloneReading(unitByName("בראשית").unitId)),
		);
		const map = aliyahStartMarkers(boundaries);
		expect(map.size).toBe(boundaries.length);
		expect(map.get("1:1")?.label).toBe("ראשון");
		expect(map.get("6:5")?.label).toBe("מפטיר");
	});

	it("aliyahContaining finds the boundary holding a coordinate", () => {
		const boundaries = must(
			getAliyot(getStandaloneReading(unitByName("בראשית").unitId)),
		);
		// בראשית ב י sits inside aliyah 2 (ב ד-ב יט) and inside maftir? No —
		// maftir repeats only ו ה-ח; ב י is solely aliyah 2.
		const found = aliyahContaining(boundaries, {
			perekId: perekIdOf("בראשית", 2),
			pasuk: 10,
		});
		expect(found?.ordinal).toBe(2);
		// A coordinate inside the maftir tail resolves to the *first*
		// containing boundary — the regular seventh aliyah, not מפטיר.
		const tail = aliyahContaining(boundaries, {
			perekId: perekIdOf("בראשית", 6),
			pasuk: 6,
		});
		expect(tail?.ordinal).toBe(7);
	});

	it("aliyahContaining returns null outside every boundary", () => {
		const boundaries = must(
			getAliyot(getStandaloneReading(unitByName("בראשית").unitId)),
		);
		const outside = aliyahContaining(boundaries, {
			perekId: perekIdOf("שמות", 1),
			pasuk: 1,
		});
		expect(outside).toBeNull();
	});

	it("returns empty/null lookups for unknown ids", () => {
		expect(getJoinedReadingsForUnit(99999)).toEqual([]);
		expect(getParashaReadingById("Not-A-Reading")).toBeNull();
	});
});
