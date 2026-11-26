import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	createFileRoute,
	Link,
	useNavigate,
	useSearch,
} from "@tanstack/react-router";
import {
	type MouseEvent as ReactMouseEvent,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import {
	ArrowLeft,
	ArrowRight,
	BookOpen,
	CalendarDays,
	FileText,
	LoaderCircle,
	NotebookText,
	Pencil,
	Plus,
	Save,
	Star,
	Trash2,
	UserRound,
} from "lucide-react";
import { ArticleRelationshipsPanel } from "~/components/ArticleRelationshipsPanel";
import { AutoSaveIndicator } from "~/components/AutoSaveIndicator";
import { ConfirmDialog } from "~/components/ConfirmDialog";
import { CoveringSourcesEditor } from "~/components/CoveringSourcesEditor";
import { searchEntriesForLink } from "~/components/editor/entryLinkSearch";
import { HebrewDatesEditor } from "~/components/HebrewDatesEditor";
import {
	type WysiwygEditorHandle,
	WysiwygEditor,
} from "~/components/WysiwygEditor";
import {
	coverageFieldsForSave,
	perekSourceLabel,
} from "~/lib/covering-sources";
import {
	type Article,
	type ArticleFormData,
	createArticle,
	deleteArticle,
	getArticle,
	updateArticle,
} from "~/server/articles";
import { type Author, getAuthors } from "~/server/authors";
import { listMoadim } from "~/server/moadim";
import { getPerakim } from "~/server/perakim";

type ArticleSearch = {
	perekId?: number;
};

export const Route = createFileRoute("/articles/$id")({
	validateSearch: (search: Record<string, unknown>): ArticleSearch => {
		return {
			perekId: search.perekId ? Number(search.perekId) : undefined,
		};
	},
	component: ArticleEditPage,
});

function ArticleEditPage() {
	const { id } = Route.useParams();
	const { perekId: searchPerekId } = useSearch({ from: "/articles/$id" });
	const navigate = useNavigate();
	const queryClient = useQueryClient();

	const isNew = id === "new";
	const articleId = isNew ? null : Number.parseInt(id, 10);
	const defaultPerekId = searchPerekId ?? 1;

	// New articles start with an explicit empty covering set (coverage
	// unknown). For existing articles the state is populated from the
	// loaded article; coveringSources stays undefined when the
	// covering-source schema is not deployed, and the save then omits the
	// coverage fields so nothing is wiped.
	const [formData, setFormData] = useState<ArticleFormData>({
		perek_id: defaultPerekId,
		author_id: 1,
		abstract: "",
		name: "",
		priority: 1,
		distributable: false,
		content: "",
		coveringSources: isNew ? [] : undefined,
		coverageVerified: false,
		hebrewDates: isNew ? [] : undefined,
		// New articles keep moedIds undefined until the catalogue query
		// proves the moed schema exists — an eager [] would still hit the
		// link table on save and roll the create back pre-migration.
		moedIds: undefined,
	});

	const [hasChanges, setHasChanges] = useState(false);
	const [lastSaved, setLastSaved] = useState<Date | null>(null);
	const [confirmDelete, setConfirmDelete] = useState(false);
	const [deleteOpener, setDeleteOpener] = useState<HTMLElement | null>(null);
	const editorRef = useRef<WysiwygEditorHandle>(null);
	/* The editor debounces onChange, so formData.content can lag the editor by
	   up to autoSaveDelay; contentRef always holds the newest content. */
	const contentRef = useRef("");
	const latestRef = useRef({ formData, hasChanges });
	const mountedRef = useRef(true);
	/* Saves serialize through this promise so a second write never overtakes
	   an in-flight one (an older save landing last would overwrite newer
	   edits, and a second create would duplicate a new article). */
	const inFlightSaveRef = useRef<Promise<unknown> | null>(null);
	/* Once an article exists, later saves update it — even ones queued while
	   the create was still in flight. */
	const savedIdRef = useRef<number | null>(null);
	/* Every user edit bumps editVersionRef; a save records the version it
	   carried. Unsaved edits exist while the two differ — a query refetch
	   must not reset form state over them, and a save that lands behind
	   newer edits must not mark the form clean. */
	const editVersionRef = useRef(0);
	const savedVersionRef = useRef(0);

	useEffect(() => {
		latestRef.current = { formData, hasChanges };
	});
	/* StrictMode replays mount/unmount in dev; the setup must restore
	   mountedRef or the deferred unmount save and the isNew navigation are
	   permanently disabled after the replayed cleanup. */
	useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
		};
	}, []);

	const { data: article, isLoading: articleLoading } = useQuery({
		queryKey: ["article", articleId],
		queryFn: () => {
			if (articleId === null) throw new Error("Article ID is required");
			return getArticle({ data: articleId });
		},
		enabled: !!articleId,
	});

	const { data: authors } = useQuery({
		queryKey: ["authors"],
		queryFn: () => getAuthors(),
	});

	const { data: perakim } = useQuery({
		queryKey: ["perakim"],
		queryFn: () => getPerakim(),
	});

	// The moed catalogue is small — one checkbox per moed; `undefined`
	// keeps the control hidden while the moed schema is not deployed.
	const { data: moadim } = useQuery({
		queryKey: ["moadim"],
		queryFn: () => listMoadim(),
	});

	// Once the catalogue answers (even as an empty list) the moed schema
	// exists, so a new article may carry an explicit empty link set —
	// `undefined` stays the "schema unknown, omit on save" state.
	useEffect(() => {
		if (isNew && moadim !== undefined) {
			setFormData((prev) =>
				prev.moedIds === undefined ? { ...prev, moedIds: [] } : prev,
			);
		}
	}, [isNew, moadim]);

	const selectedPerek = perakim?.find(
		(perek) => perek.id === formData.perek_id,
	);
	const selectedAuthor = authors?.find(
		(author) => author.id === formData.author_id,
	);

	// Initialize form with article data. A refetch (e.g. the invalidation a
	// save fires) must not clobber edits that arrived after that save.
	useEffect(() => {
		if (article && editVersionRef.current === savedVersionRef.current) {
			contentRef.current = article.content ?? "";
			setFormData({
				perek_id: article.perek_id,
				author_id: article.author_id,
				abstract: article.abstract ?? "",
				name: article.name,
				priority: article.priority,
				distributable: Boolean(article.distributable),
				content: article.content ?? "",
				coveringSources: article.coveringSources,
				coverageVerified: article.coverage_verified,
				hebrewDates: article.hebrewDates,
				moedIds: article.moedIds,
			});
		}
	}, [article]);

	const saveMutation = useMutation({
		mutationFn: async (data: ArticleFormData) => {
			const payload: ArticleFormData = {
				...data,
				...coverageFieldsForSave(
					data.coveringSources,
					data.coverageVerified === true,
				),
			};
			const targetId = savedIdRef.current ?? articleId;
			if (targetId === null) {
				return createArticle({ data: payload });
			}
			return updateArticle({ data: { id: targetId, ...payload } });
		},
		onSuccess: async (savedArticle: Article) => {
			savedIdRef.current = savedArticle.id;
			queryClient.invalidateQueries({ queryKey: ["article", savedArticle.id] });
			queryClient.invalidateQueries({
				queryKey: ["articles", "perek", savedArticle.perek_id],
			});
			setLastSaved(new Date());

			/* A save fired while unmounting (leaving the page inside the
			   debounce window) must not hijack the user's navigation. */
			if (isNew && mountedRef.current) {
				navigate({
					to: "/articles/$id",
					params: { id: String(savedArticle.id) },
					search: {},
					replace: true,
				});
			}
		},
	});

	const deleteMutation = useMutation({
		mutationFn: () => {
			if (articleId === null) throw new Error("Article ID is required");
			return deleteArticle({ data: articleId });
		},
		onSuccess: async () => {
			navigate({
				to: "/articles/perek/$perekId",
				params: { perekId: String(article?.perek_id ?? 1) },
			});
		},
	});

	const handleFieldChange = useCallback(
		<K extends keyof ArticleFormData>(field: K, value: ArticleFormData[K]) => {
			editVersionRef.current += 1;
			setFormData((prev) => ({ ...prev, [field]: value }));
			setHasChanges(true);
		},
		[],
	);

	const handleContentChange = useCallback((content: string) => {
		editVersionRef.current += 1;
		contentRef.current = content;
		setFormData((prev) => ({ ...prev, content }));
		setHasChanges(true);
	}, []);

	/* FIFO queue on the tail promise: saves run strictly one at a time, so
	   several queued writes can't overtake or interleave. */
	const saveLatest = (data: ArticleFormData) => {
		const version = editVersionRef.current;
		const tail = inFlightSaveRef.current ?? Promise.resolve();
		inFlightSaveRef.current = tail.then(() =>
			saveMutation.mutateAsync(data).then(
				() => {
					savedVersionRef.current = version;
					// Only the newest edit's save clears the dirty flag — edits
					// typed while it was in flight still need their own save.
					if (editVersionRef.current === version) {
						setHasChanges(false);
					}
					return true;
				},
				() => false,
			),
		);
	};
	const saveLatestRef = useRef(saveLatest);
	saveLatestRef.current = saveLatest;

	// Auto-save effect
	useEffect(() => {
		if (!hasChanges || saveMutation.isPending) return;

		const timer = setTimeout(() => {
			editorRef.current?.flush();
			const data = { ...formData, content: contentRef.current };
			if (data.name.trim()) {
				saveLatestRef.current(data);
			}
		}, 2000);

		return () => clearTimeout(timer);
	}, [formData, hasChanges, saveMutation.isPending, saveMutation]);

	/* Leaving the page inside the editor's debounce window used to drop the
	   last edit. React detaches the editor's imperative handle before this
	   cleanup and runs it before the editor's own unmount flush, so the
	   final-save decision is deferred until teardown delivers any pending
	   content to contentRef. mountedRef skips the deferred save on
	   StrictMode's dev remount. */
	useEffect(() => {
		return () => {
			setTimeout(() => {
				if (mountedRef.current) return;
				const { formData: fd, hasChanges: dirty } = latestRef.current;
				if (
					(dirty || contentRef.current !== fd.content) &&
					fd.name.trim()
				) {
					saveLatestRef.current({ ...fd, content: contentRef.current });
				}
			}, 0);
		};
	}, []);


	const handleDelete = (event: ReactMouseEvent<HTMLElement>) => {
		setDeleteOpener(event.currentTarget);
		setConfirmDelete(true);
	};

	if (articleLoading) {
		return (
			<div className="flex items-center justify-center h-64">
				<div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
			</div>
		);
	}

	return (
		<div className="space-y-8">
			{/* Header */}
			<div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
				<div>
					<Link
						to="/articles/perek/$perekId"
						params={{ perekId: String(formData.perek_id) }}
						className="inline-flex items-center gap-1.5 text-blue-600 hover:text-blue-700 text-sm font-medium transition-colors"
					>
						<ArrowRight size={16} aria-hidden="true" />
						<span>חזרה לפרק {formData.perek_id}</span>
					</Link>
					<h1 className="text-3xl font-bold text-gray-900 mt-2 flex items-center gap-2">
						{isNew ? (
							<Plus className="size-7" aria-hidden="true" />
						) : (
							<Pencil className="size-7" aria-hidden="true" />
						)}
						{isNew ? "מאמר חדש" : "עריכת מאמר"}
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
							onClick={handleDelete}
							className="inline-flex items-center gap-1.5 text-red-600 hover:text-red-700 px-4 py-2 border border-red-200 rounded-lg hover:bg-red-50 transition-all font-medium text-sm"
						>
							<Trash2 size={16} aria-hidden="true" />
							<span>מחק מאמר</span>
						</button>
					)}
				</div>
			</div>

			<form className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
				{/* Basic Info Section */}
				<div className="p-8 space-y-6">
					<div className="grid md:grid-cols-2 gap-6">
						<div>
							<label
								htmlFor="name"
								className="block text-sm font-semibold text-gray-700 mb-2"
							>
								שם המאמר <span className="text-red-500">*</span>
							</label>
							<input
								id="name"
								type="text"
								value={formData.name}
								onChange={(e) => handleFieldChange("name", e.target.value)}
								className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
								placeholder="הכנס שם מאמר"
							/>
						</div>

						<div>
							<label
								htmlFor="author"
								className="block text-sm font-semibold text-gray-700 mb-2"
							>
								<UserRound
									className="inline-block size-4 align-[-0.125em]"
									aria-hidden="true"
								/>{" "}
								מחבר
							</label>
							<select
								id="author"
								value={formData.author_id}
								onChange={(e) =>
									handleFieldChange(
										"author_id",
										Number.parseInt(e.target.value, 10),
									)
								}
								className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all bg-white"
							>
								{authors?.map((author: Author) => (
									<option key={author.id} value={author.id}>
										{author.name}
									</option>
								))}
							</select>
						</div>

						<div>
							<label
								htmlFor="perek"
								className="block text-sm font-semibold text-gray-700 mb-2"
							>
								<BookOpen
									className="inline-block size-4 align-[-0.125em]"
									aria-hidden="true"
								/>{" "}
								פרק (1-929)
							</label>
							<input
								id="perek"
								type="number"
								min={1}
								max={929}
								value={formData.perek_id}
								onChange={(e) =>
									handleFieldChange(
										"perek_id",
										Number.parseInt(e.target.value, 10),
									)
								}
								className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
							/>
							{selectedPerek && (
								<p className="mt-1 text-xs text-gray-500">
									{perekSourceLabel(selectedPerek)}
								</p>
							)}
						</div>

						<div>
							<label
								htmlFor="priority"
								className="block text-sm font-semibold text-gray-700 mb-2"
							>
								<Star
									className="inline-block size-4 align-[-0.125em]"
									aria-hidden="true"
								/>{" "}
								עדיפות (1-10)
							</label>
							<input
								id="priority"
								type="number"
								min={1}
								max={10}
								value={formData.priority}
								onChange={(e) =>
									handleFieldChange(
										"priority",
										Number.parseInt(e.target.value, 10),
									)
								}
								className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
							/>
						</div>
					</div>

					<label className="flex items-center gap-3 text-sm font-semibold text-gray-700">
						<input
							type="checkbox"
							checked={formData.distributable}
							onChange={(e) =>
								handleFieldChange("distributable", e.target.checked)
							}
						/>
						מאושר לפרסום בעלון היומי
					</label>
					<div>
						<label
							htmlFor="abstract"
							className="block text-sm font-semibold text-gray-700 mb-2"
						>
							<NotebookText
								className="inline-block size-4 align-[-0.125em]"
								aria-hidden="true"
							/>{" "}
							תקציר
						</label>
						<textarea
							id="abstract"
							value={formData.abstract}
							onChange={(e) => handleFieldChange("abstract", e.target.value)}
							rows={3}
							className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all resize-none"
							placeholder="תקציר קצר של המאמר"
						/>
					</div>

					{formData.moedIds !== undefined && moadim && moadim.length > 0 && (
						<div className="border-t border-gray-100 pt-6">
							<div className="block text-sm font-semibold text-gray-700 mb-2">
								<CalendarDays
									className="inline-block size-4 align-[-0.125em]"
									aria-hidden="true"
								/>{" "}
								מועדים על הפרק
							</div>
							<div className="flex flex-wrap gap-3">
								{moadim.map((moed) => (
									<label
										key={moed.id}
										className="flex items-center gap-1.5 text-sm"
									>
										<input
											type="checkbox"
											checked={formData.moedIds?.includes(moed.id) ?? false}
											onChange={(e) =>
												handleFieldChange(
													"moedIds",
													e.target.checked
														? [...(formData.moedIds ?? []), moed.id]
														: (formData.moedIds ?? []).filter(
																(id) => id !== moed.id,
															),
												)
											}
										/>
										{moed.name}
										{!moed.published && (
											<span className="text-xs text-gray-400">(טיוטה)</span>
										)}
									</label>
								))}
							</div>
							<p className="mt-1 text-xs text-gray-400">
								קישור מפורש של המאמר למועד - נוסף לאיחוד ההתאמות לפי טווחי המקרא
								של המועד
							</p>
						</div>
					)}

					{formData.coveringSources !== undefined && (
						<div className="border-t border-gray-100 pt-6">
							<CoveringSourcesEditor
								sources={formData.coveringSources}
								verified={formData.coverageVerified === true}
								perakim={perakim ?? []}
								defaultPerekId={formData.perek_id}
								onChange={(sources) =>
									handleFieldChange("coveringSources", sources)
								}
								onVerifiedChange={(coverageVerified) =>
									handleFieldChange("coverageVerified", coverageVerified)
								}
							/>
						</div>
					)}

					{formData.hebrewDates !== undefined && (
						<div className="border-t border-gray-100 pt-6">
							<HebrewDatesEditor
								dates={formData.hebrewDates}
								onChange={(dates) => handleFieldChange("hebrewDates", dates)}
							/>
						</div>
					)}

					<div>
						{/* biome-ignore lint/a11y/noLabelWithoutControl: WysiwygEditor is a custom component */}
						<label className="block text-sm font-semibold text-gray-700 mb-2">
							<FileText
								className="inline-block size-4 align-[-0.125em]"
								aria-hidden="true"
							/>{" "}
							תוכן המאמר
						</label>
						<WysiwygEditor
							ref={editorRef}
							content={formData.content}
							onChange={handleContentChange}
							placeholder="הכנס את תוכן המאמר..."
							searchEntries={searchEntriesForLink}
						/>
					</div>
				</div>

				{saveMutation.isError && (
					<div className="px-8 py-3 bg-red-50 border-t border-red-100 text-sm text-red-700">
						שמירה נכשלה: {saveMutation.error.message}
					</div>
				)}

				{/* Action Buttons */}
				<div className="flex justify-end gap-4 px-8 py-5 bg-gray-50 border-t border-gray-200">
					<Link
						to="/articles/perek/$perekId"
						params={{ perekId: String(formData.perek_id) }}
						className="px-6 py-2.5 border border-gray-300 rounded-lg hover:bg-gray-100 transition-all font-medium text-gray-700"
					>
						ביטול
					</Link>
					<button
						type="button"
						onClick={() => {
							editorRef.current?.flush();
							saveLatest({
								...formData,
								content: contentRef.current,
							});
						}}
						disabled={saveMutation.isPending || !formData.name.trim()}
						className="px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all font-medium shadow-sm hover:shadow-md"
					>
						{saveMutation.isPending ? (
							<>
								<LoaderCircle
									className="inline-block size-4 animate-spin align-[-0.125em]"
									aria-hidden="true"
								/>{" "}
								שומר...
							</>
						) : (
							<>
								<Save
									className="inline-block size-4 align-[-0.125em]"
									aria-hidden="true"
								/>{" "}
								שמור עכשיו
							</>
						)}
					</button>
				</div>
			</form>

			{/* Full relationship picture (#3102) — every registry entry, each
			    managed through its owning workflow. Only for persisted articles. */}
			{articleId !== null && (
				<div className="flex justify-end">
					<Link
						to="/link-proposals"
						search={{ articleId }}
						className="text-sm text-blue-600 hover:text-blue-700 hover:underline"
					>
						PRs לקישורי מאמר זה{" "}
						<ArrowLeft
							className="inline-block size-3.5 align-[-0.125em]"
							aria-hidden="true"
						/>
					</Link>
				</div>
			)}
			{articleId !== null && (
				<ArticleRelationshipsPanel
					articleId={articleId}
					perekId={formData.perek_id}
					authorId={formData.author_id}
					authorName={selectedAuthor?.name}
					coveringCount={formData.coveringSources?.length}
					coverageVerified={formData.coverageVerified === true}
				/>
			)}

			<ConfirmDialog
				open={confirmDelete}
				opener={deleteOpener}
				title="מחיקת מאמר"
				message="האם אתה בטוח שברצונך למחוק את המאמר?"
				confirmLabel="מחק"
				onConfirm={() => {
					setConfirmDelete(false);
					deleteMutation.mutate();
				}}
				onCancel={() => setConfirmDelete(false)}
			/>
		</div>
	);
}
