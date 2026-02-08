import { sanitizeForUrl, toUrlSlug } from "@/util/slug";

describe("slug utilities", () => {
	describe("sanitizeForUrl", () => {
		it("strips ASCII double quotes", () => {
			expect(sanitizeForUrl('שליט"א')).toBe("שליטא");
		});

		it("strips Hebrew gershayim (״)", () => {
			expect(sanitizeForUrl("שליט״א")).toBe("שליטא");
		});

		it("strips Hebrew geresh (׳)", () => {
			expect(sanitizeForUrl("ר׳ משה")).toBe("ר משה");
		});

		it("strips ASCII single quotes", () => {
			expect(sanitizeForUrl("ר' משה")).toBe("ר משה");
		});

		it("strips multiple problematic characters", () => {
			expect(sanitizeForUrl('הרב "אברהם" ז״ל')).toBe("הרב אברהם זל");
		});

		it("trims surrounding whitespace", () => {
			expect(sanitizeForUrl("  הרב לדוגמא  ")).toBe("הרב לדוגמא");
		});

		it("returns unchanged text when no problematic characters", () => {
			expect(sanitizeForUrl("הרב לדוגמא שליטא")).toBe("הרב לדוגמא שליטא");
		});

		it("handles empty string", () => {
			expect(sanitizeForUrl("")).toBe("");
		});
	});

	describe("toUrlSlug", () => {
		it("sanitises and percent-encodes Hebrew text", () => {
			const slug = toUrlSlug('הרב לדוגמא שליט"א');
			// Should strip the quote and encode
			expect(slug).toBe(encodeURIComponent("הרב לדוגמא שליטא"));
		});

		it("encodes spaces as %20", () => {
			const slug = toUrlSlug("הרב משה");
			expect(slug).toContain("%20");
		});

		it("produces decodable slug", () => {
			const original = 'הרב איתן שנדורפי שליט"א';
			const slug = toUrlSlug(original);
			expect(decodeURIComponent(slug)).toBe("הרב איתן שנדורפי שליטא");
		});
	});
});
