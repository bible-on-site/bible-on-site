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
	clearLegacyEntryDraft,
	draftKey,
	entryDraftScope,
	LOCAL_DRAFT_VERSION,
	listNewEntryDrafts,
	newEntryDraftScope,
	readEntryDraft,
	readLegacyEntryDraft,
	type StoredEntryDraft,
	writeEntryDraft,
} from "~/lib/tanahpedia/local-draft";
import {
	isRevisionConflictError,
	REVISION_SOURCE_ADMIN,
	REVISION_SOURCE_LLM,
} from "~/lib/tanahpedia/revisions-shared";
import { getEditorIdentity } from "~/server/session";
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
	// A local draft found on load — offered for explicit restore, never
	// applied silently over the freshly-fetched server state.
	const [pendingDraft, setPendingDraft] = useState<{
		draft: StoredEntryDraft;
		staleBase: boolean;
	} | null>(null);
	// The stored draft exists but is unreadable (truncated/old shape).
	const [malformedDraft, setMalformedDraft] = useState(false);
	// The debounced mirror failed (storage unavailable/full) or the editor
	// identity needed for the scoped key could not be resolved.
	const [draftWriteFailed, setDraftWriteFailed] = useState(false);
	// Another tab/window wrote to this draft — surfaced, never merged.
	const [otherTabDraft, setOtherTabDraft] = useState(false);
	const [lastDraftAt, setLastDraftAt] = useState<Date | null>(null);

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
	// Tab/window identity — a draft written by a different sessionId came
	// from another open tab and must not silently merge.
	const sessionIdRef = useRef<string | null>(null);
	// Unsaved entries get a stable draft identity for the mount's lifetime;
	// recovery scans the account's `new:` drafts to offer the latest one.
	const newDraftIdRef = useRef<string | null>(null);
	// Recovery runs once per draft scope so it cannot re-offer after edits.
	// draftCheckGen re-arms the check after a server-state adoption (conflict
	// reload, history restore): structural sharing can keep the refetched
	// entry reference-equal, so a state bump — not the entry dep — re-runs it.
	const draftCheckedRef = useRef<string | null>(null);
	const [draftCheckGen, setDraftCheckGen] = useState(0);
	// Assigned during render so the debounce and save-ack paths always write
	// the latest editor state, never a stale closure.
	const persistDraftRef = useRef<() => void>(() => {});

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

	const { data: editorIdentity, error: identityError } = useQuery({
		queryKey: ["tanahpedia-editor-identity"],
		queryFn: () => getEditorIdentity(),
		staleTime: Number.POSITIVE_INFINITY,
	});
	const accountId = editorIdentity?.id ?? null;
	if (sessionIdRef.current === null) {
		sessionIdRef.current = crypto.randomUUID();
	}
	if (isNew && newDraftIdRef.current === null) {
		newDraftIdRef.current = crypto.randomUUID();
	}
	const draftScope = isNew
		? newEntryDraftScope(newDraftIdRef.current as string)
		: entryDraftScope(createdIdRef.current ?? id);
	const draftStorageKey = accountId ? draftKey(accountId, draftScope) : null;

	persistDraftRef.current = () => {
		if (!draftStorageKey || !accountId || !sessionIdRef.current) return;
		const ok = writeEntryDraft(draftStorageKey, {
			version: LOCAL_DRAFT_VERSION,
			accountId,
			scope: draftScope,
			sessionId: sessionIdRef.current,
			baseRevisionId: baseRevisionIdRef.current,
			savedAt: new Date().toISOString(),
			form: formData,
			source: saveSource,
			notes: pendingNotes,
		});
		setDraftWriteFailed(!ok);
		if (ok) {
			setLastDraftAt(new Date());
			// A successful write replaces whatever malformed bytes were there.
			setMalformedDraft(false);
		}
	};

	useEffect(() => {
		// Skip while dirty — a background refetch must not clobber unsaved
		// edits or regress the revision base they build on.
		if (!entry || editCounterRef.current !== cleanCounterRef.current) return;
		setFormData({
			unique_name: entry.unique_name,
			title: entry.title,
			content: entry.content ?? "",
		});
		baseRevisionIdRef.current = entry.currentRevisionId ?? null;
		setBaseRevisionId(entry.currentRevisionId ?? null);
	}, [entry]);

	// Recovery check for an existing entry — runs once per draft scope, after
	// both the entry and the account identity have resolved. A found draft is
	// offered (with its timestamp and stale-base marker), never applied.
	// biome-ignore lint/correctness/useExhaustiveDependencies: draftCheckGen is the deliberate re-arm trigger after adopting server state
	useEffect(() => {
		if (isNew || !entry || !accountId || !draftStorageKey) return;
		if (draftCheckedRef.current === draftStorageKey) return;
		draftCheckedRef.current = draftStorageKey;

		let found: StoredEntryDraft | null = null;
		const result = readEntryDraft(draftStorageKey);
		if (result.kind === "malformed") setMalformedDraft(true);
		else if (result.kind === "ok") found = result.draft;
		if (!found) {
			// Adopt a #2611-era unscoped stash (written by the failure path) —
			// it is removed once offered so it cannot re-fire under v2.
			const legacy = readLegacyEntryDraft(id);
			if (legacy) {
				clearLegacyEntryDraft(id);
				found = {
					version: LOCAL_DRAFT_VERSION,
					accountId,
					scope: draftScope,
					sessionId: sessionIdRef.current as string,
					baseRevisionId: legacy.baseRevisionId,
					savedAt: legacy.savedAt,
					form: legacy.form,
					source: REVISION_SOURCE_ADMIN,
					notes: null,
				};
			}
		}
		if (!found) return;
		const sameAsServer =
			found.form.unique_name === entry.unique_name &&
			found.form.title === entry.title &&
			found.form.content === (entry.content ?? "");
		if (sameAsServer) {
			// Leftover of an already-committed save — drop it silently.
			clearEntryDraft(draftStorageKey);
			return;
		}
		setPendingDraft({
			draft: found,
			staleBase: found.baseRevisionId !== (entry.currentRevisionId ?? null),
		});
	}, [isNew, entry, accountId, draftStorageKey, draftScope, id, draftCheckGen]);

	// Unsaved entries have no server record to compare against — the latest
	// account `new:` draft is offered on mount.
	useEffect(() => {
		if (!isNew || !accountId) return;
		const checkId = `new:${accountId}`;
		if (draftCheckedRef.current === checkId) return;
		draftCheckedRef.current = checkId;
		const [latest] = listNewEntryDrafts(accountId);
		if (latest) {
			setPendingDraft({ draft: latest, staleBase: false });
			return;
		}
		// A #2611-era stash under the literal "new" key gets the same offer.
		const legacy = readLegacyEntryDraft("new");
		if (legacy) {
			clearLegacyEntryDraft("new");
			setPendingDraft({
				draft: {
					version: LOCAL_DRAFT_VERSION,
					accountId,
					scope: draftScope,
					sessionId: sessionIdRef.current as string,
					baseRevisionId: null,
					savedAt: legacy.savedAt,
					form: legacy.form,
					source: REVISION_SOURCE_ADMIN,
					notes: null,
				},
				staleBase: false,
			});
		}
	}, [isNew, accountId, draftScope]);

	// Cross-tab mirroring: a write under our key from another sessionId is
	// surfaced, never merged into this tab's buffer.
	useEffect(() => {
		if (!draftStorageKey) return;
		const onStorage = (event: StorageEvent) => {
			if (event.key !== draftStorageKey || !event.newValue) return;
			try {
				const other = JSON.parse(event.newValue) as StoredEntryDraft;
				if (other.sessionId !== sessionIdRef.current) setOtherTabDraft(true);
			} catch {
				setOtherTabDraft(true);
			}
		};
		window.addEventListener("storage", onStorage);
		return () => window.removeEventListener("storage", onStorage);
	}, [draftStorageKey]);

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
				if (draftStorageKey) clearEntryDraft(draftStorageKey);
				setLastDraftAt(null);
				setPendingDraft(null);
				setSaveSource(REVISION_SOURCE_ADMIN);
				setPendingNotes(null);
			} else {
				// Newer edits outlived the ack — re-anchor the draft's base on
				// the head this commit just produced.
				persistDraftRef.current();
			}
			if (isNew && savedEntry?.id) {
				createdIdRef.current = savedEntry.id;
				// The new-entry draft's content is now committed (or lives on
				// under the created entry's scope) — never leave it behind to be
				// re-offered on the next /new visit.
				if (accountId && newDraftIdRef.current) {
					clearEntryDraft(
						draftKey(accountId, newEntryDraftScope(newDraftIdRef.current)),
					);
				}
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

	// Queue a commit; the newest snapshot wins and runs as soon as the
	// previous request settles — explicit saves and retries can never race.
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
			// The entry no longer exists — its draft can never be committed.
			if (draftStorageKey) clearEntryDraft(draftStorageKey);
			clearLegacyEntryDraft(id);
			navigate({ to: "/tanahpedia" });
		},
	});

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

	// The ONLY automatic persistence: typed edits mirror into the
	// account-scoped local draft after a short debounce. Nothing here ever
	// touches the server — commits happen solely through שמור עכשיו.
	// biome-ignore lint/correctness/useExhaustiveDependencies: formData re-arms the debounce on every keystroke; the callback reads live refs
	useEffect(() => {
		if (!hasChanges || !draftStorageKey) return;
		const timer = setTimeout(() => persistDraftRef.current(), 600);
		return () => clearTimeout(timer);
	}, [hasChanges, draftStorageKey, formData]);

	// Adopt the server version (conflict reload, history restore): mark the
	// loaded state clean, dismiss the conflict, refetch, then re-arm draft
	// recovery — structural sharing can keep the refetched entry
	// reference-equal, so the state bump is what re-runs the check.
	const adoptServerState = async () => {
		editCounterRef.current += 1;
		cleanCounterRef.current = editCounterRef.current;
		setHasChanges(false);
		setConflictError(false);
		setPendingDraft(null);
		await queryClient.invalidateQueries({
			queryKey: ["tanahpedia-entry", id],
		});
		draftCheckedRef.current = null;
		setDraftCheckGen((g) => g + 1);
	};

	// Restoring applies the draft's content over the CURRENT head — the
	// stale marker told the user the server moved, and their commit still
	// carries the base guard, so a restored draft can never silently rebase.
	const restorePendingDraft = () => {
		if (!pendingDraft) return;
		const { draft } = pendingDraft;
		if (isNew && draft.scope.startsWith("new:")) {
			newDraftIdRef.current = draft.scope.slice("new:".length);
		}
		setFormData(draft.form);
		setSaveSource(draft.source || REVISION_SOURCE_ADMIN);
		setPendingNotes(draft.notes);
		editCounterRef.current += 1;
		setHasChanges(true);
		setPendingDraft(null);
	};

	const discardPendingDraft = () => {
		if (!pendingDraft) return;
		if (accountId)
			clearEntryDraft(draftKey(accountId, pendingDraft.draft.scope));
		if (!isNew) clearLegacyEntryDraft(id);
		setPendingDraft(null);
	};

	// Explicit revert: drop every uncommitted edit AND its local draft, then
	// re-anchor on whatever the server holds.
	const handleRevert = () => {
		if (!window.confirm("לבטל את כל השינויים שלא נשמרו? הטיוטה המקומית תימחק."))
			return;
		editCounterRef.current += 1;
		cleanCounterRef.current = editCounterRef.current;
		setHasChanges(false);
		setPendingDraft(null);
		setSaveError(null);
		setConflictError(false);
		setSaveSource(REVISION_SOURCE_ADMIN);
		setPendingNotes(null);
		setLastDraftAt(null);
		if (draftStorageKey) clearEntryDraft(draftStorageKey);
		if (!isNew) clearLegacyEntryDraft(id);
		if (isNew) {
			setFormData({ unique_name: "", title: "", content: "" });
		} else {
			// Reset synchronously: the refetch may return reference-equal data
			// (structural sharing), which would never re-run the sync effect.
			if (entry) {
				setFormData({
					title: entry.title,
					unique_name: entry.unique_name,
					content: entry.content ?? "",
				});
			}
			void queryClient.invalidateQueries({
				queryKey: ["tanahpedia-entry", id],
			});
		}
	};

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
						lastDraftAt={lastDraftAt}
						draftFailed={draftWriteFailed || !!identityError}
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

			{pendingDraft && (
				<div className="rounded-lg border border-blue-300 bg-blue-50 p-4 flex flex-wrap items-center justify-between gap-3">
					<div className="text-sm text-blue-900">
						<p className="font-medium">
							נמצאה טיוטה מקומית מ-
							{new Date(pendingDraft.draft.savedAt).toLocaleString("he-IL")}
							{pendingDraft.draft.form.title
								? ` (${pendingDraft.draft.form.title})`
								: ""}
						</p>
						<p className="mt-1">
							{pendingDraft.staleBase
								? "הערך בשרת עודכן מאז נכתבה הטיוטה — שחזור יחיל את תוכנה על העריכה הנוכחית, והשמירה תישאר כפופה לאישורך."
								: "הטיוטה נשמרה במכשיר זה בלבד ולא פורסמה — אפשר לשחזר אותה או למחוק."}
						</p>
					</div>
					<div className="flex gap-2">
						<button
							type="button"
							onClick={restorePendingDraft}
							className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700"
						>
							שחזר טיוטה
						</button>
						<button
							type="button"
							onClick={discardPendingDraft}
							className="px-4 py-2 text-sm font-medium rounded-lg border border-blue-300 text-blue-800 hover:bg-blue-100"
						>
							מחק טיוטה
						</button>
					</div>
				</div>
			)}

			{malformedDraft && (
				<div className="rounded-lg border border-amber-300 bg-amber-50 p-4 flex flex-wrap items-center justify-between gap-3">
					<p className="text-sm text-amber-900">
						נמצאה טיוטה מקומית פגומה שלא ניתן לשחזר — העריכה ממשיכה רגיל,
						והטיוטה תוחלף בשמירה המקומית הבאה.
					</p>
					<button
						type="button"
						onClick={() => {
							if (draftStorageKey) clearEntryDraft(draftStorageKey);
							setMalformedDraft(false);
						}}
						className="px-4 py-2 text-sm font-medium rounded-lg border border-amber-300 text-amber-900 hover:bg-amber-100"
					>
						מחק טיוטה פגומה
					</button>
				</div>
			)}

			{otherTabDraft && (
				<div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
					הטיוטה המקומית עודכנה מכרטיסייה אחרת הפתוחה לאותו ערך — הטיוטות לא
					מתמזגות אוטומטית כדי לא לדרוס עבודה.
					<button
						type="button"
						onClick={() => setOtherTabDraft(false)}
						className="mr-3 underline font-medium"
					>
						הבנתי
					</button>
				</div>
			)}

			{(draftWriteFailed || identityError) && !saveError && (
				<div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
					הטיוטה המקומית לא נשמרה — השינויים מוגנים רק בזיכרון עמוד זה. בדוק את
					האחסון או התחברותך לפני סגירת הכרטיסייה.
				</div>
			)}

			{conflictError && (
				<div className="rounded-lg border border-red-300 bg-red-50 p-4 flex flex-wrap items-center justify-between gap-3">
					<p className="text-sm text-red-800">
						הערך נשמר על ידי סשן אחר מאז שהטענת אותו - השמירה נדחתה כדי לא לדרוס
						שינויים. טען מחדש את הערך כדי לראות את הגרסה העדכנית — השינויים שלך
						יישארו כטיוטה מקומית ותוצע לשחזור.
					</p>
					<button
						type="button"
						onClick={() => {
							// Accepting the server head discards the local edits — the
							// draft keeps them recoverable, and the recovery check runs
							// again so they are offered over the fresh head.
							void adoptServerState();
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
						// A restore committed new server state — adopt it as the
						// baseline; the local draft stays and is re-offered over the
						// new head so pre-restore edits are not silently lost.
						void adoptServerState();
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
					{hasChanges && (
						<button
							type="button"
							onClick={handleRevert}
							disabled={saveMutation.isPending}
							className="px-6 py-2.5 border border-red-200 text-red-700 rounded-lg hover:bg-red-50 disabled:opacity-50 transition-all font-medium"
						>
							בטל שינויים
						</button>
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
