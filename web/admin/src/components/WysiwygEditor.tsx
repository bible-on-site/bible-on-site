import Image from "@tiptap/extension-image";
import Italic from "@tiptap/extension-italic";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { type Editor, EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	ADMIN_EDITOR_SHORTCUT_EXTRAS_KEY,
	adminEditorShortcutsExtension,
	DEFAULT_SHORTCUT_HELP_ROWS,
	SHORTCUT_EXTRAS_JSON_EXAMPLE,
} from "./editor/adminEditorShortcuts";

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

	useEffect(() => {
		setPreviewHtml(content);
		setSourceDraft(content);
	}, [content]);

	const extensions = useMemo(
		() => [
			StarterKit.configure({
				heading: { levels: [1, 2, 3, 4, 5, 6] },
				italic: false,
			}),
			ItalicNoShortcut,
			Image,
			Link.configure({ openOnClick: false }),
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

	const addImage = useCallback(() => {
		const url = window.prompt("הכנס URL של תמונה:");
		if (url && editor) {
			editor.chain().focus().setImage({ src: url }).run();
		}
	}, [editor]);

	const setLink = useCallback(() => {
		const url = window.prompt("הכנס URL:");
		if (url && editor) {
			editor.chain().focus().setLink({ href: url }).run();
		}
	}, [editor]);

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
			{helpOpen && (
				<div
					className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40 p-4"
					role="dialog"
					aria-modal="true"
					aria-labelledby="shortcut-help-title"
				>
					<div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6 space-y-4">
						<h2
							id="shortcut-help-title"
							className="text-lg font-bold text-gray-900"
						>
							קיצורי מקלדת בעורך
						</h2>
						<table className="w-full text-sm border border-gray-200 rounded">
							<thead className="bg-gray-50">
								<tr>
									<th className="text-right p-2 border-b">מקשים</th>
									<th className="text-right p-2 border-b">פעולה</th>
								</tr>
							</thead>
							<tbody>
								{DEFAULT_SHORTCUT_HELP_ROWS.map((row) => (
									<tr key={row.keys} className="border-b border-gray-100">
										<td className="p-2 font-mono text-xs">{row.keys}</td>
										<td className="p-2">{row.action}</td>
									</tr>
								))}
							</tbody>
						</table>
						<div>
							<p className="text-sm text-gray-600 mb-1">
								קיצורים נוספים (JSON, אופציונלי) — מפתח = צירוף TipTap
								(למשל Mod-Shift-k), ערך = פקודה:
							</p>
							<p className="text-xs text-gray-500 mb-2 font-mono break-all">
								link | bold | italic | bulletList | orderedList | heading:1 …
								heading:6
							</p>
							<pre className="text-xs bg-gray-100 p-2 rounded mb-2 overflow-x-auto">
								{SHORTCUT_EXTRAS_JSON_EXAMPLE}
							</pre>
							<textarea
								value={extrasDraft}
								onChange={(e) => setExtrasDraft(e.target.value)}
								className="w-full min-h-[100px] border border-gray-300 rounded-lg p-2 font-mono text-xs"
								dir="ltr"
								spellCheck={false}
							/>
						</div>
						<div className="flex justify-end gap-2">
							<button
								type="button"
								onClick={() => setHelpOpen(false)}
								className="px-4 py-2 border border-gray-300 rounded-lg text-sm"
							>
								ביטול
							</button>
							<button
								type="button"
								onClick={saveExtras}
								className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm"
							>
								שמור והחל מחדש עורך
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
					מפת קיצורים
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
							• רשימה
						</button>
						<button
							type="button"
							onClick={setLink}
							className={`px-2 py-1 rounded text-sm ${
								editor.isActive("link")
									? "bg-blue-600 text-white"
									: "bg-white border"
							}`}
						>
							קישור
						</button>
						<button
							type="button"
							onClick={addImage}
							className="px-2 py-1 rounded text-sm bg-white border"
						>
							תמונה
						</button>
					</>
				)}
			</div>

			{mode === "visual" && <EditorContent editor={editor} className="bg-white" />}

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
