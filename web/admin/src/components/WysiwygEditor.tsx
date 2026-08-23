import BulletList from "@tiptap/extension-bullet-list";
import Image from "@tiptap/extension-image";
import Italic from "@tiptap/extension-italic";
import ListItem from "@tiptap/extension-list-item";
import Placeholder from "@tiptap/extension-placeholder";
import { type Editor, EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import DOMPurify from "dompurify";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorShortcutModal } from "./editor/EditorShortcutModal";
import {
	EntryLinkPicker,
	type EntryLinkOption,
	type EntrySearch,
} from "./editor/EntryLinkPicker";
import {
	ADMIN_EDITOR_SHORTCUT_EXTRAS_KEY,
	adminEditorShortcutsExtension,
} from "./editor/adminEditorShortcuts";
import {
	canRemoveFootnote,
	insertFootnoteAtSelection,
	isSelectionInsideFootnotes,
	removeFootnoteAtSelection,
} from "./editor/adminFootnoteCommands";
import {
	AdminFootnoteDocument,
	adminFootnoteExtensions,
} from "./editor/adminFootnoteExtensions";
import {
	toEditorFootnoteHtml,
	toStoredFootnoteHtml,
} from "./editor/adminFootnoteMigration";
import {
	AdminLink,
	buildLinkHref,
	inferLinkType,
	type AdminLinkType,
	type TipTapLinkMarkAttrs,
} from "./editor/adminLinkExtension";
import { AdminOrderedList } from "./editor/adminOrderedListExtension";

const ItalicNoShortcut = Italic.extend({
	addKeyboardShortcuts() {
		return {};
	},
});

type EditorMode = "visual" | "preview" | "source";

/** Internal hrefs may be stored percent-encoded; humans read the decoded slug. */
function decodeEntrySlug(href: string): string {
	try {
		return decodeURIComponent(href);
	} catch {
		return href;
	}
}

