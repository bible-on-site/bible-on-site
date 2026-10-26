/**
 * @jest-environment jsdom
 */
import {
	hebrewNumeral,
	normalizeFootnoteHtml,
} from "@/lib/tanahpedia/normalize-footnotes";

/*
 * Fixtures mirror the markup generations stored in production. LEGACY_SUP_LIST
 * is trimmed from the seeded entry HTML (prod-synced), LEGACY_BARE from the
 * live entry HTML of יהושע בן נון / משה רבנו after they were re-saved by the
 * previous editor — the generation that shows "1. א" duplicated markers.
 */

/* literal sup markers inside an unnumbered ol (`list-style:none` inline). */
const LEGACY_SUP_LIST = `
<p>גדול היה<a href="#x">קישור</a> ואחריו<sup><a href="#note-1" id="noteref-1">א</a></sup>.</p>
<hr>
<h2>הערות</h2>
<ol style="list-style:none;padding:0;">
<li id="note-1"><sup>א</sup> שמות ב י <a href="#noteref-1">↩</a></li>
<li id="note-2"><sup>ב</sup> חזקוני שמות ב י <a href="#noteref-2">↩</a></li>
</ol>`;

/* Verbatim production shape (live משה רבנו / יהושע בן נון): bare ref anchors
   (`data-link-type="comment"`, no sup) and a plain ol whose li's carry the
   letter inline with no id — only the ↩ href ties a body to its reference.
   The browser renders this as decimal marker + baked letter: the regression. */
const LEGACY_BARE = `
<p>ומדבר עמו כאדם המדבר עם חברו<a href="#note-54" data-link-type="comment">נד</a>.</p>
<p>עוד דבר<a href="#note-1" data-link-type="comment">א</a>.</p>
<hr>
<h2>הערות</h2>
<ol>
<li><p>א שמות ב י <a href="#noteref-1" data-link-type="comment">↩</a></p></li>
<li><p>נד מדרש הגדול שמות ב י <a href="#noteref-54" data-link-type="comment">↩</a></p></li>
</ol>`;

/* Oldest generation: paragraph bodies with a bold marker, no list at all. */
const LEGACY_PARAGRAPHS = `
<p>טקסט<sup><a href="#note-1" id="noteref-1">א</a></sup></p>
<h2>הערות</h2>
<p id="note-1"><strong>א.</strong> גופה של הערה</p>`;

/* Current generation, as the admin migration emits on save. */
const CANONICAL = `
<p>טקסט<sup id="fnref:1"><a class="footnote-ref" data-id="u1" data-reference-number="1" href="#fn:1" role="doc-noteref">א</a></sup></p>
<ol class="footnotes"><li id="fn:1" data-id="u1"><p>גופה של הערה<a class="footnote-backref" href="#fnref:1" role="doc-backlink" aria-label="חזרה לאזכור א">↩</a></p></li></ol>`;

function parse(html: string): Document {
	return new DOMParser().parseFromString(html, "text/html");
}

describe("hebrewNumeral", () => {
	it("renders single and multi-letter values without gereshim", () => {
		expect(hebrewNumeral(1)).toBe("א");
		expect(hebrewNumeral(10)).toBe("י");
		expect(hebrewNumeral(11)).toBe("יא");
		expect(hebrewNumeral(15)).toBe("טו");
		expect(hebrewNumeral(16)).toBe("טז");
		expect(hebrewNumeral(54)).toBe("נד");
		expect(hebrewNumeral(124)).toBe("קכד");
		expect(hebrewNumeral(465)).toBe("תסה");
	});

	it("falls back to א for non-positive or non-finite input", () => {
		expect(hebrewNumeral(0)).toBe("א");
		expect(hebrewNumeral(-7)).toBe("א");
		expect(hebrewNumeral(Number.NaN)).toBe("א");
	});
});

