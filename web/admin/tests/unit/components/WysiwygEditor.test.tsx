import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WysiwygEditor } from "~/components/WysiwygEditor";

const editorState = vi.hoisted(() => {
	let html = "<p>Initial</p>";
	let active = new Set<string>();
	let attributes = new Map<string, Record<string, unknown>>();
	let selectionEmpty = false;
	const listeners = new Map<string, Set<() => void>>();
	let useEditorResult: unknown;

	const chain = {
		focus: vi.fn(() => chain),
		toggleBold: vi.fn(() => chain),
		toggleItalic: vi.fn(() => chain),
		toggleStrike: vi.fn(() => chain),
		toggleHeading: vi.fn(() => chain),
		toggleBulletList: vi.fn(() => chain),
		toggleOrderedList: vi.fn(() => chain),
		updateAttributes: vi.fn(() => chain),
		setLink: vi.fn(() => chain),
		extendMarkRange: vi.fn(() => chain),
		unsetLink: vi.fn(() => chain),
		setImage: vi.fn(() => chain),
		insertContent: vi.fn((content: string) => {
			html += content;
			return chain;
		}),
		setTextSelection: vi.fn(() => chain),
		run: vi.fn(() => true),
	};

	const editor = {
		chain: vi.fn(() => chain),
		getHTML: vi.fn(() => html),
		commands: {
			setContent: vi.fn((next: string) => {
				html = next;
			}),
		},
		state: {
			selection: {
				get empty() {
					return selectionEmpty;
				},
			},
			doc: { descendants: vi.fn() },
		},
		view: {
			posAtDOM: vi.fn(() => 4),
		},
		isActive: vi.fn((name: string, attrs?: Record<string, unknown>) => {
			if (name === "heading" && attrs) {
				return active.has(`heading:${attrs.level}`);
			}
			return active.has(name);
		}),
		getAttributes: vi.fn((name: string) => attributes.get(name) ?? {}),
		on: vi.fn((event: string, handler: () => void) => {
			const set = listeners.get(event) ?? new Set<() => void>();
			set.add(handler);
			listeners.set(event, set);
		}),
		off: vi.fn((event: string, handler: () => void) => {
			listeners.get(event)?.delete(handler);
		}),
	};
	useEditorResult = editor;

	function reset() {
		html = "<p>Initial</p>";
		active = new Set<string>();
		attributes = new Map<string, Record<string, unknown>>();
		selectionEmpty = false;
		listeners.clear();
		useEditorResult = editor;
		vi.clearAllMocks();
	}

	return {
		chain,
		editor,
		reset,
		setHtml: (next: string) => {
			html = next;
		},
		setSelectionEmpty: (next: boolean) => {
			selectionEmpty = next;
		},
		setActive: (...names: string[]) => {
			active = new Set(names);
		},
		setAttributes: (name: string, next: Record<string, unknown>) => {
			attributes.set(name, next);
		},
		getEditor: () => useEditorResult,
		setUseEditorResult: (next: unknown) => {
			useEditorResult = next;
		},
		emit: (event: string) => {
			for (const handler of listeners.get(event) ?? []) handler();
		},
	};
});

vi.mock("@tiptap/extension-bullet-list", () => ({ default: {} }));
vi.mock("@tiptap/extension-image", () => ({ default: {} }));
vi.mock("@tiptap/extension-italic", () => ({
	default: { extend: vi.fn(() => ({})) },
}));
vi.mock("@tiptap/extension-list-item", () => ({ default: {} }));
vi.mock("@tiptap/extension-placeholder", () => ({
	default: { configure: vi.fn(() => ({})) },
}));
vi.mock("@tiptap/starter-kit", () => ({
	default: { configure: vi.fn(() => ({})) },
}));
vi.mock("@tiptap/react", () => ({
	EditorContent: ({ editor }: { editor: unknown }) => (
		<div className="ProseMirror" data-testid="editor-content">
			<a href="#note-1">פתח הערה א</a>
			{String(Boolean(editor))}
		</div>
	),
	useEditor: vi.fn(() => editorState.getEditor()),
}));

