/**
 * Learning-calendar PDF generator (#2366, branded layout #2727).
 *
 * Renders the selected month/year/full-cycle views to a printable PDF:
 * Hebrew month headings, weekday labels, day numbers and perek references —
 * reusing the Frank Ruhl fonts + RTL helpers from tanach-pdf.
 *
 * Layout is driven by `input.scope`:
 *  - "month": a single page — logo, branded document title, one calendar.
 *  - "year"/"cycle": a cover page (logo + document title + period subtitle),
 *    then two monthly calendars per data page under a running document
 *    header and a per-page month-range heading.
 * Every page carries a grey/blue footer band repeating the document title
 * plus a page number.
 *
 * Scheduled (study-day) perek sources get clickable URI annotations pointing
 * at <linkBase>/<perekId> on the public site. Review, blank and dimmed cells
 * stay unlinked.
 *
 * pdf-lib draws LTR only, so each string is split into bidi visual runs and
 * drawn left-to-right (see bidi-text.ts); grid columns are laid out
 * right-to-left (column 0 = rightmost).
 */

// biome-ignore lint/suspicious/noTsIgnore: @ts-expect-error fails in production build (unused directive) so we must use @ts-ignore
// @ts-ignore — @pdf-lib/fontkit is CJS; namespace import may wrap the real instance in .default
import * as _fontkit from "@pdf-lib/fontkit";
import { toLetters } from "gematry";
import type { PDFFont, PDFImage, PDFPage } from "pdf-lib";
import {
	PDFArray,
	PDFDocument,
	PDFName,
	PDFString,
	rgb,
} from "pdf-lib";
import {
	type CalendarDay,
	getMonthLabel,
	getMonthName,
	getYearLabel,
	isMergedReviewPair,
	type MonthCell,
} from "@/data/learning-schedule";
import {
	bidiRunsWidth,
	bidiTextWidth,
	drawBidiRuns,
	memoizeGlyphEncoding,
	visualTextRuns,
} from "./bidi-text";
import { getBoldFontBytes, getLogoBytes, getRegularFontBytes } from "./pdf-fonts";

/* istanbul ignore next -- branch depends on bundler environment at runtime */
// biome-ignore lint/suspicious/noExplicitAny: CJS/ESM interop — unwrap .default when bundler wraps it
const fontkit: any = (_fontkit as any).default ?? _fontkit;

export type CalendarPdfScope = "month" | "year" | "cycle";

export interface CalendarPdfMonth {
	/** Section heading, e.g. "אלול ה'תשפה". */
	title: string;
	/** Hebrew year — drives the per-page range heading. */
	year: number;
	/** Uniform month number (see getMonthOrder). */
	month: number;
	cells: MonthCell[];
}

export interface CalendarPdfInput {
	/**
	 * Document scope — selects the layout: a single month page, or a cover
	 * plus two-months-per-page for year/cycle exports.
	 */
	scope: CalendarPdfScope;
	/** Canonical branded document title, repeated in headers and the footer. */
	title: string;
	/** Optional second line, e.g. the cycle range under a month/year title. */
	subtitle?: string;
	months: CalendarPdfMonth[];
	/** Marks days outside the selected cycle so they print dimmed. */
	dimmed?: (day: NonNullable<MonthCell["day"]>) => boolean;
	/** Formats a scheduled day's cell label (perek ref or review range). */
	dayLabel: (day: NonNullable<MonthCell["day"]>) => string;
	/**
	 * Absolute URL base for scheduled-perek link annotations
	 * (e.g. "https://xn--febl3a.co.il/929"); targets are /<perekId> under it.
	 * Omit to render without links.
	 */
	linkBase?: string;
}

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN = 42;
const CELL_W = (PAGE_WIDTH - 2 * MARGIN) / 7;
const CELL_H = 46;
const WEEKDAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

const INK = rgb(0.12, 0.16, 0.24);
const MUTED = rgb(0.45, 0.5, 0.6);
const LINE = rgb(0.8, 0.83, 0.88);
const REVIEW = rgb(0.15, 0.45, 0.75);
/** Restrained grey/blue footer band and its text (#2727). */
const FOOTER_BG = rgb(0.92, 0.94, 0.97);
const FOOTER_INK = rgb(0.36, 0.44, 0.58);
const FOOTER_H = 32;

