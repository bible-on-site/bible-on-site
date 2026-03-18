import { NextResponse } from "next/server";
import { getEntryByUniqueName } from "@/lib/tanahpedia/service";

/**
 * Sanitise entry HTML for the hover-preview tooltip.
 * Keeps structural tags (headers → `<strong>`, paragraphs → line breaks)
 * and strips everything else (footnotes, links, images, styles, etc.).
 */
function toPreviewHtml(html: string): string {
	return (
		html
			// Normalize literal newlines
			.replace(/\\n/g, "")
			.replace(/\r?\n/g, "")
			// Remove footnote superscripts entirely
			.replace(/<sup[^>]*>.*?<\/sup>/gi, "")
			// Remove <hr> separators
			.replace(/<hr\s*\/?>/gi, "")
			// Strip inline styles from headers but keep the tags
			.replace(/<(h[2-4])\s[^>]*>/gi, "<$1>")
			// Skip empty headers
			.replace(/<h[2-4]>\s*<\/h[2-4]>/gi, "")
			// <p> → content + line break
			.replace(/<p[^>]*>(.*?)<\/p>/gi, "$1<br>")
			// Remove all remaining tags except h2-h4 and br
			.replace(/<(?!\/?(?:h[2-4]|br)\b)[^>]+>/gi, "")
			.replace(/&nbsp;/g, " ")
			// Collapse whitespace runs
			.replace(/[ \t]+/g, " ")
			// Collapse multiple consecutive <br>s into one
			.replace(/(<br\s*\/?\s*>\s*){2,}/gi, "<br>")
			// Remove <br> immediately before a header (block element handles spacing)
			.replace(/<br\s*\/?\s*>(\s*<h[2-4]>)/gi, "$1")
			// Remove <br> immediately after a closing header
			.replace(/(<\/h[2-4]>)\s*<br\s*\/?\s*>/gi, "$1")
			// Trim leading/trailing <br> and whitespace
			.replace(/^(\s|<br\s*\/?\s*>)+/, "")
			.replace(/(\s|<br\s*\/?\s*>)+$/, "")
	);
}

const MAX_SNIPPET_LENGTH = 350;

export async function GET(
	_request: Request,
	{ params }: { params: Promise<{ uniqueName: string }> },
) {
	const { uniqueName } = await params;
	const decoded = decodeURIComponent(uniqueName);
	const entry = await getEntryByUniqueName(decoded);
	if (!entry) {
		return NextResponse.json(null, { status: 404 });
	}
	let snippet = toPreviewHtml(entry.content || "");
	const textOnly = snippet.replace(/<[^>]+>/g, "");
	if (textOnly.length > MAX_SNIPPET_LENGTH) {
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
			if (textLen >= MAX_SNIPPET_LENGTH) {
				cutIdx = i + 1;
				break;
			}
		}
		if (cutIdx > 0) {
			snippet = `${snippet.slice(0, cutIdx)}…`;
			// Close any unclosed header tag
			const openH = snippet.match(/<h[2-4]>(?![\s\S]*<\/h[2-4]>)/i);
			if (openH) {
				const tag = openH[0].replace("<", "</").replace(">", "");
				snippet += `${tag}>`;
			}
		}
	}
	return NextResponse.json({
		title: entry.title,
		snippet,
	});
}
