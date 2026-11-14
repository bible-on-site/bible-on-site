import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAdminEditorExtensions } from "~/components/editor/adminEditorExtensions";
import { removeFootnoteAtSelection } from "~/components/editor/adminFootnoteCommands";
import {
	toEditorFootnoteHtml,
	toStoredFootnoteHtml,
} from "~/components/editor/adminFootnoteMigration";

/**
 * Save-and-reopen regression coverage for tiptap-footnotes v4 (#3318): the
 * stored markup must still parse as references after a real editor serializes
 * it, or the mount sync drops the footnote bodies.
 */

const mounted: { editor: Editor; host: HTMLElement }[] = [];

function openEditor(storedHtml: string): Editor {
	const host = document.createElement("div");
	document.body.appendChild(host);
	const editor = new Editor({
		element: host,
		extensions: createAdminEditorExtensions("טסט"),
		content: toEditorFootnoteHtml(storedHtml),
	});
	mounted.push({ editor, host });
	return editor;
}

/** What the routes persist when the editor reports a change. */
function saveEditor(editor: Editor): string {
	return toStoredFootnoteHtml(editor.getHTML());
}

function parse(html: string): Document {
	return new DOMParser().parseFromString(html, "text/html");
}

function footnoteBodies(doc: Document): (string | undefined)[] {
	return Array.from(doc.querySelectorAll("ol.footnotes > li")).map((li) =>
		li.textContent?.replace("↩", "").trim(),
	);
}

function referenceNumbers(doc: Document): (string | null)[] {
	return Array.from(doc.querySelectorAll("a.footnote-ref")).map((a) =>
		a.getAttribute("data-reference-number"),
	);
}

/** A stored document exactly as the v3 editor wrote it. */
const V3_STORED =
	'<p>ראשון<sup id="fnref:1"><a class="footnote-ref" data-id="note-a" data-reference-number="1" href="#fn:1" role="doc-noteref">א</a></sup></p>' +
	'<p>שני<sup id="fnref:2"><a class="footnote-ref" data-id="note-b" data-reference-number="2" href="#fn:2" role="doc-noteref">ב</a></sup></p>' +
	'<ol class="footnotes">' +
	'<li id="fn:1" data-id="note-a"><p>טקסט ההערה <strong>הראשונה</strong> מיוחד<a class="footnote-backref" href="#fnref:1" role="doc-backlink">↩</a></p></li>' +
	'<li id="fn:2" data-id="note-b"><p>תוכן ההערה השנייה<a class="footnote-backref" href="#fnref:2" role="doc-backlink">↩</a></p></li>' +
	"</ol>";

afterEach(() => {
	for (const { editor, host } of mounted.splice(0)) {
		editor.destroy();
		host.remove();
	}
});

