/**
 * Tanach PDF generator — beautiful, structured output.
 *
 * Produces a well-formatted PDF with:
 * - Each perek starts on a fresh page
 * - Proper Hebrew text with nikud (Frank Ruhl Libre static font)
 * - Perek title + descriptive header
 * - Available perushim listed per perek
 * - Related article titles per perek
 * - Right-aligned RTL text with page numbers
 *
 * Uses a static-weight font (not variable) so fontkit metrics are accurate.
 * pdf-lib's StandardFonts only support WinAnsi (Latin-1) encoding — any
 * non-Latin text (Hebrew, Arabic, etc.) requires an embedded custom font.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { type PDFFont, PDFDocument, rgb } from "pdf-lib";
// biome-ignore lint/suspicious/noTsIgnore: @ts-expect-error fails in production build (unused directive) so we must use @ts-ignore
// @ts-ignore — @pdf-lib/fontkit is CJS; namespace import may wrap the real instance in .default
import * as _fontkit from "@pdf-lib/fontkit";
// biome-ignore lint/suspicious/noExplicitAny: CJS/ESM interop — unwrap .default when bundler wraps it
const fontkit: any = (_fontkit as any).default ?? _fontkit;

import { toNumber } from "gematry";
import type { Segment } from "@/data/db/tanah-view-types";
import { getPerekByPerekId } from "@/data/perek-dto";
import { getPerekIdsForSefer, getSeferByName } from "@/data/sefer-dto";
import { getArticlesByPerekId } from "@/lib/articles/service";
import { getPerushimByPerekId } from "@/lib/perushim";
import type { SemanticPageInfo } from "./types";

/* ──────────────────────────── Font loading ─────────────────────────── */

let regularFontCache: Uint8Array | null = null;
let boldFontCache: Uint8Array | null = null;

function loadFont(filename: string): Uint8Array {
	const fontPath = resolve(
		process.cwd(),
		"src",
		"lib",
		"download",
		"fonts",
		filename,
	);
	return readFileSync(fontPath);
}

export function getRegularFontBytes(): Uint8Array {
	if (!regularFontCache)
		regularFontCache = loadFont("FrankRuhlLibre-Regular.ttf");
	return regularFontCache;
}

export function getBoldFontBytes(): Uint8Array {
	if (!boldFontCache) boldFontCache = loadFont("FrankRuhlLibre-Bold.ttf");
	return boldFontCache;
}

/* ──────────────────────────── Text helpers ─────────────────────────── */

/**
 * Get plain text from segments (qri/ktiv only; stuma/ptuha as space).
 * Each segment is a single word — join with " " to separate them.
 * Maqaf (U+05BE ־) already connects words; remove extra space after it.
 */
