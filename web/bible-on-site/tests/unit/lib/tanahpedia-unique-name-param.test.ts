import { normalizedUniqueNameFromParam } from "../../../src/lib/tanahpedia/unique-name-param";

describe("normalizedUniqueNameFromParam", () => {
	it("trims whitespace", () => {
		expect(normalizedUniqueNameFromParam("  שמשון  ")).toBe("שמשון");
	});

	it("returns Hebrew segment unchanged when already decoded", () => {
		expect(normalizedUniqueNameFromParam("שמשון")).toBe("שמשון");
	});

	it("decodes percent-encoded UTF-8", () => {
		const encoded = encodeURIComponent("שמשון");
		expect(normalizedUniqueNameFromParam(encoded)).toBe("שמשון");
	});

	it("applies Unicode NFC normalization", () => {
		const nfd = "\u0065\u0301"; // é as e + combining acute (NFD)
		expect(normalizedUniqueNameFromParam(nfd)).toBe("\u00e9");
	});

	it("falls back to raw segment on invalid percent escapes", () => {
		expect(normalizedUniqueNameFromParam("bad%ZZ-name")).toBe("bad%ZZ-name");
	});
});
