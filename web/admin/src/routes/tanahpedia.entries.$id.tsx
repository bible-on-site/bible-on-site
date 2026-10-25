import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AutoSaveIndicator } from "~/components/AutoSaveIndicator";
import { searchEntriesForLink } from "~/components/editor/entryLinkSearch";
import { EntryHistoryPanel } from "~/components/tanahpedia/EntryHistoryPanel";
import { EntryStructuralPanel } from "~/components/tanahpedia/EntryStructuralPanel";
import { TanahpediaLlmAssistantPanel } from "~/components/tanahpedia/TanahpediaLlmAssistantPanel";
import { WysiwygEditor } from "~/components/WysiwygEditor";
import {
	type ClassifiedSaveError,
	classifySaveError,
} from "~/lib/server-fn-errors";
import {
	clearEntryDraft,
	readEntryDraft,
	stashEntryDraft,
} from "~/lib/tanahpedia/local-draft";
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

/** A single save request — snapshot of the editor state it commits. */
interface SaveJob {
	form: EntryFormData;
	source: string;
	notes: string | null;
	/** Editor edit-generation when the job was submitted; see editCounterRef. */
	editCount: number;
}

/** The job plus the optimistic-concurrency base, resolved at dequeue time. */
type DispatchedSaveJob = SaveJob & { baseRevisionId: string | null };

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
	// The visible non-conflict save failure; sticky until explicit retry so a
	// persistent failure surfaces once instead of looping silently.
	const [saveError, setSaveError] = useState<ClassifiedSaveError | null>(null);

	// Edit-generation counters (read synchronously — immune to render timing):
	// every user edit bumps editCounterRef; cleanCounterRef records the counter
	// at the last committed baseline. Dirty iff they differ.
	const editCounterRef = useRef(0);
	const cleanCounterRef = useRef(0);
	const baseRevisionIdRef = useRef<string | null>(null);
	baseRevisionIdRef.current = baseRevisionId;
	// Serialized save queue: one request in flight; a later request waits and
	// only the newest queued snapshot runs next.
	const inFlightRef = useRef(false);
	const queuedJobRef = useRef<SaveJob | null>(null);
	const flushRef = useRef<() => void>(() => {});
	// Once a create succeeds, later queued saves on the /new route must update
	// the created entry — the route param still reads "new" until navigation.
	// Reset on param change: the component isn't remounted when moving between
	// entries, so a stale id must not redirect saves to the previous entry.
	const createdIdRef = useRef<string | null>(null);
	const routeIdRef = useRef(id);
	if (routeIdRef.current !== id) {
		routeIdRef.current = id;
		createdIdRef.current = null;
	}

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
		// Skip while dirty — a background refetch must not clobber unsaved
		// edits or regress the revision base they build on.
		if (!entry || editCounterRef.current !== cleanCounterRef.current) return;

		// A stashed local draft (written when a save died, e.g. an expired
		// session that forces a login round-trip) restores over the fresh head
		// and stays dirty so the autosave can still commit it.
		const draft = readEntryDraft(id);
		// A draft stashed against an older head means someone else saved in
		// the meantime — committing it blindly would replace their changes, so
		// it lands on the same visible conflict path as a rejected save.
		const draftStale =
			!!draft && draft.baseRevisionId !== (entry.currentRevisionId ?? null);
		if (draft) {
			setFormData(draft.form);
			editCounterRef.current += 1;
			setHasChanges(true);
		} else {
			setFormData({
				unique_name: entry.unique_name,
				title: entry.title,
				content: entry.content ?? "",
			});
		}
		baseRevisionIdRef.current = entry.currentRevisionId ?? null;
		setBaseRevisionId(entry.currentRevisionId ?? null);
		setConflictError(draftStale);
	}, [entry, id]);

	// The /new route has no server entry, so its stash (a failed first save)
	// restores on mount instead of through the entry-sync effect.
	useEffect(() => {
		if (!isNew) return;
		const draft = readEntryDraft(id);
		if (!draft) return;
		setFormData(draft.form);
		editCounterRef.current += 1;
		setHasChanges(true);
	}, [isNew, id]);

	const saveMutation = useMutation({
		mutationFn: async (job: DispatchedSaveJob) => {
			const { form, baseRevisionId, source, notes } = job;
			if (isNew && !createdIdRef.current) {
				return createEntry({
					data: {
						id: crypto.randomUUID(),
						unique_name: form.unique_name,
						title: form.title,
						content: form.content,
						source,
						notes,
					},
				});
			}
			return updateEntry({
				data: {
					id: createdIdRef.current ?? id,
					unique_name: form.unique_name,
					title: form.title,
					content: form.content,
					baseRevisionId,
					source,
					notes,
				},
			});
		},
		onSuccess: (savedEntry, job) => {
			queryClient.invalidateQueries({ queryKey: ["tanahpedia-admin-entries"] });
			void queryClient.invalidateQueries({
				queryKey: ["tanahpedia-entry-revisions", savedEntry?.id ?? id],
			});
			setLastSaved(new Date());
			setConflictError(false);
			setSaveError(null);
			// The acknowledged head is always adoptable — the next save proposes
			// on top of whatever snapshot this request committed. The ref update
			// must be synchronous: onSettled flushes the queue before the render
			// that carries the new state value.
			if (savedEntry?.headRevisionId !== undefined) {
				baseRevisionIdRef.current = savedEntry.headRevisionId;
				setBaseRevisionId(savedEntry.headRevisionId);
			}
			// Only clear dirty when the acked snapshot is still the editor's
			// latest — edits typed after this request began are still pending,
			// and so is their source/notes attribution (e.g. an LLM apply that
			// landed mid-flight belongs to the next save, not this one).
			if (job.editCount === editCounterRef.current) {
				cleanCounterRef.current = editCounterRef.current;
				setHasChanges(false);
				clearEntryDraft(id);
				setSaveSource(REVISION_SOURCE_ADMIN);
				setPendingNotes(null);
			}
			if (isNew && savedEntry?.id) {
				createdIdRef.current = savedEntry.id;
				navigate({
					to: "/tanahpedia/entries/$id",
					params: { id: savedEntry.id },
					replace: true,
				});
			}
		},
		onError: (error) => {
			if (isRevisionConflictError(error)) {
				setConflictError(true);
				return;
			}
			setSaveError(classifySaveError(error));
		},
		onSettled: () => {
			inFlightRef.current = false;
			flushRef.current();
		},
	});

	// Queue a save; the newest snapshot wins and runs as soon as the previous
	// request settles — autosave, manual saves, and double-clicks can never
	// race each other.
	const requestSave = useCallback((job: SaveJob) => {
		queuedJobRef.current = job;
		flushRef.current();
	}, []);

	flushRef.current = () => {
		const job = queuedJobRef.current;
		if (!job || inFlightRef.current) return;
		queuedJobRef.current = null;
		inFlightRef.current = true;
		// The base is read at dequeue time, not enqueue: a request that just
		// settled may have legitimately moved the head (our own commit), and
		// only the latest known base avoids a self-inflicted conflict.
		saveMutation.mutate({
			...job,
			baseRevisionId: baseRevisionIdRef.current,
		});
	};

	const deleteMutation = useMutation({
		mutationFn: () => deleteEntry({ data: id }),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["tanahpedia-admin-entries"] });
			navigate({ to: "/tanahpedia" });
		},
	});

	// While a save failure is unresolved, keep the local draft mirroring the
	// editor — a reload or reconnect must recover edits made after the failure,
	// not just the snapshot that failed.
	useEffect(() => {
		if (saveError) {
			stashEntryDraft(id, formData, baseRevisionId);
		}
	}, [saveError, formData, id, baseRevisionId]);

	const handleFieldChange = useCallback(
		<K extends keyof EntryFormData>(field: K, value: EntryFormData[K]) => {
			setFormData((prev) => ({ ...prev, [field]: value }));
			editCounterRef.current += 1;
			setHasChanges(true);
			setSaveSource(REVISION_SOURCE_ADMIN);
			setPendingNotes(null);
		},
		[],
	);

	const handleContentChange = useCallback((content: string) => {
		setFormData((prev) => ({ ...prev, content }));
		editCounterRef.current += 1;
		setHasChanges(true);
		setSaveSource(REVISION_SOURCE_ADMIN);
		setPendingNotes(null);
	}, []);

	useEffect(() => {
		// saveError and conflictError are sticky — after a failure the autosave
		// waits for the explicit retry/reload instead of re-firing every
		// debounce forever.
		if (!hasChanges || saveError || conflictError || !formData.title.trim())
			return;
		const timer = setTimeout(() => {
			requestSave({
				form: formData,
				source: saveSource,
				notes: pendingNotes,
				editCount: editCounterRef.current,
			});
		}, 2000);
		return () => clearTimeout(timer);
	}, [
		formData,
		hasChanges,
		saveError,
		conflictError,
		saveSource,
		pendingNotes,
		requestSave,
	]);

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
						saveFailed={saveError !== null}
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

			{saveError && (
				<div className="rounded-lg border border-red-300 bg-red-50 p-4 flex flex-wrap items-center justify-between gap-3">
					<div className="text-sm text-red-800">
						<p className="font-medium">{saveError.message}</p>
						<p className="mt-1">
							השינויים שלך נשמרו מקומית ולא אבדו —{" "}
							{saveError.kind === "session"
								? "התחבר מחדש והשמירה תושלם אוטומטית."
								: "אפשר לנסות שוב עכשיו."}
						</p>
					</div>
					{saveError.kind === "session" ? (
						<button
							type="button"
							onClick={() => window.location.reload()}
							className="px-4 py-2 text-sm font-medium rounded-lg bg-red-600 text-white hover:bg-red-700"
						>
							התחבר מחדש
						</button>
					) : (
						<button
							type="button"
							onClick={() => {
								setSaveError(null);
								requestSave({
									form: formData,
									source: saveSource,
									notes: pendingNotes,
									editCount: editCounterRef.current,
								});
							}}
							className="px-4 py-2 text-sm font-medium rounded-lg bg-red-600 text-white hover:bg-red-700"
						>
							נסה שוב
						</button>
					)}
				</div>
			)}

			{conflictError && (
				<div className="rounded-lg border border-red-300 bg-red-50 p-4 flex flex-wrap items-center justify-between gap-3">
					<p className="text-sm text-red-800">
						הערך נשמר על ידי סשן אחר מאז שהטענת אותו - השמירה נדחתה כדי לא לדרוס
						שינויים. טען מחדש את הערך כדי לראות את הגרסה העדכנית (השינויים הלא
						שמורים שלך ייאבדו).
					</p>
					<button
						type="button"
						onClick={() => {
							// Reloading discards the local edits — mark clean so the
							// refetched entry actually lands in the form, and drop the
							// stashed draft or it would restore right back on top.
							cleanCounterRef.current = editCounterRef.current;
							setHasChanges(false);
							clearEntryDraft(id);
							void queryClient.invalidateQueries({
								queryKey: ["tanahpedia-entry", id],
							});
						}}
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
						...(isNew ? [] : [["history", "היסטוריה"] as [typeof tab, string]]),
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
								editCounterRef.current += 1;
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
						cleanCounterRef.current = editCounterRef.current;
						setHasChanges(false);
						clearEntryDraft(id);
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
					{hasChanges && !formData.title.trim() && (
						<span className="self-center text-sm text-red-600">
							כותרת הערך נדרשת לשמירה
						</span>
					)}
					<button
						type="button"
						onClick={() => {
							setSaveError(null);
							requestSave({
								form: formData,
								source: saveSource,
								notes: pendingNotes,
								editCount: editCounterRef.current,
							});
						}}
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