describe("normalizeFootnoteHtml", () => {
	it("returns content without footnotes unchanged", () => {
		const html = "<p>טקסט רגיל</p><ol><li>אחד</li><li>שניים</li></ol>";
		expect(normalizeFootnoteHtml(html)).toBe(html);
	});

	it("canonicalizes the literal-sup list generation", () => {
		const out = normalizeFootnoteHtml(LEGACY_SUP_LIST);
		const doc = parse(out);
		const list = doc.querySelector("ol.footnotes");
		expect(list).not.toBeNull();
		const items = list?.querySelectorAll(":scope > li") ?? [];
		expect(items).toHaveLength(2);
		expect(items[0].id).toBe("fn:1");
		expect(items[1].id).toBe("fn:2");
		/* The marker is carried in data-marker so the CSS pseudo-element (and
		   platform renderers) show the note's own number. */
		expect(items[0].getAttribute("data-marker")).toBe("א");
		expect(items[1].getAttribute("data-marker")).toBe("ב");
		/* The literal marker is gone — the single visible marker now comes
		   from the CSS pseudo-element, not stored text. */
		expect(items[0].querySelector("sup")).toBeNull();
		expect(items[0].textContent?.trim()).toMatch(/^שמות/);
		/* Ref canonicalized: sup wrapper keeps a unique fnref id; the marker
		   is a generated attribute + accessible label, not text. */
		const ref = doc.querySelector("sup#fnref\\:1 a.footnote-ref");
		expect(ref?.getAttribute("href")).toBe("#fn:1");
		expect(ref?.getAttribute("role")).toBe("doc-noteref");
		expect(ref?.getAttribute("data-marker")).toBe("א");
		expect(ref?.getAttribute("aria-label")).toBe("הערה א");
		expect(ref?.textContent).toBe("");
		/* Canonical jump-back link: the glyph is generated, not text. */
		const back = items[0].querySelector("a.footnote-backref");
		expect(back?.getAttribute("href")).toBe("#fnref:1");
		expect(back?.getAttribute("role")).toBe("doc-backlink");
		expect(back?.getAttribute("aria-label")).toBe("חזרה לאזכור א");
		expect(back?.textContent).toBe("");
	});

	it("canonicalizes the bare-anchor generation and repairs both link directions", () => {
		const out = normalizeFootnoteHtml(LEGACY_BARE);
		const doc = parse(out);
		/* Refs gain the sup wrapper, role, class and canonical target. */
		const ref54 = doc.querySelector('a[href="#fn\\:54"]');
		expect(ref54).not.toBeNull();
		expect(ref54?.parentElement?.tagName).toBe("SUP");
		expect(ref54?.parentElement?.id).toBe("fnref:54");
		expect(ref54?.getAttribute("role")).toBe("doc-noteref");
		expect(ref54?.getAttribute("data-marker")).toBe("נד");
		expect(ref54?.textContent).toBe("");
		/* Bodies get fn ids even though the stored li had none. */
		const note54 = doc.getElementById("fn:54");
		expect(note54).not.toBeNull();
		expect(note54?.getAttribute("data-marker")).toBe("נד");
		expect(note54?.textContent).toContain("מדרש הגדול");
		/* The inline letter (נד) was stripped — the CSS counter supplies it. */
		expect(note54?.querySelector("p")?.textContent?.trim()).toMatch(/^מדרש/);
		/* Jump-back targets the real ref id. */
		expect(
			note54?.querySelector("a.footnote-backref")?.getAttribute("href"),
		).toBe("#fnref:54");
		/* The legacy wrapper list is gone — the canonical list replaces it
		   wholesale instead of nesting inside a leftover li. */
		const lists = doc.querySelectorAll("ol");
		expect(lists).toHaveLength(1);
		expect(lists[0].classList.contains("footnotes")).toBe(true);
		expect(note54?.parentElement).toBe(lists[0]);
	});

	it("keeps the markers out of extracted prose", () => {
		const doc = parse(normalizeFootnoteHtml(LEGACY_BARE));
		/* The prose reads straight through: no stray letter token where the
		   reference marker used to sit, and no literal ↩ in the notes. */
		expect(doc.querySelector("p")?.textContent).toMatch(/עם חברו\.$/);
		expect(doc.querySelector("p")?.textContent).not.toContain("נד");
		const noteText = doc.getElementById("fn:54")?.textContent ?? "";
		expect(noteText).not.toContain("↩");
		expect(noteText).toMatch(/^מדרש הגדול/);
	});

	it("canonicalizes the paragraph-body generation", () => {
		const out = normalizeFootnoteHtml(LEGACY_PARAGRAPHS);
		const doc = parse(out);
		const item = doc.querySelector("ol.footnotes > li");
		expect(item?.id).toBe("fn:1");
		expect(item?.querySelector("strong")).toBeNull();
		expect(item?.textContent?.trim()).toMatch(/^גופה/);
	});

	it("is idempotent on canonical markup", () => {
		const once = normalizeFootnoteHtml(CANONICAL);
		const twice = normalizeFootnoteHtml(once);
		const doc = parse(twice);
		expect(doc.querySelectorAll("ol.footnotes > li")).toHaveLength(1);
		const ref = doc.querySelector("sup#fnref\\:1 a.footnote-ref");
		expect(ref).not.toBeNull();
		expect(ref?.getAttribute("data-marker")).toBe("א");
		expect(ref?.textContent).toBe("");
		const back = doc.querySelector("ol.footnotes a.footnote-backref");
		expect(back?.getAttribute("href")).toBe("#fnref:1");
		expect(back?.textContent).toBe("");
		/* No literal marker crept back in. */
		expect(doc.querySelector("ol.footnotes li")?.textContent?.trim()).toMatch(
			/^גופה/,
		);
	});

	it("maps repeated references to one note with unique ref ids", () => {
		const html = `
<p>אחד<sup><a href="#note-1" id="noteref-1a">א</a></sup> ושוב<sup><a href="#note-1" id="noteref-1b">א</a></sup></p>
<ol style="list-style:none"><li id="note-1"><sup>א</sup> הערה <a href="#noteref-1a">↩</a></li></ol>`;
		const doc = parse(normalizeFootnoteHtml(html));
		const refIds = Array.from(doc.querySelectorAll("sup[id]")).map((s) => s.id);
		expect(new Set(refIds).size).toBe(2);
		expect(doc.querySelectorAll('a[href="#fn\\:1"]')).toHaveLength(2);
		/* Both references display the note's own letter. */
		for (const ref of Array.from(doc.querySelectorAll("a.footnote-ref"))) {
			expect(ref.getAttribute("data-marker")).toBe("א");
		}
		const back = doc.querySelector("ol.footnotes a.footnote-backref");
		expect(refIds).toContain(back?.getAttribute("href")?.slice(1));
	});

	it("keeps ordinary numbered lists and prose starting with a Hebrew letter", () => {
		const html = `
<p>טקסט<sup><a href="#note-1" id="noteref-1">א</a></sup></p>
<ol><li>אחת שתיים שלוש</li><li>עוד פריט</li></ol>
<ol style="list-style:none"><li id="note-1"><sup>א</sup> אוהב את התורה</li></ol>`;
		const doc = parse(normalizeFootnoteHtml(html));
		const lists = doc.querySelectorAll("ol");
		/* Two lists: the ordinary one untouched, the notes one canonical. */
		expect(lists).toHaveLength(2);
		const ordinary = doc.querySelector("ol:not(.footnotes)");
		expect(ordinary?.querySelectorAll("li")).toHaveLength(2);
		expect(ordinary?.textContent).toContain("אחת שתיים שלוש");
		/* 'אוהב' is prose, not the marker 'א' — only the sup letter is stripped. */
		const note = doc.getElementById("fn:1");
		expect(note?.textContent?.trim()).toMatch(/^אוהב/);
	});

	it("does not strip a leading word whose letters merely share a prefix", () => {
		const html = `
<ol style="list-style:none"><li id="note-1"><sup>א</sup> טקסט אמיתי</li></ol>`;
		const doc = parse(normalizeFootnoteHtml(html));
		expect(doc.getElementById("fn:1")?.textContent?.trim()).toMatch(/^טקסט/);
	});

	it("carries the note's own number in data-marker for sparse numbering", () => {
		/* A lone note 54 must display נד — not its list position א. */
		const html = `<p>טקסט<a href="#note-54">נד</a></p>
<ol><li><p>נד מדרש הגדול <a href="#noteref-54">↩</a></p></li></ol>`;
		const doc = parse(normalizeFootnoteHtml(html));
		const item = doc.querySelector("ol.footnotes > li");
		expect(item?.id).toBe("fn:54");
		expect(item?.getAttribute("data-marker")).toBe("נד");
	});

	it("canonicalizes refs written as bare anchors without ids", () => {
		const html = `<p>גדול היה<a href="#note-2">ב</a>.</p>
<ol><li><p>א משהו <a href="#noteref-2">↩</a></p></li></ol>`;
		const doc = parse(normalizeFootnoteHtml(html));
		const ref = doc.querySelector("sup#fnref\\:2 a.footnote-ref");
		expect(ref?.getAttribute("href")).toBe("#fn:2");
		expect(doc.getElementById("fn:2")).not.toBeNull();
	});

	it("replaces the hand-made הערות section furniture", () => {
		const doc = parse(normalizeFootnoteHtml(LEGACY_SUP_LIST));
		/* hr + heading are gone — the canonical list's generated label and
		   border-top replace them, so all generations render identically. */
		expect(doc.querySelector("hr")).toBeNull();
		expect(doc.querySelector("h2")).toBeNull();
		expect(doc.querySelector("ol.footnotes")).not.toBeNull();
	});

	it("keeps real content between the heading and the notes", () => {
		const html = `<p>גוף<sup><a href="#note-1" id="noteref-1">א</a></sup></p>
<hr>
<h2>הערות</h2>
<p>מבוא אמיתי לרשימה</p>
<ol style="list-style:none"><li id="note-1"><sup>א</sup> הערה</li></ol>`;
		const doc = parse(normalizeFootnoteHtml(html));
		/* The paragraph sits between heading and list — the section is real
		   authored content, not furniture, so nothing is removed. */
		expect(doc.querySelector("h2")?.textContent).toBe("הערות");
		expect(doc.body.textContent).toContain("מבוא אמיתי לרשימה");
		expect(doc.querySelector("ol.footnotes > li")?.id).toBe("fn:1");
	});

	it("retargets cross-note links to the canonical ids", () => {
		const html = `<p>גוף<sup><a href="#note-1" id="noteref-1">א</a></sup></p>
<ol style="list-style:none">
<li id="note-1"><sup>א</sup> ראה גם <a href="#note-2">הערה ב</a> <a href="#noteref-1">↩</a></li>
<li id="note-2"><sup>ב</sup> הערה שנייה <a href="#noteref-2">↩</a></li>
</ol>`;
		const doc = parse(normalizeFootnoteHtml(html));
		const cross = doc
			.getElementById("fn:1")
			?.querySelector('a[href="#fn\\:2"]');
		expect(cross).not.toBeNull();
		expect(cross?.textContent).toBe("הערה ב");
		/* It is a real content link, not a generated marker. */
		expect(cross?.getAttribute("role")).toBeNull();
		expect(cross?.parentElement?.tagName).not.toBe("SUP");
	});

	it("adds no backref to a note nobody references", () => {
		const html = `<p>גוף<sup><a href="#note-1" id="noteref-1">א</a></sup></p>
<ol style="list-style:none">
<li id="note-1"><sup>א</sup> הערה מקושרת <a href="#noteref-1">↩</a></li>
<li id="note-2"><sup>ב</sup> הערה יתומה <a href="#noteref-2">↩</a></li>
</ol>`;
		const doc = parse(normalizeFootnoteHtml(html));
		expect(
			doc.getElementById("fn:1")?.querySelector("a.footnote-backref"),
		).not.toBeNull();
		/* A link to a nonexistent fnref:2 would be a dead fragment. */
		expect(
			doc.getElementById("fn:2")?.querySelector("a.footnote-backref"),
		).toBeNull();
	});

	it("processes a body reachable under two numbers only once", () => {
		/* li#note-1 holds a backlink to #noteref-2 — the same element is
		   discovered as body 1 (by id) and body 2 (by backref). */
		const html = `<p>גוף<sup><a href="#note-1" id="noteref-1">א</a></sup></p>
<ol><li id="note-1"><sup>א</sup> הערה <a href="#noteref-2">↩</a></li></ol>`;
		const doc = parse(normalizeFootnoteHtml(html));
		const items = doc.querySelectorAll("ol.footnotes > li");
		expect(items).toHaveLength(1);
		expect(items[0].id).toBe("fn:1");
		expect(items[0].getAttribute("data-marker")).toBe("א");
	});

	it("returns empty input unchanged", () => {
		expect(normalizeFootnoteHtml("")).toBe("");
	});

	it("appends the backref after the note, never inside a trailing inline element", () => {
		/* The body's trailing <sup>*</sup> is authored content, not the marker —
		   so it survives; the jump-back link must sit on the item, not inside
		   that sup where the glyph would render super-scripted. */
		const html = `<p>גוף<sup><a href="#note-1" id="noteref-1">א</a></sup></p>
<ol><li id="note-1"><sup>א</sup> גוף ההערה <sup>*</sup></li></ol>`;
		const doc = parse(normalizeFootnoteHtml(html));
		const item = doc.getElementById("fn:1");
		expect(item?.querySelector("sup")?.textContent).toBe("*");
		const back = item?.querySelector(":scope > a.footnote-backref");
		expect(back).not.toBeNull();
		expect(back?.parentElement).toBe(item);
	});

	it("appends the backref into the last paragraph block when present", () => {
		const html = `<p>גוף<sup><a href="#note-1" id="noteref-1">א</a></sup></p>
<ol><li id="note-1"><p><sup>א</sup> חלק ראשון</p><p>חלק שני</p></li></ol>`;
		const doc = parse(normalizeFootnoteHtml(html));
		const paragraphs = doc.getElementById("fn:1")?.querySelectorAll(":scope > p");
		const back = paragraphs?.[1]?.querySelector("a.footnote-backref");
		expect(back).not.toBeNull();
		/* Not in the first paragraph. */
		expect(paragraphs?.[0]?.querySelector("a.footnote-backref")).toBeNull();
	});

	it("leaves a reference to a missing note as a plain link", () => {
		/* With no note body present there is nothing to link or display —
		   the anchor keeps its original shape rather than pointing at a
		   fragment that does not exist. */
		const html = `<p>גוף<a href="#note-3">ג</a></p>`;
		const doc = parse(normalizeFootnoteHtml(html));
		const anchor = doc.querySelector('a[href="#note-3"]');
		expect(anchor).not.toBeNull();
		expect(anchor?.getAttribute("role")).toBeNull();
		expect(doc.querySelector("sup")).toBeNull();
	});

	it("replaces a <ul> note container wholesale like an <ol>", () => {
		const html = `<p>גוף<sup><a href="#note-1" id="noteref-1">א</a></sup></p>
<ul><li id="note-1"><sup>א</sup> הערה</li></ul>`;
		const doc = parse(normalizeFootnoteHtml(html));
		const lists = doc.querySelectorAll("ul, ol");
		expect(lists).toHaveLength(1);
		expect(lists[0].tagName).toBe("OL");
		expect(lists[0].classList.contains("footnotes")).toBe(true);
		expect(doc.getElementById("fn:1")?.textContent?.trim()).toBe("הערה");
	});

	it("anchors the canonical list before a note item stored outside a list", () => {
		/* Degenerate markup: an <li> whose parent is not a list. The list is
		   still inserted where the item sat. */
		const html = `<p>גוף<sup><a href="#note-1" id="noteref-1">א</a></sup></p>
<div><li id="note-1"><sup>א</sup> הערה</li></div>`;
		const doc = parse(normalizeFootnoteHtml(html));
		const list = doc.querySelector("ol.footnotes");
		expect(list?.parentElement?.tagName).toBe("DIV");
		expect(list?.querySelector("li")?.id).toBe("fn:1");
	});

	it("replaces a list container that holds a paragraph-form note", () => {
		/* Degenerate markup: <p> nested directly inside <ul>. The canonical
		   list replaces the whole ul, not just the paragraph. */
		const html = `<p>גוף<sup><a href="#note-1" id="noteref-1">א</a></sup></p>
<ul><p id="note-1"><strong>א.</strong> הערה</p></ul>`;
		const doc = parse(normalizeFootnoteHtml(html));
		const lists = doc.querySelectorAll("ul, ol");
		expect(lists).toHaveLength(1);
		expect(lists[0].tagName).toBe("OL");
		expect(doc.getElementById("fn:1")?.textContent?.trim()).toBe("הערה");
	});

	it("registers a bare-paragraph body through its legacy backlink", () => {
		/* A paragraph with no id is still a note when a #noteref-N link sits
		   inside it — closest('p') resolves the body. */
		const html = `<p>גוף<sup><a href="#note-7" id="noteref-7">ז</a></sup></p>
<p>ז הערה שביעית <a href="#noteref-7">↩</a></p>`;
		const doc = parse(normalizeFootnoteHtml(html));
		const item = doc.getElementById("fn:7");
		expect(item).not.toBeNull();
		expect(item?.getAttribute("data-marker")).toBe("ז");
		expect(item?.textContent?.trim()).toMatch(/^הערה שביעית/);
	});

	it("keeps a heading that does not read הערות", () => {
		const html = `<p>גוף<sup><a href="#note-1" id="noteref-1">א</a></sup></p>
<h3>מבוא אחר</h3>
<ol style="list-style:none"><li id="note-1"><sup>א</sup> הערה</li></ol>`;
		const doc = parse(normalizeFootnoteHtml(html));
		expect(doc.querySelector("h3")?.textContent).toBe("מבוא אחר");
		expect(doc.querySelector("ol.footnotes")).not.toBeNull();
	});

	it("keeps authored text directly before the notes list", () => {
		const html = `<p>גוף<sup><a href="#note-1" id="noteref-1">א</a></sup></p>
<h2>הערות</h2>
שורת מבוא
<ol style="list-style:none"><li id="note-1"><sup>א</sup> הערה</li></ol>`;
		const doc = parse(normalizeFootnoteHtml(html));
		expect(doc.body.textContent).toContain("שורת מבוא");
		expect(doc.querySelector("h2")).not.toBeNull();
	});

	it("keeps a leading inline element that is not the marker", () => {
		/* <sup>*</sup> is authored content — stripping must not touch it. */
		const html = `<p>גוף<sup><a href="#note-1" id="noteref-1">א</a></sup></p>
<ol><li id="note-1"><sup>*</sup> תוכן ההערה</li></ol>`;
		const doc = parse(normalizeFootnoteHtml(html));
		const item = doc.getElementById("fn:1");
		expect(item?.querySelector("sup")?.textContent).toBe("*");
		expect(item?.textContent).toContain("תוכן ההערה");
	});

	it("keeps a note that begins with a non-marker element", () => {
		const html = `<p>גוף<sup><a href="#note-1" id="noteref-1">א</a></sup></p>
<ol><li id="note-1"><em>הדגשה</em> שאר ההערה</li></ol>`;
		const doc = parse(normalizeFootnoteHtml(html));
		const item = doc.getElementById("fn:1");
		expect(item?.querySelector("em")?.textContent).toBe("הדגשה");
		expect(item?.textContent).toContain("שאר ההערה");
	});

	it("keeps a note whose first word exceeds the marker length", () => {
		/* 'שלוםעולם' is one long word — it cannot be the marker 'א'. */
		const html = `<p>גוף<sup><a href="#note-1" id="noteref-1">א</a></sup></p>
<ol><li id="note-1">שלוםעולם תוכן</li></ol>`;
		const doc = parse(normalizeFootnoteHtml(html));
		expect(doc.getElementById("fn:1")?.textContent?.trim()).toMatch(
			/^שלוםעולם/,
		);
	});

	it("keeps a leading letter that differs from the note's marker", () => {
		/* Note 2 begins with the letter א — it is prose, not marker ב. */
		const html = `<p>גוף<sup><a href="#note-2" id="noteref-2">ב</a></sup></p>
<ol><li id="note-2">א מתחילה בהערה</li></ol>`;
		const doc = parse(normalizeFootnoteHtml(html));
		expect(doc.getElementById("fn:2")?.textContent?.trim()).toMatch(
			/^א מתחילה/,
		);
	});

	it("normalizes an orphaned canonical list without rewriting the html", () => {
		/* An empty ol.footnotes with no bodies or refs stays in place. */
		const html = `<p>טקסט</p><ol class="footnotes"></ol>`;
		const out = normalizeFootnoteHtml(html);
		expect(out).toContain('class="footnotes"');
		expect(parse(out).querySelectorAll("ol.footnotes > li")).toHaveLength(0);
	});

	it("leaves ordinary links untouched among footnote markup", () => {
		/* A link whose href matches no footnote pattern must keep its target
		   and text — only real references get rewritten. */
		const doc = parse(normalizeFootnoteHtml(LEGACY_SUP_LIST));
		const ordinary = doc.querySelector('a[href="#x"]');
		expect(ordinary).not.toBeNull();
		expect(ordinary?.textContent).toBe("קישור");
		expect(ordinary?.getAttribute("role")).toBeNull();
		expect(ordinary?.getAttribute("data-marker")).toBeNull();
	});

	it("places the canonical list once for multiple paragraph-form notes", () => {
		/* The second paragraph body joins the same list rather than trying
		   to anchor a new one. */
		const html = `<p>טקסט<sup><a href="#note-1" id="noteref-1">א</a></sup></p>
<p id="note-1"><strong>א.</strong> הערה ראשונה</p>
<p id="note-2"><strong>ב.</strong> הערה שנייה</p>`;
		const doc = parse(normalizeFootnoteHtml(html));
		const lists = doc.querySelectorAll("ol.footnotes");
		expect(lists).toHaveLength(1);
		const items = lists[0].querySelectorAll(":scope > li");
		expect(items).toHaveLength(2);
		expect(items[0].id).toBe("fn:1");
		expect(items[1].id).toBe("fn:2");
	});
});
