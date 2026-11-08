import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LinkProposalCard } from "~/components/LinkProposalCard";
import type { LinkProposal } from "~/lib/article-linking/types";

function makeProposal(overrides: Partial<LinkProposal> = {}): LinkProposal {
	return {
		id: "prop-1",
		runId: "run-1",
		articleId: 7,
		relationshipKey: "coveringSources",
		action: "add",
		target: { pasukCoordinates: [{ perekId: 18, pasuk: 2 }] },
		targetLabel: "בראשית יח ב",
		evidence: [{ quote: "בראשית יח, ב", spanStart: 5, spanEnd: 19 }],
		rationale: "ציטוט ישיר במאמר",
		confidence: 0.9,
		conflict: null,
		status: "pending",
		dedupeKey: "d",
		decisionKey: "e",
		generator: "heuristic-citations:v1",
		model: null,
		promptVersion: "linking-v1",
		baseContentHash: "abc",
		baseSnapshot: null,
		promptTokens: null,
		completionTokens: null,
		reviewPatch: null,
		reviewNotes: null,
		reviewer: null,
		reviewedAt: null,
		appliedAt: null,
		appliedSnapshot: null,
		createdAt: "2026-01-01",
		updatedAt: "2026-01-01",
		staleNow: false,
		...overrides,
	};
}

function renderCard(proposal: LinkProposal) {
	const onReview = vi.fn();
	const onApply = vi.fn();
	render(
		<LinkProposalCard
			proposal={proposal}
			onReview={onReview}
			onApply={onApply}
		/>,
	);
	return { onReview, onApply };
}

describe("LinkProposalCard", () => {
	it("renders the target label, evidence and provenance", () => {
		renderCard(makeProposal());
		expect(screen.getByText("בראשית יח ב")).toBeInTheDocument();
		expect(screen.getByText(/בראשית יח, ב/)).toBeInTheDocument();
		expect(screen.getByText("ממתין לסקירה")).toBeInTheDocument();
	});

	it("approves a pending proposal", () => {
		const { onReview } = renderCard(makeProposal());
		fireEvent.click(screen.getByText("אשר"));
		expect(onReview).toHaveBeenCalledWith({
			id: "prop-1",
			decision: "approve",
		});
	});

	it("rejects a pending proposal", () => {
		const { onReview } = renderCard(makeProposal());
		fireEvent.click(screen.getByText("דחה"));
		expect(onReview).toHaveBeenCalledWith({
			id: "prop-1",
			decision: "reject",
		});
	});

	it("shows the apply button only for approved proposals", () => {
		const { onApply } = renderCard(makeProposal({ status: "approved" }));
		fireEvent.click(screen.getByText("החל על המאמר"));
		expect(onApply).toHaveBeenCalledWith("prop-1");
	});

	it("blocks approve and apply on a stale proposal", () => {
		renderCard(makeProposal({ staleNow: true }));
		expect(screen.getByText("לא עדכני")).toBeInTheDocument();
		expect(screen.queryByText("החל על המאמר")).not.toBeInTheDocument();
	});

	it("supports editing a held proposal before approval", () => {
		const { onReview } = renderCard(makeProposal({ status: "held" }));
		fireEvent.click(screen.getByText("ערוך ואשר"));
		fireEvent.click(screen.getByText("אשר עם התיקון"));
		expect(onReview).toHaveBeenCalledWith({
			id: "prop-1",
			decision: "approve",
			reviewPatch: { pasukCoordinates: [{ perekId: 18, pasuk: 2 }] },
		});
	});

	it("shows an error instead of sending an invalid JSON patch", () => {
		const { onReview } = renderCard(makeProposal({ status: "held" }));
		fireEvent.click(screen.getByText("ערוך ואשר"));
		fireEvent.change(screen.getByRole("textbox"), {
			target: { value: "{ not json" },
		});
		fireEvent.click(screen.getByText("אשר עם התיקון"));
		expect(onReview).not.toHaveBeenCalled();
		expect(screen.getByText(/JSON לא תקין/)).toBeInTheDocument();
	});

	it("cancels the patch editor without reviewing", () => {
		const { onReview } = renderCard(makeProposal({ status: "held" }));
		fireEvent.click(screen.getByText("ערוך ואשר"));
		expect(screen.getByRole("textbox")).toBeInTheDocument();
		fireEvent.click(screen.getByText("בטל עריכה"));
		expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
		expect(onReview).not.toHaveBeenCalled();
	});

	it("renders provenance, conflict, manual patch and review metadata", () => {
		renderCard(
			makeProposal({
				status: "applied",
				conflict: "partial evidence",
				reviewPatch: { pasukCoordinates: [{ perekId: 1, pasuk: 1 }] },
				reviewer: "editor-9",
				reviewedAt: "2026-02-02",
				model: "gpt-4o-mini",
				rationale: null,
				evidence: [],
			}),
		);
		expect(screen.getByText(/partial evidence/)).toBeInTheDocument();
		expect(screen.getByText(/אושר עם תיקון ידני/)).toBeInTheDocument();
		expect(screen.getByText(/editor-9/)).toBeInTheDocument();
		expect(screen.getByText(/gpt-4o-mini/)).toBeInTheDocument();
		expect(screen.queryByText(/ראיות מהמאמר/)).not.toBeInTheDocument();
		expect(screen.queryByText("אשר")).not.toBeInTheDocument();
		expect(screen.queryByText("דחה")).not.toBeInTheDocument();
	});

	it("disables action buttons while busy", () => {
		const onReview = vi.fn();
		render(
			<LinkProposalCard
				proposal={makeProposal()}
				busy
				onReview={onReview}
				onApply={vi.fn()}
			/>,
		);
		fireEvent.click(screen.getByText("אשר"));
		expect(onReview).not.toHaveBeenCalled();
	});

	it("hides the standalone approve button for held proposals", () => {
		renderCard(makeProposal({ status: "held" }));
		expect(screen.queryByText("אשר")).not.toBeInTheDocument();
		expect(screen.getByText("ערוך ואשר")).toBeInTheDocument();
		expect(screen.getByText("דחה")).toBeInTheDocument();
	});

	it("falls back to the raw key for an unknown relationship", () => {
		renderCard(makeProposal({ relationshipKey: "bogusRelation" }));
		expect(screen.getByText("bogusRelation")).toBeInTheDocument();
	});

	it("renders evidence without spans and a reviewer without a timestamp", () => {
		renderCard(
			makeProposal({
				status: "rejected",
				evidence: [{ quote: "ללא מיקום", spanStart: null, spanEnd: null }],
				reviewer: "editor-3",
				reviewedAt: null,
			}),
		);
		expect(screen.getByText(/ללא מיקום/)).toBeInTheDocument();
		expect(screen.getByText(/editor-3/)).toBeInTheDocument();
	});

	it("renders a timestamp without a reviewer name", () => {
		renderCard(
			makeProposal({
				status: "rejected",
				reviewer: null,
				reviewedAt: "2026-02-03T10:00:00Z",
			}),
		);
		expect(screen.getByText(/נסקר על ידי —/)).toBeInTheDocument();
		expect(screen.getByText(/2026-02-03/)).toBeInTheDocument();
	});
});
