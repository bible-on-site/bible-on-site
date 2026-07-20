import type { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	ADMIN_EDITOR_SHORTCUT_EXTRAS_KEY,
	adminEditorShortcutsExtension,
	parseStoredShortcutExtras,
} from "~/components/editor/adminEditorShortcuts";

function createEditor() {
	const chain = {
		focus: vi.fn(() => chain),
		toggleBold: vi.fn(() => chain),
		toggleItalic: vi.fn(() => chain),
		toggleBulletList: vi.fn(() => chain),
		toggleOrderedList: vi.fn(() => chain),
		toggleHeading: vi.fn(() => chain),
		extendMarkRange: vi.fn(() => chain),
		setLink: vi.fn(() => chain),
		unsetLink: vi.fn(() => chain),
		run: vi.fn(() => true),
	};
	const editor = {
		chain: vi.fn(() => chain),
		getAttributes: vi.fn(() => ({})),
		isActive: vi.fn(() => false),
	};
	return { chain, editor: editor as unknown as Editor };
}

describe("adminEditorShortcuts", () => {
	afterEach(() => {
		localStorage.clear();
		vi.restoreAllMocks();
	});

	it("returns no extra shortcuts when storage is empty or invalid", () => {
		const { editor } = createEditor();

		expect(parseStoredShortcutExtras(editor)).toEqual({});

		localStorage.setItem(ADMIN_EDITOR_SHORTCUT_EXTRAS_KEY, "not json");
		expect(parseStoredShortcutExtras(editor)).toEqual({});
	});

	it("parses valid stored shortcut commands and ignores invalid entries", () => {
		const { chain, editor } = createEditor();
		localStorage.setItem(
			ADMIN_EDITOR_SHORTCUT_EXTRAS_KEY,
			JSON.stringify({
				" Mod-b ": "bold",
				"Mod-i": "italic",
				"Mod-Shift-7": "bulletList",
				"Mod-Shift-8": "orderedList",
				"Mod-Alt-2": "heading:2",
				"Mod-bad": "unknown",
				"Mod-number": 42,
			}),
		);

		const extras = parseStoredShortcutExtras(editor);

		expect(Object.keys(extras).sort()).toEqual([
			"Mod-Alt-2",
			"Mod-Shift-7",
			"Mod-Shift-8",
			"Mod-b",
			"Mod-i",
		]);

		expect(extras["Mod-b"]()).toBe(true);
		expect(chain.toggleBold).toHaveBeenCalledTimes(1);

		expect(extras["Mod-i"]()).toBe(true);
		expect(chain.toggleItalic).toHaveBeenCalledTimes(1);

		expect(extras["Mod-Shift-7"]()).toBe(true);
		expect(chain.toggleBulletList).toHaveBeenCalledTimes(1);

		expect(extras["Mod-Shift-8"]()).toBe(true);
		expect(chain.toggleOrderedList).toHaveBeenCalledTimes(1);

		expect(extras["Mod-Alt-2"]()).toBe(true);
		expect(chain.toggleHeading).toHaveBeenCalledWith({ level: 2 });
	});

	it("creates, updates, and removes links from stored link shortcuts", () => {
		const promptSpy = vi.spyOn(window, "prompt");
		const { chain, editor } = createEditor();
		localStorage.setItem(
			ADMIN_EDITOR_SHORTCUT_EXTRAS_KEY,
			JSON.stringify({ "Mod-k": "link" }),
		);

		promptSpy.mockReturnValueOnce("https://example.com");
		expect(parseStoredShortcutExtras(editor)["Mod-k"]()).toBe(true);
		expect(chain.setLink).toHaveBeenCalledWith({
			href: "https://example.com",
			linkType: "external",
			target: "_blank",
			rel: "noopener noreferrer nofollow",
		});

		vi.mocked(editor.isActive).mockReturnValue(true);
		vi.mocked(editor.getAttributes).mockReturnValue({
			href: "/tanahpedia/entry/משה",
			linkType: "internal",
		});
		promptSpy.mockReturnValueOnce("#note-4");
		expect(parseStoredShortcutExtras(editor)["Mod-k"]()).toBe(true);
		expect(chain.extendMarkRange).toHaveBeenCalledWith("link");
		expect(chain.setLink).toHaveBeenCalledWith({
			href: "#note-4",
			linkType: "comment",
		});

		promptSpy.mockReturnValueOnce("");
		expect(parseStoredShortcutExtras(editor)["Mod-k"]()).toBe(true);
		expect(chain.extendMarkRange).toHaveBeenCalledWith("link");
		expect(chain.unsetLink).toHaveBeenCalledTimes(1);

		promptSpy.mockReturnValueOnce(null);
		expect(parseStoredShortcutExtras(editor)["Mod-k"]()).toBe(false);
	});

	it("builds default keyboard shortcuts and lets stored extras override them", () => {
		const promptSpy = vi.spyOn(window, "prompt").mockReturnValue("#note-2");
		const { chain, editor } = createEditor();

		const baseShortcuts =
			adminEditorShortcutsExtension.config.addKeyboardShortcuts?.call({
				editor,
			});

		expect(baseShortcuts).toBeDefined();
		expect(baseShortcuts?.["Mod-1"]()).toBe(true);
		expect(baseShortcuts?.["Mod-2"]()).toBe(true);
		expect(baseShortcuts?.["Mod-3"]()).toBe(true);
		expect(baseShortcuts?.["Mod-4"]()).toBe(true);
		expect(baseShortcuts?.["Mod-5"]()).toBe(true);
		expect(baseShortcuts?.["Mod-6"]()).toBe(true);
		expect(chain.toggleHeading).toHaveBeenCalledWith({ level: 1 });
		expect(chain.toggleHeading).toHaveBeenCalledWith({ level: 2 });
		expect(chain.toggleHeading).toHaveBeenCalledWith({ level: 3 });
		expect(chain.toggleHeading).toHaveBeenCalledWith({ level: 4 });
		expect(chain.toggleHeading).toHaveBeenCalledWith({ level: 5 });
		expect(chain.toggleHeading).toHaveBeenCalledWith({ level: 6 });

		expect(baseShortcuts?.["Mod-i"]()).toBe(true);
		expect(chain.setLink).toHaveBeenCalledWith({
			href: "#note-2",
			linkType: "comment",
		});
		expect(promptSpy).toHaveBeenCalledTimes(1);

		expect(baseShortcuts?.["Mod-Shift-7"]()).toBe(true);
		expect(chain.toggleBulletList).toHaveBeenCalledTimes(1);
		expect(baseShortcuts?.["Mod-Shift-8"]()).toBe(true);
		expect(chain.toggleOrderedList).toHaveBeenCalledTimes(1);

		localStorage.setItem(
			ADMIN_EDITOR_SHORTCUT_EXTRAS_KEY,
			JSON.stringify({ "Mod-2": "bold" }),
		);
		const overriddenShortcuts =
			adminEditorShortcutsExtension.config.addKeyboardShortcuts?.call({
				editor,
			});

		expect(overriddenShortcuts?.["Mod-2"]()).toBe(true);
		expect(chain.toggleBold).toHaveBeenCalledTimes(1);
	});
});
