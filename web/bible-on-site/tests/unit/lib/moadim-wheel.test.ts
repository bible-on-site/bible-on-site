/**
 * @jest-environment node
 *
 * מעגל השנה wheel model (#3101, PR #3131 redesign): month resolution,
 * equal-arc slices, contiguous month bands, spoke/band rotations,
 * sector geometry and name wrapping — pure functions, no DOM.
 */
import {
	bandHue,
	bandRotation,
	buildMoedWheel,
	HEBREW_MONTHS,
	MONTH_HUES,
	monthKeyOf,
	OTHER_BAND_KEY,
	OTHER_BAND_LABEL,
	polar,
	sectorPath,
	spokeRotation,
	starOfDavidPath,
	wrapMoedName,
} from "../../../src/lib/moadim";
import type { MoedSummary } from "../../../src/lib/moadim";

const moed = (id: number, extra: Partial<MoedSummary> = {}): MoedSummary => ({
	id,
	slug: `moed-${id}`,
	name: `מועד ${id}`,
	summary: null,
	hebrewMonth: null,
	dateLabel: null,
	annualOrder: id,
	...extra,
});

describe("monthKeyOf", () => {
	it("returns the canonical month for exact values", () => {
		expect(monthKeyOf("ניסן")).toBe("ניסן");
		expect(monthKeyOf("אדר")).toBe("אדר");
	});

	it("resolves composite values to the earliest contained canonical month", () => {
		expect(monthKeyOf("אדר ב")).toBe("אדר");
		expect(monthKeyOf("כסלו-טבת")).toBe("כסלו");
		expect(monthKeyOf("טבת-כסלו")).toBe("טבת");
	});

	it("keeps unknown literal text as its own band", () => {
		expect(monthKeyOf("חודש מיוחד")).toBe("חודש מיוחד");
	});

	it("groups missing months into the other band", () => {
		expect(monthKeyOf(null)).toBe(OTHER_BAND_KEY);
		expect(monthKeyOf("   ")).toBe(OTHER_BAND_KEY);
	});
});

describe("bandHue", () => {
	it("maps every canonical month to a distinct hue", () => {
		const hues = HEBREW_MONTHS.map((m) => bandHue(m));
		expect(new Set(hues).size).toBe(HEBREW_MONTHS.length);
		for (const month of HEBREW_MONTHS) {
			expect(bandHue(month)).toBe(MONTH_HUES[month]);
		}
	});

	it("returns null for non-canonical bands", () => {
		expect(bandHue(OTHER_BAND_KEY)).toBeNull();
		expect(bandHue("חודש מיוחד")).toBeNull();
	});
});

describe("buildMoedWheel", () => {
	it("gives every moed an equal sector in stored order", () => {
		const wheel = buildMoedWheel([
			moed(1, { hebrewMonth: "ניסן" }),
			moed(2, { hebrewMonth: "אייר" }),
			moed(3),
			moed(4),
		]);
		expect(wheel.slices).toHaveLength(4);
		for (const [i, slice] of wheel.slices.entries()) {
			expect(slice.startDeg).toBeCloseTo(i * 90);
			expect(slice.endDeg).toBeCloseTo((i + 1) * 90);
			expect(slice.midDeg).toBeCloseTo(i * 90 + 45);
		}
		expect(wheel.slices[2].hue).toBeNull();
	});

	it("merges contiguous same-month slices into one band", () => {
		const wheel = buildMoedWheel([
			moed(1, { hebrewMonth: "תשרי" }),
			moed(2, { hebrewMonth: "תשרי" }),
			moed(3, { hebrewMonth: "כסלו" }),
			moed(4),
		]);
		expect(wheel.bands.map((b) => b.label)).toEqual([
			"תשרי",
			"כסלו",
			OTHER_BAND_LABEL,
		]);
		expect(wheel.bands[0].startDeg).toBeCloseTo(0);
		expect(wheel.bands[0].endDeg).toBeCloseTo(180);
		expect(wheel.bands[0].hue).toBe(MONTH_HUES.תשרי);
		expect(wheel.bands[2].hue).toBeNull();
	});

	it("splits a month into two bands when its moadim are not contiguous", () => {
		const wheel = buildMoedWheel([
			moed(1, { hebrewMonth: "ניסן" }),
			moed(2, { hebrewMonth: "אייר" }),
			moed(3, { hebrewMonth: "ניסן" }),
		]);
		expect(wheel.bands.map((b) => b.label)).toEqual([
			"ניסן",
			"אייר",
			"ניסן",
		]);
	});

	it("handles a single moed as a full-circle slice and band", () => {
		const wheel = buildMoedWheel([moed(1, { hebrewMonth: "אב" })]);
		expect(wheel.slices[0].endDeg - wheel.slices[0].startDeg).toBeCloseTo(360);
		expect(wheel.bands[0].endDeg).toBeCloseTo(360);
	});
});