function renderEditor(onChange = vi.fn(), content = "<p>Initial</p>") {
	return {
		onChange,
		...render(
			<WysiwygEditor
				content={content}
				onChange={onChange}
				placeholder="Body"
				autoSaveDelay={1}
			/>,
		),
	};
}

function clickFootnoteDialogAddButton() {
	const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
	if (!dialog) {
		throw new Error("Expected footnote dialog to be open");
	}
	const buttons = within(dialog).getAllByRole("button");
	const addButton = buttons.at(-1);
	if (!addButton) {
		throw new Error("Expected footnote dialog to have an add button");
	}
	fireEvent.click(addButton);
}

describe("WysiwygEditor", () => {
	beforeEach(() => {
		editorState.reset();
		localStorage.clear();
		vi.stubGlobal("alert", vi.fn());
		vi.stubGlobal("prompt", vi.fn());
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("renders a loading placeholder while TipTap has not created an editor", () => {
		editorState.setUseEditorResult(null);

		const { container } = renderEditor();

		expect(container.firstElementChild).toHaveClass("animate-pulse");
	});

	it("renders toolbar controls and runs formatting commands", () => {
		renderEditor();

		fireEvent.click(screen.getByRole("button", { name: "B" }));
		fireEvent.click(screen.getByRole("button", { name: "I" }));
		fireEvent.click(screen.getByRole("button", { name: "S" }));
		fireEvent.click(screen.getByRole("button", { name: "H1" }));
		fireEvent.click(screen.getByRole("button", { name: "• תבליטים" }));
		fireEvent.click(screen.getByRole("button", { name: "1. מספרים" }));
		fireEvent.click(screen.getByRole("button", { name: "א׳ עברית" }));

		expect(editorState.chain.toggleBold).toHaveBeenCalledTimes(1);
		expect(editorState.chain.toggleItalic).toHaveBeenCalledTimes(1);
		expect(editorState.chain.toggleStrike).toHaveBeenCalledTimes(1);
		expect(editorState.chain.toggleHeading).toHaveBeenCalledWith({ level: 1 });
		expect(editorState.chain.toggleBulletList).toHaveBeenCalledTimes(1);
		expect(editorState.chain.updateAttributes).toHaveBeenCalledWith(
			"orderedList",
			{
				orderedType: "decimal",
			},
		);
		expect(editorState.chain.updateAttributes).toHaveBeenCalledWith(
			"orderedList",
			{
				orderedType: "hebrew-alpha",
			},
		);
	});

	it("updates ordered-list attributes without toggling when the list is already active", () => {
		editorState.setActive("orderedList");
		editorState.setAttributes("orderedList", { orderedType: "decimal" });
		renderEditor();

		fireEvent.click(screen.getAllByRole("button")[12]);

		expect(editorState.chain.toggleOrderedList).not.toHaveBeenCalled();
		expect(editorState.chain.updateAttributes).toHaveBeenCalledWith(
			"orderedList",
			{
				orderedType: "hebrew-alpha",
			},
		);
	});

	it("switches source mode, flushes source edits, and renders sanitized preview", async () => {
		const onChange = vi.fn();
		renderEditor(onChange);

		fireEvent.click(screen.getByRole("button", { name: "מקור HTML" }));
		const source = screen.getByRole("textbox");
		fireEvent.change(source, { target: { value: "<p>Source</p>" } });
		fireEvent.click(screen.getByRole("button", { name: "תצוגה מקדימה" }));

		expect(editorState.editor.commands.setContent).toHaveBeenCalledWith(
			"<p>Source</p>",
		);
		expect(onChange).toHaveBeenCalledWith("<p>Source</p>");
		await waitFor(() => expect(screen.getByText("Source")).toBeInTheDocument());
	});

	it("creates, updates, and removes links from the link panel", () => {
		renderEditor();

		editorState.setSelectionEmpty(true);
		fireEvent.click(screen.getByRole("button", { name: "קישור חדש" }));
		expect(alert).toHaveBeenCalledWith("סמן טקסט ואז לחץ «קישור חדש».");

		editorState.setSelectionEmpty(false);
		fireEvent.click(screen.getByRole("button", { name: "קישור חדש" }));
		expect(editorState.chain.setLink).toHaveBeenCalledWith({
			href: "https://",
			linkType: "external",
		});

		fireEvent.change(
			screen.getByPlaceholderText("https://… / slug / #note-1"),
			{
				target: { value: "https://example.com" },
			},
		);
		fireEvent.click(screen.getByRole("button", { name: "עדכן קישור" }));
		expect(editorState.chain.setLink).toHaveBeenCalledWith({
			href: "https://example.com",
			linkType: "external",
			target: "_blank",
			rel: "noopener noreferrer nofollow",
		});

		editorState.setActive("link");
		editorState.setAttributes("link", {
			href: "#note-1",
			linkType: "comment",
		});
		act(() => editorState.emit("selectionUpdate"));
		expect(
			screen.getByRole("button", { name: "הסר קישור" }),
		).not.toBeDisabled();
		fireEvent.click(screen.getByRole("button", { name: "הסר קישור" }));
		expect(editorState.chain.unsetLink).toHaveBeenCalledTimes(1);
	});

	it("adds images and inserts end footnotes", () => {
		vi.mocked(prompt).mockReturnValue("https://example.com/image.jpg");
		const html = '<p>Body</p><p id="note-1"><strong>א.</strong> old</p>';
		editorState.setHtml(html);
		renderEditor(vi.fn(), html);

		fireEvent.click(screen.getByRole("button", { name: "תמונה" }));
		expect(editorState.chain.setImage).toHaveBeenCalledWith({
			src: "https://example.com/image.jpg",
		});

		fireEvent.click(screen.getByRole("button", { name: "הערה" }));
		expect(
			screen.getByRole("dialog", { name: "הערות (כמו בתנכפדיה)" }),
		).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "הוסף" }));
		expect(editorState.chain.insertContent).toHaveBeenCalledWith(
			expect.stringContaining('id="noteref-2"'),
		);
	});

	it("changes footnote mode options and closes the dialog without insertion", () => {
		renderEditor();

		fireEvent.click(screen.getAllByRole("button")[15]);
		const modeInputs = document.querySelectorAll<HTMLInputElement>(
			'input[name="fnm"]',
		);

		fireEvent.click(modeInputs[1]);
		expect(modeInputs[1]).toBeChecked();
		fireEvent.click(modeInputs[0]);
		expect(modeInputs[0]).toBeChecked();
		const dialog = screen.getByRole("dialog");
		fireEvent.click(within(dialog).getAllByRole("button")[0]);

		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
		expect(editorState.chain.insertContent).not.toHaveBeenCalled();
	});

	it("does not add an image when the prompt is cancelled", () => {
		vi.mocked(prompt).mockReturnValue(null);
		renderEditor();

		fireEvent.click(screen.getAllByRole("button")[14]);

		expect(editorState.chain.setImage).not.toHaveBeenCalled();
	});

	it("updates link panel type and external target options", () => {
		renderEditor();

		editorState.setSelectionEmpty(false);
		fireEvent.click(screen.getAllByRole("button")[13]);
		const linkTypeInputs = document.querySelectorAll<HTMLInputElement>(
			'input[name="linkType"]',
		);
		const hrefInput = screen.getByRole("textbox");

		fireEvent.click(linkTypeInputs[2]);
		expect(hrefInput).toHaveValue("#note-1");
		fireEvent.click(linkTypeInputs[0]);
		fireEvent.click(screen.getByRole("checkbox"));
		fireEvent.change(hrefInput, {
			target: { value: "https://example.com/plain" },
		});
		fireEvent.click(screen.getAllByRole("button")[16]);

		expect(editorState.chain.setLink).toHaveBeenLastCalledWith({
			href: "https://example.com/plain",
			linkType: "external",
		});
	});

	it("selects an existing link when a link inside the editor is clicked", () => {
		const { container } = renderEditor();
		const link = container.querySelector(".ProseMirror a");
		expect(link).not.toBeNull();

		fireEvent.click(link as Element);

		expect(editorState.editor.view.posAtDOM).toHaveBeenCalledWith(link, 0);
		expect(editorState.chain.setTextSelection).toHaveBeenCalledWith(4);
		expect(editorState.chain.extendMarkRange).toHaveBeenCalledWith("link");
	});

	it("rejects invalid footnote slot numbers before mutating content", () => {
		const html = '<p>Body</p><p id="note-1"><strong>a.</strong> old</p>';
		editorState.setHtml(html);
		renderEditor(vi.fn(), html);

		fireEvent.click(screen.getAllByRole("button")[15]);
		fireEvent.click(
			document.querySelectorAll<HTMLInputElement>('input[name="fnplace"]')[1],
		);
		fireEvent.change(screen.getByRole("spinbutton"), {
			target: { value: "4" },
		});
		clickFootnoteDialogAddButton();

		expect(alert).toHaveBeenCalledWith(expect.stringContaining("1"));
		expect(editorState.chain.insertContent).not.toHaveBeenCalled();
	});

	it("alerts when slot insertion cannot find the temporary marker", () => {
		const html = '<p>Body</p><p id="note-1"><strong>a.</strong> old</p>';
		editorState.setHtml(html);
		renderEditor(vi.fn(), html);

		fireEvent.click(screen.getAllByRole("button")[15]);
		fireEvent.click(
			document.querySelectorAll<HTMLInputElement>('input[name="fnplace"]')[1],
		);
		clickFootnoteDialogAddButton();

		expect(editorState.chain.insertContent).toHaveBeenCalledWith(
			"@@ADMIN_FN_ANCHOR_v1@@",
		);
		expect(alert).toHaveBeenCalledTimes(1);
	});

	it("inserts a footnote into a numbered slot when the marker is found", () => {
		const html = '<p>Body</p><p id="note-1"><strong>a.</strong> old</p>';
		editorState.setHtml(html);
		editorState.editor.state.doc.descendants.mockImplementation((callback) => {
			callback({ isText: true, text: "@@ADMIN_FN_ANCHOR_v1@@" }, 10);
			return true;
		});
		renderEditor(vi.fn(), html);

		fireEvent.click(screen.getAllByRole("button")[15]);
		fireEvent.click(
			document.querySelectorAll<HTMLInputElement>('input[name="fnplace"]')[1],
		);
		clickFootnoteDialogAddButton();

		expect(editorState.chain.setTextSelection).toHaveBeenCalledWith({
			from: 10,
			to: 32,
		});
		expect(editorState.chain.insertContent).toHaveBeenLastCalledWith(
			expect.stringContaining('id="noteref-2"'),
		);
	});

	it("opens shortcut help and saves valid shortcut JSON", () => {
		localStorage.setItem("admin-editor-shortcut-extras", '{"Mod-b":"bold"}');
		renderEditor();

		fireEvent.click(screen.getByRole("button", { name: "קיצורים" }));
		const textarea = screen.getByLabelText("קיצורים מותאמים JSON");
		expect(textarea).toHaveValue('{"Mod-b":"bold"}');

		fireEvent.change(textarea, { target: { value: '{"Mod-i":"italic"}' } });
		fireEvent.click(
			screen.getByRole("button", { name: "שמור JSON והחל עורך" }),
		);

		expect(localStorage.getItem("admin-editor-shortcut-extras")).toBe(
			'{"Mod-i":"italic"}',
		);
		expect(
			screen.queryByRole("dialog", { name: "קיצורי מקלדת" }),
		).not.toBeInTheDocument();
	});

	it("rejects invalid shortcut JSON", () => {
		renderEditor();
		fireEvent.click(screen.getByRole("button", { name: "קיצורים" }));
		fireEvent.change(screen.getByLabelText("קיצורים מותאמים JSON"), {
			target: { value: "{" },
		});
		fireEvent.click(
			screen.getByRole("button", { name: "שמור JSON והחל עורך" }),
		);

		expect(alert).toHaveBeenCalledWith("JSON לא תקין. בדוק את הפורמט.");
		expect(
			screen.getByRole("dialog", { name: "קיצורי מקלדת" }),
		).toBeInTheDocument();
	});
});
