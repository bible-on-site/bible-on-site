import { mergeAttributes } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import { Footnote, FootnoteReference, Footnotes } from "tiptap-footnotes";
import { hebrewNumeral } from "./adminHebrew";

const REFNUM_ATTR = "data-reference-number";
const REF_CLASS = "footnote-ref";

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
 *
 * Since tiptap-footnotes v4 the number lives only on `node.attrs`
 * (`referenceNumber` is `rendered: false`), and the parser accepts a `sup`
 * solely when its first child is `a.footnote-ref`. The class, `href` and
 * `data-reference-number` must all be emitted here: a reference serialized
 * without them no longer parses on reopen, and the mount sync then drops its
 * footnote body. A reference with no number yet (just inserted, before the
 * sync assigns one) renders without the derived attributes instead of
 * emitting `undefined`/`NaN` markup.
 */
export const AdminFootnoteReference = FootnoteReference.extend({
	renderHTML({ node, HTMLAttributes }) {
		const number = node.attrs.referenceNumber as string | null;
		const numeric = Number(number);
		return [
			"sup",
			{ id: number ? `fnref:${number}` : undefined },
			[
				"a",
				mergeAttributes(
					{ class: REF_CLASS },
					this.options.HTMLAttributes,
					HTMLAttributes,
					{
						href: number ? `#fn:${number}` : undefined,
						[REFNUM_ATTR]: number ?? undefined,
						role: "doc-noteref",
					},
				),
				number == null
					? ""
					: Number.isFinite(numeric)
						? hebrewNumeral(numeric)
						: number,
			],
		];
	},
});

export const adminFootnoteExtensions = [
	Footnotes,
	Footnote,
	AdminFootnoteReference,
];
