/**
 * @jest-environment node
 *
 * The פרשה slug contract (issue #2738): one canonical Hebrew-name slug
 * per unit, researched aliases and shared 'פרשת {name}' forms, and a
 * single normalized resolution map that rejects collisions and
 * malformed input at build time.
 */
import {
	buildParashaSlugIndex,
	normalizeParashaSegment,
	PARASHA_SLUG_RECORDS,
	parashaCanonicalPath,
	parashaCanonicalSlug,
	resolveParashaSegment,
} from "../../../src/data/parasha/parasha-slugs";
import { getAllParashaUnits } from "../../../src/data/parasha/parasha-units";

/** The full 54-slug canonical table — mirrored by the SQLite export's
 * parity assertion in reading_units.rs. */
const EXPECTED_SLUGS = [
	"בראשית", "נח", "לך-לך", "וירא", "חיי-שרה", "תולדות", "ויצא", "וישלח",
	"וישב", "מקץ", "ויגש", "ויחי", "שמות", "וארא", "בא", "בשלח", "יתרו",
	"משפטים", "תרומה", "תצוה", "כי-תשא", "ויקהל", "פקודי", "ויקרא", "צו",
	"שמיני", "תזריע", "מצורע", "אחרי-מות", "קדושים", "אמור", "בהר",
	"בחוקותי", "במדבר", "נשא", "בהעלותך", "שלח", "קרח", "חוקת", "בלק",
	"פינחס", "מטות", "מסעי", "דברים", "ואתחנן", "עקב", "ראה", "שופטים",
	"כי-תצא", "כי-תבוא", "נצבים", "וילך", "האזינו", "וזאת-הברכה",
];

describe("PARASHA_SLUG_RECORDS", () => {
	it("carries exactly the 54 canonical slugs, in unit order", () => {
		expect(PARASHA_SLUG_RECORDS).toHaveLength(54);
		expect(PARASHA_SLUG_RECORDS.map((r) => r.slug)).toEqual(EXPECTED_SLUGS);
		expect(PARASHA_SLUG_RECORDS.map((r) => r.unitId)).toEqual(
			Array.from({ length: 54 }, (_, i) => i + 1),
		);
		// Display names keep spaces; slugs keep ASCII hyphens.
		expect(PARASHA_SLUG_RECORDS[2].name).toBe("לך לך");
		expect(PARASHA_SLUG_RECORDS[53].name).toBe("וזאת הברכה");
	});

	it("stays in parity with the derived reading units", () => {
		expect(getAllParashaUnits().map((u) => u.slug)).toEqual(EXPECTED_SLUGS);
	});
});

describe("normalizeParashaSegment", () => {
	it("folds spaces, maqaf, and dashes into one ASCII hyphen", () => {
		expect(normalizeParashaSegment("לך לך")).toBe("לך-לך");
		expect(normalizeParashaSegment("לך־לך")).toBe("לך-לך");
		expect(normalizeParashaSegment("לך–לך")).toBe("לך-לך");
		expect(normalizeParashaSegment("לך  לך")).toBe("לך-לך");
		expect(normalizeParashaSegment("לך־ לך")).toBe("לך-לך");
		// NBSP and mixed separators collapse too.
		expect(normalizeParashaSegment("לך לך")).toBe("לך-לך");
	});

	it("strips niqqud, teamim, and quote marks", () => {
		expect(normalizeParashaSegment("לֶךְ־לֵךְ")).toBe("לך-לך");
		expect(normalizeParashaSegment('תנ"ך')).toBe("תנך");
		expect(normalizeParashaSegment("אחרֵי מוֹת")).toBe("אחרי-מות");
	});

	it("trims edge separators", () => {
		expect(normalizeParashaSegment(" לך לך ")).toBe("לך-לך");
		expect(normalizeParashaSegment("-לך-לך-")).toBe("לך-לך");
	});

	it("rejects non-Hebrew content without dropping meaningful letters", () => {
		for (const input of [
			"abc",
			"1garbage",
			"לך לך!",
			"לך.לך",
			"לך/לך",
			"",
			" ",
			"-",
			"123",
		]) {
			expect(normalizeParashaSegment(input)).toBeNull();
		}
	});
});

