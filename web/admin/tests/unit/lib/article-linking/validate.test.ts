import { describe, expect, it } from "vitest";
import {
	AUTHOR_ATTRIBUTION_POLICY_REASON,
	normalizeTarget,
	type RawModelOutput,
	validateModelOutput,
} from "~/lib/article-linking/validate";
import { catalogue, snapshot } from "./fixture";

const plainText = "המאמר דן בבראשית יח, ב ובשמואל ב ה, ז לעניין זה.";

function validate(raw: RawModelOutput) {
	return validateModelOutput(raw, { catalogue, plainText, snapshot });
}

describe("validateModelOutput", () => {
	describe("with valid proposals", () => {
		it("produces a pending coveringSources draft with anchored evidence", () => {
			const { drafts } = validate({
				proposals: [
					{
						relationshipKey: "coveringSources",
						action: "add",
						target: {
							citations: [{ sefer: "בראשית", perek: "יח", pasuk: "ב" }],
						},
						evidence: [{ quote: "בראשית יח, ב" }],
						confidence: 0.9,
					},
				],
			});
			expect(drafts).toHaveLength(1);
			expect(drafts[0].status).toBe("pending");
			expect(drafts[0].target).toEqual({
				pasukCoordinates: [{ perekId: 18, pasuk: 2 }],
			});
			expect(drafts[0].evidence[0].spanStart).not.toBeNull();
		});
	});

	it("abstains from authorship even for a catalogue author with anchored evidence", () => {
		const { drafts, abstentions } = validateModelOutput(
			{
				proposals: [
					{
						relationshipKey: "author",
						action: "replace",
						target: { authorId: 7 },
						evidence: [{ quote: "מאת מחבר אחר" }],
						confidence: 1,
					},
				],
			},
			{
				catalogue: {
					...catalogue,
					authors: [...catalogue.authors, { id: 7, name: "מחבר אחר" }],
				},
				plainText: "מאת מחבר אחר",
				snapshot,
			},
		);
		expect(drafts).toEqual([]);
		expect(abstentions).toEqual([
			{ relationshipKey: "author", reason: AUTHOR_ATTRIBUTION_POLICY_REASON },
		]);
	});

	describe("with hallucinated or invalid targets", () => {
		it("holds a covering proposal citing a nonexistent pasuk", () => {
			const { drafts } = validate({
				proposals: [
					{
						relationshipKey: "coveringSources",
						action: "add",
						target: {
							citations: [{ sefer: "בראשית", perek: "א", pasuk: "צ" }],
						},
						evidence: [{ quote: "המאמר" }],
					},
				],
			});
			expect(drafts[0].status).toBe("held");
			expect(drafts[0].conflict).toContain("out of range");
		});

		it("holds a proposal whose evidence is not in the article text", () => {
			const { drafts } = validate({
				proposals: [
					{
						relationshipKey: "coveringSources",
						action: "add",
						target: {
							citations: [{ sefer: "בראשית", perek: "יח", pasuk: "ב" }],
						},
						evidence: [{ quote: "ציטוט שאינו בטקסט כלל" }],
					},
				],
			});
			expect(drafts[0].status).toBe("held");
			expect(drafts[0].conflict).toContain("not anchored");
		});
	});

	describe("with unsupported or pending relationships", () => {
		it("holds pending-schema relationships and never marks them applicable", () => {
			const { drafts } = validate({
				proposals: [
					{
						relationshipKey: "recurringHebrewDate",
						action: "add",
						target: { month: "ניסן", day: 15 },
						evidence: [{ quote: "המאמר" }],
					},
					{
						relationshipKey: "moadim",
						action: "add",
						target: { moedName: "פסח" },
						evidence: [{ quote: "המאמר" }],
					},
				],
			});
			expect(drafts).toHaveLength(2);
			expect(drafts.every((d) => d.status === "held")).toBe(true);
			expect(drafts[0].conflict).toContain("pending-schema");
		});

		it("holds unknown relationship keys and pipeline-owned keys", () => {
			const { drafts } = validate({
				proposals: [
					{
						relationshipKey: "bogusRelation",
						action: "add",
						target: {},
						evidence: [{ quote: "המאמר" }],
					},
					{
						relationshipKey: "mentionAnnotations",
						action: "add",
						target: {},
						evidence: [{ quote: "המאמר" }],
					},
				],
			});
			expect(drafts.every((d) => d.status === "held")).toBe(true);
		});
	});

	describe("with forged or malformed model output", () => {
		it("ignores status/reviewer fields the model cannot grant itself", () => {
			const { drafts } = validate({
				proposals: [
					{
						relationshipKey: "coveringSources",
						action: "add",
						target: {
							citations: [{ sefer: "בראשית", perek: "יח", pasuk: "ב" }],
						},
						evidence: [{ quote: "בראשית יח, ב" }],
						// @ts-expect-error — forged fields must be dropped
						status: "approved",
						reviewer: "admin",
						confidence: 1,
					},
				],
			});
			expect(drafts[0].status).toBe("pending");
		});

		it("counts malformed items instead of throwing", () => {
			const { drafts, malformed } = validate({
				proposals: [
					{ action: "add", target: {} },
					{ relationshipKey: "author" },
				],
			});
			expect(malformed).toBe(2);
			expect(drafts).toHaveLength(0);
		});
	});

	describe("with mixed-evidence and normalization edges", () => {
		it("keeps a draft pending with a conflict when only some quotes anchor", () => {
			const { drafts } = validate({
				proposals: [
					{
						relationshipKey: "coveringSources",
						action: "add",
						target: {
							citations: [{ sefer: "בראשית", perek: "יח", pasuk: "ב" }],
						},
						evidence: [{ quote: "בראשית יח, ב" }, { quote: "ציטוט שאינו כאן" }],
					},
				],
			});
			expect(drafts[0].status).toBe("pending");
			expect(drafts[0].conflict).toContain("some evidence not anchored");
		});

		it("holds an action the write contract cannot express", () => {
			const { drafts } = validate({
				proposals: [
					{
						relationshipKey: "primaryPerek",
						action: "add",
						target: { perekId: 18 },
						evidence: [{ quote: "המאמר" }],
					},
				],
			});
			expect(drafts[0].status).toBe("held");
			expect(drafts[0].conflict).toContain("not expressible");
		});

		it("records abstentions and drops entries without a key", () => {
			const { abstentions } = validate({
				proposals: [],
				abstentions: [
					{ relationshipKey: "author", reason: "אין ראיה" },
					{ relationshipKey: "moadim", reason: 7 },
					{ reason: "no key" },
				] as RawModelOutput["abstentions"],
			});
			expect(abstentions).toEqual([
				{ relationshipKey: "author", reason: "אין ראיה" },
				{ relationshipKey: "moadim", reason: "" },
			]);
		});

		it("clamps out-of-range confidence and drops non-numbers", () => {
			const { drafts } = validate({
				proposals: [
					{
						relationshipKey: "coveringSources",
						action: "add",
						target: {
							citations: [{ sefer: "בראשית", perek: "יח", pasuk: "ב" }],
						},
						evidence: [{ quote: "בראשית יח, ב" }],
						confidence: 5,
					},
					{
						relationshipKey: "coveringSources",
						action: "add",
						target: {
							citations: [{ sefer: "בראשית", perek: "יח", pasuk: "ג" }],
						},
						evidence: [{ quote: "בראשית" }],
						confidence: "high" as unknown as number,
					},
				],
			});
			expect(drafts[0].confidence).toBe(1);
			expect(drafts[1].confidence).toBeNull();
		});

		it("plans a pending primaryPerek replace for a different perek", () => {
			const { drafts } = validate({
				proposals: [
					{
						relationshipKey: "primaryPerek",
						action: "replace",
						target: { sefer: "בראשית", perek: 18 },
						evidence: [{ quote: "המאמר" }],
					},
				],
			});
			expect(drafts[0].status).toBe("pending");
			expect(drafts[0].target).toEqual({ perekId: 18 });
		});

		it("accepts ASCII digit strings for citation numerals", () => {
			const { drafts } = validate({
				proposals: [
					{
						relationshipKey: "coveringSources",
						action: "add",
						target: {
							citations: [{ sefer: "בראשית", perek: "18", pasuk: "2" }],
						},
						evidence: [{ quote: "בראשית יח, ב" }],
					},
				],
			});
			expect(drafts[0].status).toBe("pending");
			expect(drafts[0].target).toEqual({
				pasukCoordinates: [{ perekId: 18, pasuk: 2 }],
			});
		});

		it.each([
			{ description: "omitted evidence", evidence: undefined },
			{ description: "an empty evidence list", evidence: [] },
			{
				description: "evidence without usable quotes",
				evidence: [{ quote: 42 as unknown as string }, {}, { quote: "" }],
			},
		])("holds a proposal with $description", ({ evidence }) => {
			const { drafts } = validate({
				proposals: [
					{
						relationshipKey: "coveringSources",
						action: "add",
						target: {
							citations: [{ sefer: "בראשית", perek: "יח", pasuk: "ב" }],
						},
						evidence,
					},
				],
			});
			expect(drafts[0].status).toBe("held");
			expect(drafts[0].evidence).toHaveLength(0);
			expect(drafts[0].conflict).toContain("no anchored evidence");
		});

		it("plans a pending coveringSources remove as a set-merge intent", () => {
			const { drafts } = validate({
				proposals: [
					{
						relationshipKey: "coveringSources",
						action: "remove",
						target: {
							citations: [{ sefer: "בראשית", perek: "יח", pasuk: "ג" }],
						},
						evidence: [{ quote: "בראשית" }],
					},
				],
			});
			expect(drafts[0].status).toBe("pending");
			expect(drafts[0].action).toBe("remove");
		});

		it("holds a remove action on a read-only many-cardinality key", () => {
			const { drafts } = validate({
				proposals: [
					{
						relationshipKey: "mentionAnnotations",
						action: "add",
						target: {},
						evidence: [{ quote: "המאמר" }],
					},
					{
						relationshipKey: "dedicationAssignments",
						action: "clear",
						target: { dedicationId: 5 },
						evidence: [{ quote: "המאמר" }],
					},
				],
			});
			expect(drafts[0].status).toBe("held");
			expect(drafts[0].conflict).toContain("not expressible");
			expect(drafts[0].conflict).toContain("ops: read");
			expect(drafts[1].status).toBe("held");
			expect(drafts[1].conflict).toContain("not expressible");
		});

		it("keeps the raw target on a held supported proposal", () => {
			const { drafts } = validate({
				proposals: [
					{
						relationshipKey: "coveringSources",
						action: "add",
						target: {},
						evidence: [{ quote: "המאמר" }],
					},
				],
			});
			expect(drafts[0].status).toBe("held");
			expect(drafts[0].target).toEqual({});
			expect(drafts[0].conflict).toContain("no citations");
		});

		it("keeps the raw target on an unnormalizable pending-schema proposal", () => {
			const { drafts } = validate({
				proposals: [
					{
						relationshipKey: "recurringHebrewDate",
						action: "add",
						target: { month: "ניסן" },
						evidence: [{ quote: "המאמר" }],
					},
				],
			});
			expect(drafts[0].status).toBe("held");
			expect(drafts[0].target).toEqual({ month: "ניסן" });
			expect(drafts[0].conflict).toContain("month+day");
		});

		it("trims a rationale and normalizes blank or non-string ones to null", () => {
			const { drafts } = validate({
				proposals: [
					{
						relationshipKey: "coveringSources",
						action: "add",
						target: {
							citations: [{ sefer: "בראשית", perek: "יח", pasuk: "ב" }],
						},
						evidence: [{ quote: "בראשית יח, ב" }],
						rationale: "  ציטוט ישיר  ",
					},
					{
						relationshipKey: "coveringSources",
						action: "add",
						target: {
							citations: [{ sefer: "בראשית", perek: "יח", pasuk: "ג" }],
						},
						evidence: [{ quote: "בראשית" }],
						rationale: "   ",
					},
					{
						relationshipKey: "coveringSources",
						action: "add",
						target: {
							citations: [{ sefer: "בראשית", perek: "יח", pasuk: "ד" }],
						},
						evidence: [{ quote: "בראשית" }],
						rationale: 9 as unknown as string,
					},
				],
			});
			expect(drafts[0].rationale).toBe("ציטוט ישיר");
			expect(drafts[1].rationale).toBeNull();
			expect(drafts[2].rationale).toBeNull();
		});

		it("tolerates output without a proposals array", () => {
			const { drafts, malformed } = validate({});
			expect(drafts).toHaveLength(0);
			expect(malformed).toBe(0);
		});
	});
});

