import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { type Editor, EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useCallback, useEffect, useRef } from "react";

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

	const editor = useEditor({
		extensions: [
			StarterKit.configure({
				heading: {
					levels: [1, 2, 3],
				},
			}),
			Image,
			Link.configure({
				openOnClick: false,
			}),
			Placeholder.configure({
				placeholder,
			}),
		],
		content,
		onUpdate: ({ editor }: { editor: Editor }) => {
			const html = editor.getHTML();

			// Clear existing timeout
			if (saveTimeoutRef.current) {
				clearTimeout(saveTimeoutRef.current);
			}

			// Set up auto-save with debounce
			saveTimeoutRef.current = setTimeout(() => {
				if (html !== lastSavedContent.current) {
					lastSavedContent.current = html;
					onChange(html);
				}
			}, autoSaveDelay);
		},
		editorProps: {
			attributes: {
				class: "prose prose-lg max-w-none min-h-[300px] p-4 focus:outline-none",
				dir: "rtl",
			},
		},
	});

	// Update content when prop changes
	useEffect(() => {
		if (editor && content !== editor.getHTML()) {
			editor.commands.setContent(content);
			lastSavedContent.current = content;
		}
	}, [content, editor]);

	// Cleanup timeout on unmount
	useEffect(() => {
		return () => {
			if (saveTimeoutRef.current) {
				clearTimeout(saveTimeoutRef.current);
			}
		};
	}, []);

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

	if (!editor) {
		return <div className="animate-pulse bg-gray-100 h-64 rounded" />;
	}

	return (
		<div className="border border-gray-300 rounded-lg overflow-hidden">
			{/* Toolbar */}
			<div className="bg-gray-50 border-b border-gray-300 p-2 flex flex-wrap gap-1">
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
				<span className="w-px bg-gray-300 mx-1" />
				<button
					type="button"
					onClick={() =>
						editor.chain().focus().toggleHeading({ level: 1 }).run()
					}
					className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
						editor.isActive("heading", { level: 1 })
							? "bg-blue-600 text-white"
							: "bg-white hover:bg-gray-100 border"
					}`}
				>
					H1
				</button>
				<button
					type="button"
					onClick={() =>
						editor.chain().focus().toggleHeading({ level: 2 }).run()
					}
					className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
						editor.isActive("heading", { level: 2 })
							? "bg-blue-600 text-white"
							: "bg-white hover:bg-gray-100 border"
					}`}
				>
					H2
				</button>
				<button
					type="button"
					onClick={() =>
						editor.chain().focus().toggleHeading({ level: 3 }).run()
					}
					className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
						editor.isActive("heading", { level: 3 })
							? "bg-blue-600 text-white"
							: "bg-white hover:bg-gray-100 border"
					}`}
				>
					H3
				</button>
				<span className="w-px bg-gray-300 mx-1" />
				<button
					type="button"
					onClick={() => editor.chain().focus().toggleBulletList().run()}
					className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
						editor.isActive("bulletList")
							? "bg-blue-600 text-white"
							: "bg-white hover:bg-gray-100 border"
					}`}
				>
					• רשימה
				</button>
				<button
					type="button"
					onClick={() => editor.chain().focus().toggleOrderedList().run()}
					className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
						editor.isActive("orderedList")
							? "bg-blue-600 text-white"
							: "bg-white hover:bg-gray-100 border"
					}`}
				>
					1. רשימה
				</button>
				<span className="w-px bg-gray-300 mx-1" />
				<button
					type="button"
					onClick={() => editor.chain().focus().toggleBlockquote().run()}
					className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
						editor.isActive("blockquote")
							? "bg-blue-600 text-white"
							: "bg-white hover:bg-gray-100 border"
					}`}
				>
					ציטוט
				</button>
				<button
					type="button"
					onClick={setLink}
					className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
						editor.isActive("link")
							? "bg-blue-600 text-white"
							: "bg-white hover:bg-gray-100 border"
					}`}
				>
					🔗 קישור
				</button>
				<button
					type="button"
					onClick={addImage}
					className="px-3 py-1 rounded text-sm font-medium bg-white hover:bg-gray-100 border transition-colors"
				>
					🖼️ תמונה
				</button>
				<span className="w-px bg-gray-300 mx-1" />
				<button
					type="button"
					onClick={() => editor.chain().focus().undo().run()}
					disabled={!editor.can().undo()}
					className="px-3 py-1 rounded text-sm font-medium bg-white hover:bg-gray-100 border disabled:opacity-50 transition-colors"
				>
					↩️ בטל
				</button>
				<button
					type="button"
					onClick={() => editor.chain().focus().redo().run()}
					disabled={!editor.can().redo()}
					className="px-3 py-1 rounded text-sm font-medium bg-white hover:bg-gray-100 border disabled:opacity-50 transition-colors"
				>
					↪️ חזור
				</button>
			</div>

			{/* Editor content */}
			<EditorContent editor={editor} className="bg-white" />
		</div>
	);
}