export function segmentsToText(segments: Segment[]): string {
	return segments
		.map((s) => {
			if (s.type === "qri" || s.type === "ktiv") return s.value;
			return " ";
		})
		.join(" ")
		.replace(/־\s+/g, "־")
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * Strip cantillation marks (taamim, U+0591–U+05AF) from Hebrew text.
 * Keeps nikud (vowels, U+05B0–U+05BD), shin/sin dots, letters, maqaf.
 * Taamim have zero advance-width in many fonts and confuse pdf-lib's
 * width measurement, causing garbled layout.
 */
export function stripTaamim(text: string): string {
	return text.replace(/[\u0591-\u05AF]/g, "");
}

/**
 * Reverse grapheme clusters so pdf-lib (which draws LTR) renders
 * Hebrew text in the correct visual RTL order.
 *
 * Uses Intl.Segmenter to keep combining marks (nikud) attached to
 * their base character during reversal.
 */
export function reverseGraphemes(text: string): string {
	const segmenter = new Intl.Segmenter("he", { granularity: "grapheme" });
	return [...segmenter.segment(text)]
		.map((s) => s.segment)
		.reverse()
		.join("");
}

/** Strip HTML tags from a string, decode common entities. */
export function stripHtml(html: string): string {
	let text = html.replace(/<br\s*\/?>/gi, "\n");
	// Iteratively strip tags to handle fragments like "<scr" + "ipt>"
	let prev: string;
	do {
		prev = text;
		text = text.replace(/<[^>]+>/g, "");
	} while (text !== prev);
	// Decode entities (amp last so &amp;lt; doesn't become <)
	return text
		.replace(/&nbsp;/g, " ")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&amp;/g, "&")
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * Naive word-wrap: split text into lines that fit within maxWidth.
 * pdf-lib's `maxWidth` option on drawText doesn't work reliably with
 * custom embedded fonts, so we measure and break manually.
 */
export function wrapText(
	text: string,
	font: { widthOfTextAtSize: (t: string, s: number) => number },
	fontSize: number,
	maxWidth: number,
): string[] {
	if (!text) return [""];
	const words = text.split(/\s+/);
	const lines: string[] = [];
	let current = "";

	for (const word of words) {
		const test = current ? `${current} ${word}` : word;
		if (font.widthOfTextAtSize(test, fontSize) <= maxWidth) {
			current = test;
		} else {
			if (current) lines.push(current);
			current = word;
		}
	}
	if (current) lines.push(current);
	return lines.length ? lines : [""];
}

/* ─────────────────────── Mapping helpers ───────────────────────────── */

/**
 * Convert semantic page info to perek IDs using the sefer's perek range.
 *
 * semanticPages contains entries like { semanticName: "א'", pageIndex: 3 }.
 * We parse the Hebrew number and map to the sefer's perek ID array.
 */
export function semanticPagesToPerekIds(
	semanticPages: SemanticPageInfo[],
	seferName: string,
): number[] {
	const sefer = getSeferByName(seferName);
	const allPerekIds = getPerekIdsForSefer(sefer);

	const perekIds: number[] = [];
	const seen = new Set<number>();

	for (const sp of semanticPages) {
		const perekNum = toNumber(sp.semanticName);
		if (perekNum <= 0 || perekNum > allPerekIds.length) continue;
		const perekId = allPerekIds[perekNum - 1];
		if (perekId !== undefined && !seen.has(perekId)) {
			seen.add(perekId);
			perekIds.push(perekId);
		}
	}

	return perekIds;
}

/* ─────────────────── PDF layout constants ──────────────────────────── */

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN = 50;
const MAX_WIDTH = PAGE_WIDTH - 2 * MARGIN;

const TITLE_SIZE = 18;
const HEADER_SIZE = 12;
const BODY_SIZE = 12;
const SMALL_SIZE = 10;

const TITLE_LINE_HEIGHT = TITLE_SIZE * 2.0;
const HEADER_LINE_HEIGHT = HEADER_SIZE * 1.6;
const BODY_LINE_HEIGHT = BODY_SIZE * 1.6;
const SMALL_LINE_HEIGHT = SMALL_SIZE * 1.5;

/* ──────────────────── Low-level drawing helpers ───────────────────── */

interface DrawContext {
	doc: Awaited<ReturnType<typeof PDFDocument.create>>;
	font: PDFFont;
	boldFont: PDFFont;
	y: number;
	pageNum: number;
}

function ensureSpace(ctx: DrawContext, needed: number): void {
	if (ctx.y < MARGIN + needed) {
		ctx.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
		ctx.y = PAGE_HEIGHT - MARGIN;
		ctx.pageNum++;
	}
}

function currentPage(ctx: DrawContext) {
	const pages = ctx.doc.getPages();
	return pages[pages.length - 1];
}

function drawRtlLine(
	ctx: DrawContext,
	text: string,
	font: PDFFont,
	size: number,
	/* istanbul ignore next -- default never reached; all callers pass color */
	color = rgb(0, 0, 0),
): void {
	const page = currentPage(ctx);
	const visual = reverseGraphemes(text);
	const textWidth = font.widthOfTextAtSize(visual, size);
	const x = PAGE_WIDTH - MARGIN - textWidth;
	page.drawText(visual, {
		x: Math.max(MARGIN, x),
		y: ctx.y,
		size,
		font,
		color,
	});
}

function drawRtlWrapped(
	ctx: DrawContext,
	text: string,
	font: PDFFont,
	size: number,
	lineHeight: number,
	color = rgb(0, 0, 0),
): void {
	const lines = wrapText(text, font, size, MAX_WIDTH);
	for (const line of lines) {
		ensureSpace(ctx, lineHeight);
		drawRtlLine(ctx, line, font, size, color);
		ctx.y -= lineHeight;
	}
}

/* ──────────────────── Separator line ───────────────────────────────── */

function drawSeparator(ctx: DrawContext): void {
	ensureSpace(ctx, 10);
	const page = currentPage(ctx);
	page.drawLine({
		start: { x: PAGE_WIDTH - MARGIN, y: ctx.y },
		end: { x: MARGIN, y: ctx.y },
		thickness: 0.5,
		color: rgb(0.7, 0.7, 0.7),
	});
	ctx.y -= 10;
}

/* ─────────────────────── Main PDF builder ──────────────────────────── */

/**
 * Build PDF bytes for the given perek IDs.
 * Each perek starts on a new page with title, header, pesukim,
 * and appended perushim/articles section.
 */
export async function buildTanachPdfForPerekRange(
	perekIds: number[],
): Promise<Uint8Array> {
	const doc = await PDFDocument.create();

	doc.registerFontkit(fontkit);

	const regularBytes = getRegularFontBytes();
	const boldBytes = getBoldFontBytes();
	const font = await doc.embedFont(regularBytes, { subset: true });
	const boldFont = await doc.embedFont(boldBytes, { subset: true });

	const ctx: DrawContext = { doc, font, boldFont, y: 0, pageNum: 0 };

	for (let i = 0; i < perekIds.length; i++) {
		const perekId = perekIds[i];

		// ── New page for each perek ──
		doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
		ctx.y = PAGE_HEIGHT - MARGIN;
		ctx.pageNum++;

		const perek = getPerekByPerekId(perekId);

		// ── Combined title + header (like TOC: "במדבר א — header") ──
		const titleText = perek.header
			? `${perek.sefer} ${perek.perekHeb} — ${perek.header}`
			: `${perek.sefer} ${perek.perekHeb}`;
		drawRtlWrapped(ctx, titleText, boldFont, TITLE_SIZE, TITLE_LINE_HEIGHT);

		ctx.y -= BODY_LINE_HEIGHT * 0.5; // spacing

		// ── Pesukim ──
		for (const pasuk of perek.pesukim) {
			const text = stripTaamim(segmentsToText(pasuk.segments));
			if (!text) continue;
			drawRtlWrapped(ctx, text, font, BODY_SIZE, BODY_LINE_HEIGHT);
			ctx.y -= 2; // tiny inter-pasuk gap
		}

		// ── Perushim section ──
		try {
			const perushim = await getPerushimByPerekId(perekId);
			if (perushim.length > 0) {
				ctx.y -= BODY_LINE_HEIGHT;
				drawSeparator(ctx);

				ensureSpace(ctx, HEADER_LINE_HEIGHT);
				drawRtlLine(
					ctx,
					"פירושים זמינים",
					boldFont,
					HEADER_SIZE,
					rgb(0.15, 0.15, 0.5),
				);
				ctx.y -= HEADER_LINE_HEIGHT;

				for (const p of perushim) {
					ensureSpace(ctx, SMALL_LINE_HEIGHT);
					const label = `• ${p.name} (${p.parshanName}) — ${p.noteCount} הערות`;
					drawRtlLine(
						ctx,
						label,
						font,
						SMALL_SIZE,
						rgb(0.2, 0.2, 0.2),
					);
					ctx.y -= SMALL_LINE_HEIGHT;
				}
			}
		} catch {
			// Perushim are optional; silently skip on DB error
		}

		// ── Articles section ──
		try {
			const articles = await getArticlesByPerekId(perekId);
			if (articles.length > 0) {
				ctx.y -= BODY_LINE_HEIGHT * 0.5;
				drawSeparator(ctx);

				ensureSpace(ctx, HEADER_LINE_HEIGHT);
				drawRtlLine(
					ctx,
					"מאמרים",
					boldFont,
					HEADER_SIZE,
					rgb(0.15, 0.5, 0.15),
				);
				ctx.y -= HEADER_LINE_HEIGHT;

				for (const article of articles) {
					ensureSpace(ctx, SMALL_LINE_HEIGHT * 2);
					const titleLine = `• ${article.name}`;
					drawRtlLine(
						ctx,
						titleLine,
						boldFont,
						SMALL_SIZE,
						rgb(0.1, 0.1, 0.1),
					);
					ctx.y -= SMALL_LINE_HEIGHT;

					const byLine = `מאת: ${article.authorName}`;
					drawRtlLine(
						ctx,
						byLine,
						font,
						SMALL_SIZE,
						rgb(0.3, 0.3, 0.3),
					);
					ctx.y -= SMALL_LINE_HEIGHT;

					if (article.abstract) {
						const plain = stripHtml(article.abstract);
						if (plain) {
							drawRtlWrapped(
								ctx,
								plain,
								font,
								SMALL_SIZE,
								SMALL_LINE_HEIGHT,
								rgb(0.25, 0.25, 0.25),
							);
						}
					}
					ctx.y -= 4; // gap between articles
				}
			}
		} catch {
			// Articles are optional; silently skip on DB error
		}
	}

	// ── Page numbers ──
	const allPages = doc.getPages();
	for (let i = 0; i < allPages.length; i++) {
		const page = allPages[i];
		const num = `${i + 1}`;
		const numWidth = font.widthOfTextAtSize(num, 9);
		page.drawText(num, {
			x: (PAGE_WIDTH - numWidth) / 2,
			y: 25,
			size: 9,
			font,
			color: rgb(0.5, 0.5, 0.5),
		});
	}

	return doc.save();
}

/**
 * Create a page-ranges download handler that produces a Tanach PDF.
 * Uses semanticPages to map page indices → perek IDs via Hebrew gematria.
 */
export function createTanachPageRangesHandler(): (
	pages: number[],
	semanticPages: SemanticPageInfo[],
	context?: { seferName?: string },
) => Promise<[ext: string, bin: Uint8Array]> {
	return async (_pages, semanticPages, context) => {
		const seferName = context?.seferName;
		if (!seferName) {
			throw new Error("Tanach PDF requires context.seferName");
		}

		const perekIds = semanticPagesToPerekIds(semanticPages, seferName);
		if (perekIds.length === 0) {
			throw new Error("No content pages in selected range");
		}

		const bin = await buildTanachPdfForPerekRange(perekIds);
		return ["pdf", bin];
	};
}