describe("footnote save/reopen round trip", () => {
	it("keeps references and footnote bodies through save and reopen", () => {
		const first = openEditor(V3_STORED);
		/* Mounting alone must not serialize away the footnotes. */
		expect(first.getHTML()).toContain('data-reference-number="1"');
		expect(first.getHTML()).toContain("טקסט ההערה");

		/* An unrelated body edit, then the production save transform. */
		first.chain().focus().setTextSelection(2).insertContent(" ועוד").run();
		const stored = saveEditor(first);
		const storedDoc = parse(stored);

		expect(stored).not.toContain("undefined");
		expect(stored).not.toContain("NaN");
		expect(referenceNumbers(storedDoc)).toEqual(["1", "2"]);
		expect(footnoteBodies(storedDoc)).toEqual([
			"טקסט ההערה הראשונה מיוחד",
			"תוכן ההערה השנייה",
		]);
		const refLink = storedDoc.querySelector("sup a.footnote-ref");
		expect(refLink?.getAttribute("href")).toBe("#fn:1");
		expect(refLink?.textContent).toBe("א");
		expect(
			storedDoc.querySelector("sup#fnref\\:2 a.footnote-ref")?.textContent,
		).toBe("ב");

		/* Reopen in a fresh editor — the mount sync must keep every note. */
		const second = openEditor(stored);
		const reopenedHtml = second.getHTML();
		expect(reopenedHtml).toContain("טקסט ההערה");
		expect(reopenedHtml).toContain("תוכן ההערה השנייה");
		expect(reopenedHtml).toContain('data-reference-number="2"');

		/* Saving again reproduces the identical stored form. */
		const restored = saveEditor(second);
		expect(restored).toBe(stored);
	});

	it("keeps a note created in the editor through repeated save cycles", () => {
		const first = openEditor("<p>גוף בלבד</p>");
		first.chain().focus().setTextSelection(2).addFootnote().run();
		const refId = (() => {
			let id: string | undefined;
			first.state.doc.descendants((node) => {
				if (node.type.name === "footnoteReference") {
					id = node.attrs["data-id"] as string;
				}
				return true;
			});
			return id;
		})();
		expect(refId).toBeTruthy();

		first.commands.focusFootnote(refId as string);
		first.commands.insertContent("הערה חדשה עם תוכן מלא");

		const storedOnce = saveEditor(first);
		expect(storedOnce).not.toContain("undefined");
		expect(footnoteBodies(parse(storedOnce))).toEqual([
			"הערה חדשה עם תוכן מלא",
		]);

		const second = openEditor(storedOnce);
		second.chain().focus().setTextSelection(1).insertContent("עריכה").run();
		const storedTwice = saveEditor(second);
		expect(storedTwice).not.toContain("undefined");
		const twiceDoc = parse(storedTwice);
		expect(footnoteBodies(twiceDoc)).toEqual(["הערה חדשה עם תוכן מלא"]);
		/* One generated return link per footnote — they must not pile up. */
		expect(twiceDoc.querySelectorAll("a.footnote-backref")).toHaveLength(1);
		expect(
			twiceDoc.querySelector("a.footnote-backref")?.getAttribute("href"),
		).toBe("#fnref:1");

		const third = openEditor(storedTwice);
		expect(third.getHTML()).toContain("הערה חדשה עם תוכן מלא");
		expect(saveEditor(third)).toBe(storedTwice);
	});

	it("keeps content migrated from the legacy #note- markup", () => {
		const legacy =
			'<p>הכתוב אומר<sup><a href="#note-1" id="noteref-1">א</a></sup>.</p>' +
			"<hr><h2>הערות</h2>" +
			'<ol><li id="note-1"><sup>א</sup> שמות לג יא <a href="#noteref-1">↩</a></li></ol>';

		const first = openEditor(legacy);
		first.chain().focus().setTextSelection(1).insertContent("קידום ").run();
		const stored = saveEditor(first);
		expect(stored).not.toContain("undefined");
		expect(footnoteBodies(parse(stored))).toEqual(["שמות לג יא"]);

		const second = openEditor(stored);
		expect(second.getHTML()).toContain("שמות לג יא");
		expect(saveEditor(second)).toBe(stored);
	});

	it("keeps a shared footnote while one of its references remains", () => {
		const shared =
			'<p>אזכור ראשון<sup id="fnref:1"><a class="footnote-ref" data-id="shared-note" data-reference-number="1" href="#fn:1">א</a></sup></p>' +
			'<p>אזכור שני<sup><a class="footnote-ref" data-id="shared-note" data-reference-number="1" href="#fn:1">א</a></sup></p>' +
			'<ol class="footnotes">' +
			'<li id="fn:1" data-id="shared-note"><p>הערה משותפת</p></li>' +
			"</ol>";

		const editor = openEditor(shared);
		expect(footnoteBodies(parse(editor.getHTML()))).toEqual(["הערה משותפת"]);

		/* jsdom never reports DOM focus, but removal needs a focused editor. */
		vi.spyOn(editor, "isFocused", "get").mockReturnValue(true);

		/* Delete the first reference only — the body must survive. */
		let firstRefPos = -1;
		editor.state.doc.descendants((node, pos) => {
			if (firstRefPos < 0 && node.type.name === "footnoteReference") {
				firstRefPos = pos;
				return false;
			}
			return true;
		});
		editor.chain().setTextSelection(firstRefPos).run();
		expect(removeFootnoteAtSelection(editor)).toBe(true);

		const remaining = parse(saveEditor(editor));
		expect(referenceNumbers(remaining)).toEqual(["1"]);
		expect(footnoteBodies(remaining)).toEqual(["הערה משותפת"]);
	});

	it("drops a footnote when its last reference is removed", () => {
		const editor = openEditor(V3_STORED);
		vi.spyOn(editor, "isFocused", "get").mockReturnValue(true);
		const refPositions: number[] = [];
		editor.state.doc.descendants((node, pos) => {
			if (node.type.name === "footnoteReference") refPositions.push(pos);
			return true;
		});
		expect(refPositions).toHaveLength(2);

		for (const _ of refPositions) {
			let pos = -1;
			editor.state.doc.descendants((node, nodePos) => {
				if (pos < 0 && node.type.name === "footnoteReference") {
					pos = nodePos;
					return false;
				}
				return true;
			});
			editor.chain().setTextSelection(pos).run();
			expect(removeFootnoteAtSelection(editor)).toBe(true);
		}

		const stored = parse(saveEditor(editor));
		expect(stored.querySelector("ol.footnotes")).toBeNull();
		expect(stored.querySelector("a.footnote-ref")).toBeNull();
	});
});
