/**
 * HTML → safe snippet for Tanahpedia hover preview API.
 */

export function toPreviewHtml(html: string): string {
	return (
		html
			.replace(/\\n/g, "")
			.replace(/\r?\n/g, "")
			.replace(/<sup[^>]*>.*?<\/sup>/gi, "")
			.replace(/<hr\s*\/?>/gi, "")
			.replace(/<(h[2-4])\s[^>]*>/gi, "<$1>")
			.replace(/<h[2-4]>\s*<\/h[2-4]>/gi, "")
			.replace(/<p[^>]*>(.*?)<\/p>/gi, "$1<br>")
			.replace(/<(?!\/?(?:h[2-4]|br)\b)[^>]+>/gi, "")
			.replace(/&nbsp;/g, " ")
			.replace(/[ \t]+/g, " ")
			.replace(/(<br\s*\/?\s*>\s*){2,}/gi, "<br>")
			.replace(/<br\s*\/?\s*>(\s*<h[2-4]>)/gi, "$1")
			.replace(/(<\/h[2-4]>)\s*<br\s*\/?\s*>/gi, "$1")
			.replace(/^(\s|<br\s*\/?\s*>)+/, "")
			.replace(/(\s|<br\s*\/?\s*>)+$/, "")
	);
}

const ELLIPSIS = "…";

/**
 * Truncate `snippet` so visible text (ignoring HTML tags) is at most `maxLen` chars.
 * Appends ellipsis and closes a dangling `<h2>`–`<h4>` if needed.
 */
export function truncatePreviewSnippet(
	snippet: string,
	maxLen: number,
): string {
	const textOnly = snippet.replace(/<[^>]+>/g, "");
	if (textOnly.length <= maxLen) return snippet;

	let textLen = 0;
	let cutIdx = 0;
	for (let i = 0; i < snippet.length; i++) {
		if (snippet[i] === "<") {
			const close = snippet.indexOf(">", i);
			if (close !== -1) {
				i = close;
				continue;
			}
		}
		textLen++;
		if (textLen >= maxLen) {
			cutIdx = i + 1;
			break;
		}
	}
	if (cutIdx <= 0) return snippet;

	let out = `${snippet.slice(0, cutIdx)}${ELLIPSIS}`;
	const openH = out.match(/<h[2-4]>(?![\s\S]*<\/h[2-4]>)/i);
	if (openH) {
		const tag = openH[0].replace("<", "</").replace(">", "");
		out += `${tag}>`;
	}
	return out;
}