describe("polar", () => {
	it("places deg 0 at the top and runs clockwise", () => {
		expect(polar(500, 500, 100, 0)).toEqual([500, 400]);
		expect(polar(500, 500, 100, 90)).toEqual([600, 500]);
		expect(polar(500, 500, 100, 180)).toEqual([500, 600]);
		const [x, y] = polar(500, 500, 100, 270);
		expect(x).toBeCloseTo(400);
		expect(y).toBeCloseTo(500);
	});
});

describe("sectorPath", () => {
	it("emits a closed annulus segment", () => {
		const d = sectorPath(500, 500, 170, 428, 0, 90);
		expect(d).toContain("M 500 72");
		expect(d).toContain("A 428 428 0 0 1 928 500");
		expect(d).toContain("L 670 500");
		expect(d).toContain("A 170 170 0 0 0 500 330");
		expect(d).toMatch(/Z$/);
	});

	it("flags the large arc when a sector spans more than 180°", () => {
		expect(sectorPath(500, 500, 10, 20, 0, 200)).toContain("0 1 1");
	});

	it("splits a near-full circle into two half arcs", () => {
		const d = sectorPath(500, 500, 170, 428, 0, 360);
		expect(d).toContain("A 428 428 0 0 1 500 928");
		expect((d.match(/A 428/g) ?? []).length).toBe(2);
	});
});

describe("spokeRotation", () => {
	it("keeps spokes readable on both wheel halves", () => {
		expect(spokeRotation(0)).toBe(270);
		expect(spokeRotation(90)).toBe(0);
		expect(spokeRotation(180)).toBe(90);
		expect(spokeRotation(270)).toBe(0);
		expect(spokeRotation(315)).toBe(45);
	});
});

describe("bandRotation", () => {
	it("keeps rim labels within ±90° of upright", () => {
		expect(bandRotation(0)).toBe(0);
		expect(bandRotation(60)).toBe(60);
		expect(bandRotation(120)).toBe(-60);
		expect(bandRotation(180)).toBe(0);
		expect(bandRotation(270)).toBe(90);
	});
});

describe("wrapMoedName", () => {
	it("keeps short names on one line", () => {
		expect(wrapMoedName("פסח")).toEqual(["פסח"]);
		expect(wrapMoedName("ראש השנה")).toEqual(["ראש השנה"]);
	});

	it("balances long names across two lines", () => {
		expect(wrapMoedName("שמיני עצרת ושמחת תורה")).toEqual([
			"שמיני עצרת",
			"ושמחת תורה",
		]);
		expect(wrapMoedName("שבעה עשר בתמוז")).toEqual(["שבעה עשר", "בתמוז"]);
	});

	it("returns one unbreakable word as a single line", () => {
		expect(wrapMoedName("אאאאאאאאאאאאאא")).toEqual(["אאאאאאאאאאאאאא"]);
	});
});

describe("starOfDavidPath", () => {
	it("emits two closed triangles", () => {
		const d = starOfDavidPath(500, 480, 60);
		expect(d).toContain("M 500 420");
		expect(d).toContain("M 500 540");
		expect((d.match(/Z/g) ?? [])).toHaveLength(2);
	});
});
