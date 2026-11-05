import { useState } from "react";
import type { LinkProposal, ProposalTarget } from "~/lib/article-linking/types";
import { relationshipFor } from "~/lib/article-relationships";

const STATUS_LABELS: Record<LinkProposal["status"], string> = {
	pending: "ממתין לסקירה",
	held: "מוקפא — דורש תיקון",
	approved: "אושר",
	rejected: "נדחה",
	applied: "יושם",
	stale: "לא עדכני",
};

const STATUS_STYLES: Record<LinkProposal["status"], string> = {
	pending: "bg-amber-100 text-amber-800 border-amber-200",
	held: "bg-purple-100 text-purple-800 border-purple-200",
	approved: "bg-blue-100 text-blue-800 border-blue-200",
	rejected: "bg-gray-100 text-gray-600 border-gray-200",
	applied: "bg-green-100 text-green-800 border-green-200",
	stale: "bg-red-100 text-red-800 border-red-200",
};

const ACTION_LABELS: Record<LinkProposal["action"], string> = {
	add: "הוספה",
	remove: "הסרה",
	replace: "החלפה",
	clear: "ניקוי",
};

export interface ReviewInput {
	id: string;
	decision: "approve" | "reject";
	reviewPatch?: ProposalTarget;
	reviewNotes?: string;
}

/**
 * One evidence-backed draft in the human review queue (#3103). The card
 * exposes review (approve/reject/edit) and — only after approval — apply.
 * Generation never reaches live data from here: apply is an explicit,
 * server-validated step.
 */
export function LinkProposalCard({
	proposal,
	busy = false,
	onReview,
	onApply,
}: {
	proposal: LinkProposal;
	busy?: boolean;
	onReview: (input: ReviewInput) => void;
	onApply: (id: string) => void;
}) {
	const [patchText, setPatchText] = useState<string | null>(null);
	const [patchError, setPatchError] = useState<string | null>(null);
	const entry = relationshipFor(proposal.relationshipKey);
	const relationshipLabel = entry?.label ?? proposal.relationshipKey;
	const effectiveStatus = proposal.staleNow ? "stale" : proposal.status;
	const reviewable =
		proposal.status === "pending" || proposal.status === "held";
	const applicable = proposal.status === "approved" && !proposal.staleNow;

	const approveWithPatch = () => {
		/* istanbul ignore next -- the button only renders when patchText is set */
		if (patchText === null) return;
		try {
			const patch = JSON.parse(patchText) as ProposalTarget;
			setPatchError(null);
			onReview({ id: proposal.id, decision: "approve", reviewPatch: patch });
		} catch {
			setPatchError("JSON לא תקין — התיקון לא נשלח");
		}
	};

	return (
		<article
			data-testid="link-proposal-card"
			data-status={effectiveStatus}
			className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden"
		>
			<header className="px-6 py-4 border-b border-gray-100 flex flex-wrap items-center gap-3">
				<span
					className={`px-3 py-1 rounded-full text-xs font-semibold border ${STATUS_STYLES[effectiveStatus]}`}
				>
					{STATUS_LABELS[effectiveStatus]}
				</span>
				<span className="text-sm font-semibold text-gray-800">
					{relationshipLabel}
				</span>
				<span className="text-xs text-gray-500">
					{ACTION_LABELS[proposal.action]} · מאמר #{proposal.articleId}
				</span>
				<span className="ms-auto text-xs text-gray-400" dir="ltr">
					{proposal.generator}
					{proposal.model ? ` (${proposal.model})` : ""}
				</span>
			</header>

			<div className="px-6 py-4 space-y-3">
				<p className="text-sm text-gray-800">
					<span className="font-medium">יעד: </span>
					{proposal.targetLabel}
				</p>

				{proposal.evidence && proposal.evidence.length > 0 && (
					<div>
						<p className="text-xs font-semibold text-gray-500 mb-1">
							ראיות מהמאמר:
						</p>
						<ul className="space-y-1">
							{proposal.evidence.map((ev) => (
								<li
									key={`${ev.spanStart ?? ""}-${ev.quote}`}
									className="text-sm text-gray-700 bg-gray-50 border-r-2 border-blue-300 px-3 py-1.5 rounded"
								>
									&#8220;{ev.quote}&#8221;
								</li>
							))}
						</ul>
					</div>
				)}

				{proposal.rationale && (
					<p className="text-sm text-gray-600">
						<span className="font-medium">נימוק: </span>
						{proposal.rationale}
					</p>
				)}

				{proposal.confidence !== null && (
					<p className="text-xs text-gray-500" dir="ltr">
						confidence: {proposal.confidence.toFixed(2)} — עדות בלבד, לא מאשרת
						אוטומטית
					</p>
				)}

				{proposal.conflict && (
					<p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
						⚠ {proposal.conflict}
					</p>
				)}

				{proposal.staleNow && (
					<p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
						תוכן המאמר השתנה מאז ההפקה — יש להפיק מחדש
					</p>
				)}

				{proposal.reviewPatch && (
					<p className="text-xs text-gray-500">
						אושר עם תיקון ידני:{" "}
						<code dir="ltr">{JSON.stringify(proposal.reviewPatch)}</code>
					</p>
				)}

				{(proposal.reviewer || proposal.reviewedAt) && (
					<p className="text-xs text-gray-400">
						נסקר על ידי {proposal.reviewer ?? "—"} · {proposal.reviewedAt ?? ""}
					</p>
				)}
			</div>

			{(reviewable || applicable) && (
				<footer className="px-6 py-4 bg-gray-50 border-t border-gray-100 space-y-3">
					{reviewable && patchText !== null && (
						<div className="space-y-2">
							<textarea
								dir="ltr"
								className="w-full font-mono text-xs border border-gray-300 rounded-lg p-3 min-h-24"
								value={patchText}
								onChange={(e) => setPatchText(e.target.value)}
							/>
							{patchError && (
								<p className="text-xs text-red-600">{patchError}</p>
							)}
							<div className="flex gap-2">
								<button
									type="button"
									disabled={busy}
									onClick={approveWithPatch}
									className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
								>
									אשר עם התיקון
								</button>
								<button
									type="button"
									disabled={busy}
									onClick={() => {
										setPatchText(null);
										setPatchError(null);
									}}
									className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-100"
								>
									בטל עריכה
								</button>
							</div>
						</div>
					)}
					<div className="flex flex-wrap gap-2">
						{reviewable && patchText === null && (
							<>
								{proposal.status === "pending" && (
									<button
										type="button"
										disabled={busy || proposal.staleNow}
										onClick={() =>
											onReview({ id: proposal.id, decision: "approve" })
										}
										className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50"
									>
										אשר
									</button>
								)}
								<button
									type="button"
									disabled={busy}
									onClick={() =>
										setPatchText(JSON.stringify(proposal.target, null, 2))
									}
									className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
								>
									ערוך ואשר
								</button>
								<button
									type="button"
									disabled={busy}
									onClick={() =>
										onReview({ id: proposal.id, decision: "reject" })
									}
									className="px-4 py-2 border border-red-300 text-red-700 rounded-lg text-sm font-medium hover:bg-red-50 disabled:opacity-50"
								>
									דחה
								</button>
							</>
						)}
						{applicable && (
							<button
								type="button"
								disabled={busy}
								onClick={() => onApply(proposal.id)}
								className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
							>
								החל על המאמר
							</button>
						)}
					</div>
				</footer>
			)}
		</article>
	);
}
