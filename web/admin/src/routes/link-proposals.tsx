import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
	LinkProposalCard,
	type ReviewInput,
} from "~/components/LinkProposalCard";
import type { LinkProposalStatus } from "~/lib/article-linking/types";
import {
	applyLinkProposals,
	generateLinkProposals,
	getLinkPipelineStatus,
	listLinkProposals,
	reviewLinkProposal,
} from "~/server/article-link-proposals";

export const Route = createFileRoute("/link-proposals")({
	validateSearch: (search: Record<string, unknown>) => ({
		articleId:
			typeof search.articleId === "number" && search.articleId > 0
				? search.articleId
				: undefined,
	}),
	component: LinkProposalsPage,
});

const STATUS_FILTER_OPTIONS: {
	value: "" | LinkProposalStatus;
	label: string;
}[] = [
	{ value: "", label: "הכל" },
	{ value: "pending", label: "ממתין" },
	{ value: "held", label: "מוקפא" },
	{ value: "approved", label: "אושר" },
	{ value: "rejected", label: "נדחה" },
	{ value: "applied", label: "יושם" },
	{ value: "stale", label: "לא עדכני" },
];

/** The human review queue for the article-linking pipeline (#3103). */
function LinkProposalsPage() {
	const { articleId } = Route.useSearch();
	const queryClient = useQueryClient();
	const [statusFilter, setStatusFilter] = useState<"" | LinkProposalStatus>("");
	const [articleInput, setArticleInput] = useState("");
	const [engine, setEngine] = useState<"heuristic" | "llm" | "both">(
		"heuristic",
	);
	const [force, setForce] = useState(false);
	const [dryRun, setDryRun] = useState(false);
	const [notice, setNotice] = useState<string | null>(null);

	const { data: pipeline } = useQuery({
		queryKey: ["link-pipeline-status"],
		queryFn: () => getLinkPipelineStatus(),
	});

	const proposalsQuery = useQuery({
		queryKey: ["link-proposals", statusFilter, articleId],
		queryFn: () =>
			listLinkProposals({
				data: {
					status: statusFilter || undefined,
					articleId,
				},
			}),
	});
	const proposals = useMemo(
		() => proposalsQuery.data ?? [],
		[proposalsQuery.data],
	);

	const invalidate = () => {
		queryClient.invalidateQueries({ queryKey: ["link-proposals"] });
	};

	const generateMutation = useMutation({
		mutationFn: (input: {
			articleIds: number[];
			engine: "heuristic" | "llm" | "both";
			force: boolean;
			dryRun: boolean;
		}) => generateLinkProposals({ data: input }),
		onSuccess: (result) => {
			const generated = result.outcomes.filter(
				(o) => o.outcome === "generated" || o.outcome === "dry-run",
			).length;
			const errors = result.outcomes.filter((o) => o.outcome === "error");
			setNotice(
				errors.length > 0
					? `הרצה ${result.runId.slice(0, 8)}: ${generated} מאמרים, ${errors.length} שגיאות`
					: `הרצה ${result.runId.slice(0, 8)}: ${generated} מאמרים עובדו`,
			);
			invalidate();
		},
		onError: (error: Error) => setNotice(`שגיאה בהפקה: ${error.message}`),
	});

	const reviewMutation = useMutation({
		mutationFn: (input: ReviewInput) => reviewLinkProposal({ data: input }),
		onSuccess: invalidate,
		onError: (error: Error) => setNotice(`שגיאה בסקירה: ${error.message}`),
	});

	const applyMutation = useMutation({
		mutationFn: (ids: string[]) => applyLinkProposals({ data: { ids } }),
		onSuccess: (result) => {
			const applied = result.outcomes.filter(
				(o) => o.outcome === "applied" || o.outcome === "already-applied",
			).length;
			const failed = result.outcomes.length - applied;
			setNotice(
				failed > 0
					? `${applied} הוחלו, ${failed} נכשלו — פרטים על ההצעות`
					: `${applied} הצעות הוחלו בהצלחה`,
			);
			invalidate();
		},
		onError: (error: Error) => setNotice(`שגיאה בהחלה: ${error.message}`),
	});

	const busy =
		generateMutation.isPending ||
		reviewMutation.isPending ||
		applyMutation.isPending;

	const runGenerate = () => {
		const ids = articleInput
			.split(/[,\s]+/)
			.map((token) => Number.parseInt(token, 10))
			.filter((n) => Number.isInteger(n) && n > 0);
		if (ids.length === 0) {
			setNotice("יש להזין לפחות מזהה מאמר אחד");
			return;
		}
		setNotice(null);
		generateMutation.mutate({ articleIds: ids, engine, force, dryRun });
	};

	const approvedIds = proposals
		.filter((p) => p.status === "approved" && !p.staleNow)
		.map((p) => p.id);

	return (
		<div className="space-y-8">
			<header>
				<h1 className="text-3xl font-bold text-gray-900">הצעות קישור מאמרים</h1>
				<p className="text-gray-500 mt-1">
					צינור ההפקה יוצר טיוטות בלבד — שום קשר לא מתפרסם בלי אישור אנושי והחלה
					דרך חוזה הכתיבה המשותף
				</p>
			</header>

			{/* Pipeline capability surface */}
			{pipeline && (
				<section className="bg-white rounded-xl shadow-sm border border-gray-200 px-6 py-4">
					<div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-gray-600">
						<span>חוזה קשרים v{pipeline.contractVersion}</span>
						<span>
							{pipeline.llmEnabled ? "🤖 LLM זמין" : "🧮 היוריסטי בלבד"}
						</span>
						<span>
							{pipeline.articleApiConfigured
								? "🔑 נתיב כתיבה מוגדר"
								: "⚠ ARTICLE_API_KEY חסר — החלה לא תעבוד"}
						</span>
						{!pipeline.schemaReady && (
							<span className="text-amber-700">⚠ סכמת ההצעות לא זמינה</span>
						)}
						{pipeline.pendingKeys.length > 0 && (
							<span className="text-gray-400">
								ממתין לסכמה: {pipeline.pendingKeys.join(", ")}
							</span>
						)}
					</div>
				</section>
			)}

			{/* Generation */}
			<section className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
				<div className="px-6 py-4 border-b border-gray-100">
					<h2 className="font-semibold text-gray-900">הפקת הצעות חדשות</h2>
				</div>
				<div className="p-6 flex flex-wrap items-end gap-4">
					<label className="flex flex-col gap-1">
						<span className="text-xs font-medium text-gray-500">
							מזהי מאמרים (מופרדים בפסיק)
						</span>
						<input
							type="text"
							dir="ltr"
							value={articleInput}
							onChange={(e) => setArticleInput(e.target.value)}
							placeholder="123, 456"
							className="border border-gray-300 rounded-lg px-4 py-2 w-56 focus:ring-2 focus:ring-blue-500"
						/>
					</label>
					<label className="flex flex-col gap-1">
						<span className="text-xs font-medium text-gray-500">מנוע</span>
						<select
							value={engine}
							onChange={(e) =>
								setEngine(e.target.value as "heuristic" | "llm" | "both")
							}
							className="border border-gray-300 rounded-lg px-4 py-2"
						>
							<option value="heuristic">היוריסטי (חלץ ציטוטים)</option>
							<option value="llm" disabled={pipeline && !pipeline.llmEnabled}>
								LLM
							</option>
							<option value="both" disabled={pipeline && !pipeline.llmEnabled}>
								שניהם
							</option>
						</select>
					</label>
					<label className="flex items-center gap-2 text-sm text-gray-600">
						<input
							type="checkbox"
							checked={force}
							onChange={(e) => setForce(e.target.checked)}
						/>
						התעלם מ-checkpoint
					</label>
					<label className="flex items-center gap-2 text-sm text-gray-600">
						<input
							type="checkbox"
							checked={dryRun}
							onChange={(e) => setDryRun(e.target.checked)}
						/>
						תצוגה מקדימה בלבד
					</label>
					<button
						type="button"
						disabled={busy}
						onClick={runGenerate}
						className="px-5 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50"
					>
						{generateMutation.isPending ? "מפיק…" : "הפק הצעות"}
					</button>
				</div>
			</section>

			{notice && (
				<p className="text-sm text-gray-700 bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
					{notice}
				</p>
			)}

			{/* Queue */}
			<section className="space-y-4">
				<div className="flex flex-wrap items-center gap-4">
					<h2 className="text-xl font-bold text-gray-900">
						תור סקירה ({proposals.length})
					</h2>
					<select
						value={statusFilter}
						onChange={(e) =>
							setStatusFilter(e.target.value as "" | LinkProposalStatus)
						}
						className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
					>
						{STATUS_FILTER_OPTIONS.map((opt) => (
							<option key={opt.value} value={opt.value}>
								{opt.label}
							</option>
						))}
					</select>
					{articleId !== undefined && (
						<span className="text-sm text-gray-500">
							מסונן למאמר #{articleId} ·{" "}
							<Link
								to="/link-proposals"
								search={{ articleId: undefined }}
								className="text-blue-600 hover:underline"
							>
								נקה סינון
							</Link>
						</span>
					)}
					{approvedIds.length > 0 && (
						<button
							type="button"
							disabled={busy}
							onClick={() => applyMutation.mutate(approvedIds)}
							className="ms-auto px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
						>
							החל את כל המאושרות ({approvedIds.length})
						</button>
					)}
				</div>

				{proposalsQuery.isLoading ? (
					<p className="text-gray-400">טוען…</p>
				) : proposals.length === 0 ? (
					<p className="text-gray-400 bg-white rounded-xl border border-gray-200 px-6 py-8 text-center">
						אין הצעות להצגה — הפק הצעות חדשות או שנה את הסינון
					</p>
				) : (
					proposals.map((proposal) => (
						<LinkProposalCard
							key={proposal.id}
							proposal={proposal}
							busy={busy}
							onReview={(input) => reviewMutation.mutate(input)}
							onApply={(id) => applyMutation.mutate([id])}
						/>
					))
				)}
			</section>
		</div>
	);
}
