import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
	type EntryLinkOption,
	EntryLinkPicker,
} from "~/components/editor/EntryLinkPicker";
import { searchEntriesForLink } from "~/components/editor/entryLinkSearch";
import { classifySaveError } from "~/lib/server-fn-errors";
import {
	aliasKindForTargetCount,
	pediaNameFromInput,
	pediaPublicUrl,
	validateAliasSpec,
} from "~/lib/tanahpedia/pedia-names";
import {
	checkPediaName,
	deleteAliasName,
	type EntryAliasView,
	getEntryAliases,
	removeEntryFromAlias,
	saveEntryAlias,
} from "~/server/tanahpedia/aliases";

interface EntryAliasesPanelProps {
	entryId: string;
	entryUniqueName: string;
	entryTitle: string;
	websiteBase: string;
}

interface DraftTarget {
	entryId: string;
	uniqueName: string;
	title: string;
	label: string;
}

interface EditorState {
	/** Raw name input while creating; once known, `name` holds it. */
	nameInput: string;
	/** Existing shared name being edited, or null for a brand-new name. */
	editingName: string | null;
	targets: DraftTarget[];
	pickingTarget: boolean;
	/** Name whose existing targets were already merged in — merge runs once. */
	mergedFrom: string | null;
}

const NAME_CHECK_DEBOUNCE_MS = 300;

function useDebouncedValue<T>(value: T, delayMs: number): T {
	const [debounced, setDebounced] = useState(value);
	useEffect(() => {
		const t = setTimeout(() => setDebounced(value), delayMs);
		return () => clearTimeout(t);
	}, [value, delayMs]);
	return debounced;
}

function CopyButton({ url }: { url: string }) {
	const [copied, setCopied] = useState(false);
	useEffect(() => {
		if (!copied) return;
		const t = setTimeout(() => setCopied(false), 1500);
		return () => clearTimeout(t);
	}, [copied]);
	return (
		<button
			type="button"
			onClick={() => {
				void navigator.clipboard
					?.writeText(url)
					.then(() => setCopied(true))
					.catch(() => setCopied(false));
			}}
			className="px-2 py-1 text-xs font-medium rounded-md border border-gray-300 text-gray-600 hover:bg-gray-100"
		>
			{copied ? "הועתק!" : "העתק"}
		</button>
	);
}

/**
 * כתובות נוספות / שמות חלופיים — the alias manager.
 *
 * Explicit save boundary (separate from the entry draft): every "שמור כתובת"
 * applies the whole target set of that name atomically and publishes it
 * immediately — including when the name is shared with other entries, which
 * is always called out in the UI.
 */
