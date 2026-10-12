import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { AutoSaveIndicator } from "~/components/AutoSaveIndicator";
import { searchEntriesForLink } from "~/components/editor/entryLinkSearch";
import { EntryHistoryPanel } from "~/components/tanahpedia/EntryHistoryPanel";
import { EntryStructuralPanel } from "~/components/tanahpedia/EntryStructuralPanel";
import { TanahpediaLlmAssistantPanel } from "~/components/tanahpedia/TanahpediaLlmAssistantPanel";
import { WysiwygEditor } from "~/components/WysiwygEditor";
import {
	isRevisionConflictError,
	REVISION_SOURCE_ADMIN,
	REVISION_SOURCE_LLM,
} from "~/lib/tanahpedia/revisions-shared";
import {
	createEntry,
	deleteEntry,
	getEntry,
	updateEntry,
} from "~/server/tanahpedia/entries";
import { getLlmAssistantStatus } from "~/server/tanahpedia/llm-assistant";

interface EntryFormData {
	unique_name: string;
	title: string;
	content: string;
}

export const Route = createFileRoute("/tanahpedia/entries/$id")({
	component: EntryEditPage,
});

function EntryEditPage() {
	const { id } = Route.useParams();
	const navigate = useNavigate();
	const queryClient = useQueryClient();

	const isNew = id === "new";

	const [formData, setFormData] = useState<EntryFormData>({
		unique_name: "",
		title: "",
		content: "",
	});
	const [hasChanges, setHasChanges] = useState(false);
	const [lastSaved, setLastSaved] = useState<Date | null>(null);
	const [tab, setTab] = useState<"content" | "metadata" | "history">("content");
	// The APPLIED head revision this editing session is based on; the server
	// rejects saves whose base is stale (another session moved the head).
	const [baseRevisionId, setBaseRevisionId] = useState<string | null>(null);
	const [saveSource, setSaveSource] = useState<string>(REVISION_SOURCE_ADMIN);
	const [pendingNotes, setPendingNotes] = useState<string | null>(null);
	const [conflictError, setConflictError] = useState(false);

	const { data: llmStatus } = useQuery({
		queryKey: ["tanahpedia-llm-status"],
		queryFn: () => getLlmAssistantStatus(),
	});
	const llmEnabled = llmStatus?.enabled === true;

	const { data: entry, isLoading } = useQuery({
		queryKey: ["tanahpedia-entry", id],
		queryFn: () => getEntry({ data: id }),
		enabled: !isNew,
	});

	useEffect(() => {
		if (entry) {
			setFormData({
				unique_name: entry.unique_name,
				title: entry.title,
				content: entry.content ?? "",
			});
			setBaseRevisionId(entry.currentRevisionId ?? null);
			setConflictError(false);
		}
	}, [entry]);

	const saveMutation = useMutation({
		mutationFn: async (data: EntryFormData) => {
			if (isNew) {
				return createEntry({
					data: {
						id: crypto.randomUUID(),
						unique_name: data.unique_name,
						title: data.title,
						content: data.content,
						source: saveSource,
						notes: pendingNotes,
					},
				});
			}
			return updateEntry({
				data: {
					id,
					unique_name: data.unique_name,
					title: data.title,
					content: data.content,
					baseRevisionId,
					source: saveSource,
					notes: pendingNotes,
				},
			});
		},
		onSuccess: (savedEntry) => {
			queryClient.invalidateQueries({ queryKey: ["tanahpedia-admin-entries"] });
			void queryClient.invalidateQueries({
				queryKey: ["tanahpedia-entry-revisions", savedEntry?.id ?? id],
			});
			setLastSaved(new Date());
			setHasChanges(false);
			setConflictError(false);
			setSaveSource(REVISION_SOURCE_ADMIN);
			setPendingNotes(null);
			if (savedEntry?.headRevisionId !== undefined) {
				setBaseRevisionId(savedEntry.headRevisionId);
			}
			if (isNew && savedEntry?.id) {
				navigate({
					to: "/tanahpedia/entries/$id",
					params: { id: savedEntry.id },
					replace: true,
				});
			}
		},
		onError: (error) => {
			if (isRevisionConflictError(error)) setConflictError(true);
		},
	});

	const deleteMutation = useMutation({
		mutationFn: () => deleteEntry({ data: id }),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["tanahpedia-admin-entries"] });
			navigate({ to: "/tanahpedia" });
		},
	});

	const handleFieldChange = useCallback(
		<K extends keyof EntryFormData>(field: K, value: EntryFormData[K]) => {
			setFormData((prev) => ({ ...prev, [field]: value }));
			setHasChanges(true);
			setSaveSource(REVISION_SOURCE_ADMIN);
			setPendingNotes(null);
		},
		[],
	);

	const handleContentChange = useCallback((content: string) => {
		setFormData((prev) => ({ ...prev, content }));
		setHasChanges(true);
		setSaveSource(REVISION_SOURCE_ADMIN);
		setPendingNotes(null);
	}, []);

	useEffect(() => {
		if (!hasChanges || saveMutation.isPending) return;
		const timer = setTimeout(() => {
			if (formData.title.trim()) saveMutation.mutate(formData);
		}, 2000);
		return () => clearTimeout(timer);
	}, [formData, hasChanges, saveMutation.isPending, saveMutation]);

	if (isLoading) {
		return (
			<div className="flex items-center justify-center h-64">
				<div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
			</div>
		);
	}

	return (
		<div className="space-y-8">
			<div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
				<div>
					<Link
						to="/tanahpedia"
						className="inline-flex items-center gap-1.5 text-blue-600 hover:text-blue-700 text-sm font-medium transition-colors"
					>
						<span>→</span>
						<span>חזרה לתנכפדיה</span>
					</Link>
					<h1 className="text-3xl font-bold text-gray-900 mt-2">
						{isNew ? "ערך חדש" : `עריכת ערך: ${entry?.title ?? ""}`}
					</h1>
				</div>
				<div className="flex items-center gap-4">
					<AutoSaveIndicator
						isSaving={saveMutation.isPending}
						lastSaved={lastSaved}
						hasChanges={hasChanges}
					/>
					{!isNew && (
						<button
							type="button"
							onClick={() => {
								if (window.confirm("האם אתה בטוח שברצונך למחוק ערך זה?"))
									deleteMutation.mutate();
							}}
							className="inline-flex items-center gap-1.5 text-red-600 hover:text-red-700 px-4 py-2 border border-red-200 rounded-lg hover:bg-red-50 transition-all font-medium text-sm"
						>
							מחק ערך
						</button>
					)}
				</div>
			</div>

			{conflictError && (
				<div className="rounded-lg border border-red-300 bg-red-50 p-4 flex flex-wrap items-center justify-between gap-3">
					<p className="text-sm text-red-800">
						הערך נשמר על ידי סשן אחר מאז שהטענת אותו - השמירה נדחתה כדי לא לדרוס
						שינויים. טען מחדש את הערך כדי לראות את הגרסה העדכנית (השינויים הלא
						שמורים שלך ייאבדו).
					</p>
					<button
						type="button"
						onClick={() =>
							void queryClient.invalidateQueries({
								queryKey: ["tanahpedia-entry", id],
							})
						}
						className="px-4 py-2 text-sm font-medium rounded-lg bg-red-600 text-white hover:bg-red-700"
					>
						טען מחדש
					</button>
				</div>
			)}

			<div className="flex gap-1 border-b border-gray-200" role="tablist">
				{(
					[
						["content", "תוכן"],
						["metadata", "מטא-דאטה"],
						...(isNew
							? []
							: [["history", "היסטוריה"] as [typeof tab, string]]),
					] as [typeof tab, string][]
				).map(([key, label]) => (
					<button
						key={key}
						type="button"
						role="tab"
						aria-selected={tab === key}
						onClick={() => setTab(key)}
						className={`px-5 py-2.5 text-sm font-medium rounded-t-lg border border-b-0 transition-colors ${
							tab === key
								? "bg-white border-gray-200 text-blue-700"
								: "bg-gray-50 border-transparent text-gray-600 hover:text-gray-900"
						}`}
					>
						{label}
					</button>
				))}
			</div>

			{tab === "metadata" && (
				<>
					{!isNew && llmEnabled && (
						<TanahpediaLlmAssistantPanel
							entryId={id}
							formData={formData}
							onApplyEntryFields={(patch, meta) => {
								setFormData((prev) => ({ ...prev, ...patch }));
								setHasChanges(true);
								setSaveSource(REVISION_SOURCE_LLM);
								setPendingNotes(meta?.notesForEditor ?? null);
							}}
						/>
					)}

					{isNew ? (
						<div className="rounded-lg border border-amber-200 bg-amber-50/60 p-4 text-sm text-amber-950">
							עריכת מבנה יישויות זמינה לאחר שמירת ערך חדש (נוצר מזהה בשרת).
						</div>
					) : (
						<EntryStructuralPanel entryId={id} />
					)}
				</>
			)}

			{tab === "history" && !isNew && (
				<EntryHistoryPanel
					entryId={id}
					currentContent={entry?.content ?? formData.content}
					baseRevisionId={baseRevisionId}
					onEntryChanged={() => {
						setHasChanges(false);
						void queryClient.invalidateQueries({
							queryKey: ["tanahpedia-entry", id],
						});
					}}
				/>
			)}

			<form className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
				<div className="p-8 space-y-6">
					{tab === "metadata" && (
						<div className="grid md:grid-cols-2 gap-6">
							<div>
								<label
									htmlFor="title"
									className="block text-sm font-semibold text-gray-700 mb-2"
								>
									כותרת <span className="text-red-500">*</span>
								</label>
								<input
									id="title"
									type="text"
									value={formData.title}
									onChange={(e) => handleFieldChange("title", e.target.value)}
									className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
									placeholder="כותרת הערך"
								/>
							</div>
							<div>
								<label
									htmlFor="unique_name"
									className="block text-sm font-semibold text-gray-700 mb-2"
								>
									שם ייחודי (URL)
								</label>
								<input
									id="unique_name"
									type="text"
									value={formData.unique_name}
									onChange={(e) =>
										handleFieldChange("unique_name", e.target.value)
									}
									className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
									placeholder="שם-ייחודי-בurl"
								/>
							</div>
						</div>
					)}

					{tab === "content" && (
						<div>
							{/* biome-ignore lint/a11y/noLabelWithoutControl: WysiwygEditor is a custom component */}
							<label className="block text-sm font-semibold text-gray-700 mb-2">
								תוכן הערך
							</label>
							<WysiwygEditor
								content={formData.content}
								onChange={handleContentChange}
								placeholder="הכנס את תוכן הערך..."
								searchEntries={searchEntriesForLink}
							/>
						</div>
					)}
				</div>

				<div className="flex justify-end gap-4 px-8 py-5 bg-gray-50 border-t border-gray-200">
					<Link
						to="/tanahpedia"
						className="px-6 py-2.5 border border-gray-300 rounded-lg hover:bg-gray-100 transition-all font-medium text-gray-700"
					>
						ביטול
					</Link>
					<button
						type="button"
						onClick={() => saveMutation.mutate(formData)}
						disabled={saveMutation.isPending || !formData.title.trim()}
						className="px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all font-medium shadow-sm hover:shadow-md"
					>
						{saveMutation.isPending ? "שומר..." : "שמור עכשיו"}
					</button>
				</div>
			</form>
		</div>
	);
}
