import type { AdditionalsItem } from "../../../src/data/db/tanah-view-types";
import {
	getAllPerakim,
	getSeferByName,
	getSeferOrAdditionalByName,
} from "../../../src/data/sefer-dto";

describe("getSeferOrAdditionalByName", () => {
	describe("when invalid sefer name", () => {
		it("throws error", () => {
			expect(() => getSeferOrAdditionalByName("ספר מקבים")).toThrow(
				"Invalid sefer name: ספר מקבים",
			);
		});
	});
	describe("when invalid additional letter", () => {
		describe("when sefer has other addtionals", () => {
			it("throws error", () => {
				expect(() => getSeferOrAdditionalByName("שמואל", "ג")).toThrow(
					"Invalid additional letter: ג",
				);
			});
		});
		describe("when sefer has no other addtionals", () => {
			it("throws error", () => {
				expect(() => getSeferOrAdditionalByName("ישעיהו", "ב")).toThrow(
					"Sefer ישעיהו has no addtionals at all and requested additional letter: ב",
				);
			});
		});
	});
	describe("when בראשית", () => {
		const actual = getSeferOrAdditionalByName("בראשית");
		it("has name בראשית", () => {
			expect(actual.name).toBe("בראשית");
		});
		it("has helek תורה", () => {
			expect(actual.helek).toBe("תורה");
		});
		it("has perekFrom 1", () => {
			expect(actual.perekFrom).toBe(1);
		});
		it("has perekTo 50", () => {
			expect(actual.perekTo).toBe(50);
		});
		it("has pesukimCount 1533", () => {
			expect(actual.pesukimCount).toBe(1533);
		});
		it("has tanachUsName Genesis", () => {
			expect(actual.tanachUsName).toBe("Genesis");
		});
		it("has 50 perakim", () => {
			expect(actual.perakim).toHaveLength(50);
		});
	});
	describe("when שמואל א", () => {
		const actual = getSeferOrAdditionalByName("שמואל", "א") as AdditionalsItem;
		it("has name שמואל א", () => {
			expect(actual.name).toBe("שמואל א");
		});
		it("has helek נביאים", () => {
			expect(actual.helek).toBe("נביאים");
		});
		it("has perekFrom 233", () => {
			expect(actual.perekFrom).toBe(233);
		});
		it("has perekTo 263", () => {
			expect(actual.perekTo).toBe(263);
		});
		it("has pesukimCount 811", () => {
			expect(actual.pesukimCount).toBe(811);
		});
		it("has letter א", () => {
			expect(actual.letter).toBe("א");
		});
		it("has tanachUsName I Samuel", () => {
			expect(actual.tanachUsName).toBe("I Samuel");
		});
		it("has 31 perakim", () => {
			expect(actual.perakim).toHaveLength(31);
		});
	});
});

describe("getSeferByName", () => {
	describe("when valid sefer name", () => {
		const actual = getSeferByName("בראשית");
		it("returns sefer with correct name", () => {
			expect(actual.name).toBe("בראשית");
		});
		it("has perakim array", () => {
			expect("perakim" in actual || "additionals" in actual).toBe(true);
		});
	});
	describe("when sefer with additionals", () => {
		const actual = getSeferByName("שמואל");
		it("returns sefer with additionals", () => {
			expect("additionals" in actual).toBe(true);
		});
	});
	describe("when invalid sefer name", () => {
		it("throws error", () => {
			expect(() => getSeferByName("ספר מקבים")).toThrow(
				"Invalid sefer name: ספר מקבים",
			);
		});
	});
});

describe("getAllPerakim", () => {
	const allPerakim = getAllPerakim();

	it("returns 929 perakim total", () => {
		expect(allPerakim).toHaveLength(929);
	});

	it("assigns sequential perekId starting from 1", () => {
		expect(allPerakim[0].perekId).toBe(1);
		expect(allPerakim[928].perekId).toBe(929);
	});

	it("first perek has pesukim with segments", () => {
		expect(allPerakim[0].pesukim.length).toBeGreaterThan(0);
		expect(allPerakim[0].pesukim[0].segments).toBeDefined();
	});

	it("last perek has pesukim with segments", () => {
		expect(allPerakim[928].pesukim.length).toBeGreaterThan(0);
		expect(allPerakim[928].pesukim[0].segments).toBeDefined();
	});

	it("all perakim have pesukim array", () => {
		for (const perek of allPerakim) {
			expect(perek.pesukim).toBeDefined();
			expect(Array.isArray(perek.pesukim)).toBe(true);
		}
	});

	it("includes perakim from sefarim with additionals", () => {
		// Shemuel has 62 perakim (31 + 31), starting at perek 233
		const shemuelPerakim = allPerakim.filter(
			(p) => p.perekId >= 233 && p.perekId <= 294,
		);
		expect(shemuelPerakim).toHaveLength(62);
	});
});
