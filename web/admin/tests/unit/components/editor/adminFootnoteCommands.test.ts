import type { Editor } from "@tiptap/core";
import { describe, expect, it, vi } from "vitest";
import {
	canRemoveFootnote,
	footnoteIdAtSelection,
	footnoteReferenceRange,
	insertFootnoteAtSelection,
	isSelectionInsideFootnotes,
	removeFootnoteAtSelection,
} from "~/components/editor/adminFootnoteCommands";

interface FakeNode {
	type: { name: string };
	attrs: Record<string, unknown>;
	nodeSize: number;
}

function node(name: string, attrs: Record<string, unknown> = {}): FakeNode {
	return { type: { name }, attrs, nodeSize: 1 };
}

interface FakeEditorOptions {
	ancestors?: string[];
	nodeBefore?: FakeNode | null;
	nodeAfter?: FakeNode | null;
	pos?: number;
	docNodes?: Array<{ node: FakeNode; pos: number }>;
	addFootnoteResult?: boolean;
	isFocused?: boolean;
}

function fakeEditor(options: FakeEditorOptions = {}) {
	const ancestors = options.ancestors ?? [];
	const chain = {
		focus: vi.fn(() => chain),
		addFootnote: vi.fn(() => chain),
		deleteRange: vi.fn(() => chain),
		setTextSelection: vi.fn(() => chain),
		run: vi.fn(() => options.addFootnoteResult ?? true),
	};
	const commands = { focusFootnote: vi.fn() };
	const editor = {
		isFocused: options.isFocused ?? true,
		chain: vi.fn(() => chain),
		commands,
		state: {
			selection: {
				$from: {
					depth: ancestors.length,
					pos: options.pos ?? 5,
					node: (depth: number) => node(ancestors[depth - 1] ?? "doc"),
					nodeBefore: options.nodeBefore ?? null,
					nodeAfter: options.nodeAfter ?? null,
				},
			},
			doc: {
				descendants: (
					fn: (n: FakeNode, pos: number) => boolean | undefined,
				) => {
					for (const entry of options.docNodes ?? []) {
						if (fn(entry.node, entry.pos) === false) break;
					}
				},
			},
		},
	};
	return { editor: editor as unknown as Editor, chain, commands };
}

describe("isSelectionInsideFootnotes", () => {
	it("detects a caret inside a footnote item", () => {
		const { editor } = fakeEditor({ ancestors: ["footnotes", "footnote"] });
		expect(isSelectionInsideFootnotes(editor)).toBe(true);
	});

	it("returns false for a caret in the body", () => {
		const { editor } = fakeEditor({ ancestors: ["paragraph"] });
		expect(isSelectionInsideFootnotes(editor)).toBe(false);
	});
});

describe("footnoteReferenceRange", () => {
	it("takes the reference before the caret", () => {
		const { editor } = fakeEditor({
			nodeBefore: node("footnoteReference"),
			pos: 7,
		});
		expect(footnoteReferenceRange(editor)).toEqual({ from: 6, to: 7 });
	});

	it("takes the reference after the caret", () => {
		const { editor } = fakeEditor({
			nodeAfter: node("footnoteReference"),
			pos: 7,
		});
		expect(footnoteReferenceRange(editor)).toEqual({ from: 7, to: 8 });
	});

	it("returns null when the caret touches no reference", () => {
		const { editor } = fakeEditor({ nodeBefore: node("text") });
		expect(footnoteReferenceRange(editor)).toBeNull();
	});
});

describe("footnoteIdAtSelection", () => {
	it("returns the data-id of the surrounding footnote", () => {
		const { editor } = fakeEditor({ ancestors: ["footnotes", "footnote"] });
		editor.state.selection.$from.node = ((depth: number) =>
			depth === 2
				? node("footnote", { "data-id": "abc" })
				: node("footnotes")) as never;
		expect(footnoteIdAtSelection(editor)).toBe("abc");
	});

	it("returns null outside a footnote", () => {
		const { editor } = fakeEditor({ ancestors: ["paragraph"] });
		expect(footnoteIdAtSelection(editor)).toBeNull();
	});
});

