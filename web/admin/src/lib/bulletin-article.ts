import { type DefaultTreeAdapterTypes, parseFragment } from "parse5";

// Titles, player fallback links and playback labels are not a written article.
const SKIP_TAGS = new Set([
	"audio",
	"video",
	"iframe",
	"embed",
	"object",
	"script",
	"style",
	"template",
	"noscript",
	"svg",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
]);
const BLOCK_TAGS = new Set([
	"p",
	"div",
	"section",
	"article",
	"li",
	"blockquote",
	"td",
	"th",
	"tr",
	"figcaption",
	"br",
	"hr",
]);
const MEDIA_PATH =
	/\.(?:mp3|mp4|m4a|m4v|wav|ogg|oga|ogv|opus|webm|mov|m3u8|pdf)$/i;
const MEDIA_HOST =
	/(?:^|\.)(?:youtube\.com|youtube-nocookie\.com|youtu\.be|vimeo\.com)$/i;
const PLAYBACK_ACTIONS = new Set([
	"לצפייה",
	"לצפיה",
	"צפייה",
	"צפיה",
	"להאזנה",
	"האזנה",
	"לשמיעה",
	"שמיעה",
	"להאזין",
	"לשמוע",
	"לצפות",
	"watch",
	"listen",
	"play",
	"view",
	"download",
]);
const PLAYBACK_QUALIFIERS = new Set([
	"לשיעור",
	"בשיעור",
	"השיעור",
	"לסרטון",
	"בסרטון",
	"הסרטון",
	"להקלטה",
	"בהקלטה",
	"ההקלטה",
	"לפרק",
	"בפרק",
	"הפרק",
	"המלא",
	"המלאה",
	"השלם",
	"השלמה",
	"לחצו",
	"לחץ",
	"כאן",
	"על",
	"הקישור",
	"בקישור",
	"הבא",
	"הבאה",
	"או",
	"בלבד",
	"ניתן",
	"אפשר",
	"את",
	"to",
	"the",
	"full",
	"video",
	"audio",
	"lesson",
	"recording",
	"click",
	"here",
	"or",
	"and",
]);

function isPlaybackCaption(text: string): boolean {
	const words = text.split(" ");
	return (
		words.some((word) => PLAYBACK_ACTIONS.has(word)) &&
		words.every(
			(word) => PLAYBACK_ACTIONS.has(word) || PLAYBACK_QUALIFIERS.has(word),
		)
	);
}

function isMediaLink(href: string): boolean {
	const url = URL.parse(href, "https://bulletin.invalid");
	return (
		url !== null &&
		(MEDIA_PATH.test(url.pathname) || MEDIA_HOST.test(url.hostname))
	);
}

function bodyText(node: DefaultTreeAdapterTypes.Node): string {
	if ("tagName" in node) {
		if (
			SKIP_TAGS.has(node.tagName) ||
			node.attrs.some((a) => a.name === "hidden")
		)
			return "";
		if (
			node.tagName === "a" &&
			isMediaLink(node.attrs.find((a) => a.name === "href")?.value ?? "")
		)
			return "";
	}
	if ("value" in node) return node.value;
	if (!("childNodes" in node)) return "";
	return (
		node.childNodes.map(bodyText).join("") +
		("tagName" in node && BLOCK_TAGS.has(node.tagName) ? "\n" : "")
	);
}

function normalize(text: string): string {
	return text
		.normalize("NFKC")
		.replace(/\p{M}/gu, "")
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.trim()
		.toLowerCase();
}

/** Examines printable prose only; stored HTML and author eligibility are unchanged. */
export function hasBulletinArticleText(
	html: string | null,
	title = "",
): boolean {
	if (!html?.trim()) return false;
	const normalizedTitle = normalize(title);
	return bodyText(parseFragment(html))
		.split("\n")
		.some((part) => {
			const text = normalize(part);
			return (
				/\p{L}/u.test(text) &&
				text !== normalizedTitle &&
				!isPlaybackCaption(text) &&
				!/^באדיבות(?: |$)|^כל הזכויות שמורות(?: |$)/u.test(text)
			);
		});
}