function drawRtlCentered(
	page: PDFPage,
	text: string,
	font: PDFFont,
	size: number,
	centerX: number,
	y: number,
	color: typeof INK,
): void {
	// One UAX #9 pass per label — reused for both width and draw.
	const runs = visualTextRuns(text);
	const width = bidiRunsWidth(font, runs, size);
	drawBidiRuns(page, runs, font, size, centerX - width / 2, y, color);
}

function fitText(text: string, font: PDFFont, size: number, maxWidth: number) {
	if (bidiTextWidth(font, text, size) <= maxWidth) {
		return text;
	}
	// Longest prefix that still fits — binary search keeps this O(log n)
	// shaping passes instead of one per truncated character.
	let lo = 1;
	let hi = text.length - 1;
	let best = 1;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		const candidate = text.slice(0, mid);
		if (bidiTextWidth(font, candidate, size) <= maxWidth) {
			best = mid;
			lo = mid + 1;
		} else {
			hi = mid - 1;
		}
	}
	return text.slice(0, best);
}

/**
 * Fixed document metadata date. Calendar PDFs are pre-generated artifacts
 * addressed by content hash (#2608), so rendering must be byte-deterministic:
 * pdf-lib otherwise stamps CreationDate/ModDate with wall-clock time.
 */
const FIXED_METADATA_DATE = new Date("2020-01-01T00:00:00.000Z");

/** Draw-time context shared by every page/grid. */
interface RenderCtx {
	doc: PDFDocument;
	font: PDFFont;
	bold: PDFFont;
	logo: PDFImage;
	input: CalendarPdfInput;
}

/**
 * Adds a clickable URI annotation over a drawn label. `rect` is the final
 * drawn bounds in PDF coordinates ([x1, y1, x2, y2]) — computed by callers
 * after pagination/bidi/text fitting, per the link contract.
 */
function addUriLink(
	ctx: RenderCtx,
	page: PDFPage,
	uri: string,
	rect: [number, number, number, number],
): void {
	const annot = ctx.doc.context.register(
		ctx.doc.context.obj({
			Type: "Annot",
			Subtype: "Link",
			Rect: rect,
			Border: [0, 0, 0],
			A: { Type: "Action", S: "URI", URI: PDFString.of(uri) },
		}),
	);
	let annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
	if (annots === undefined) {
		annots = ctx.doc.context.obj([]);
		page.node.set(PDFName.of("Annots"), annots);
	}
	annots.push(annot);
}

/** Centered logo preserving the 591:295 source aspect ratio. */
function drawLogo(
	page: PDFPage,
	logo: PDFImage,
	centerX: number,
	topY: number,
	width: number,
): number {
	const height = (width * logo.height) / logo.width;
	page.drawImage(logo, {
		x: centerX - width / 2,
		y: topY - height,
		width,
		height,
	});
	return topY - height;
}

/**
 * The per-page month-range heading, built from the structured month refs on
 * the page rather than parsing a title string (#2727):
 *  - same year: "חשוון-כסלו ה'תשפה"
 *  - cross-year: "אלול ה'תשפה - תשרי ה'תשפו"
 *  - a lone final month uses its own month/year label.
 */
function pageRangeHeading(months: CalendarPdfMonth[]): string {
	const [first, second] = months;
	if (second === undefined) {
		return getMonthLabel({ year: first.year, month: first.month });
	}
	if (first.year === second.year) {
		return `${getMonthName(first.year, first.month)}-${getMonthName(second.year, second.month)} ${getYearLabel(first.year)}`;
	}
	return `${getMonthLabel({ year: first.year, month: first.month })} - ${getMonthLabel({ year: second.year, month: second.month })}`;
}

/**
 * Draws one month grid (title + weekday row + day cells) starting at `y` and
 * returns the new y below the grid. `showTitle` is off for the single-month
 * page, where the document heading already names the month.
 *
 * Scheduled study-day labels additionally get a URI annotation to
 * <linkBase>/<perekId>; review ranges, blanks and dimmed cells get none.
 */