export function EntryAliasesPanel({
	entryId,
	entryUniqueName,
	entryTitle,
	websiteBase,
}: EntryAliasesPanelProps) {
	const queryClient = useQueryClient();
	const aliasesKey = ["tanahpedia-entry-aliases", entryId] as const;

	const { data: aliases, isLoading } = useQuery({
		queryKey: aliasesKey,
		queryFn: () => getEntryAliases({ data: entryId }),
	});

	const [editor, setEditor] = useState<EditorState | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);

	const invalidate = () =>
		queryClient.invalidateQueries({ queryKey: aliasesKey });

	const saveMutation = useMutation({
		mutationFn: (input: {
			name: string;
			targets: { entryId: string; label: string }[];
		}) => saveEntryAlias({ data: input }),
		onSuccess: (saved) => {
			void invalidate();
			setEditor(null);
			setActionError(null);
			setNotice(
				saved.kind === "disambiguation"
					? `נשמר — «${saved.name}» מציג כעת דף פירושונים עם ${saved.targetCount} ערכים.`
					: `נשמר — «${saved.name}» מפנה ישירות לערך היעד.`,
			);
		},
		onError: (err) => setActionError(classifySaveError(err).message),
	});

	const removeMutation = useMutation({
		mutationFn: (input: { name: string; entryId: string }) =>
			removeEntryFromAlias({ data: input }),
		onSuccess: (result) => {
			void invalidate();
			setActionError(null);
			setNotice(
				result.remainingTargets === 0
					? `השם «${result.name}» נמחק לגמרי.`
					: `הערך הוסר מהשם «${result.name}» — ${result.remainingTargets} יעדים נותרו.`,
			);
		},
		onError: (err) => setActionError(classifySaveError(err).message),
	});

	const deleteMutation = useMutation({
		mutationFn: (name: string) => deleteAliasName({ data: { name } }),
		onSuccess: (result) => {
			void invalidate();
			setEditor(null);
			setActionError(null);
			setNotice(
				`השם «${result.name}» נמחק לגמרי (${result.removedTargets} יעדים).`,
			);
		},
		onError: (err) => setActionError(classifySaveError(err).message),
	});

	const selfTarget: DraftTarget = {
		entryId,
		uniqueName: entryUniqueName,
		title: entryTitle,
		label: "",
	};

	const openCreate = () => {
		setNotice(null);
		setActionError(null);
		setEditor({
			nameInput: "",
			editingName: null,
			targets: [selfTarget],
			pickingTarget: false,
			mergedFrom: null,
		});
	};

	const openEdit = (alias: EntryAliasView) => {
		setNotice(null);
		setActionError(null);
		setEditor({
			nameInput: alias.name,
			editingName: alias.name,
			targets: alias.targets.map((t) => ({
				entryId: t.entryId,
				uniqueName: t.uniqueName,
				title: t.title,
				label: t.label ?? "",
			})),
			pickingTarget: false,
			mergedFrom: alias.name,
		});
	};

	const confirmRemove = (alias: EntryAliasView) => {
		const shared = alias.targets.length > 1;
		const message = shared
			? `להסיר את הערך מהשם המשותף «${alias.name}»? שאר ${alias.targets.length - 1} היעדים יישארו כפי שהם.`
			: `הערך הוא היעד היחיד של «${alias.name}» — ההסרה תמחק את השם לגמרי. להמשיך?`;
		if (window.confirm(message)) {
			removeMutation.mutate({ name: alias.name, entryId });
		}
	};

	return (
		<section
			aria-labelledby="entry-aliases-heading"
			className="rounded-xl border border-gray-200 bg-white p-5 space-y-4 shadow-sm"
		>
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div>
					<h3
						id="entry-aliases-heading"
						className="text-base font-semibold text-gray-900"
					>
						כתובות נוספות / שמות חלופיים
					</h3>
					<p className="mt-1 text-sm text-gray-600 leading-relaxed max-w-3xl">
						שמות נוספים שמובילים לערך זה — או לדף פירושונים כשאותו שם משותף לכמה
						ערכים. שינויים כאן נשמרים ומתפרסמים מיד עם «שמור כתובת» — הם אינם
						חלק מטיוטת הערך.
					</p>
				</div>
				{!editor && (
					<button
						type="button"
						onClick={openCreate}
						className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700"
					>
						+ הוסף שם חלופי
					</button>
				)}
			</div>

			{notice && (
				<p className="text-sm text-green-800 bg-green-50 border border-green-200 rounded-lg p-3">
					{notice}
				</p>
			)}
			{actionError && (
				<p className="text-sm text-red-800 bg-red-50 border border-red-200 rounded-lg p-3">
					{actionError}
				</p>
			)}

			{isLoading && <p className="text-sm text-gray-500">טוען שמות…</p>}

			{!isLoading && (aliases?.length ?? 0) === 0 && !editor && (
				<p className="text-sm text-gray-500">
					אין כתובות נוספות לערך זה עדיין.
				</p>
			)}

			{aliases && aliases.length > 0 && (
				<ul className="space-y-3">
					{aliases.map((alias) => (
						<AliasRow
							key={alias.name}
							alias={alias}
							websiteBase={websiteBase}
							onEdit={() => openEdit(alias)}
							onRemove={() => confirmRemove(alias)}
							busy={removeMutation.isPending}
						/>
					))}
				</ul>
			)}

			{editor && (
				<AliasEditor
					editor={editor}
					setEditor={setEditor}
					entryId={entryId}
					websiteBase={websiteBase}
					saving={saveMutation.isPending}
					deleting={deleteMutation.isPending}
					onSave={(name, targets) => saveMutation.mutate({ name, targets })}
					onDeleteName={(name) => {
						const count = editor.targets.length;
						if (
							window.confirm(
								`למחוק את השם «${name}» לגמרי? השם יוסר מ-${count} ערכים.`,
							)
						) {
							deleteMutation.mutate(name);
						}
					}}
				/>
			)}
		</section>
	);
}