describe("normalizeTarget", () => {
	const norm = (key: string, raw: Record<string, unknown>) =>
		normalizeTarget(key, raw, catalogue, snapshot);

	describe("for primaryPerek", () => {
		it("resolves a direct perekId that exists", () => {
			const out = norm("primaryPerek", { perekId: 18 });
			expect(out.target).toEqual({ perekId: 18 });
			expect(out.label).toContain("בראשית");
		});

		it("holds an unknown perekId", () => {
			expect(norm("primaryPerek", { perekId: 9999 }).heldReason).toContain(
				"does not exist",
			);
		});

		it("holds when it is already the current perek", () => {
			expect(norm("primaryPerek", { perekId: 1 }).heldReason).toContain(
				"already the current primary perek",
			);
		});

		it("holds a citation missing its sefer", () => {
			expect(norm("primaryPerek", { perek: 18 }).heldReason).toContain(
				"missing sefer/perek",
			);
		});

		it("holds an ambiguous perek reference", () => {
			expect(
				norm("primaryPerek", { sefer: "שמואל", perek: 5 }).heldReason,
			).toBeTruthy();
		});

		it("resolves an additional-letter perek through the sefer letter", () => {
			const out = norm("primaryPerek", {
				sefer: "שמואל",
				additional: "ב",
				perek: 5,
			});
			expect(out.target).toEqual({ perekId: 605 });
			expect(out.label).toContain("שמואל");
		});

		it("treats a blank additional letter as absent", () => {
			expect(
				norm("primaryPerek", {
					sefer: "שמואל",
					additional: "   ",
					perek: 5,
				}).heldReason,
			).toBeTruthy();
		});
	});

	describe("for author", () => {
		it.each([
			{ authorId: 2 },
			{ authorId: 7 },
			{ authorId: "ז" },
			{ id: 7 },
			{ authorId: 99 },
			{},
		])("refuses author proposals and review patches: %j", (target) => {
			const out = normalizeTarget(
				"author",
				target,
				{
					...catalogue,
					authors: [...catalogue.authors, { id: 7, name: "רש" }],
				},
				snapshot,
			);
			expect(out).toEqual({ heldReason: AUTHOR_ATTRIBUTION_POLICY_REASON });
		});
	});

	describe("for coveringSources", () => {
		it("accepts direct coordinates with a verified flag", () => {
			const out = norm("coveringSources", {
				pasukCoordinates: [
					{ perekId: 18, pasuk: 2 },
					{ perekId: 18, pasuk: 2 },
					{ perekId: 18, pasuk: 3 },
				],
				coverageVerified: true,
			});
			expect(out.target).toEqual({
				pasukCoordinates: [
					{ perekId: 18, pasuk: 2 },
					{ perekId: 18, pasuk: 3 },
				],
				coverageVerified: true,
			});
		});

		it("holds when no citations are supplied", () => {
			expect(norm("coveringSources", {}).heldReason).toContain(
				"no citations supplied",
			);
		});

		it("holds a direct coordinate on a nonexistent perek", () => {
			expect(
				norm("coveringSources", {
					pasukCoordinates: [{ perekId: 9999, pasuk: 1 }],
				}).heldReason,
			).toContain("does not exist");
		});

		it("holds a direct coordinate out of range", () => {
			expect(
				norm("coveringSources", {
					pasukCoordinates: [{ perekId: 18, pasuk: 99 }],
				}).heldReason,
			).toContain("out of range");
		});

		it("holds an unresolvable citation form", () => {
			expect(
				norm("coveringSources", {
					citations: [{ perek: "יח", pasuk: "ב" }],
				}).heldReason,
			).toContain("missing sefer");
		});

		it("holds an ambiguous citation", () => {
			expect(
				norm("coveringSources", {
					citations: [{ sefer: "שמואל", perek: 5, pasuk: 7 }],
				}).heldReason,
			).toContain("ambiguous");
		});

		it("holds an unparseable perek/pasuk", () => {
			expect(
				norm("coveringSources", {
					citations: [{ sefer: "בראשית", perek: "קקק", pasuk: "ב" }],
				}).heldReason,
			).toBeTruthy();
		});

		it("holds a non-scalar perek as unparseable", () => {
			expect(
				norm("coveringSources", {
					citations: [{ sefer: "בראשית", perek: { x: 1 }, pasuk: 2 }],
				}).heldReason,
			).toContain("unparseable");
		});

		it("dedupes repeated citation-form coordinates", () => {
			const out = norm("coveringSources", {
				citations: [
					{ sefer: "בראשית", perek: "יח", pasuk: "ב" },
					{ sefer: "בראשית", perek: 18, pasuk: 2 },
				],
			});
			expect(out.target).toEqual({
				pasukCoordinates: [{ perekId: 18, pasuk: 2 }],
				coverageVerified: undefined,
			});
		});

		it("resolves a citation pinned to an additional-letter sefer", () => {
			const out = norm("coveringSources", {
				citations: [
					{ sefer: "שמואל", additional: "ב", perek: "ה", pasuk: "ז" },
				],
			});
			expect(out.target).toEqual({
				pasukCoordinates: [{ perekId: 605, pasuk: 7 }],
				coverageVerified: undefined,
			});
		});

		it("treats a blank citation additional letter as absent", () => {
			const out = norm("coveringSources", {
				citations: [
					{ sefer: "שמואל", additional: "  ", perek: "ה", pasuk: "ז" },
				],
			});
			// Blank additional leaves שמואל ambiguous — held, not guessed.
			expect(out.heldReason).toBeTruthy();
		});
	});

	describe("for dedicationAssignments", () => {
		it("resolves a catalogue dedication with an expiry", () => {
			const out = norm("dedicationAssignments", {
				dedicationId: 5,
				expiresAt: " 2027-01-01 ",
			});
			expect(out.target).toEqual({
				dedicationId: 5,
				expiresAt: "2027-01-01",
			});
		});

		it("holds a dedication outside the catalogue", () => {
			expect(
				norm("dedicationAssignments", { dedicationId: 42 }).heldReason,
			).toContain("not in catalogue");
		});

		it("accepts the id alias and normalizes a missing expiry to null", () => {
			const out = norm("dedicationAssignments", { id: 5 });
			expect(out.target).toEqual({ dedicationId: 5, expiresAt: null });
		});

		it("normalizes blank and non-string expiries to null", () => {
			expect(
				norm("dedicationAssignments", {
					dedicationId: 5,
					expiresAt: "   ",
				}).target,
			).toEqual({ dedicationId: 5, expiresAt: null });
			expect(
				norm("dedicationAssignments", {
					dedicationId: 5,
					expiresAt: 123,
				}).target,
			).toEqual({ dedicationId: 5, expiresAt: null });
		});
	});

	describe("for pending-schema and unknown keys", () => {
		it("stores recurringHebrewDate targets but keeps them held", () => {
			const out = norm("recurringHebrewDate", { month: "ניסן", day: "טו" });
			expect(out.target).toEqual({ month: "ניסן", day: 15 });
			expect(out.heldReason).toContain("pending-schema");
		});

		it("holds a recurringHebrewDate missing its day", () => {
			expect(
				norm("recurringHebrewDate", { month: "ניסן" }).heldReason,
			).toContain("month+day");
		});

		it("holds a recurringHebrewDate with a non-string month", () => {
			expect(
				norm("recurringHebrewDate", { month: 7, day: 3 }).heldReason,
			).toContain("month+day");
		});

		it("stores a moadim moed name via the name alias", () => {
			const out = norm("moadim", { name: "סוכות" });
			expect(out.target).toEqual({ moedName: "סוכות" });
			expect(out.heldReason).toContain("pending-schema");
		});

		it("holds a moadim proposal without a name", () => {
			expect(norm("moadim", {}).heldReason).toContain("moed name");
		});

		it("holds an unrecognized relationship key", () => {
			expect(norm("bogus", {}).heldReason).toContain(
				"unsupported relationship key",
			);
		});
	});
});