/** Characters that would change what the URL means if left raw. */
const UNSAFE_IN_HREF = /[\s"'<>#?%\\]/;

/** Hebrew slugs stay readable in the markup; browsers encode them on request. */
function toReadableHref(uniqueName: string): string {
	return UNSAFE_IN_HREF.test(uniqueName)
		? encodeURIComponent(uniqueName)
		: uniqueName;
}

/** Toolbar presses must not steal the caret, or the command loses its target. */
function keepCaret(event: ReactMouseEvent) {
	event.preventDefault();
}

interface WysiwygEditorProps {
	content: string;
	onChange: (content: string) => void;
	placeholder?: string;
	autoSaveDelay?: number;
	/** Enables the searchable entry list for internal links. */
	searchEntries?: EntrySearch;
}

export function WysiwygEditor({
	content,
	onChange,
	placeholder = "הכנס תוכן...",
	autoSaveDelay = 2000,
	searchEntries,
}: WysiwygEditorProps) {
	const lastSavedContent = useRef(content);
	const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const [mode, setMode] = useState<EditorMode>("visual");
	const [previewHtml, setPreviewHtml] = useState(content);
	const [sourceDraft, setSourceDraft] = useState(content);
	const [shortcutReloadKey, setShortcutReloadKey] = useState(0);
	const [helpOpen, setHelpOpen] = useState(false);
	const [extrasDraft, setExtrasDraft] = useState("");

	const [linkPanelHref, setLinkPanelHref] = useState("");
	const [linkPanelType, setLinkPanelType] = useState<AdminLinkType>("external");
	const [linkPanelBlank, setLinkPanelBlank] = useState(true);
	const [linkPanelActive, setLinkPanelActive] = useState(false);

	useEffect(() => {
		const stored = toStoredFootnoteHtml(toEditorFootnoteHtml(content));
		setPreviewHtml(stored);
		setSourceDraft(stored);
	}, [content]);

	const extensions = useMemo(
		() => [
			StarterKit.configure({
				heading: { levels: [1, 2, 3, 4, 5, 6] },
				italic: false,
				orderedList: false,
				bulletList: false,
				listItem: false,
				document: false,
				/* StarterKit v3 bundles Link; AdminLink replaces it. */
				link: false,
			}),
			AdminFootnoteDocument,
			ListItem,
			BulletList,
			AdminOrderedList,
			ItalicNoShortcut,
			Image,
			AdminLink.configure({ openOnClick: false }),
			Placeholder.configure({ placeholder }),
			adminEditorShortcutsExtension,
			...adminFootnoteExtensions,
		],
		[placeholder],
	);

	const editor = useEditor(
		{
			extensions,
			content: toEditorFootnoteHtml(content),
			onUpdate: ({ editor: ed }: { editor: Editor }) => {
				const html = toStoredFootnoteHtml(ed.getHTML());
				setPreviewHtml(html);

				if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
				saveTimeoutRef.current = setTimeout(() => {
					if (html !== lastSavedContent.current) {
						lastSavedContent.current = html;
						onChange(html);
					}
				}, autoSaveDelay);
			},
			editorProps: {
				attributes: {
					class: "admin-prose min-h-[300px] focus:outline-none",
					dir: "rtl",
				},
			},
		},
		[extensions, shortcutReloadKey],
	);

	const syncLinkPanelFromEditor = useCallback(() => {
		if (!editor) return;
		if (editor.isActive("link")) {
			const href = editor.getAttributes("link").href as string | undefined;
			const lt = editor.getAttributes("link").linkType as AdminLinkType | null;
			const type = lt ?? inferLinkType(href);
			setLinkPanelHref(
				type === "internal" ? decodeEntrySlug(href ?? "") : (href ?? ""),
			);
			setLinkPanelType(type);
			setLinkPanelBlank(
				type === "external" && !!editor.getAttributes("link").target,
			);
			setLinkPanelActive(true);
		} else {
			setLinkPanelActive(false);
		}
	}, [editor]);

	useEffect(() => {
		if (!editor) return;
		syncLinkPanelFromEditor();
		const handler = () => syncLinkPanelFromEditor();
		editor.on("selectionUpdate", handler);
		return () => {
			editor.off("selectionUpdate", handler);
		};
	}, [editor, syncLinkPanelFromEditor]);

	useEffect(() => {
		if (!editor) return;
		const migrated = toEditorFootnoteHtml(content);
		if (migrated === editor.getHTML()) return;
		editor.commands.setContent(migrated);
		/* Normalized serialization, so a pure migration does not look like an edit. */
		const normalized = toStoredFootnoteHtml(editor.getHTML());
		lastSavedContent.current = normalized;
		setPreviewHtml(normalized);
	}, [content, editor]);

	useEffect(() => {
		return () => {
			if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
		};
	}, []);

	const flushSourceToEditor = useCallback(() => {
		if (!editor) return;
		editor.commands.setContent(toEditorFootnoteHtml(sourceDraft));
		const stored = toStoredFootnoteHtml(editor.getHTML());
		lastSavedContent.current = stored;
		setPreviewHtml(stored);
		onChange(stored);
	}, [editor, onChange, sourceDraft]);

	const handleModeChange = useCallback(
		(next: EditorMode) => {
			if (next === mode) return;
			if (mode === "source" && next !== "source") {
				flushSourceToEditor();
			}
			if (next === "source" && editor) {
				setSourceDraft(editor.getHTML());
			}
			setMode(next);
		},
		[editor, flushSourceToEditor, mode],
	);

	const applyLinkFromPanel = useCallback(() => {
		if (!editor) return;
		const { href, linkType } = buildLinkHref(linkPanelType, linkPanelHref);
		const attrs: TipTapLinkMarkAttrs & { linkType: AdminLinkType } = {
			href,
			linkType,
		};
		if (linkType === "external" && linkPanelBlank) {
			attrs.target = "_blank";
			attrs.rel = "noopener noreferrer nofollow";
		}
		const forTipTap = attrs as TipTapLinkMarkAttrs;
		if (editor.isActive("link")) {
			editor.chain().focus().extendMarkRange("link").setLink(forTipTap).run();
		} else {
			const { empty } = editor.state.selection;
			if (empty) {
				window.alert("סמן טקסט לפני הוספת קישור, או לחץ על קישור קיים.");
				return;
			}
			editor.chain().focus().setLink(forTipTap).run();
		}
		syncLinkPanelFromEditor();
	}, [
		editor,
		linkPanelBlank,
		linkPanelHref,
		linkPanelType,
		syncLinkPanelFromEditor,
	]);

	const removeLinkFromPanel = useCallback(() => {
		if (!editor) return;
		editor.chain().focus().extendMarkRange("link").unsetLink().run();
		syncLinkPanelFromEditor();
	}, [editor, syncLinkPanelFromEditor]);

	const selectEntryLink = useCallback(
		(entry: EntryLinkOption) => {
			if (!editor) return;
			const href = toReadableHref(entry.uniqueName);
			setLinkPanelHref(href);
			setLinkPanelType("internal");
			const attrs = { href, linkType: "internal" } as TipTapLinkMarkAttrs;
			if (editor.isActive("link")) {
				editor.chain().focus().extendMarkRange("link").setLink(attrs).run();
			} else if (!editor.state.selection.empty) {
				editor.chain().focus().setLink(attrs).run();
			}
			syncLinkPanelFromEditor();
		},
		[editor, syncLinkPanelFromEditor],
	);

	const beginNewLink = useCallback(() => {		if (!editor) return;
		const { empty } = editor.state.selection;
		if (empty) {
			window.alert("סמן טקסט ואז לחץ «קישור חדש».");
			return;
		}
		setLinkPanelHref("https://");
		setLinkPanelType("external");
		setLinkPanelBlank(true);
		setLinkPanelActive(true);
		editor
			.chain()
			.focus()
			.setLink({ href: "https://", linkType: "external" } as TipTapLinkMarkAttrs)
			.run();
	}, [editor]);

	const addImage = useCallback(() => {
		const url = window.prompt("הכנס URL של תמונה:");
		if (url && editor) {
			editor.chain().focus().setImage({ src: url }).run();
		}
	}, [editor]);

	const setOrderedStyle = useCallback(
		(style: "decimal" | "hebrew-alpha") => {
			if (!editor) return;
			if (editor.isActive("orderedList")) {
				editor
					.chain()
					.focus()
					.updateAttributes("orderedList", { orderedType: style })
					.run();
			} else {
				editor
					.chain()
					.focus()
					.toggleOrderedList()
					.updateAttributes("orderedList", { orderedType: style })
					.run();
			}
		},
		[editor],
	);

	/* Numbering, ordering and the footnote list are owned by tiptap-footnotes. */
	const addFootnote = useCallback(() => {
		if (!editor) return;
		if (isSelectionInsideFootnotes(editor)) {
			window.alert("מקם את הסמן בגוף הטקסט (לא ברשימת ההערות) והוסף הערה.");
			return;
		}
		if (!insertFootnoteAtSelection(editor)) {
			window.alert("לחץ בגוף הטקסט במקום שבו תופיע ההערה, ואז «+ הערה».");
		}	}, [editor]);

	const removeFootnote = useCallback(() => {
		if (!editor) return;
		if (!removeFootnoteAtSelection(editor)) {
			window.alert("מקם את הסמן על אזכור הערה או בתוך ההערה שברצונך למחוק.");
		}
	}, [editor]);

	const handleProseLinkClick = useCallback(
		(e: ReactMouseEvent) => {
			if (!editor) return;
			const el = e.target as HTMLElement;
			const anchor = el.closest("a");
			if (!anchor?.closest(".ProseMirror")) return;
			e.preventDefault();
			try {
				const pos = editor.view.posAtDOM(anchor, 0);
				if (Number.isFinite(pos)) {
					editor
						.chain()
						.focus()
						.setTextSelection(pos)
						.extendMarkRange("link")
						.run();
					queueMicrotask(() => syncLinkPanelFromEditor());
				}
			} catch {
				// posAtDOM can throw if node not in document
			}
		},
		[editor, syncLinkPanelFromEditor],
	);

	const openHelp = useCallback(() => {
		if (typeof localStorage !== "undefined") {
			setExtrasDraft(
				localStorage.getItem(ADMIN_EDITOR_SHORTCUT_EXTRAS_KEY) ?? "",
			);
		}
		setHelpOpen(true);
	}, []);

	const saveExtras = useCallback(() => {
		if (typeof localStorage !== "undefined") {
			const t = extrasDraft.trim();
			if (t) {
				try {
					JSON.parse(t);
				} catch {
					window.alert("JSON לא תקין. בדוק את הפורמט.");
					return;
				}
				localStorage.setItem(ADMIN_EDITOR_SHORTCUT_EXTRAS_KEY, t);
			} else {
				localStorage.removeItem(ADMIN_EDITOR_SHORTCUT_EXTRAS_KEY);
			}
		}
		setHelpOpen(false);
		setShortcutReloadKey((k) => k + 1);
	}, [extrasDraft]);

	if (!editor) {
		return <div className="animate-pulse bg-gray-100 h-64 rounded" />;
	}

	const modeBtn = (m: EditorMode, label: string) => (
		<button
			type="button"
			onClick={() => handleModeChange(m)}
			className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
				mode === m
					? "bg-blue-600 text-white"
					: "bg-white hover:bg-gray-100 border border-gray-300 text-gray-700"
			}`}
		>
			{label}
		</button>
	);

	return (
		<div className="border border-gray-300 rounded-lg">
			<EditorShortcutModal
				open={helpOpen}
				onClose={() => setHelpOpen(false)}
				extrasDraft={extrasDraft}
				onExtrasDraftChange={setExtrasDraft}
				onSaveExtras={saveExtras}
			/>

			<div className="sticky top-16 z-40 bg-white/95 backdrop-blur-sm border-b border-gray-300 shadow-sm">
			<div className="bg-gray-50 border-b border-gray-200 p-2 flex flex-wrap gap-2 items-center">
				<div className="flex gap-1 flex-wrap items-center">
					{modeBtn("visual", "עריכה")}
					{modeBtn("preview", "תצוגה מקדימה")}
					{modeBtn("source", "מקור HTML")}
				</div>
				<span className="w-px h-6 bg-gray-300 mx-1" />
				<button
					type="button"
					onClick={openHelp}
					className="px-3 py-1.5 rounded text-sm font-medium bg-white border border-gray-300 hover:bg-gray-100"
				>
					קיצורים
				</button>
				{mode === "visual" && (
					<>
						<span className="w-px h-6 bg-gray-300 mx-1" />
						<button
							type="button"
							onClick={() => editor.chain().focus().toggleBold().run()}
							className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
								editor.isActive("bold")
									? "bg-blue-600 text-white"
									: "bg-white hover:bg-gray-100 border"
							}`}
						>
							<strong>B</strong>
						</button>
						<button
							type="button"
							onClick={() => editor.chain().focus().toggleItalic().run()}
							className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
								editor.isActive("italic")
									? "bg-blue-600 text-white"
									: "bg-white hover:bg-gray-100 border"
							}`}
						>
							<em>I</em>
						</button>
						<button
							type="button"
							onClick={() => editor.chain().focus().toggleStrike().run()}
							className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
								editor.isActive("strike")
									? "bg-blue-600 text-white"
									: "bg-white hover:bg-gray-100 border"
							}`}
						>
							<s>S</s>
						</button>
						<span className="w-px bg-gray-300 mx-1 h-6" />
						{([1, 2, 3] as const).map((level) => (
							<button
								key={level}
								type="button"
								onClick={() =>
									editor
										.chain()
										.focus()
										.toggleHeading({ level })
										.run()
								}
								className={`px-2 py-1 rounded text-sm font-medium ${
									editor.isActive("heading", { level })
										? "bg-blue-600 text-white"
										: "bg-white hover:bg-gray-100 border"
								}`}
							>
								H{level}
							</button>
						))}
						<button
							type="button"
							onClick={() => editor.chain().focus().toggleBulletList().run()}
							className={`px-2 py-1 rounded text-sm ${
								editor.isActive("bulletList")
									? "bg-blue-600 text-white"
									: "bg-white border"
							}`}
						>
							• תבליטים
						</button>
						<button
							type="button"
							onClick={() => setOrderedStyle("decimal")}
							className={`px-2 py-1 rounded text-sm ${
								editor.isActive("orderedList") &&
								editor.getAttributes("orderedList").orderedType === "decimal"
									? "bg-blue-600 text-white"
									: "bg-white border"
							}`}
						>
							1. מספרים
						</button>
						<button
							type="button"
							onClick={() => setOrderedStyle("hebrew-alpha")}
							className={`px-2 py-1 rounded text-sm ${
								editor.isActive("orderedList") &&
								editor.getAttributes("orderedList").orderedType === "hebrew-alpha"
									? "bg-blue-600 text-white"
									: "bg-white border"
							}`}
						>
							א׳ עברית
						</button>
						<button
							type="button"
							onClick={beginNewLink}
							className="px-2 py-1 rounded text-sm bg-white border"
						>
							קישור חדש
						</button>
						<button
							type="button"
							onClick={addImage}
							className="px-2 py-1 rounded text-sm bg-white border"
						>
							תמונה
						</button>
						<button
							type="button"
							onMouseDown={keepCaret}
							onClick={addFootnote}
							title="מוסיפה אזכור במיקום הסמן וקופצת להערה החדשה לכתיבת התוכן; המספור מתעדכן לבד"
							className="px-2 py-1 rounded text-sm bg-amber-50 border border-amber-200 text-amber-950"
						>
							+ הערה
						</button>
						<button
							type="button"
							onMouseDown={keepCaret}
							onClick={removeFootnote}
							disabled={!canRemoveFootnote(editor)}
							title="מוחקת את ההערה שהסמן עליה — האזכור והפריט ברשימה גם יחד"
							className="px-2 py-1 rounded text-sm bg-white border border-amber-200 text-amber-900 disabled:opacity-40"
						>
							− הערה
						</button>
					</>
				)}
			</div>

			{mode === "visual" && (
				<div className="border-b border-gray-200 bg-slate-50 px-3 py-2 space-y-2">
					<div className="text-xs font-semibold text-slate-600">
						{linkPanelActive
							? "עריכת קישור"
							: "לחץ על קישור בטקסט לעריכה, או «קישור חדש» עם טקסט מסומן"}
					</div>
					<input
						type="text"
						value={linkPanelHref}
						onChange={(e) => setLinkPanelHref(e.target.value)}
						className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono"
						dir="ltr"
						placeholder="https://… / slug / #note-1"
					/>
					<div className="flex flex-wrap gap-4 text-sm items-center">
						<span className="text-gray-600">סוג:</span>
						{(
							[
								["external", "חיצוני"],
								["internal", "פנימי"],
								["comment", "הערה (#note)"],
							] as const
						).map(([v, label]) => (
							<label
								key={v}
								className="inline-flex items-center gap-1.5 cursor-pointer"
							>
								<input
									type="radio"
									name="linkType"
									checked={linkPanelType === v}
									onChange={() => {
										setLinkPanelType(v);
										if (v === "comment" && !linkPanelHref.startsWith("#")) {
											setLinkPanelHref("#note-1");
										}
									}}
								/>
								{label}
							</label>
						))}
						{linkPanelType === "external" && (
							<label className="inline-flex items-center gap-1.5 cursor-pointer mr-4">
								<input
									type="checkbox"
									checked={linkPanelBlank}
									onChange={(e) => setLinkPanelBlank(e.target.checked)}
								/>
								חלון חדש
							</label>
						)}
						<button
							type="button"
							onClick={applyLinkFromPanel}
							className="mr-auto px-3 py-1 bg-blue-600 text-white rounded text-sm"
						>
							עדכן קישור
						</button>
						<button
							type="button"
							onClick={removeLinkFromPanel}
							disabled={!editor.isActive("link")}
							className="px-3 py-1 border border-red-200 text-red-700 rounded text-sm disabled:opacity-40"
						>
							הסר קישור
						</button>
					</div>
					{linkPanelType === "internal" && searchEntries && (
						<EntryLinkPicker
							search={searchEntries}
							selectedUniqueName={decodeEntrySlug(linkPanelHref)}
							onSelect={selectEntryLink}
						/>
					)}
				</div>
			)}
			</div>

			{mode === "visual" && (
				<div
					className="bg-white"
					onClickCapture={handleProseLinkClick}
					role="presentation"
				>
					<EditorContent editor={editor} />
				</div>
			)}

			{mode === "preview" && (
				<div
					className="admin-prose border-t border-gray-100"
					// biome-ignore lint/security/noDangerouslySetInnerHtml: DOMPurify-sanitized admin preview HTML
					dangerouslySetInnerHTML={{
						__html: DOMPurify.sanitize(previewHtml || "<p></p>"),
					}}
				/>
			)}

			{mode === "source" && (
				<textarea
					value={sourceDraft}
					onChange={(e) => setSourceDraft(e.target.value)}
					className="admin-html-source"
					spellCheck={false}
					dir="ltr"
				/>
			)}
		</div>
	);
}