function AliasRow({
	alias,
	websiteBase,
	onEdit,
	onRemove,
	busy,
}: {
	alias: EntryAliasView;
	websiteBase: string;
	onEdit: () => void;
	onRemove: () => void;
	busy: boolean;
}) {
	const url = pediaPublicUrl(websiteBase, alias.name);
	const problem = alias.reservedCategory
		? `השם שמור לנתיב הקטגוריה «${alias.reservedCategory}» — הכתובת אינה נגישה`
		: alias.shadowedByCanonical
			? `הכתובת מוצלת על ידי הכתובת הראשית של «${alias.shadowedByCanonical.title}» — היא אינה נגישה כרגע`
			: null;

	return (
		<li className="rounded-lg border border-gray-200 p-4 space-y-2">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div className="flex flex-wrap items-center gap-2">
					<span className="font-bold text-gray-900">«{alias.name}»</span>
					{alias.isSelfMain ? (
						<span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
							זהה לכתובת הראשית — ללא אפקט
						</span>
					) : alias.kind === "disambiguation" ? (
						<span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-800">
							דף פירושונים — {alias.targets.length} ערכים
						</span>
					) : (
						<span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-800">
							הפניה לערך זה
						</span>
					)}
					{problem && (
						<span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-800">
							לא נגיש
						</span>
					)}
				</div>
				<div className="flex items-center gap-2">
					<button
						type="button"
						onClick={onEdit}
						className="px-3 py-1 text-xs font-medium rounded-md border border-gray-300 text-gray-700 hover:bg-gray-100"
					>
						ערוך יעדים
					</button>
					<button
						type="button"
						onClick={onRemove}
						disabled={busy}
						className="px-3 py-1 text-xs font-medium rounded-md border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-50"
					>
						הסר מהערך
					</button>
				</div>
			</div>

			<div className="flex flex-wrap items-center gap-2 text-sm">
				<a
					href={url}
					target="_blank"
					rel="noreferrer"
					dir="ltr"
					className="font-mono text-blue-700 hover:underline break-all"
				>
					{url}
				</a>
				<CopyButton url={url} />
				<a
					href={url}
					target="_blank"
					rel="noreferrer"
					className="px-2 py-1 text-xs font-medium rounded-md border border-gray-300 text-gray-600 hover:bg-gray-100"
				>
					פתח
				</a>
			</div>

			{alias.kind === "disambiguation" && (
				<ul className="text-sm text-gray-700 pr-4 list-disc space-y-0.5">
					{alias.targets.map((t) => (
						<li key={t.entryId}>
							{t.title}
							{t.label ? ` - ${t.label}` : ""}
							<span dir="ltr" className="text-xs text-gray-400">
								{" "}
								(/pedia/{t.uniqueName})
							</span>
						</li>
					))}
				</ul>
			)}

			{problem && <p className="text-sm text-red-700">{problem}</p>}
		</li>
	);
}

