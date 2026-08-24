import { afterEach, describe, expect, it, vi } from "vitest";
import {
	hasLegacyFootnotes,
	migrateLegacyFootnotes,
	toEditorFootnoteHtml,
	toStoredFootnoteHtml,
} from "../../../../src/components/editor/adminFootnoteMigration";

const LEGACY_REF_PARAGRAPH =
	'<p>גוף<sup><a href="#note-1" id="noteref-1">א</a></sup></p>';
const TWO_LEGACY_REFS_PARAGRAPH =
	'<p>גוף<sup><a href="#note-1" id="noteref-1">א</a></sup>ועוד<sup><a href="#note-1" id="noteref-1">א</a></sup></p>';

function parse(html: string): Document {
	return new DOMParser().parseFromString(html, "text/html");
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("hasLegacyFootnotes", () => {
	describe("when the html uses the legacy hand-built markup", () => {
		it("detects a legacy reference anchor", () => {
			expect(hasLegacyFootnotes(LEGACY_REF_PARAGRAPH)).toBe(true);
		});

		it("detects a legacy body paragraph", () => {
			expect(hasLegacyFootnotes('<p id="note-1">טקסט</p>')).toBe(true);
		});
	});

	describe("when the html has no legacy markup", () => {
		it("returns false for plain content", () => {
			expect(hasLegacyFootnotes("<p>גוף ללא הערות</p>")).toBe(false);
		});

		it("returns false for content already using the extension markup", () => {
			const html =
				'<ol class="footnotes"><li id="fn:1" data-id="a"><p>טקסט</p></li></ol>';
			expect(hasLegacyFootnotes(html)).toBe(false);
		});
	});
});

describe("migrateLegacyFootnotes", () => {
	describe("when there is nothing to migrate", () => {
		it("returns the html untouched", () => {
			const html = "<p>גוף ללא הערות</p>";
			expect(migrateLegacyFootnotes(html)).toBe(html);
		});

		it("leaves orphan bodies alone when no reference points at them", () => {
			const html = '<p>גוף</p><p id="note-1"><strong>א.</strong> טקסט</p>';
			expect(migrateLegacyFootnotes(html)).toBe(html);
		});
	});

	describe("when a reference and its body are present", () => {
		const migrated = migrateLegacyFootnotes(
			LEGACY_REF_PARAGRAPH +
				'<p id="note-1"><strong>א.</strong> טקסט ההערה</p>',
		);
		const doc = parse(migrated);

		it("emits the footnote list as a trailing ol.footnotes", () => {
			const list = doc.querySelector("ol.footnotes");
			expect(list).not.toBeNull();
			expect(list?.parentElement?.lastElementChild).toBe(list);
		});

		it("moves the body text into the list item without the legacy marker", () => {
			const item = doc.querySelector("ol.footnotes li#fn\\:1");
			expect(item?.textContent?.trim()).toBe("טקסט ההערה");
			expect(item?.querySelector("strong")).toBeNull();
		});

		it("removes the original body paragraph", () => {
			expect(doc.querySelector("p#note-1")).toBeNull();
		});

		it("rewrites the reference to the extension markup", () => {
			const link = doc.querySelector("sup#fnref\\:1 a.footnote-ref");
			expect(link?.getAttribute("href")).toBe("#fn:1");
			expect(link?.getAttribute("data-reference-number")).toBe("1");
			expect(link?.getAttribute("role")).toBe("doc-noteref");
			expect(link?.textContent).toBe("א");
		});

		it("links the reference and the list item by a shared data-id", () => {
			const refId = doc
				.querySelector("a.footnote-ref")
				?.getAttribute("data-id");
			const itemId = doc
				.querySelector("ol.footnotes li")
				?.getAttribute("data-id");
			expect(refId).toBeTruthy();
			expect(itemId).toBe(refId);
		});
	});

	describe("when references are numbered out of document order", () => {
		const migrated = migrateLegacyFootnotes(
			'<p>א<sup><a href="#note-2" id="noteref-2">ב</a></sup>' +
				'ב<sup><a href="#note-1" id="noteref-1">א</a></sup></p>' +
				'<p id="note-1"><strong>א.</strong> ראשונה</p>' +
				'<p id="note-2"><strong>ב.</strong> שנייה</p>',
		);
		const doc = parse(migrated);

		it("renumbers the references by their position in the text", () => {
			const numbers = Array.from(doc.querySelectorAll("a.footnote-ref")).map(
				(a) => a.getAttribute("data-reference-number"),
			);
			expect(numbers).toEqual(["1", "2"]);
		});

		it("orders the list items to match the renumbered references", () => {
			const texts = Array.from(doc.querySelectorAll("ol.footnotes li")).map(
				(li) => li.textContent?.trim(),
			);
			expect(texts).toEqual(["שנייה", "ראשונה"]);
		});

		it("renders the hebrew letter matching the new position", () => {
			const letters = Array.from(doc.querySelectorAll("a.footnote-ref")).map(
				(a) => a.textContent,
			);
			expect(letters).toEqual(["א", "ב"]);
		});
	});

	describe("when a reference has no matching body", () => {
		it("creates an empty list item for it", () => {
			const migrated = migrateLegacyFootnotes(LEGACY_REF_PARAGRAPH);
			const doc = parse(migrated);
			const item = doc.querySelector("ol.footnotes li#fn\\:1");
			expect(item).not.toBeNull();
			expect(item?.textContent).toBe("");
		});
	});

	describe("when browser UUID generation is unavailable", () => {
		it("generates distinct fallback ids", () => {
			vi.stubGlobal("crypto", {});
			const doc = parse(migrateLegacyFootnotes(TWO_LEGACY_REFS_PARAGRAPH));
			const ids = Array.from(doc.querySelectorAll("a.footnote-ref"), (link) =>
				link.getAttribute("data-id"),
			);

			expect(ids).toHaveLength(2);
			expect(ids[0]).toMatch(/^fn-[a-z0-9]+-\d+$/);
			expect(ids[1]).not.toBe(ids[0]);
		});
	});

	describe("when two references share the same body", () => {
		it("consumes the body only once", () => {
			const migrated = migrateLegacyFootnotes(
				TWO_LEGACY_REFS_PARAGRAPH +
					'<p id="note-1"><strong>א.</strong> טקסט</p>',
			);
			const doc = parse(migrated);
			const texts = Array.from(doc.querySelectorAll("ol.footnotes li")).map(
				(li) => li.textContent?.trim(),
			);
			expect(texts).toEqual(["טקסט", ""]);
		});
	});

	describe("when the body keeps inline markup", () => {
		it("preserves the nested elements", () => {
			const migrated = migrateLegacyFootnotes(
				LEGACY_REF_PARAGRAPH +
					'<p id="note-1"><strong>א.</strong> ראו <em>ספר</em> כאן</p>',
			);
			const doc = parse(migrated);
			const item = doc.querySelector("ol.footnotes li p");
			expect(item?.querySelector("em")?.textContent).toBe("ספר");
			expect(item?.textContent?.trim()).toBe("ראו ספר כאן");
		});
	});

	/** The shape actually stored by the legacy tanahpedia importer. */
	describe("when the entry uses the imported legacy footnote section", () => {
		const legacy =
			'<p>הכתוב אומר<sup><a href="#note-1" id="noteref-1">א</a></sup>.</p>' +
			'<p>ועוד<sup><a href="#note-2" id="noteref-2">ב</a></sup>.</p>' +
			"<hr><h2>הערות</h2>" +
			'<ol style="list-style:none;padding:0;">' +
			'<li id="note-1"><sup>א</sup> שמות לג יא <a href="#noteref-1">↩</a></li>' +
			'<li id="note-2"><sup>ב</sup> בראשית א א <a href="#noteref-2">↩</a></li>' +
			"</ol>";
		const doc = parse(migrateLegacyFootnotes(legacy));

		it("moves each body text into its list item", () => {
			const texts = Array.from(doc.querySelectorAll("ol.footnotes li")).map(
				(li) => li.textContent?.trim(),
			);
			expect(texts).toEqual(["שמות לג יא", "בראשית א א"]);
		});

		it("drops the duplicated marker and the back-link", () => {
			const item = doc.querySelector("ol.footnotes li");
			expect(item?.querySelector("sup")).toBeNull();
			expect(item?.textContent).not.toContain("↩");
		});

		it("removes the legacy footnotes section wrapper", () => {
			expect(doc.querySelector("ol:not(.footnotes)")).toBeNull();
			expect(doc.querySelector("hr")).toBeNull();
			expect(
				Array.from(doc.querySelectorAll("h2")).map((h) => h.textContent),
			).not.toContain("הערות");
		});

		it("keeps the body paragraphs before the footnote list", () => {
			const list = doc.querySelector("ol.footnotes");
			expect(list?.previousElementSibling?.tagName).toBe("P");
		});
	});

	describe("when the legacy section contains formatting whitespace", () => {
		it("removes blank boundary nodes with the old section", () => {
			const legacy =
				LEGACY_REF_PARAGRAPH +
				"<hr>\n<h2>הערות</h2>\n" +
				'<ol><li id="note-1"> \n<strong>א.</strong><em>טקסט</em>   </li></ol>';
			const doc = parse(migrateLegacyFootnotes(legacy));

			expect(doc.querySelector("ol.footnotes li")?.textContent).toBe("טקסט");
			expect(doc.querySelector("hr")).toBeNull();
			expect(doc.querySelector("h2")).toBeNull();
		});
	});

	describe("when an unrelated node precedes an emptied legacy list", () => {
		it("stops section cleanup at that boundary", () => {
			const legacy =
				LEGACY_REF_PARAGRAPH +
				'<h2>הערות</h2>preserve boundary<ol><li id="note-1">טקסט</li></ol>';
			const doc = parse(migrateLegacyFootnotes(legacy));

			expect(doc.querySelector("ol.footnotes li")?.textContent).toBe("טקסט");
			expect(doc.querySelector("h2")?.textContent).toBe("הערות");
		});
	});

	/** Entries re-saved by the previous editor lost the `id="note-N"` anchors. */
	describe("when the bodies were re-saved without their ids", () => {
		const legacy =
			'<p>גוף<a href="#note-49" data-link-type="comment">מט</a>.</p>' +
			'<p>עוד<a href="#note-50" data-link-type="comment">נ</a>.</p>' +
			"<ol>" +
			'<li><p>מט ריש לקיש <a href="#noteref-49" data-link-type="comment">↩</a></p></li>' +
			'<li><p>נ דברים רבה <a href="#noteref-50" data-link-type="comment">↩</a></p></li>' +
			"</ol>";
		const doc = parse(migrateLegacyFootnotes(legacy));

		it("links each body through its back-link", () => {
			const texts = Array.from(doc.querySelectorAll("ol.footnotes li")).map(
				(li) => li.textContent?.trim(),
			);
			expect(texts).toEqual(["ריש לקיש", "דברים רבה"]);
		});

		it("does not nest paragraphs inside the list item", () => {
			expect(doc.querySelector("ol.footnotes li p p")).toBeNull();
		});

		it("keeps a body whose text merely starts with the marker letter", () => {
			const migrated = migrateLegacyFootnotes(
				'<p>גוף<a href="#note-2" data-link-type="comment">ב</a></p>' +
					'<ol><li><p>בראשית א א <a href="#noteref-2">↩</a></p></li></ol>',
			);
			expect(
				parse(migrated).querySelector("ol.footnotes li")?.textContent,
			).toBe("בראשית א א");
		});

                it("resolves a body that is a bare paragraph rather than a list item", () => {
                        const migrated = migrateLegacyFootnotes(
                                '<p>גוף<a href="#note-3" data-link-type="comment">ג</a></p>' +
                                        '<p>ג רשי <a href="#noteref-3">↩</a></p>',
                        );
                        expect(
                                parse(migrated).querySelector("ol.footnotes li")?.textContent,
                        ).toBe("רשי");
                });

                it("renumbers the references from one", () => {
                        const numbers = Array.from(
                                doc.querySelectorAll("a.footnote-ref"),
                        ).map((a) => a.getAttribute("data-reference-number"));
                        expect(numbers).toEqual(["1", "2"]);
                });

                it("removes an emptied legacy ul container too", () => {
                        const migrated = migrateLegacyFootnotes(
                                '<p>גוף<a href="#note-4" data-link-type="comment">ד</a></p>' +
                                        '<ul><li><p>ד במדבר <a href="#noteref-4">↩</a></p></li></ul>',
                        );
                        const doc = parse(migrated);
                        expect(doc.querySelector("ul")).toBeNull();
                        expect(doc.querySelector("ol.footnotes li")?.textContent).toBe(
                                "במדבר",
                        );
                });
        });
});

const STORED = `<p>גוף<sup id="fnref:1"><a class="footnote-ref" data-id="x" data-reference-number="1" href="#fn:1">א</a></sup></p><ol class="footnotes"><li id="fn:1" data-id="x"><p>טקסט</p></li></ol>`;

describe("toStoredFootnoteHtml", () => {
	describe("when the content has footnotes", () => {
		it("appends a link back to the reference", () => {
			const doc = parse(toStoredFootnoteHtml(STORED));
			const back = doc.querySelector("ol.footnotes li a.footnote-backref");
			expect(back?.getAttribute("href")).toBe("#fnref:1");
		});

		it("puts the back-link inside the footnote paragraph", () => {
			const doc = parse(toStoredFootnoteHtml(STORED));
			expect(
				doc.querySelector("ol.footnotes li p a.footnote-backref"),
			).not.toBeNull();
		});

		it("names the back-link for assistive technology", () => {
			const doc = parse(toStoredFootnoteHtml(STORED));
			const back = doc.querySelector("a.footnote-backref");
			expect(back?.getAttribute("role")).toBe("doc-backlink");
			expect(back?.getAttribute("aria-label")).toBe("חזרה לאזכור א");
		});

		it("numbers each back-link by list position", () => {
			const twoItems = STORED.replace(
				"</ol>",
				'<li id="fn:2" data-id="y"><p>שני</p></li></ol>',
			);
			const doc = parse(toStoredFootnoteHtml(twoItems));
			const hrefs = Array.from(doc.querySelectorAll("a.footnote-backref")).map(
				(a) => a.getAttribute("href"),
			);
			expect(hrefs).toEqual(["#fnref:1", "#fnref:2"]);
		});

		it("is idempotent", () => {
			const once = toStoredFootnoteHtml(STORED);
			expect(toStoredFootnoteHtml(once)).toBe(once);
		});
	});

	describe("when the content has no footnotes", () => {
		it("returns the html untouched", () => {
			const html = "<p>גוף בלבד</p>";
			expect(toStoredFootnoteHtml(html)).toBe(html);
		});

		it("returns the html untouched when footnotes is mentioned but no list exists", () => {
			const html = '<p>המילה footnotes בלבד</p>';
			expect(toStoredFootnoteHtml(html)).toBe(html);
		});
	});
});

describe("toEditorFootnoteHtml", () => {
	it("removes generated back-links so they do not pile up", () => {
		const doc = parse(toEditorFootnoteHtml(toStoredFootnoteHtml(STORED)));
		expect(doc.querySelector("a.footnote-backref")).toBeNull();
		expect(doc.querySelector("ol.footnotes li")?.textContent).toBe("טקסט");
	});

	it("round-trips to a stable stored form", () => {
		const stored = toStoredFootnoteHtml(STORED);
		expect(toStoredFootnoteHtml(toEditorFootnoteHtml(stored))).toBe(stored);
	});

	it("still migrates legacy markup", () => {
		const legacy =
			'<p>גוף<sup><a href="#note-1" id="noteref-1">א</a></sup></p>' +
			'<p id="note-1"><strong>א.</strong> טקסט</p>';
		const doc = parse(toEditorFootnoteHtml(legacy));
		expect(doc.querySelector("ol.footnotes li")?.textContent).toBe("טקסט");
	});
});
