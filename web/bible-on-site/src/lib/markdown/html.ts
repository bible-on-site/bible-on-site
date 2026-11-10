/**
 * Stored article/commentary/encyclopedia HTML → Markdown (issue #3257).
 *
 * Corpus bodies are stored HTML authored for the site; the converter
 * walks the DOM (jsdom — already a server dependency through
 * isomorphic-dompurify) rather than regex-stripping tags, so links,
 * headings, lists, footnotes and media resolve correctly and relative
 * URLs are absolutized against the canonical origin. Sanitizing stays
 * the caller's job (the page's DOMPurify pipeline runs first).
 */
import { JSDOM } from "jsdom";
import { absUrl } from "@/lib/seo/jsonld";

const BLOCK = new Set([
	"p",
	"div",
	"section",
	"article",
	"header",
	"footer",
	"main",
	"figure",
	"figcaption",
	"blockquote",
	"pre",
	"ul",
	"ol",
	"table",
	"tr",
	"dl",
	"form",
	"fieldset",
	"address",
	"aside",
	"nav",
	"details",
	"summary",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"hr",
]);

const SKIP = new Set(["script", "style", "noscript", "template"]);

interface Footnote {
	id: string;
	content: string;
}

interface State {
	footnotes: Map<string, Footnote>;
	/** Inside an `ol.footnotes`/`section.footnotes` list — collect, don't emit. */
	collectingFootnotes: boolean;
}