describe("canRemoveFootnote", () => {
	it("is false without an editor", () => {
		expect(canRemoveFootnote(null)).toBe(false);
	});

	it("is true next to a reference", () => {
		const { editor } = fakeEditor({ nodeBefore: node("footnoteReference") });
		expect(canRemoveFootnote(editor)).toBe(true);
	});

	it("is false in plain body text", () => {
		const { editor } = fakeEditor({ ancestors: ["paragraph"] });
		expect(canRemoveFootnote(editor)).toBe(false);
	});

	it("is false while the editor is not focused", () => {
		/* The default selection sits in the trailing footnote list. */
		const { editor } = fakeEditor({
			ancestors: ["footnotes", "footnote"],
			isFocused: false,
		});
		expect(canRemoveFootnote(editor)).toBe(false);
	});
});

describe("removeFootnoteAtSelection", () => {
	it("deletes the reference next to the caret", () => {
		const { editor, chain } = fakeEditor({
			nodeBefore: node("footnoteReference"),
			pos: 7,
		});
		expect(removeFootnoteAtSelection(editor)).toBe(true);
		expect(chain.deleteRange).toHaveBeenCalledWith({ from: 6, to: 7 });
	});

	it("deletes the reference of the footnote being edited", () => {
		const { editor, chain } = fakeEditor({
			ancestors: ["footnotes", "footnote"],
			docNodes: [
				{ node: node("footnoteReference", { "data-id": "abc" }), pos: 12 },
			],
		});
		editor.state.selection.$from.node = ((depth: number) =>
			depth === 2
				? node("footnote", { "data-id": "abc" })
				: node("footnotes")) as never;

		expect(removeFootnoteAtSelection(editor)).toBe(true);
		expect(chain.deleteRange).toHaveBeenCalledWith({ from: 12, to: 13 });
	});

	it("reports failure when nothing is targeted", () => {
		const { editor, chain } = fakeEditor({ ancestors: ["paragraph"] });
		expect(removeFootnoteAtSelection(editor)).toBe(false);
		expect(chain.deleteRange).not.toHaveBeenCalled();
	});

	it("refuses to act on an unfocused editor", () => {
		const { editor, chain } = fakeEditor({
			ancestors: ["footnotes", "footnote"],
			isFocused: false,
			docNodes: [
				{ node: node("footnoteReference", { "data-id": "abc" }), pos: 12 },
			],
		});
		expect(removeFootnoteAtSelection(editor)).toBe(false);
		expect(chain.deleteRange).not.toHaveBeenCalled();
	});
});

describe("insertFootnoteAtSelection", () => {
	it("focuses the footnote it just created", () => {
		const created = node("footnoteReference", { "data-id": "new" });
		const state: Array<{ node: FakeNode; pos: number }> = [];
		const { editor, chain, commands } = fakeEditor({ docNodes: state });
		chain.run.mockImplementation(() => {
			state.push({ node: created, pos: 3 });
			return true;
		});

		expect(insertFootnoteAtSelection(editor)).toBe(true);
		expect(commands.focusFootnote).toHaveBeenCalledWith("new");
	});

	it("does not focus anything when the command fails", () => {
		const { editor, chain, commands } = fakeEditor();
		chain.run.mockReturnValue(false);

		expect(insertFootnoteAtSelection(editor)).toBe(false);
		expect(commands.focusFootnote).not.toHaveBeenCalled();
	});

	it("still inserts when focus tracking reports blurred", () => {
		/* The caret is restored by the chain's focus(); only the destructive
		   remove is gated on isFocused. */
		const { editor, chain } = fakeEditor({ isFocused: false });
		expect(insertFootnoteAtSelection(editor)).toBe(true);
		expect(chain.addFootnote).toHaveBeenCalled();
	});
});
