import { describe, expect, it } from "vitest";
import {
	aliasKindForTargetCount,
	dedupeAliasTargets,
	normalizePediaName,
	pediaNameFromInput,
	pediaPublicUrl,
	reservedCategoryLabelFor,
	validateAliasSpec,
} from "~/lib/tanahpedia/pedia-names";

describe("normalizePediaName", () => {
	it("trims surrounding whitespace", () => {
		expect(normalizePediaName("  משה  ")).toBe("משה");
	});

	it("decodes a percent-encoded name to its stored form", () => {
		expect(normalizePediaName("%D7%9E%D7%A9%D7%94")).toBe("משה");
	});

	it("keeps the raw value when escapes are malformed", () => {
		expect(normalizePediaName("%ZZ%")).toBe("%ZZ%");
	});

	it("normalizes Unicode to NFC so lookups match the public router", () => {
		const decomposed = "מְשֶׁה".normalize("NFD");
		expect(normalizePediaName(decomposed)).toBe(decomposed.normalize("NFC"));
	});
});

describe("pediaNameFromInput", () => {
	it("passes a bare name through unchanged", () => {
		expect(pediaNameFromInput("משה-רבנו")).toBe("משה-רבנו");
	});

	it("takes the last segment of a full public URL", () => {
		expect(
			pediaNameFromInput("https://bible-on-site.com/pedia/%D7%9E%D7%A9%D7%94"),
		).toBe("משה");
	});

	it("handles a /pedia/ path without an origin", () => {
		expect(pediaNameFromInput("/pedia/משה-רבנו")).toBe("משה-רבנו");
	});

	it("strips query strings and fragments from pasted URLs", () => {
		expect(pediaNameFromInput("http://x.test/pedia/משה?role=king#top")).toBe(
			"משה",
		);
	});

	it("takes the last segment of nested admin paths too", () => {
		expect(pediaNameFromInput("http://x.test/tanahpedia/entries/אב")).toBe(
			"אב",
		);
	});

	it("returns an empty string for empty input", () => {
		expect(pediaNameFromInput("   ")).toBe("");
	});

	it("returns an empty string for a URL with no trailing name segment", () => {
		expect(pediaNameFromInput("http://x.test/pedia/")).toBe("");
	});
});

describe("reservedCategoryLabelFor", () => {
	it("flags the Hebrew category slug", () => {
		expect(reservedCategoryLabelFor("אישים")).toBe("אישים");
	});

	it("flags a space-separated variant that normalizes to the slug", () => {
		expect(reservedCategoryLabelFor("בעלי חיים")).toBe("בעלי חיים");
	});

	it("flags a legacy English category key", () => {
		expect(reservedCategoryLabelFor("person")).toBe("אישים");
	});

	it("flags a percent-encoded category slug", () => {
		expect(reservedCategoryLabelFor("%D7%90%D7%99%D7%A9%D7%99%D7%9D")).toBe(
			"אישים",
		);
	});

	it("returns null for a regular name", () => {
		expect(reservedCategoryLabelFor("משה-רבנו")).toBeNull();
	});
});

describe("pediaPublicUrl", () => {
	it("builds the full public URL under the configured origin", () => {
		expect(pediaPublicUrl("https://site.test", "משה-רבנו")).toBe(
			"https://site.test/pedia/%D7%9E%D7%A9%D7%94-%D7%A8%D7%91%D7%A0%D7%95",
		);
	});

	it("strips a trailing slash from the origin", () => {
		expect(pediaPublicUrl("https://site.test/", "ערך")).toBe(
			"https://site.test/pedia/%D7%A2%D7%A8%D7%9A",
		);
	});
});

describe("dedupeAliasTargets", () => {
	it("drops repeated picks of the same entry", () => {
		expect(
			dedupeAliasTargets([
				{ entryId: "a", label: "x" },
				{ entryId: "a", label: "y" },
			]),
		).toEqual([{ entryId: "a", label: "x" }]);
	});

	it("fills an empty label from a later duplicate pick", () => {
		expect(
			dedupeAliasTargets([
				{ entryId: "a", label: " " },
				{ entryId: "a", label: "תווית" },
			]),
		).toEqual([{ entryId: "a", label: "תווית" }]);
	});

	it("trims labels", () => {
		expect(dedupeAliasTargets([{ entryId: "a", label: "  תווית  " }])).toEqual([
			{ entryId: "a", label: "תווית" },
		]);
	});
});

describe("aliasKindForTargetCount", () => {
	it("reports a plain alias for a single target", () => {
		expect(aliasKindForTargetCount(1)).toBe("alias");
	});

	it("reports a disambiguation page for several targets", () => {
		expect(aliasKindForTargetCount(2)).toBe("disambiguation");
	});
});

describe("validateAliasSpec", () => {
	it("rejects an empty name", () => {
		expect(validateAliasSpec("", [{ entryId: "a", label: "" }])).toEqual(
			expect.objectContaining({ ok: false }),
		);
	});

	it("rejects a name containing a path separator", () => {
		expect(validateAliasSpec("א/ב", [{ entryId: "a", label: "" }])).toEqual(
			expect.objectContaining({ ok: false }),
		);
	});

	it("rejects a spec with no targets", () => {
		expect(validateAliasSpec("משה", [])).toEqual(
			expect.objectContaining({ ok: false }),
		);
	});

	it("accepts a single unlabelled target", () => {
		expect(validateAliasSpec("משה", [{ entryId: "a", label: "" }])).toEqual({
			ok: true,
		});
	});

	it("requires a distinguishing label on every target of a shared name", () => {
		expect(
			validateAliasSpec("משה", [
				{ entryId: "a", label: "הנביא" },
				{ entryId: "b", label: " " },
			]),
		).toEqual(expect.objectContaining({ ok: false }));
	});

	it("accepts a shared name when every target is labelled", () => {
		expect(
			validateAliasSpec("משה", [
				{ entryId: "a", label: "הנביא" },
				{ entryId: "b", label: "בן עמרם" },
			]),
		).toEqual({ ok: true });
	});

	it("rejects an over-long name", () => {
		expect(
			validateAliasSpec("א".repeat(256), [{ entryId: "a", label: "" }]),
		).toEqual(expect.objectContaining({ ok: false }));
	});

	it("rejects an over-long label", () => {
		expect(
			validateAliasSpec("משה", [{ entryId: "a", label: "א".repeat(256) }]),
		).toEqual(expect.objectContaining({ ok: false }));
	});
});
