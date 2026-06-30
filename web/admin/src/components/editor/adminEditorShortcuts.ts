import { Extension } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import {
	buildLinkHref,
	inferLinkType,
	type AdminLinkType,
	type TipTapLinkMarkAttrs,
} from "./adminLinkExtension";

export const ADMIN_EDITOR_SHORTCUT_EXTRAS_KEY = "admin-editor-shortcut-extras";

export interface ShortcutRow {
	keys: string;
	action: string;
	tags?: string;
}

export interface ShortcutSection {
	title: string;
	rows: ShortcutRow[];
}

export const SHORTCUT_SECTIONS: ShortcutSection[] = [
	{
		title: "כותרות",
		rows: [
			{
				keys: "Ctrl+1 … Ctrl+6",
				action: "כותרות H1–H6",
				tags: "heading כותרת",
			},
		],
	},
	{
		title: "קישורים וטקסט",
		rows: [
			{
				keys: "Ctrl+I",
				action: "עריכת קישור (או הוספה אם יש סימון)",
				tags: "link קישור",
			},
			{ keys: "Ctrl+B", action: "מודגש", tags: "bold" },
			{
				keys: "—",
				action: "הטייה — מכפתור סרגל בלבד",
				tags: "italic",
			},
		],
	},
	{
		title: "רשימות",
		rows: [
			{
				keys: "Ctrl+Shift+7",
				action: "רשימת תבליטים",
				tags: "bullet list",
			},
			{
				keys: "Ctrl+Shift+8",
				action: "רשימה ממוספרת (1 2 3)",
				tags: "ordered decimal",
			},
			{
				keys: "סרגל הכלים",
				action: "רשימה א׳ ב׳ ג׳ (עברית) — כפתור נפרד",
				tags: "hebrew alpha",
			},
		],
	},
];

/** @deprecated use SHORTCUT_SECTIONS */
export const DEFAULT_SHORTCUT_HELP_ROWS: { keys: string; action: string }[] =
	SHORTCUT_SECTIONS.flatMap((s) => s.rows);

function runHeading(editor: Editor, level: 1 | 2 | 3 | 4 | 5 | 6): boolean {
	return editor.chain().focus().toggleHeading({ level }).run();
}

function promptLink(editor: Editor): boolean {
	const prevHref = editor.getAttributes("link").href as string | undefined;
	const prevType = (editor.getAttributes("link").linkType as AdminLinkType | null) ?? inferLinkType(prevHref);
	const url = window.prompt(
		prevType === "comment"
			? "מספר הערה או #note-1"
			: "כתובת (חיצונית, פנימית או #note-1)",
		prevHref || "https://",
	);
	if (url === null) return false;
	if (url === "") {
		editor.chain().focus().extendMarkRange("link").unsetLink().run();
		return true;
	}
	const type: AdminLinkType =
		url.trim().startsWith("#") || /^note-?\d/i.test(url.trim())
			? "comment"
			: inferLinkType(url.trim());
	const { href, linkType } = buildLinkHref(type, url.trim());
	const attrs: TipTapLinkMarkAttrs & { linkType: AdminLinkType } = {
		href,
		linkType,
	};
	if (type === "external") {
		attrs.target = "_blank";
		attrs.rel = "noopener noreferrer nofollow";
	}
	const forTipTap = attrs as TipTapLinkMarkAttrs;
	if (editor.isActive("link")) {
		editor.chain().focus().extendMarkRange("link").setLink(forTipTap).run();
	} else {
		editor.chain().focus().setLink(forTipTap).run();
	}
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
			"Mod-Shift-7": () => editor.chain().focus().toggleBulletList().run(),
			"Mod-Shift-8": () => editor.chain().focus().toggleOrderedList().run(),
		};

		const extras = parseStoredShortcutExtras(editor);
		return { ...base, ...extras };
	},
});

export const SHORTCUT_EXTRAS_JSON_EXAMPLE = `{
  "Mod-Shift-l": "link",
  "Mod-Alt-2": "heading:2"
}`;
