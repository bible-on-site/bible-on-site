import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import DOMPurify from "dompurify";
import { useMemo, useState } from "react";
import { diffHtmlWords } from "~/lib/tanahpedia/html-diff";
import {
	type EntryRevisionRow,
	isRevisionConflictError,
} from "~/lib/tanahpedia/revisions-shared";
import {
	approveEntryRevision,
	listEntryRevisions,
	rejectEntryRevision,
	restoreEntryRevision,
} from "~/server/tanahpedia/revisions";

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
	APPLIED: {
		label: "הוחל",
		className: "bg-green-100 text-green-800 border-green-200",
	},
	PENDING: {
		label: "ממתין לסקירה",
		className: "bg-amber-100 text-amber-800 border-amber-200",
	},
	REJECTED: {
		label: "נדחה",
		className: "bg-gray-100 text-gray-600 border-gray-200",
	},
};

interface EntryHistoryPanelProps {
	entryId: string;
	currentContent: string | null;
	/** The APPLIED head the editor is currently based on (for concurrency). */
	baseRevisionId: string | null;
	/** Fired after an action changed the entry so the editor can reload. */
	onEntryChanged: () => void;
}

function formatDateTime(value: string): string {
	const d = new Date(value);
	return Number.isNaN(d.getTime())
		? value
		: d.toLocaleString("he-IL", { dateStyle: "short", timeStyle: "medium" });
}

function DiffView({ before, after }: { before: string; after: string }) {
	const parts = useMemo(() => {
		// Parts have no id — key them by type + cumulative offset (unique/stable).
		let offset = 0;
		return diffHtmlWords(before, after).map((part) => {
			const keyed = { ...part, key: `${part.type}:${offset}` };
			offset += part.text.length;
			return keyed;
		});
	}, [before, after]);
	return (
		<div
			dir="ltr"
			className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3 text-left text-xs font-mono whitespace-pre-wrap break-all max-h-72 overflow-auto"
		>
			{parts.map((part) =>
				part.type === "same" ? (
					<span key={part.key} className="text-gray-500">
						{part.text}
					</span>
				) : part.type === "add" ? (
					<span
						key={part.key}
						className="bg-green-200/80 text-green-950 rounded-sm"
					>
						{part.text}
					</span>
				) : (
					<span
						key={part.key}
						className="bg-red-200/80 text-red-950 line-through rounded-sm"
					>
						{part.text}
					</span>
				),
			)}
		</div>
	);
}

function RevisionRow({
	revision,
	baseContent,
	currentContent,
	baseRevisionId,
	isBusy,
	onApprove,
	onReject,
	onRestore,
}: {
	revision: EntryRevisionRow;
	baseContent: string | null | undefined;
	currentContent: string;
	baseRevisionId: string | null;
	isBusy: boolean;
	onApprove: (id: string) => void;
	onReject: (id: string) => void;
	onRestore: (id: string) => void;
}) {
	const [expanded, setExpanded] = useState<"none" | "diff" | "preview">("none");
	const badge = STATUS_BADGE[revision.status] ?? {
		label: revision.status,
		className: "bg-gray-100 text-gray-600 border-gray-200",
	};

	const diffTarget =
		revision.status === "PENDING" || baseContent === undefined
			? { before: revision.proposed_content ?? "", after: currentContent }
			: {
					before: baseContent ?? "",
					after: revision.proposed_content ?? "",
				};

	return (
		<li className="border border-gray-200 rounded-lg p-4 bg-white">
			<div className="flex flex-wrap items-center gap-2">
				<span
					className={`px-2 py-0.5 rounded-full border text-xs font-medium ${badge.className}`}
				>
					{badge.label}
				</span>
				<span className="px-2 py-0.5 rounded-full border border-blue-200 bg-blue-50 text-blue-800 text-xs font-medium">
					{revision.source}
				</span>
				<span className="text-xs text-gray-500 font-mono" dir="ltr">
					{revision.id.slice(0, 8)}
				</span>
				<span className="text-xs text-gray-600">
					{formatDateTime(revision.created_at)}
				</span>
				{revision.proposed_title && (
					<span className="text-sm font-medium text-gray-800">
						{revision.proposed_title}
					</span>
				)}
			</div>

			{revision.notes && (
				<p className="mt-2 text-xs text-gray-600">{revision.notes}</p>
			)}

			<div className="mt-3 flex flex-wrap gap-2">
				<button
					type="button"
					onClick={() => setExpanded(expanded === "diff" ? "none" : "diff")}
					className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
				>
					{expanded === "diff" ? "הסתר הבדלים" : "הצג הבדלים"}
				</button>
				<button
					type="button"
					onClick={() =>
						setExpanded(expanded === "preview" ? "none" : "preview")
					}
					className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
				>
					{expanded === "preview" ? "הסתר תצוגה" : "תצוגה מקדימה"}
				</button>

				{revision.status === "PENDING" && (
					<>
						<button
							type="button"
							disabled={isBusy}
							onClick={() => onApprove(revision.id)}
							className="px-3 py-1.5 text-xs font-medium rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
						>
							אשר והחל
						</button>
						<button
							type="button"
							disabled={isBusy}
							onClick={() => onReject(revision.id)}
							className="px-3 py-1.5 text-xs font-medium rounded-lg bg-red-50 border border-red-200 text-red-700 hover:bg-red-100 disabled:opacity-50"
						>
							דחה
						</button>
					</>
				)}

				{revision.status !== "PENDING" && (
					<button
						type="button"
						disabled={isBusy}
						onClick={() => {
							if (
								window.confirm(
									"שחזור ישמור מחדש את הערך עם תוכן הגרסה הזו ויחליף את התוכן בעורך. להמשיך?",
								)
							) {
								onRestore(revision.id);
							}
						}}
						className="px-3 py-1.5 text-xs font-medium rounded-lg border border-indigo-300 text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
						title={
							baseRevisionId === null
								? "שחזור יתבסס על ה-head הנוכחי"
								: undefined
						}
					>
						שחזר גרסה זו
					</button>
				)}
			</div>

			{expanded === "diff" && (
				<DiffView before={diffTarget.before} after={diffTarget.after} />
			)}
			{expanded === "preview" && (
				<div
					className="admin-prose mt-3 rounded-lg border border-gray-200 bg-white p-4 max-h-72 overflow-auto"
					// biome-ignore lint/security/noDangerouslySetInnerHtml: DOMPurify-sanitized revision snapshot preview
					dangerouslySetInnerHTML={{ // nosemgrep -- DOMPurify-sanitized revision snapshot preview
						__html: DOMPurify.sanitize(
							revision.proposed_content || "<p></p>",
						),
					}}
				/>
			)}
		</li>
	);
}

