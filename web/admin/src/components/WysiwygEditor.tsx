import BulletList from "@tiptap/extension-bullet-list";
import Image from "@tiptap/extension-image";
import Italic from "@tiptap/extension-italic";
import ListItem from "@tiptap/extension-list-item";
import Placeholder from "@tiptap/extension-placeholder";
import { type Editor, EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorShortcutModal } from "./editor/EditorShortcutModal";
import {
	ADMIN_EDITOR_SHORTCUT_EXTRAS_KEY,
	adminEditorShortcutsExtension,
} from "./editor/adminEditorShortcuts";
import { hebrewOrdinalLetter } from "./editor/adminHebrew";
import {
	AdminLink,
	buildLinkHref,
	inferLinkType,
	type AdminLinkType,
} from "./editor/adminLinkExtension";
import { AdminOrderedList } from "./editor/adminOrderedListExtension";

const ItalicNoShortcut = Italic.extend({
	addKeyboardShortcuts() {
		return {};
	},
});

type EditorMode = "visual" | "preview" | "source";

interface WysiwygEditorProps {
	content: string;
	onChange: (content: string) => void;
	placeholder?: string;
	autoSaveDelay?: number;
}

function maxFootnoteIndex(html: string): number {
	let max = 0;
	for (const m of html.matchAll(/#note-(\d+)|id="note-(\d+)"|id="noteref-(\d+)"/g)) {
		const n = Number(m[1] || m[2] || m[3]);
		if (Number.isFinite(n) && n > max) max = n;
	}
	return max;
}

export function WysiwygEditor({
	content,
	onChange,
	placeholder = "הכנס תוכן...",
	autoSaveDelay = 2000,
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

	const [footnoteOpen, setFootnoteOpen] = useState(false);
	const [footnoteNum, setFootnoteNum] = useState(1);
	const [footnoteMode, setFootnoteMode] = useState<"ref" | "body">("ref");

	useEffect(() => {
		setPreviewHtml(content);
		setSourceDraft(content);
	}, [content]);

	const extensions = useMemo(
		() => [
			StarterKit.configure({
				heading: { levels: [1, 2, 3, 4, 5, 6] },
				italic: false,
				orderedList: false,
				bulletList: false,
				listItem: false,
			}),
			ListItem,
			BulletList,
			AdminOrderedList,
			ItalicNoShortcut,
			Image,
			AdminLink.configure({ openOnClick: false }),
			Placeholder.configure({ placeholder }),
			adminEditorShortcutsExtension,
		],
		[placeholder],
	);

	const editor = useEditor(
		{
			extensions,
			content,
			onUpdate: ({ editor: ed }: { editor: Editor }) => {
				const html = ed.getHTML();
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
			setLinkPanelHref(href ?? "");
			setLinkPanelType(lt ?? inferLinkType(href));
			setLinkPanelBlank(
				(lt ?? inferLinkType(href)) === "external" &&
					!!editor.getAttributes("link").target,
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
		if (editor && content !== editor.getHTML()) {
			editor.commands.setContent(content);
			lastSavedContent.current = content;
			setPreviewHtml(content);
		}
	}, [content, editor]);

	useEffect(() => {
		return () => {
			if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
		};
	}, []);

	const flushSourceToEditor = useCallback(() => {
		if (!editor) return;
		editor.commands.setContent(sourceDraft);
		lastSavedContent.current = sourceDraft;
		setPreviewHtml(sourceDraft);
		onChange(sourceDraft);
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
		const attrs: Record<string, unknown> = { href, linkType };
		if (linkType === "external" && linkPanelBlank) {
			attrs.target = "_blank";
			attrs.rel = "noopener noreferrer nofollow";
		}
		if (editor.isActive("link")) {
			editor.chain().focus().extendMarkRange("link").setLink(attrs).run();
		} else {
			const { empty } = editor.state.selection;
			if (empty) {
				window.alert("סמן טקסט לפני הוספת קישור, או לחץ על קישור קיים.");
				return;
			}
			editor.chain().focus().setLink(attrs).run();
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

	const beginNewLink = useCallback(() => {
		if (!editor) return;
		const { empty } = editor.state.selection;
		if (empty) {
			window.alert("סמן טקסט ואז לחץ «קישור חדש».");
			return;
		}
		setLinkPanelHref("https://");
		setLinkPanelType("external");
		setLinkPanelBlank(true);
		setLinkPanelActive(true);
		editor.chain().focus().setLink({ href: "https://", linkType: "external" }).run();
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

	const openFootnoteDialog = useCallback(() => {
		if (!editor) return;
		const next = maxFootnoteIndex(editor.getHTML()) + 1;
		setFootnoteNum(next);
		setFootnoteMode("ref");
		setFootnoteOpen(true);
	}, [editor]);

	const insertFootnoteSnippet = useCallback(() => {
		if (!editor) return;
		const n = footnoteNum;
		const letter = hebrewOrdinalLetter(n);
		const html =
			footnoteMode === "ref"
				? `<sup><a href="#note-${n}" id="noteref-${n}">${letter}</a></sup>&nbsp;`
				: `<p id="note-${n}"><strong>${letter}.</strong> </p>`;
		editor.chain().focus().insertContent(html).run();
		setFootnoteOpen(false);
	}, [editor, footnoteMode, footnoteNum]);

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
		<div className="border border-gray-300 rounded-lg overflow-hidden">
			<EditorShortcutModal
				open={helpOpen}
				onClose={() => setHelpOpen(false)}
				extrasDraft={extrasDraft}
				onExtrasDraftChange={setExtrasDraft}
				onSaveExtras={saveExtras}
			/>

			{footnoteOpen && (
				<div
					className="fixed inset-0 z-[1990] flex items-center justify-center bg-black/40 p-4"
					role="dialog"
					aria-modal="true"
					aria-labelledby="footnote-dlg-title"
				>
					<div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 space-y-4">
						<h2 id="footnote-dlg-title" className="text-lg font-bold">
							הערות (כמו בתנכפדיה)
						</h2>
						<p className="text-sm text-gray-600 leading-relaxed">
							בתוכן קיים משתמשים ב־
							<code className="text-xs bg-gray-100 px-1">#note-N</code> ואזכור{" "}
							<code className="text-xs bg-gray-100 px-1">א ב ג</code> ב־sup. לשינוי
							סדר פסקאות הערות — גרור בעריכה או ערוך במצב מקור.
						</p>
						<label className="block text-sm font-medium text-gray-700">
							מספר הערה
							<input
								type="number"
								min={1}
								value={footnoteNum}
								onChange={(e) =>
									setFootnoteNum(Number.parseInt(e.target.value, 10) || 1)
								}
								className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2"
							/>
						</label>
						<div className="flex flex-col gap-2 text-sm">
							<label className="flex items-center gap-2 cursor-pointer">
								<input
									type="radio"
									name="fnm"
									checked={footnoteMode === "ref"}
									onChange={() => setFootnoteMode("ref")}
								/>
								אזכור בהערת שוליים (sup)
							</label>
							<label className="flex items-center gap-2 cursor-pointer">
								<input
									type="radio"
									name="fnm"
									checked={footnoteMode === "body"}
									onChange={() => setFootnoteMode("body")}
								/>
								פסקת הערה בתחתית (
								<code className="text-xs">id=&quot;note-N&quot;</code>)
							</label>
						</div>
						<div className="flex justify-end gap-2">
							<button
								type="button"
								onClick={() => setFootnoteOpen(false)}
								className="px-4 py-2 border rounded-lg text-sm"
							>
								ביטול
							</button>
							<button
								type="button"
								onClick={insertFootnoteSnippet}
								className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm"
							>
								הוסף
							</button>
						</div>
					</div>
				</div>
			)}

			<div className="bg-gray-50 border-b border-gray-300 p-2 flex flex-wrap gap-2 items-center">
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
							onClick={openFootnoteDialog}
							className="px-2 py-1 rounded text-sm bg-amber-50 border border-amber-200 text-amber-950"
						>
							הערה
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
				</div>
			)}

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
					// biome-ignore lint/security/noDangerouslySetInnerHtml: admin preview of own HTML
					dangerouslySetInnerHTML={{ __html: previewHtml || "<p></p>" }}
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
