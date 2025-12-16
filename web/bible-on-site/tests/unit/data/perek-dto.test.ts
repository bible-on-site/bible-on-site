jest.mock("../../../src/util/date", () => ({
	getCurrentDate: () => new Date("2024-06-27T12:00:00+03:00"),
}));

import {
	getPerekByPerekId,
	getPerekIdByDate,
	getTodaysPerekId,
} from "../../../src/data/perek-dto";
import { parseKosherChristianDate } from "../../util/dates";

describe("getPerekIdByDate", () => {
	describe("21 Sivan 5784 (inside 3d cycle)", () => {
		it("returns 625", () => {
			const actual = getPerekIdByDate(parseKosherChristianDate("27/June/24"));
			expect(actual).toBe(625);
		});
	});
	describe("before 1st cycle (I.E. 22 Kislev 5774)", () => {
		it("returns 1st perek", () => {
			const actual = getPerekIdByDate(
				parseKosherChristianDate("14/December/14"),
			);
			expect(actual).toBe(1);
		});
	});
	describe("between cycles (I.E. 29 Tamuz 5784)", () => {
		it("returns 1st perek", () => {
			const actual = getPerekIdByDate(parseKosherChristianDate("12/July/14"));
			expect(actual).toBe(1);
		});
	});
	describe("after last cycle (I.E. 29 Elul 5938)", () => {
		it("returns last perek (929)", () => {
			const actual = getPerekIdByDate(
				parseKosherChristianDate("29/September/38"),
			);
			expect(actual).toBe(929);
		});
	});
});

describe("getPerekByPerekId", () => {
	describe("First perek in tanah", () => {
		const actual = getPerekByPerekId(1);
		it("has perekId 1", () => {
			expect(actual.perekId).toBe(1);
		});
		it("has perekHeb א", () => {
			expect(actual.perekHeb).toBe("א");
		});
		it("has header בריאת העולם", () => {
			expect(actual.header).toBe("בריאת העולם");
		});
		it("has helek תורה", () => {
			expect(actual.helek).toBe("תורה");
		});
		it("has sefer בראשית", () => {
			expect(actual.sefer).toBe("בראשית");
		});
		it("has source בראשית א", () => {
			expect(actual.source).toBe("בראשית א");
		});
	});
	describe("Second perek in tanah", () => {
		const actual = getPerekByPerekId(2);
		it("has perekId 2", () => {
			expect(actual.perekId).toBe(2);
		});
		it("has perekHeb א", () => {
			expect(actual.perekHeb).toBe("ב");
		});
		it("has header גן בעדן, אדם ואשתו", () => {
			expect(actual.header).toBe("גן בעדן, אדם ואשתו");
		});
		it("has helek תורה", () => {
			expect(actual.helek).toBe("תורה");
		});
		it("has sefer בראשית", () => {
			expect(actual.sefer).toBe("בראשית");
		});
		it("has source בראשית ב", () => {
			expect(actual.source).toBe("בראשית ב");
		});
	});
	describe("perek in sefer with additionals (252, Shemuel I 20)", () => {
		const actual = getPerekByPerekId(252);
		it("has perekId 252", () => {
			expect(actual.perekId).toBe(252);
		});
		it("has perekHeb כ", () => {
			expect(actual.perekHeb).toBe("כ");
		});
		it("has helek נביאים", () => {
			expect(actual.helek).toBe("נביאים");
		});
		it("has sefer שמואל", () => {
			expect(actual.sefer).toBe("שמואל");
		});
		it("has additional א", () => {
			expect(actual.additional).toBe("א");
		});
		it("has source שמואל א כ", () => {
			expect(actual.source).toBe("שמואל א כ");
		});
	});
	describe("Zero Perek", () => {
		it("throws an error", () => {
			expect(() => getPerekByPerekId(0)).toThrow("Invalid perekId: 0");
		});
	});
	describe("Negative Perek", () => {
		it("throws an error", () => {
			expect(() => getPerekByPerekId(-300)).toThrow("Invalid perekId: -300");
		});
	});
	describe("Perek with qri segments (perek 25 - בראשית כה)", () => {
		const actual = getPerekByPerekId(25);
		it("has perekId 25", () => {
			expect(actual.perekId).toBe(25);
		});
		it("has sefer בראשית", () => {
			expect(actual.sefer).toBe("בראשית");
		});
		it("has perekHeb כה", () => {
			expect(actual.perekHeb).toBe("כה");
		});
		it("contains qri segment in pesukim", () => {
			const qriSegments = actual.pesukim.flatMap((pasuk) =>
				pasuk.segments.filter((segment) => segment.type === "qri"),
			);
			expect(qriSegments.length).toBeGreaterThan(0);
		});
		it("qri segment has expected structure", () => {
			const qriSegments = actual.pesukim.flatMap((pasuk) =>
				pasuk.segments.filter((segment) => segment.type === "qri"),
			);
			const firstQri = qriSegments[0];
			expect(firstQri).toHaveProperty("type", "qri");
			expect(firstQri).toHaveProperty("value");
			expect(typeof firstQri.value).toBe("string");
		});
	});
});

describe("getTodaysPerekId", () => {
	it("returns correct perek for mocked date (27/June/24 = perek 625)", () => {
		const actual = getTodaysPerekId();
		expect(actual).toBe(625);
	});
});
