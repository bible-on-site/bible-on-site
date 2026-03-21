import { Extension } from "@tiptap/core";
import type { Editor } from "@tiptap/core";

export const ADMIN_EDITOR_SHORTCUT_EXTRAS_KEY = "admin-editor-shortcut-extras";

function runHeading(editor: Editor, level: 1 | 2 | 3 | 4 | 5 | 6): boolean {
	return editor.chain().focus().toggleHeading({ level }).run();
}

function promptLink(editor: Editor): boolean {
	const prev = editor.getAttributes("link").href as string | undefined;
	const url = window.prompt("הכנס URL", prev || "https://");
	if (url === null) return false;
	if (url === "") {
		editor.chain().focus().extendMarkRange("link").unsetLink().run();
		return true;
	}
	editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
	return true;
}

function parseExtraCommand(
	cmd: string,
	editor: Editor,
): (() => boolean) | null {
	const c = cmd.trim().toLowerCase();
	if (c === "link") return () => promptLink(editor);
	if (c === "bold") return () => editor.chain().focus().toggleBold().run();
	if (c === "italic") return () => editor.chain().focus().toggleItalic().run();
	if (c === "bulletlist")
		return () => editor.chain().focus().toggleBulletList().run();
	if (c === "orderedlist")
		return () => editor.chain().focus().toggleOrderedList().run();
	const hm = /^heading:([1-6])$/.exec(c);
	if (hm) {
		const level = Number(hm[1]) as 1 | 2 | 3 | 4 | 5 | 6;
		return () => runHeading(editor, level);
	}
	return null;
}

/**
 * Loads optional JSON map from localStorage: { "Mod-Shift-l": "link", "Mod-Alt-2": "heading:2" }
 * Keys use TipTap format (Mod = Ctrl/Cmd).
 */
export function parseStoredShortcutExtras(editor: Editor): Record<
	string,
	() => boolean
> {
	const out: Record<string, () => boolean> = {};
	if (typeof localStorage === "undefined") return out;
	try {
		const raw = localStorage.getItem(ADMIN_EDITOR_SHORTCUT_EXTRAS_KEY);
		if (!raw?.trim()) return out;
		const map = JSON.parse(raw) as Record<string, string>;
		for (const [key, cmd] of Object.entries(map)) {
			if (typeof key !== "string" || typeof cmd !== "string") continue;
			const runner = parseExtraCommand(cmd, editor);
			if (runner) out[key.trim()] = runner;
		}
	} catch {
		// ignore invalid JSON
	}
	return out;
}

export const adminEditorShortcutsExtension = Extension.create({
	name: "adminEditorShortcuts",

	addKeyboardShortcuts() {
		const editor = this.editor;

		const base: Record<string, () => boolean> = {
			"Mod-1": () => runHeading(editor, 1),
			"Mod-2": () => runHeading(editor, 2),
			"Mod-3": () => runHeading(editor, 3),
			"Mod-4": () => runHeading(editor, 4),
			"Mod-5": () => runHeading(editor, 5),
			"Mod-6": () => runHeading(editor, 6),
			"Mod-i": () => promptLink(editor),
		};

		const extras = parseStoredShortcutExtras(editor);
		return { ...base, ...extras };
	},
});

export const DEFAULT_SHORTCUT_HELP_ROWS: { keys: string; action: string }[] = [
	{ keys: "Ctrl+1 … Ctrl+6 (⌘ במק)", action: "כותרות H1–H6" },
	{ keys: "Ctrl+I (⌘I במק)", action: "הוספת/עריכת קישור" },
	{ keys: "Ctrl+B", action: "מודגש" },
	{ keys: "(ללא קיצור ברירת מחדל)", action: "הטייה — מכפתור סרגל" },
];

export const SHORTCUT_EXTRAS_JSON_EXAMPLE = `{
  "Mod-Shift-l": "link",
  "Mod-Alt-2": "heading:2"
}`;