/** Escape the minimal Markdown-structural characters in text. */
function escapeMd(text: string): string {
	return text
		.replace(/\\/g, "\\\\")
		.replace(/([[\]`*_<])/g, "\\$1");
}

/** Collapse runs of whitespace inside inline text like HTML does. */
function normalizeText(text: string): string {
	return text.replace(/\s+/g, " ");
}

function absolutize(url: string): string {
	const trimmed = url.trim();
	if (
		trimmed === "" ||
		trimmed.startsWith("#") ||
		/^(https?:|mailto:|tel:|data:)/i.test(trimmed)
	) {
		return trimmed;
	}
	if (trimmed.startsWith("//")) return `https:${trimmed}`;
	return absUrl(trimmed.startsWith("/") ? trimmed : `/${trimmed}`);
}

/** `sup`/`a` footnote references (`#fn:1`, `#fnref`-style, role=doc-noteref) → `[^n]`. */
function footnoteRefId(el: Element): string | null {
	const href = el.getAttribute("href");
	const role = el.getAttribute("role");
	if (role === "doc-backlink") return "";
	if (role === "doc-noteref" && href?.startsWith("#")) {
		return href.slice(1).replace(/^(fn|note|footnote)[-:]?/i, "") || href.slice(1);
	}
	if (href && /^#(fn|note|footnote)[-:]?/i.test(href)) {
		return href.slice(1).replace(/^(fn|note|footnote)[-:]?/i, "");
	}
	return null;
}

function isFootnoteList(el: Element): boolean {
	const cls = el.getAttribute("class") ?? "";
	return /\bfootnotes\b/.test(cls) || el.getAttribute("role") === "doc-endnotes";
}

function inlineChildren(el: Element, state: State): string {
	let out = "";
	for (const node of Array.from(el.childNodes)) {
		out += renderInline(node, state);
	}
	return out;
}

function renderInline(node: Node, state: State): string {
	if (node.nodeType === node.TEXT_NODE) {
		/* istanbul ignore next: a text node's textContent is never null */
		return escapeMd(normalizeText(node.textContent ?? ""));
	}
	if (node.nodeType !== node.ELEMENT_NODE) return "";
	const el = node as Element;
	const tag = el.tagName.toLowerCase();
	if (SKIP.has(tag)) return "";

	switch (tag) {
		case "br":
			return "  \n";
		case "strong":
		case "b":
			return `**${inlineChildren(el, state).trim()}**`;
		case "em":
		case "i":
			return `_${inlineChildren(el, state).trim()}_`;
		case "s":
		case "del":
		case "strike":
			return `~~${inlineChildren(el, state).trim()}~~`;
		case "code":
			/* istanbul ignore next: an Element's textContent is never null */
			return `\`${(el.textContent ?? "").trim()}\``;
		case "u":
		case "ins":
		case "mark":
		case "small":
		case "span":
			return inlineChildren(el, state);
		case "sub":
			return `~${inlineChildren(el, state).trim()}~`;
		case "sup": {
			const ref = footnoteRefId(el.querySelector("a") ?? el);
			if (ref !== null && ref !== "") return `[^${ref}]`;
			if (ref === "") return "";
			return `^(${inlineChildren(el, state).trim()})`;
		}
		case "a": {
			const ref = footnoteRefId(el);
			if (ref === "") return "";
			const text = inlineChildren(el, state).trim();
			if (ref !== null) return `[^${ref}]`;
			const href = el.getAttribute("href");
			if (!href) return text;
			const url = absolutize(href);
			return text === "" || text === url ? url : `[${text}](${url})`;
		}
		case "img": {
			const src = el.getAttribute("src");
			if (!src) return "";
			const alt = el.getAttribute("alt") ?? "";
			return `![${alt}](${absolutize(src)})`;
		}
		case "audio":
		case "video": {
			const src =
				el.getAttribute("src") ??
				el.querySelector("source")?.getAttribute("src");
			if (!src) return "";
			const label =
				el.getAttribute("title") ?? el.getAttribute("aria-label") ?? tag;
			return `[${label}](${absolutize(src)})`;
		}
		case "iframe": {
			const src = el.getAttribute("src");
			return src ? absolutize(src) : "";
		}
		case "hr":
			return "\n\n---\n\n";
		default:
			// Unknown inline wrappers keep their children.
			return inlineChildren(el, state);
	}
}

/** List item marker: `1.` for ordered lists (own position), `-` else. */
function listItems(el: Element, state: State, depth: number): string {
	const ordered = el.tagName.toLowerCase() === "ol";
	const start = Number(el.getAttribute("start") ?? "1");
	const indent = "  ".repeat(depth);
	const lines: string[] = [];
	let index = 0;
	for (const child of Array.from(el.children)) {
		if (child.tagName.toLowerCase() !== "li") continue;
		const marker = ordered ? `${start + index}.` : "-";
		index += 1;
		const content = blockChildren(child, state, depth + 1);
		const parts = content.split("\n");
		lines.push(
			`${indent}${marker} ${parts[0]}${parts
				.slice(1)
				.map((line) => (line.trim() === "" ? "" : `${indent}  ${line}`))
				.join("\n")}`
				.trimEnd(),
		);
	}
	return lines.join("\n");
}

function tableMarkdown(el: Element, state: State): string {
	const rows: string[][] = [];
	for (const tr of Array.from(el.querySelectorAll("tr"))) {
		const cells = Array.from(tr.children)
			.filter(
				(c) =>
					c.tagName.toLowerCase() === "td" ||
					c.tagName.toLowerCase() === "th",
			)
			.map((c) => inlineChildren(c, state).trim().replace(/\|/g, "\\|"));
		if (cells.length) rows.push(cells);
	}
	if (rows.length === 0) return "";
	const [header, ...body] = rows;
	const width = header.length;
	const lines = [
		`| ${header.join(" | ")} |`,
		`| ${Array.from({ length: width }, () => "---").join(" | ")} |`,
		...body.map(
			(row) =>
				`| ${Array.from({ length: width }, (_, i) => row[i] ?? "").join(" | ")} |`,
		),
	];
	return lines.join("\n");
}

function blockChildren(el: Element, state: State, depth = 0): string {
	const blocks: string[] = [];
	let inlineRun = "";
	const flush = () => {
		const text = inlineRun.trim();
		if (text !== "") blocks.push(text);
		inlineRun = "";
	};
	for (const node of Array.from(el.childNodes)) {
		if (node.nodeType === node.ELEMENT_NODE) {
			const child = node as Element;
			const tag = child.tagName.toLowerCase();
			if (BLOCK.has(tag)) {
				flush();
				const rendered = renderBlock(child, state, depth);
				if (rendered !== "") blocks.push(rendered);
				continue;
			}
		}
		inlineRun += renderInline(node, state);
	}
	flush();
	return blocks.join("\n\n");
}

function renderBlock(el: Element, state: State, depth: number): string {
	const tag = el.tagName.toLowerCase();
	/* istanbul ignore next: renderBlock only runs for BLOCK tags and no
	 * BLOCK tag is in SKIP — kept as a safety net. */
	if (SKIP.has(tag)) return "";
	if (isFootnoteList(el)) {
		// Collect definitions; emit them once at document end.
		state.collectingFootnotes = true;
		let index = 0;
		for (const li of Array.from(el.children)) {
			if (li.tagName.toLowerCase() !== "li") continue;
			index += 1;
			const id = li.getAttribute("id") ?? String(index);
			const key = id.replace(/^(fn|note|footnote)[-:]?/i, "");
			state.footnotes.set(key, {
				id: key,
				content: blockChildren(li, state, depth).trim(),
			});
		}
		state.collectingFootnotes = false;
		return "";
	}
	switch (tag) {
		case "h1":
		case "h2":
		case "h3":
		case "h4":
		case "h5":
		case "h6": {
			const level = Number(tag.slice(1));
			return `${"#".repeat(level)} ${inlineChildren(el, state).trim()}`;
		}
		case "hr":
			return "---";
		case "ul":
		case "ol":
			return listItems(el, state, depth);
		case "blockquote":
			return blockChildren(el, state, depth)
				.split("\n")
				.map((line) => (line.trim() === "" ? ">" : `> ${line}`))
				.join("\n");
		case "pre": {
			const code = el.querySelector("code");
			const lang =
				code
					?.getAttribute("class")
					?.match(/language-(\w+)/)?.[1] ?? "";
			/* istanbul ignore next: an Element's textContent is never null */
			return `\`\`\`${lang}\n${(el.textContent ?? "").replace(/\n$/, "")}\n\`\`\``;
		}
		case "table":
			return tableMarkdown(el, state);
		case "dl": {
			const lines: string[] = [];
			for (const child of Array.from(el.children)) {
				const ctag = child.tagName.toLowerCase();
				if (ctag === "dt") {
					lines.push(`**${inlineChildren(child, state).trim()}**`);
				} else if (ctag === "dd") {
					lines.push(`: ${blockChildren(child, state, depth).trim()}`);
				}
			}
			return lines.join("\n");
		}
		default:
			return blockChildren(el, state, depth);
	}
}

/**
 * HTML body → Markdown. Footnote references stay `[^n]` anchors and the
 * definitions append at the end. Returns "" for empty/markup-free input.
 */
export function htmlToMarkdown(html: string): string {
	const trimmed = html.trim();
	if (trimmed === "") return "";
	const dom = new JSDOM(`<body>${trimmed}</body>`);
	const body = dom.window.document.body;
	const state: State = { footnotes: new Map(), collectingFootnotes: false };
	const main = blockChildren(body, state).trim();
	const footnoteLines = [...state.footnotes.values()].map(
		(fn) => `[^${fn.id}]: ${fn.content.replace(/\n/g, "\n    ")}`,
	);
	const parts = [main, footnoteLines.join("\n")].filter((p) => p !== "");
	return parts.join("\n\n");
}
