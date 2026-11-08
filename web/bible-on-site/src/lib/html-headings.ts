/**
 * Database article and perush content is HTML that may embed h1-h6 headings.
 * A page already owns its single h1, so embedded headings are demoted one
 * level (h1→h2 ... h5→h6) before injection — same rationale as
 * `normalizeAbstractHtml` in lib/authors/articles-grid.ts (#2393).
 */
export function demoteHeadings(html: string): string {
	return html.replace(
		/<(\/?)h([1-5])(\s[^>]*)?>/gi,
		(_match, closing, level, rest = "") =>
			`<${closing}h${Number(level) + 1}${rest}>`,
	);
}