function drawMonthGrid(
	ctx: RenderCtx,
	page: PDFPage,
	month: CalendarPdfMonth,
	y: number,
	showTitle = true,
): number {
	if (showTitle) {
		y -= 15;
		drawRtlCentered(page, month.title, ctx.bold, 11, PAGE_WIDTH / 2, y, INK);
		y -= 8;
	}

	// Weekday header — column 0 (ראשון) is the rightmost cell.
	for (let col = 0; col < 7; col++) {
		const cx = PAGE_WIDTH - MARGIN - col * CELL_W - CELL_W / 2;
		drawRtlCentered(page, WEEKDAYS[col], ctx.font, 7, cx, y, MUTED);
	}
	y -= 12;

	for (let i = 0; i < month.cells.length; i++) {
		const cell = month.cells[i];
		const col = i % 7;
		if (col === 0 && i > 0) {
			y -= CELL_H;
		}
		if (cell.day === undefined) {
			continue;
		}
		const day = cell.day;
		// Saturday covered by Friday's merged review block (#2365).
		// `pairShabbat` keeps `day` out of the type-guard position so it
		// stays CalendarDay on the else path.
		const pairShabbat: CalendarDay | undefined = cell.day;
		if (isMergedReviewPair(month.cells[i - 1]?.day, pairShabbat)) {
			continue;
		}
		const next: CalendarDay | undefined = month.cells[i + 1]?.day;
		const merged = isMergedReviewPair(day, next) ? next : undefined;
		const dim =
			ctx.input.dimmed?.(day) === true &&
			(merged === undefined || ctx.input.dimmed?.(merged) === true);
		// A merged block spans the Friday and Saturday columns; since
		// higher columns sit further left in the RTL grid, its center
		// is half a cell left of Friday's center.
		const cx =
			PAGE_WIDTH -
			MARGIN -
			col * CELL_W -
			CELL_W / 2 -
			(merged ? CELL_W / 2 : 0);
		const cellW = merged ? CELL_W * 2 : CELL_W;
		const top = y;

		page.drawRectangle({
			x: cx - cellW / 2 + 1,
			y: top - CELL_H + 2,
			width: cellW - 2,
			height: CELL_H - 3,
			borderColor: LINE,
			borderWidth: day.status === "review" && !dim ? 0.8 : 0.4,
			opacity: dim ? 0.35 : 1,
			borderDashArray: day.status === "review" && !dim ? [2, 2] : undefined,
		});
		drawRtlCentered(
			page,
			merged
				? `${toLetters(day.day, { addQuotes: true })} - ${toLetters(merged.day, { addQuotes: true })}`
				: toLetters(day.day, { addQuotes: true }),
			ctx.bold,
			9,
			cx,
			top - 14,
			dim ? MUTED : INK,
		);
		if (day.perekId !== undefined && !dim) {
			const label = fitText(ctx.input.dayLabel(day), ctx.font, 6.5, cellW - 6);
			const labelY = top - CELL_H + 8;
			drawRtlCentered(
				page,
				label,
				ctx.font,
				6.5,
				cx,
				labelY,
				day.status === "review" ? REVIEW : MUTED,
			);
			// Links only on scheduled chapter sources — never a whole review
			// range pointing at its last perek, and never on dimmed cells.
			if (day.status === "study" && ctx.input.linkBase) {
				const width = bidiTextWidth(ctx.font, label, 6.5);
				addUriLink(ctx, page, `${ctx.input.linkBase}/${day.perekId}`, [
					cx - width / 2,
					labelY - 2,
					cx + width / 2,
					labelY + 7,
				]);
			}
		}
	}
	// y is the top of the last drawn row — the grid bottom is one cell below.
	return y - CELL_H;
}

/** Cover page for year/cycle exports: logo + branded title + period. */
function drawCoverPage(ctx: RenderCtx, page: PDFPage): void {
	let y = PAGE_HEIGHT - MARGIN - 90;
	y = drawLogo(page, ctx.logo, PAGE_WIDTH / 2, y, 240);
	y -= 40;
	drawRtlCentered(page, ctx.input.title, ctx.bold, 20, PAGE_WIDTH / 2, y, INK);
	if (ctx.input.subtitle) {
		y -= 24;
		drawRtlCentered(
			page,
			ctx.input.subtitle,
			ctx.font,
			11,
			PAGE_WIDTH / 2,
			y,
			MUTED,
		);
	}
}

/** The single-page month export: logo above the calendar on one page. */
function drawMonthPage(ctx: RenderCtx, page: PDFPage): void {
	let y = PAGE_HEIGHT - MARGIN;
	y = drawLogo(page, ctx.logo, PAGE_WIDTH / 2, y, 140);
	y -= 18;
	drawRtlCentered(page, ctx.input.title, ctx.bold, 15, PAGE_WIDTH / 2, y, INK);
	if (ctx.input.subtitle) {
		y -= 16;
		drawRtlCentered(
			page,
			ctx.input.subtitle,
			ctx.font,
			10,
			PAGE_WIDTH / 2,
			y,
			MUTED,
		);
	}
	y -= 24;
	const month = ctx.input.months[0];
	// Center the calendar in the space left above the footer band.
	const blockHeight = 12 + Math.ceil(month.cells.length / 7) * CELL_H;
	const available = y - (FOOTER_H + 16);
	y -= Math.max(0, (available - blockHeight) / 2);
	drawMonthGrid(ctx, page, month, y, false);
}

