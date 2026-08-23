import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { useEditor } from "@tiptap/react";
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
		addFootnote: vi.fn(() => chain),
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
				$from: {
					depth: 0,
					pos: 0,
					node: () => ({ type: { name: "doc" }, attrs: {} }),
					nodeBefore: null,
					nodeAfter: null,
				},
			},
			doc: { descendants: vi.fn() },
		},
		isFocused: true,
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

const PEDIA_ENTRIES = [
	{ id: "1", title: "משה רבנו", uniqueName: "משה-רבנו" },
	{ id: "2", title: "ארץ ישראל", uniqueName: "eretz yisrael" },
];

function renderEditorWithEntrySearch() {
	const onChange = vi.fn();
	render(
		<WysiwygEditor
			content="<p>Initial</p>"
			onChange={onChange}
			placeholder="Body"
			autoSaveDelay={1}
			searchEntries={async () => PEDIA_ENTRIES}
		/>,
	);
	return { onChange };
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

	it("auto-saves editor updates after the debounce delay", async () => {
		const onChange = vi.fn();
		renderEditor(onChange);
		const editorOptions = vi.mocked(useEditor).mock.calls.at(-1)?.[0];
		if (!editorOptions || !("onUpdate" in editorOptions)) {
			throw new Error("Expected WysiwygEditor to configure TipTap onUpdate");
		}

		act(() => {
			editorOptions.onUpdate?.({
				editor: { getHTML: vi.fn(() => "<p>Changed</p>") },
			} as never);
		});

		await waitFor(() =>
			expect(onChange).toHaveBeenCalledWith("<p>Changed</p>"),
		);
	});

	it("syncs changed content props back into TipTap", () => {
		const onChange = vi.fn();
		const { rerender } = renderEditor(onChange);

		rerender(
			<WysiwygEditor
				content="<p>Updated from props</p>"
				onChange={onChange}
				placeholder="Body"
				autoSaveDelay={1}
			/>,
		);

		expect(editorState.editor.commands.setContent).toHaveBeenCalledWith(
			"<p>Updated from props</p>",
		);
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
		fireEvent.change(screen.getByRole("textbox"), {
			target: { value: "#note-3" },
		});
		fireEvent.click(screen.getByRole("button", { name: "עדכן קישור" }));
		expect(editorState.chain.extendMarkRange).toHaveBeenCalledWith("link");
		expect(editorState.chain.setLink).toHaveBeenCalledWith({
			href: "#note-3",
			linkType: "comment",
		});

		expect(
			screen.getByRole("button", { name: "הסר קישור" }),
		).not.toBeDisabled();
		fireEvent.click(screen.getByRole("button", { name: "הסר קישור" }));
		expect(editorState.chain.unsetLink).toHaveBeenCalledTimes(1);
	});

	it("adds images and delegates footnote insertion to the extension", () => {
		vi.mocked(prompt).mockReturnValue("https://example.com/image.jpg");
		renderEditor();

		fireEvent.click(screen.getByRole("button", { name: "תמונה" }));
		expect(editorState.chain.setImage).toHaveBeenCalledWith({
			src: "https://example.com/image.jpg",
		});

		fireEvent.click(screen.getByRole("button", { name: "+ הערה" }));

		expect(editorState.chain.addFootnote).toHaveBeenCalledTimes(1);
		expect(editorState.chain.insertContent).not.toHaveBeenCalled();
	});

	it("does not open a footnote dialog anymore", () => {
		renderEditor();

		fireEvent.click(screen.getByRole("button", { name: "+ הערה" }));

		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
	});

	describe("internal link entry picker", () => {
		it("stays hidden until the link type is internal", () => {
			renderEditorWithEntrySearch();
			expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
		});

		it("links to the readable hebrew slug rather than an encoded one", async () => {
			renderEditorWithEntrySearch();
			editorState.setSelectionEmpty(false);
			fireEvent.click(
				document.querySelectorAll<HTMLInputElement>('input[name="linkType"]')[1],
			);

			fireEvent.click(await screen.findByText("משה רבנו"));

			expect(editorState.chain.setLink).toHaveBeenCalledWith({
				href: "משה-רבנו",
				linkType: "internal",
			});
			expect(screen.getByRole("textbox")).toHaveValue("משה-רבנו");
		});

		it("encodes a slug that would otherwise break the href", async () => {
			renderEditorWithEntrySearch();
			editorState.setSelectionEmpty(false);
			fireEvent.click(
				document.querySelectorAll<HTMLInputElement>('input[name="linkType"]')[1],
			);

			fireEvent.click(await screen.findByText("ארץ ישראל"));

			expect(editorState.chain.setLink).toHaveBeenCalledWith({
				href: "eretz%20yisrael",
				linkType: "internal",
			});
		});

		it("shows an existing encoded internal link decoded", () => {
			renderEditorWithEntrySearch();
			editorState.setActive("link");
			editorState.setAttributes("link", {
				href: "%D7%9E%D7%A9%D7%94-%D7%A8%D7%91%D7%A0%D7%95",
				linkType: "internal",
			});
			act(() => editorState.emit("selectionUpdate"));

			expect(screen.getByRole("textbox")).toHaveValue("משה-רבנו");
		});
	});

	it("does not add an image when the prompt is cancelled", () => {
		vi.mocked(prompt).mockReturnValue(null);
		renderEditor();

		fireEvent.click(screen.getByRole("button", { name: "תמונה" }));

		expect(editorState.chain.setImage).not.toHaveBeenCalled();
	});

	it("updates link panel type and external target options", () => {
		renderEditor();

		editorState.setSelectionEmpty(false);
		fireEvent.click(screen.getByRole("button", { name: "קישור חדש" }));
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
		fireEvent.click(screen.getByRole("button", { name: "עדכן קישור" }));

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

	it("clears shortcut overrides and closes shortcut help", () => {
		localStorage.setItem("admin-editor-shortcut-extras", '{"Mod-b":"bold"}');
		renderEditor();

		fireEvent.click(screen.getAllByRole("button")[3]);
		const textarea = document.querySelector("textarea");
		if (!textarea) {
			throw new Error("Expected shortcut JSON textarea to be rendered");
		}
		fireEvent.change(textarea, {
			target: { value: "   " },
		});
		fireEvent.click(within(screen.getByRole("dialog")).getAllByRole("button")[2]);

		expect(localStorage.getItem("admin-editor-shortcut-extras")).toBeNull();

		fireEvent.click(screen.getAllByRole("button")[3]);
		const dialog = screen.getByRole("dialog");
		fireEvent.click(within(dialog).getAllByRole("button")[0]);

		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
	});
});
