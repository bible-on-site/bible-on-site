import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { NodeSelection } from "@tiptap/pm/state";

const REFERENCE = "footnoteReference";
const FOOTNOTE = "footnote";
const FOOTNOTES = "footnotes";

interface Range {
	from: number;
	to: number;
}

function collectReferenceIds(editor: Editor): Set<string> {
	const ids = new Set<string>();
	editor.state.doc.descendants((node: ProseMirrorNode) => {
		if (node.type.name === REFERENCE) {
			ids.add(String(node.attrs["data-id"]));
		}
	});
	return ids;
}

/** The footnote list is a trailing block; a reference may not be nested in it. */
export function isSelectionInsideFootnotes(editor: Editor): boolean {
	const { $from } = editor.state.selection;
	for (let depth = $from.depth; depth > 0; depth -= 1) {
		const name = $from.node(depth).type.name;
		if (name === FOOTNOTES || name === FOOTNOTE) return true;
	}
	return false;
}

/** Range of the reference the caret sits on, or that follows/precedes it. */
export function footnoteReferenceRange(editor: Editor): Range | null {
	const { selection } = editor.state;
	if (
		selection instanceof NodeSelection &&
		selection.node.type.name === REFERENCE
	) {
		return { from: selection.from, to: selection.to };
	}
	const { $from } = selection;
	const before = $from.nodeBefore;
	if (before?.type.name === REFERENCE) {
		return { from: $from.pos - before.nodeSize, to: $from.pos };
	}
	const after = $from.nodeAfter;
	if (after?.type.name === REFERENCE) {
		return { from: $from.pos, to: $from.pos + after.nodeSize };
	}
	return null;
}

/** `data-id` of the footnote item the caret is editing, if any. */
export function footnoteIdAtSelection(editor: Editor): string | null {
	const { $from } = editor.state.selection;
	for (let depth = $from.depth; depth > 0; depth -= 1) {
		const node = $from.node(depth);
		if (node.type.name === FOOTNOTE) return String(node.attrs["data-id"]);
	}
	return null;
}

function referenceRangeById(editor: Editor, id: string): Range | null {
	let range: Range | null = null;
	editor.state.doc.descendants((node: ProseMirrorNode, pos: number) => {
		if (range) return false;
		if (node.type.name === REFERENCE && String(node.attrs["data-id"]) === id) {
			range = { from: pos, to: pos + node.nodeSize };
		}
		return true;
	});
	return range;
}

export function canRemoveFootnote(editor: Editor | null): boolean {
	/* Without focus the selection is still the document default, which sits in
	   the trailing footnote list — acting on it would delete an unrelated note. */
	if (!editor?.isFocused) return false;
	return (
		footnoteReferenceRange(editor) !== null ||
		footnoteIdAtSelection(editor) !== null
	);
}

/**
 * Deletes the reference; `tiptap-footnotes` then drops the orphaned list item
 * and renumbers what is left.
 */
export function removeFootnoteAtSelection(editor: Editor): boolean {
	if (!editor.isFocused) return false;
	const id = footnoteIdAtSelection(editor);
	const range = id
		? referenceRangeById(editor, id)
		: footnoteReferenceRange(editor);
	if (!range) return false;
	return editor
		.chain()
		.focus()
		.deleteRange(range)
		.setTextSelection(range.from)
		.run();
}

/** Inserts a reference at the caret and moves the caret into its new item. */
export function insertFootnoteAtSelection(editor: Editor): boolean {
	const before = collectReferenceIds(editor);
	if (!editor.chain().focus().addFootnote().run()) return false;

	for (const id of collectReferenceIds(editor)) {
		if (!before.has(id)) {
			editor.commands.focusFootnote(id);
			break;
		}
	}
	return true;
}
