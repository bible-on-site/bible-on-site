import { sefarim } from "../../../src/data/db/sefarim";

describe("sefarim", () => {
	it("should be an array", () => {
		expect(Array.isArray(sefarim)).toBe(true);
	});

	it("should contain sefarim entries (not be empty)", () => {
		expect(sefarim.length).toBeGreaterThan(0);
	});

	it("each sefer should have required base properties", () => {
		sefarim.forEach((sefer) => {
			expect(sefer).toHaveProperty("name");
			expect(sefer).toHaveProperty("helek");
			expect(sefer).toHaveProperty("pesukimCount");
			expect(sefer).toHaveProperty("perekFrom");
			expect(sefer).toHaveProperty("perekTo");
			expect(typeof sefer.name).toBe("string");
			expect(typeof sefer.helek).toBe("string");
			expect(typeof sefer.pesukimCount).toBe("number");
			expect(typeof sefer.perekFrom).toBe("number");
			expect(typeof sefer.perekTo).toBe("number");
		});
	});

	it("each sefer should have either perakim or additionals", () => {
		sefarim.forEach((sefer) => {
			const hasPerakim = "perakim" in sefer;
			const hasAdditionals = "additionals" in sefer;
			// Each sefer should have one or the other (but not neither)
			expect(hasPerakim || hasAdditionals).toBe(true);
		});
	});

	it("sefarim with perakim should have valid perakim arrays", () => {
		const sefarimWithPerakim = sefarim.filter((s) => "perakim" in s);

		sefarimWithPerakim.forEach((sefer) => {
			if ("perakim" in sefer) {
				expect(Array.isArray(sefer.perakim)).toBe(true);
				expect(sefer.perakim.length).toBeGreaterThan(0);

				sefer.perakim.forEach((perek) => {
					expect(perek).toHaveProperty("header");
					expect(perek).toHaveProperty("date");
					expect(perek).toHaveProperty("pesukim");
					expect(Array.isArray(perek.pesukim)).toBe(true);
				});
			}
		});
	});

	it("sefarim with additionals should have valid additionals structure", () => {
		const sefarimWithAdditionals = sefarim.filter((s) => "additionals" in s);

		sefarimWithAdditionals.forEach((sefer) => {
			if ("additionals" in sefer) {
				expect(Array.isArray(sefer.additionals)).toBe(true);
				expect(sefer.additionals.length).toBe(2); // Additionals is a tuple of 2

				sefer.additionals.forEach((additional) => {
					expect(additional).toHaveProperty("helek");
					expect(additional).toHaveProperty("letter");
					expect(additional).toHaveProperty("name");
					expect(additional).toHaveProperty("perakim");
					expect(Array.isArray(additional.perakim)).toBe(true);
				});
			}
		});
	});

	it("should contain expected heleks (Torah, Neviim, Ketuvim)", () => {
		const heleks = new Set(sefarim.map((s) => s.helek));
		// At least one of these should exist
		const expectedHeleks = ["תורה", "נביאים", "כתובים"];
		const hasExpectedHelek = expectedHeleks.some((h) => heleks.has(h));
		expect(hasExpectedHelek).toBe(true);
	});

	it("perekFrom should be less than or equal to perekTo", () => {
		sefarim.forEach((sefer) => {
			expect(sefer.perekFrom).toBeLessThanOrEqual(sefer.perekTo);
		});
	});

	it("pesukimCount should be a positive number", () => {
		sefarim.forEach((sefer) => {
			expect(sefer.pesukimCount).toBeGreaterThan(0);
		});
	});
});