describe("resolveParashaSegment", () => {
	it("resolves every canonical slug as canonical", () => {
		for (const record of PARASHA_SLUG_RECORDS) {
			expect(resolveParashaSegment(record.slug)).toEqual({
				unitId: record.unitId,
				slug: record.slug,
				kind: "canonical",
			});
		}
	});

	it("resolves decimal unit ids as numeric", () => {
		expect(resolveParashaSegment("1")).toEqual({
			unitId: 1,
			slug: "בראשית",
			kind: "numeric",
		});
		expect(resolveParashaSegment("54")).toEqual({
			unitId: 54,
			slug: "וזאת-הברכה",
			kind: "numeric",
		});
		expect(resolveParashaSegment("054")).toEqual({
			unitId: 54,
			slug: "וזאת-הברכה",
			kind: "numeric",
		});
	});

	it("resolves researched aliases as alias", () => {
		for (const [alias, unitId, slug] of [
			["נוח", 2, "נח"],
			["תצווה", 20, "תצוה"],
			["אחרי", 29, "אחרי-מות"],
			["בחוקתי", 33, "בחוקותי"],
			["בחקתי", 33, "בחוקותי"],
			["שלח לך", 37, "שלח"],
			["קורח", 38, "קרח"],
			["חקת", 39, "חוקת"],
			["פנחס", 41, "פינחס"],
			["ניצבים", 51, "נצבים"],
			["ברכה", 54, "וזאת-הברכה"],
		] as const) {
			expect(resolveParashaSegment(alias)).toEqual({ unitId, slug, kind: "alias" });
		}
	});

	it("resolves the shared 'פרשת {name}' and 'פרשת {alias}' forms", () => {
		expect(resolveParashaSegment("פרשת בראשית")).toMatchObject({
			unitId: 1,
			slug: "בראשית",
			kind: "alias",
		});
		expect(resolveParashaSegment("פרשת-לך-לך")).toMatchObject({
			unitId: 3,
			kind: "alias",
		});
		expect(resolveParashaSegment("פרשת תצווה")).toMatchObject({
			unitId: 20,
			kind: "alias",
		});
		expect(resolveParashaSegment("פרשת וזאת הברכה")).toMatchObject({
			unitId: 54,
			kind: "alias",
		});
	});

	it("resolves separator and niqqud variants as alias", () => {
		expect(resolveParashaSegment("לך לך")).toMatchObject({
			unitId: 3,
			slug: "לך-לך",
			kind: "alias",
		});
		expect(resolveParashaSegment("לך־לך")).toMatchObject({
			unitId: 3,
			kind: "alias",
		});
		expect(resolveParashaSegment("אחרֵי מוֹת")).toMatchObject({
			unitId: 29,
			kind: "alias",
		});
	});

	it("keeps sefer-name segments canonical — they are parasha names", () => {
		for (const [sefer, unitId] of [
			["בראשית", 1],
			["שמות", 13],
			["ויקרא", 24],
			["במדבר", 34],
			["דברים", 44],
		] as const) {
			expect(resolveParashaSegment(sefer)).toMatchObject({
				unitId,
				kind: "canonical",
			});
		}
	});

	it("never maps a joined parasha name to one constituent", () => {
		for (const joined of [
			"ויקהל-פקודי",
			"תזריע-מצורע",
			"אחרי מות-קדושים",
			"בהר-בחוקותי",
			"מטות-מסעי",
			"נצבים-וילך",
		]) {
			expect(resolveParashaSegment(joined)).toBeNull();
		}
	});

	it("rejects unknown, malformed, and out-of-range segments", () => {
		for (const segment of [
			"0",
			"55",
			"-1",
			"abc",
			"1garbage",
			"דמיון",
			"פרשת דמיון",
			"פרשת",
			"",
			"לך לך!",
		]) {
			expect(resolveParashaSegment(segment)).toBeNull();
		}
	});
});

describe("parashaCanonicalSlug / parashaCanonicalPath", () => {
	it("builds canonical Hebrew-root paths", () => {
		expect(parashaCanonicalSlug(3)).toBe("לך-לך");
		expect(parashaCanonicalPath(3)).toBe("/פרשה/לך-לך");
		expect(parashaCanonicalPath(54)).toBe("/פרשה/וזאת-הברכה");
	});

	it("throws for unit ids outside the division", () => {
		expect(() => parashaCanonicalSlug(0)).toThrow("Invalid parasha unitId");
		expect(() => parashaCanonicalPath(55)).toThrow("Invalid parasha unitId");
	});
});

describe("buildParashaSlugIndex validation", () => {
	const unit = (overrides: Record<string, unknown> = {}) => ({
		name: "פלוני",
		slug: "פלוני",
		...overrides,
	});

	it("requires the stored slug to equal the normalized name", () => {
		expect(() => buildParashaSlugIndex([unit({ slug: "אחר" })])).toThrow(
			'slug "אחר" ≠ normalized name "פלוני"',
		);
	});

	it("rejects a name that cannot form a slug", () => {
		expect(() =>
			buildParashaSlugIndex([unit({ name: "123", slug: "123" })]),
		).toThrow('unit 1 name "123" has no slug');
	});

	it("rejects colliding canonical slugs", () => {
		expect(() =>
			buildParashaSlugIndex([
				unit({ name: "לך לך", slug: "לך-לך" }),
				unit({ name: "לך־לך", slug: "לך-לך" }),
			]),
		).toThrow("collides between units 1 and 2");
	});

	it("rejects an alias that collides with another unit's canonical slug", () => {
		expect(() =>
			buildParashaSlugIndex([
				unit({ name: "ראשון", slug: "ראשון" }),
				unit({ name: "שני", slug: "שני", aliases: ["ראשון"] }),
			]),
		).toThrow("collides between units 1 and 2");
	});

	it("rejects colliding aliases and prefixed forms", () => {
		expect(() =>
			buildParashaSlugIndex([
				unit({ name: "אחד", slug: "אחד", aliases: ["משותף"] }),
				unit({ name: "שניים", slug: "שניים", aliases: ["משותף"] }),
			]),
		).toThrow("collides between units 1 and 2");
		// A unit literally named 'פרשת X' collides with X's prefixed form.
		expect(() =>
			buildParashaSlugIndex([
				unit({ name: "שלמה", slug: "שלמה" }),
				unit({ name: "פרשת שלמה", slug: "פרשת-שלמה" }),
			]),
		).toThrow("collides between units 1 and 2");
	});

	it("rejects non-Hebrew and numeric aliases", () => {
		expect(() =>
			buildParashaSlugIndex([unit({ aliases: ["lech lecha"] })]),
		).toThrow('alias "lech lecha" is not a Hebrew name');
		expect(() =>
			buildParashaSlugIndex([unit({ aliases: ["12"] })]),
		).toThrow('alias "12" is numeric');
	});

	it("lets a unit claim its own canonical form repeatedly", () => {
		// An alias equal to the canonical name is redundant, not a collision.
		const index = buildParashaSlugIndex([
			unit({ name: "יחיד", slug: "יחיד", aliases: ["יחיד"] }),
		]);
		expect(index.normalizedToUnitId.get("יחיד")).toBe(1);
	});
});
