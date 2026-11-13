import { describe, expect, it } from "vitest";
import { planProposalApply } from "~/lib/article-linking/merge";
import type {
	DedicationLinkTarget,
	LinkProposal,
	PasukCoordinate,
	ProposalTarget,
} from "~/lib/article-linking/types";
import { AUTHOR_ATTRIBUTION_POLICY_REASON } from "~/lib/article-linking/validate";
import { snapshot } from "./fixture";

const base = {
	id: "p-1",
	reviewPatch: null,
};
const reviewer = "editor-1";
const hash = "abcdef0123456789abcdef0123456789";

describe("planProposalApply", () => {
	describe("for coveringSources", () => {
		it("merges an add proposal into the live set preserving the flag", () => {
			const plan = planProposalApply(
				{
					...base,
					relationshipKey: "coveringSources",
					action: "add",
					target: {
						pasukCoordinates: [
							{ perekId: 18, pasuk: 2 },
							{ perekId: 1, pasuk: 2 }, // already covered
						],
					},
				},
				snapshot,
				hash,
				reviewer,
			);
			expect(plan.kind).toBe("article-mutation");
			if (plan.kind !== "article-mutation") return;
			expect(plan.input.coveringSources).toEqual([
				{ perekId: 1, pasuk: 1 },
				{ perekId: 1, pasuk: 2 },
				{ perekId: 18, pasuk: 2 },
			]);
			expect(plan.input.coverageVerified).toBe(true);
			expect(plan.input.expectedContentHash).toBe(hash);
			expect(plan.input.expectedCoveringSources).toEqual(
				snapshot.coveringSources,
			);
		});

		it("refuses an add that contributes nothing new", () => {
			const plan = planProposalApply(
				{
					...base,
					relationshipKey: "coveringSources",
					action: "add",
					target: { pasukCoordinates: [{ perekId: 1, pasuk: 1 }] },
				},
				snapshot,
				hash,
				reviewer,
			);
			expect(plan.kind).toBe("cannot-apply");
		});

		it("subtracts a remove proposal", () => {
			const plan = planProposalApply(
				{
					...base,
					relationshipKey: "coveringSources",
					action: "remove",
					target: { pasukCoordinates: [{ perekId: 1, pasuk: 1 }] },
				},
				snapshot,
				hash,
				reviewer,
			);
			expect(plan.kind).toBe("article-mutation");
			if (plan.kind !== "article-mutation") return;
			expect(plan.input.coveringSources).toEqual([{ perekId: 1, pasuk: 2 }]);
		});

		it("clears coverage via replace with an empty set", () => {
			const plan = planProposalApply(
				{
					...base,
					relationshipKey: "coveringSources",
					action: "clear",
					target: { pasukCoordinates: [] },
				},
				snapshot,
				hash,
				reviewer,
			);
			expect(plan.kind).toBe("article-mutation");
			if (plan.kind !== "article-mutation") return;
			expect(plan.input.coveringSources).toEqual([]);
			expect(plan.input.coverageVerified).toBe(false);
		});

		it("refuses an add carrying no coordinates", () => {
			const plan = planProposalApply(
				{
					...base,
					relationshipKey: "coveringSources",
					action: "add",
					target: {} as ProposalTarget,
				},
				snapshot,
				hash,
				reviewer,
			);
			expect(plan).toEqual({
				kind: "cannot-apply",
				reason: "add proposal carries no coordinates",
			});
		});

		it("filters malformed coordinates out of an add", () => {
			const plan = planProposalApply(
				{
					...base,
					relationshipKey: "coveringSources",
					action: "add",
					target: {
						pasukCoordinates: [
							{ perekId: 18, pasuk: 2 },
							{ perekId: Number.NaN, pasuk: 1 },
							{ perekId: 5 } as PasukCoordinate,
						],
					},
				},
				snapshot,
				hash,
				reviewer,
			);
			expect(plan.kind).toBe("article-mutation");
			if (plan.kind !== "article-mutation") return;
			expect(plan.input.coveringSources).toContainEqual({
				perekId: 18,
				pasuk: 2,
			});
			expect(plan.input.coveringSources).toHaveLength(3);
		});

		it("refuses a remove whose coordinates are not covered", () => {
			const plan = planProposalApply(
				{
					...base,
					relationshipKey: "coveringSources",
					action: "remove",
					target: { pasukCoordinates: [{ perekId: 18, pasuk: 2 }] },
				},
				snapshot,
				hash,
				reviewer,
			);
			expect(plan).toEqual({
				kind: "cannot-apply",
				reason: "no proposed coordinate is in the covering set",
			});
		});

		it("clears the verified flag when a remove empties the set", () => {
			const plan = planProposalApply(
				{
					...base,
					relationshipKey: "coveringSources",
					action: "remove",
					target: {
						pasukCoordinates: [
							{ perekId: 1, pasuk: 1 },
							{ perekId: 1, pasuk: 2 },
						],
						coverageVerified: true,
					},
				},
				snapshot,
				hash,
				reviewer,
			);
			expect(plan.kind).toBe("article-mutation");
			if (plan.kind !== "article-mutation") return;
			expect(plan.input.coveringSources).toEqual([]);
			expect(plan.input.coverageVerified).toBe(false);
		});

		it("plans a full replace honouring the proposed flag", () => {
			const plan = planProposalApply(
				{
					...base,
					relationshipKey: "coveringSources",
					action: "replace",
					target: {
						pasukCoordinates: [
							{ perekId: 18, pasuk: 2 },
							{ perekId: 18, pasuk: 2 },
						],
						coverageVerified: false,
					},
				},
				snapshot,
				"",
				reviewer,
			);
			expect(plan.kind).toBe("article-mutation");
			if (plan.kind !== "article-mutation") return;
			expect(plan.input.coveringSources).toEqual([{ perekId: 18, pasuk: 2 }]);
			expect(plan.input.coverageVerified).toBe(false);
			expect(plan.input.expectedContentHash).toBeUndefined();
		});

		it("keeps the live verified flag when a replace omits it", () => {
			const plan = planProposalApply(
				{
					...base,
					relationshipKey: "coveringSources",
					action: "replace",
					target: { pasukCoordinates: [{ perekId: 18, pasuk: 2 }] },
				},
				snapshot,
				hash,
				reviewer,
			);
			expect(plan.kind).toBe("article-mutation");
			if (plan.kind !== "article-mutation") return;
			expect(plan.input.coverageVerified).toBe(true);
		});

		it("clears the verified flag when a replace empties the set", () => {
			const plan = planProposalApply(
				{
					...base,
					relationshipKey: "coveringSources",
					action: "replace",
					target: { pasukCoordinates: [], coverageVerified: true },
				},
				snapshot,
				hash,
				reviewer,
			);
			expect(plan.kind).toBe("article-mutation");
			if (plan.kind !== "article-mutation") return;
			expect(plan.input.coveringSources).toEqual([]);
			expect(plan.input.coverageVerified).toBe(false);
		});

		it("honours a human reviewPatch over the model target", () => {
			const plan = planProposalApply(
				{
					...base,
					relationshipKey: "coveringSources",
					action: "replace",
					target: { pasukCoordinates: [{ perekId: 1, pasuk: 9 }] },
					reviewPatch: {
						pasukCoordinates: [{ perekId: 18, pasuk: 2 }],
						coverageVerified: true,
					},
				},
				snapshot,
				hash,
				reviewer,
			);
			expect(plan.kind).toBe("article-mutation");
			if (plan.kind !== "article-mutation") return;
			expect(plan.input.coveringSources).toEqual([{ perekId: 18, pasuk: 2 }]);
		});
	});

	describe("for single-valued relationships", () => {
		it("plans a primaryPerek replace", () => {
			const plan = planProposalApply(
				{
					...base,
					relationshipKey: "primaryPerek",
					action: "replace",
					target: { perekId: 18 },
				},
				snapshot,
				hash,
				reviewer,
			);
			expect(plan.kind).toBe("article-mutation");
			if (plan.kind !== "article-mutation") return;
			expect(plan.input.perekId).toBe(18);
			expect(plan.input.authorId).toBeUndefined();
		});

		it("refuses a primaryPerek add — replace only", () => {
			const plan = planProposalApply(
				{
					...base,
					relationshipKey: "primaryPerek",
					action: "add",
					target: { perekId: 18 },
				},
				snapshot,
				hash,
				reviewer,
			);
			expect(plan).toEqual({
				kind: "cannot-apply",
				reason: "primaryPerek supports replace only, not add",
			});
		});

		it("refuses a primaryPerek replace without a perekId", () => {
			const plan = planProposalApply(
				{
					...base,
					relationshipKey: "primaryPerek",
					action: "replace",
					target: {} as ProposalTarget,
				},
				snapshot,
				hash,
				reviewer,
			);
			expect(plan).toEqual({
				kind: "cannot-apply",
				reason: "no perekId target",
			});
		});

		it("refuses a redundant primaryPerek replace", () => {
			const plan = planProposalApply(
				{
					...base,
					relationshipKey: "primaryPerek",
					action: "replace",
					target: { perekId: 1 },
				},
				snapshot,
				hash,
				reviewer,
			);
			expect(plan).toEqual({
				kind: "cannot-apply",
				reason: "already the current perek",
			});
		});
	});

	describe("for legacy author proposals", () => {
		it.each<{
			action: LinkProposal["action"];
			target: ProposalTarget;
			reviewPatch: ProposalTarget | null;
		}>([
			{ action: "replace", target: { authorId: 2 }, reviewPatch: null },
			{ action: "replace", target: { authorId: 9 }, reviewPatch: null },
			{
				action: "replace",
				target: { authorId: 9 },
				reviewPatch: { authorId: 7 },
			},
			{ action: "clear", target: {} as ProposalTarget, reviewPatch: null },
		])("never plans an attribution write: %j", (proposal) => {
			const plan = planProposalApply(
				{
					...base,
					relationshipKey: "author",
					...proposal,
				},
				snapshot,
				hash,
				reviewer,
			);
			expect(plan).toEqual({
				kind: "cannot-apply",
				reason: AUTHOR_ATTRIBUTION_POLICY_REASON,
			});
		});
	});

	describe("for dedicationAssignments", () => {
		it("plans a dedication-aggregate add", () => {
			const plan = planProposalApply(
				{
					...base,
					relationshipKey: "dedicationAssignments",
					action: "add",
					target: { dedicationId: 5, expiresAt: null },
				},
				snapshot,
				hash,
				reviewer,
			);
			expect(plan).toEqual({
				kind: "dedication",
				op: "add",
				dedicationId: 5,
				expiresAt: null,
			});
		});

		it("refuses removing an assignment that is not there", () => {
			const plan = planProposalApply(
				{
					...base,
					relationshipKey: "dedicationAssignments",
					action: "remove",
					target: { dedicationId: 5 },
				},
				snapshot,
				hash,
				reviewer,
			);
			expect(plan.kind).toBe("cannot-apply");
		});

		it("refuses a non-numeric dedicationId", () => {
			const plan = planProposalApply(
				{
					...base,
					relationshipKey: "dedicationAssignments",
					action: "add",
					target: { dedicationId: "הקדשה" } as unknown as DedicationLinkTarget,
				},
				snapshot,
				hash,
				reviewer,
			);
			expect(plan).toEqual({
				kind: "cannot-apply",
				reason: "no dedicationId target",
			});
		});

		it("refuses adding an already-assigned dedication", () => {
			const plan = planProposalApply(
				{
					...base,
					relationshipKey: "dedicationAssignments",
					action: "add",
					target: { dedicationId: 5, expiresAt: "2027-01-01" },
				},
				{ ...snapshot, dedicationIds: [5] },
				hash,
				reviewer,
			);
			expect(plan).toEqual({
				kind: "cannot-apply",
				reason: "dedication already assigned to the article",
			});
		});

		it("plans a dedication-aggregate remove when assigned", () => {
			const plan = planProposalApply(
				{
					...base,
					relationshipKey: "dedicationAssignments",
					action: "remove",
					target: { dedicationId: 5 },
				},
				{ ...snapshot, dedicationIds: [5] },
				hash,
				reviewer,
			);
			expect(plan).toEqual({
				kind: "dedication",
				op: "remove",
				dedicationId: 5,
				expiresAt: null,
			});
		});

		it("refuses a dedication replace — add/remove only", () => {
			const plan = planProposalApply(
				{
					...base,
					relationshipKey: "dedicationAssignments",
					action: "replace",
					target: { dedicationId: 5 },
				},
				snapshot,
				hash,
				reviewer,
			);
			expect(plan.kind).toBe("cannot-apply");
		});
	});

	describe("for read-only or pending relationships", () => {
		it("never plans a write for them", () => {
			for (const key of [
				"mentionAnnotations",
				"recurringHebrewDate",
				"moadim",
				"bogus",
			]) {
				const plan = planProposalApply(
					{
						...base,
						relationshipKey: key,
						action: "add",
						target: { pasukCoordinates: [] },
					},
					snapshot,
					hash,
					reviewer,
				);
				expect(plan.kind).toBe("cannot-apply");
			}
		});
	});
});