/**
 * A year/cycle data page: compact running document branding, the page's
 * month-range heading, then the pair of monthly calendars stacked.
 */
function drawDataPage(
	ctx: RenderCtx,
	page: PDFPage,
	months: CalendarPdfMonth[],
): void {
	let y = PAGE_HEIGHT - MARGIN;
	// Compact running branding: small logo top-right + document title.
	const logoWidth = 40;
	const logoHeight = (logoWidth * ctx.logo.height) / ctx.logo.width;
	page.drawImage(ctx.logo, {
		x: PAGE_WIDTH - MARGIN - logoWidth,
		y: y - logoHeight,
		width: logoWidth,
		height: logoHeight,
	});
	drawRtlCentered(page, ctx.input.title, ctx.bold, 10, PAGE_WIDTH / 2, y - 10, INK);
	y -= 26;
	page.drawLine({
		start: { x: MARGIN, y },
		end: { x: PAGE_WIDTH - MARGIN, y },
		thickness: 0.6,
		color: LINE,
	});
	y -= 22;
	drawRtlCentered(
		page,
		pageRangeHeading(months),
		ctx.bold,
		13,
		PAGE_WIDTH / 2,
		y,
		INK,
	);
	y -= 10;
	// Center the month pair between the range heading and the footer band:
	// section title + weekday row + rows per month, plus the inter-month gap.
	const blockHeight =
		months.reduce(
			(h, m) => h + 23 + 12 + Math.ceil(m.cells.length / 7) * CELL_H,
			0,
		) +
		(months.length - 1) * 8;
	const available = y - (FOOTER_H + 16);
	y -= Math.max(0, (available - blockHeight) / 2);
	for (const month of months) {
		y = drawMonthGrid(ctx, page, month, y);
		y -= 8;
	}
}

/** Grey/blue footer band: document title centered, page number clear right. */
function drawFooter(ctx: RenderCtx, page: PDFPage, pageNumber: number): void {
	page.drawRectangle({
		x: 0,
		y: 0,
		width: PAGE_WIDTH,
		height: FOOTER_H,
		color: FOOTER_BG,
	});
	drawRtlCentered(
		page,
		ctx.input.title,
		ctx.font,
		8,
		PAGE_WIDTH / 2 - 12,
		11,
		FOOTER_INK,
	);
	page.drawText(String(pageNumber), {
		x: PAGE_WIDTH - MARGIN,
		y: 11,
		size: 8,
		font: ctx.font,
		color: FOOTER_INK,
	});
}

/**
 * Renders the input per its scope. Returns raw PDF bytes.
 *
 * Deterministic: `updateMetadata: false` keeps save() from restamping the
 * info dict, and the document dates are fixed constants — identical inputs
 * yield identical bytes on any machine.
 */
export async function generateCalendarPdf(
	input: CalendarPdfInput,
): Promise<Uint8Array> {
	const doc = await PDFDocument.create({ updateMetadata: false });
	doc.setProducer("bible-on-site calendar-pdf");
	doc.setCreator("bible-on-site");
	doc.setCreationDate(FIXED_METADATA_DATE);
	doc.setModificationDate(FIXED_METADATA_DATE);
	doc.registerFontkit(fontkit);
	const ctx: RenderCtx = {
		doc,
		font: memoizeGlyphEncoding(await doc.embedFont(getRegularFontBytes())),
		bold: memoizeGlyphEncoding(await doc.embedFont(getBoldFontBytes())),
		logo: await doc.embedJpg(getLogoBytes()),
		input,
	};

	if (input.scope === "month") {
		drawMonthPage(ctx, doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]));
	} else {
		drawCoverPage(ctx, doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]));
		// Two complete monthly calendars per data page; an odd final month
		// occupies the last page alone — never duplicated or padded.
		for (let i = 0; i < input.months.length; i += 2) {
			drawDataPage(
				ctx,
				doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]),
				input.months.slice(i, i + 2),
			);
		}
	}

	doc.getPages().forEach((page, i) => {
		drawFooter(ctx, page, i + 1);
	});

	return doc.save();
}