function AliasEditor({
	editor,
	setEditor,
	entryId,
	websiteBase,
	saving,
	deleting,
	onSave,
	onDeleteName,
}: {
	editor: EditorState;
	setEditor: React.Dispatch<React.SetStateAction<EditorState | null>>;
	entryId: string;
	websiteBase: string;
	saving: boolean;
	deleting: boolean;
	onSave: (name: string, targets: { entryId: string; label: string }[]) => void;
	onDeleteName: (name: string) => void;
}) {
	const isEditingExisting = editor.editingName !== null;
	const parsedName = isEditingExisting
		? (editor.editingName as string)
		: pediaNameFromInput(editor.nameInput);
	const debouncedName = useDebouncedValue(parsedName, NAME_CHECK_DEBOUNCE_MS);

	// In create mode the name lookup decides whether this is a fresh name or a
	// shared name this entry is joining.
	const { data: nameStatus } = useQuery({
		queryKey: ["alias-name-check", debouncedName, entryId],
		queryFn: () =>
			checkPediaName({ data: { name: debouncedName, forEntryId: entryId } }),
		enabled: !isEditingExisting && debouncedName.length > 0,
		staleTime: 10_000,
	});

	// When the typed name turns out to be an existing shared name, merge its
	// targets in once (per name) so the editor manages the full shared set —
	// functional update: user edits in flight must never be clobbered.
	const mergedForName = debouncedName;
	useEffect(() => {
		if (isEditingExisting || nameStatus?.kind !== "alias") return;
		setEditor((prev) => {
			/* v8 ignore next -- queued close/edit can make prev stale; defensive */
			if (!prev || prev.editingName !== null) return prev;
			if (prev.mergedFrom === mergedForName) return prev;
			if (pediaNameFromInput(prev.nameInput) !== mergedForName) return prev;
			const merged = new Map<string, DraftTarget>();
			for (const t of nameStatus.targets) {
				merged.set(t.entryId, {
					entryId: t.entryId,
					uniqueName: t.uniqueName,
					title: t.title,
					label: t.label ?? "",
				});
			}
			for (const t of prev.targets) {
				if (!merged.has(t.entryId)) merged.set(t.entryId, t);
			}
			return {
				...prev,
				mergedFrom: mergedForName,
				targets: [...merged.values()],
			};
		});
	}, [isEditingExisting, nameStatus, mergedForName, setEditor]);

	const spec = validateAliasSpec(
		parsedName,
		editor.targets.map((t) => ({ entryId: t.entryId, label: t.label })),
	);
	const kind = aliasKindForTargetCount(editor.targets.length);
	const sharesWithOthers = editor.targets.some((t) => t.entryId !== entryId);

	const nameBlockReason = isEditingExisting
		? null
		: nameStatus?.kind === "reserved"
			? `השם «${nameStatus.name}» שמור לנתיב הקטגוריה «${nameStatus.categoryLabel}» — בחר שם אחר.`
			: nameStatus?.kind === "canonical"
				? `השם «${nameStatus.name}» הוא הכתובת הראשית של «${nameStatus.entry.title}» — כדי לשתף אותו, שנה תחילה את הכתובת הראשית של אותו ערך.`
				: nameStatus?.kind === "self-main"
					? "זוהי הכתובת הראשית של הערך — אין צורך בשם חלופי זהה."
					: nameStatus?.kind === "invalid"
						? nameStatus.reason
						: null;

	const canSave = spec.ok && !nameBlockReason && !saving;

	// Functional updates can be processed after the editor was already closed,
	// so a null guard is kept in this one spot instead of at every call site.
	const updateEditor = (fn: (prev: EditorState) => EditorState) =>
		setEditor((prev) => {
			/* v8 ignore next -- reachable only by an update queued before close */
			if (!prev) return prev;
			return fn(prev);
		});

	const updateTargetLabel = (entryId: string, label: string) =>
		updateEditor((prev) => ({
			...prev,
			targets: prev.targets.map((t) =>
				t.entryId === entryId ? { ...t, label } : t,
			),
		}));

	const removeTarget = (entryId: string) =>
		updateEditor((prev) => ({
			...prev,
			targets: prev.targets.filter((t) => t.entryId !== entryId),
		}));

	const addTarget = (option: EntryLinkOption) =>
		updateEditor((prev) => ({
			...prev,
			pickingTarget: false,
			targets: prev.targets.some((t) => t.entryId === option.id)
				? prev.targets
				: [
						...prev.targets,
						{
							entryId: option.id,
							uniqueName: option.uniqueName,
							title: option.title,
							label: "",
						},
					],
		}));

	return (
		<div className="rounded-lg border border-blue-200 bg-blue-50/50 p-4 space-y-4">
			<h4 className="text-sm font-semibold text-gray-900">
				{isEditingExisting
					? `עריכת השם «${editor.editingName}»`
					: "שם חלופי חדש"}
			</h4>

			{!isEditingExisting && (
				<div>
					<label
						htmlFor="alias-name-input"
						className="block text-sm font-medium text-gray-700 mb-1"
					>
						שם / כתובת
					</label>
					<input
						id="alias-name-input"
						type="text"
						value={editor.nameInput}
						onChange={(e) =>
							updateEditor((prev) => ({ ...prev, nameInput: e.target.value }))
						}
						onBlur={() =>
							updateEditor((prev) => ({
								...prev,
								nameInput: pediaNameFromInput(prev.nameInput),
							}))
						}
						placeholder="למשל: משה"
						dir="auto"
						className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
					/>
					<p className="mt-1 text-xs text-gray-500">
						אפשר להקליד שם חדש, שם שכבר משותף לערכים אחרים, או להדביק כתובת
						מלאה.
					</p>
				</div>
			)}

			{nameBlockReason && (
				<p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
					{nameBlockReason}
				</p>
			)}
			{!isEditingExisting && nameStatus?.kind === "alias" && (
				<p className="text-sm text-blue-800 bg-blue-50 border border-blue-200 rounded-lg p-3">
					השם «{nameStatus.name}» כבר משותף — רשימת היעדים שלו נטענה לעריכה,
					וערך זה נוסף אליה. שמירה תחול על כל היעדים.
				</p>
			)}
			{!isEditingExisting && nameStatus?.kind === "free" && (
				<p className="text-sm text-green-700">השם פנוי — ייווצר כהפניה.</p>
			)}

			<div className="space-y-2">
				<p className="text-sm font-medium text-gray-700">
					יעדים — הערכים שהשם יוביל אליהם:
				</p>
				<ul className="space-y-2">
					{editor.targets.map((t) => (
						<li
							key={t.entryId}
							className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white p-2"
						>
							<span className="text-sm text-gray-900">
								{t.title}
								<span dir="ltr" className="text-xs text-gray-400">
									{" "}
									(/pedia/{t.uniqueName})
								</span>
								{t.entryId === entryId && (
									<span className="text-xs text-blue-700"> — ערך זה</span>
								)}
							</span>
							<input
								type="text"
								value={t.label}
								onChange={(e) => updateTargetLabel(t.entryId, e.target.value)}
								placeholder={
									editor.targets.length > 1
										? "תווית מבדנת — חובה"
										: "תווית מבדנת"
								}
								aria-label={`תווית מבדנת עבור ${t.title}`}
								className="flex-1 min-w-40 border border-gray-300 rounded-md px-2 py-1 text-sm"
							/>
							<button
								type="button"
								onClick={() => removeTarget(t.entryId)}
								className="px-2 py-1 text-xs rounded-md border border-red-200 text-red-700 hover:bg-red-50"
							>
								הסר יעד
							</button>
						</li>
					))}
				</ul>
				{!editor.pickingTarget ? (
					<button
						type="button"
						onClick={() =>
							updateEditor((prev) => ({ ...prev, pickingTarget: true }))
						}
						className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-100"
					>
						+ צרף ערך נוסף כיעד
					</button>
				) : (
					<EntryLinkPicker search={searchEntriesForLink} onSelect={addTarget} />
				)}
			</div>

			<div className="rounded-lg border border-gray-200 bg-white p-3 text-sm space-y-2">
				<p className="font-medium text-gray-800">תצוגה מקדימה:</p>
				{kind === "disambiguation" ? (
					<>
						<p className="text-gray-600">
							«{parsedName || "…"}» יציג דף פירושונים — השם מוביל ליותר מערך
							אחד:
						</p>
						<ul className="pr-4 list-disc space-y-0.5">
							{editor.targets.map((t) => (
								<li key={t.entryId}>
									<span className="text-blue-700">{t.title}</span>
									{t.label ? ` - ${t.label}` : ""}
								</li>
							))}
						</ul>
					</>
				) : editor.targets.length === 1 ? (
					<p className="text-gray-600">
						יעד יחיד — «{parsedName || "…"}» יפנה ישירות אל{" "}
						<span dir="ltr" className="font-mono">
							/pedia/{editor.targets[0].uniqueName}
						</span>
					</p>
				) : (
					<p className="text-gray-500">אין יעדים — השם יימחק.</p>
				)}
				{parsedName && (
					<p className="text-gray-500" dir="ltr">
						{pediaPublicUrl(websiteBase, parsedName)}
					</p>
				)}
			</div>

			{sharesWithOthers && (
				<p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
					שם זה משותף עם ערכים נוספים — «שמור כתובת» ישנה את הדף הציבורי של השם
					עבור כל היעדים, לא רק עבור ערך זה.
				</p>
			)}

			{!spec.ok && <p className="text-sm text-red-700">{spec.error}</p>}

			<div className="flex flex-wrap items-center justify-between gap-2">
				<div className="flex items-center gap-2">
					<button
						type="button"
						disabled={!canSave}
						onClick={() =>
							onSave(
								parsedName,
								editor.targets.map((t) => ({
									entryId: t.entryId,
									label: t.label,
								})),
							)
						}
						className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
					>
						{saving ? "שומר..." : "שמור כתובת"}
					</button>
					<button
						type="button"
						onClick={() => setEditor(null)}
						className="px-4 py-2 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-100"
					>
						ביטול
					</button>
				</div>
				{isEditingExisting && (
					<button
						type="button"
						disabled={deleting}
						onClick={() => onDeleteName(editor.editingName as string)}
						className="px-3 py-2 text-sm rounded-lg border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-50"
					>
						מחק את השם לחלוטין
					</button>
				)}
			</div>
		</div>
	);
}
