import { mergeAttributes } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import { Footnote, FootnoteReference, Footnotes } from "tiptap-footnotes";
import { hebrewNumeral } from "./adminHebrew";

const REFNUM_ATTR = "data-reference-number";

/**
 * `tiptap-footnotes` keeps the footnote list as a single trailing block, so the
 * document schema has to allow it explicitly (StarterKit's document must be off).
 */
export const AdminFootnoteDocument = Document.extend({
	content: "block+ footnotes?",
});

/**
 * Upstream renders the marker as a decimal number; tanahpedia uses Hebrew
 * letters (א ב ג) so the reference matches the counter of the footnote list.
 * The numeric value stays in `data-reference-number`, which is what the
 * extension parses back, so only the visible glyph changes.
 */
export const AdminFootnoteReference = FootnoteReference.extend({
	renderHTML({ HTMLAttributes }) {
		const { referenceNumber, ...attributes } = HTMLAttributes;
		/* Upstream merges `this.options.HTMLAttributes` here, but the node declares
		   no options, so that read throws once the node is rendered by the schema. */
		const attrs = mergeAttributes(attributes);
		attrs[REFNUM_ATTR] = referenceNumber;
		attrs.role = "doc-noteref";
		return [
			"sup",
			{ id: `fnref:${referenceNumber}` },
			["a", attrs, hebrewNumeral(Number(referenceNumber))],
		];
	},
});

export const adminFootnoteExtensions = [
	Footnotes,
	Footnote,
	AdminFootnoteReference,
];