/**
 * Wiki-style history for entry content: APPLIED revisions form the immutable
 * history (list, word-diff, restore-as-new-revision); PENDING rows are external
 * AI proposals awaiting triage (approve applies them through the same path).
 */
export function EntryHistoryPanel({
	entryId,
	currentContent,
	baseRevisionId,
	onEntryChanged,
}: EntryHistoryPanelProps) {
	const queryClient = useQueryClient();

	const revisionsQuery = useQuery({
		queryKey: ["tanahpedia-entry-revisions", entryId],
		queryFn: () => listEntryRevisions({ data: entryId }),
	});
	const revisions = revisionsQuery.data ?? [];

	const byId = useMemo(() => {
		const map = new Map<string, EntryRevisionRow>();
		for (const r of revisions) map.set(r.id, r);
		return map;
	}, [revisions]);

	const refresh = () => {
		void queryClient.invalidateQueries({
			queryKey: ["tanahpedia-entry-revisions", entryId],
		});
		onEntryChanged();
	};

	const restoreMutation = useMutation({
		mutationFn: (id: string) =>
			restoreEntryRevision({ data: { id, baseRevisionId } }),
		onSuccess: refresh,
	});
	const approveMutation = useMutation({
		mutationFn: (id: string) => approveEntryRevision({ data: { id } }),
		onSuccess: refresh,
	});
	const rejectMutation = useMutation({
		mutationFn: (id: string) => rejectEntryRevision({ data: { id } }),
		onSuccess: refresh,
	});

	const isBusy =
		restoreMutation.isPending ||
		approveMutation.isPending ||
		rejectMutation.isPending;

	const error =
		restoreMutation.error ?? approveMutation.error ?? rejectMutation.error;

	return (
		<div className="space-y-4">
			<div className="rounded-lg border border-gray-200 bg-gray-50/60 p-4">
				<h2 className="text-sm font-bold text-gray-800 mb-1">
					היסטוריית גרסאות תוכן
				</h2>
				<p className="text-xs text-gray-600 leading-relaxed">
					כל שמירה נרשמת כגרסה בלתי-משתנה. ניתן להשוות גרסאות לתוכן הנוכחי,
					לשחזר גרסה (השחזור עצמו נשמר כגרסה חדשה) ולאשר/לדחות הצעות חיצוניות.
				</p>
			</div>

			{error && (
				<p className="text-sm text-red-700">
					{isRevisionConflictError(error)
						? "הערך נשמר בינתיים בסשן אחר - רענן את הערך לפני הפעולה"
						: error instanceof Error
							? error.message
							: String(error)}
				</p>
			)}

			{revisionsQuery.isLoading ? (
				<p className="text-sm text-gray-500">טוען היסטוריה...</p>
			) : revisions.length === 0 ? (
				<p className="text-sm text-gray-500">
					אין עדיין גרסאות לערך זה - הגרסה הראשונה תיווצר בשמירה הבאה.
				</p>
			) : (
				<ul className="space-y-3">
					{revisions.map((revision) => (
						<RevisionRow
							key={revision.id}
							revision={revision}
							baseContent={
								revision.base_revision_id
									? byId.get(revision.base_revision_id)
											?.proposed_content
									: undefined
							}
							currentContent={currentContent ?? ""}
							baseRevisionId={baseRevisionId}
							isBusy={isBusy}
							onApprove={(id) => approveMutation.mutate(id)}
							onReject={(id) => rejectMutation.mutate(id)}
							onRestore={(id) => restoreMutation.mutate(id)}
						/>
					))}
				</ul>
			)}
		</div>
	);
}
