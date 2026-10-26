/**
 * Learning-calendar PDF generator (#2366).
 *
 * Renders the selected month/year/full-cycle views to a printable PDF:
 * Hebrew month headings, weekday labels, day numbers and perek references —
 * reusing the Frank Ruhl fonts + RTL helpers from tanach-pdf.
 *
 * pdf-lib draws LTR only: every Hebrew string is grapheme-reversed and each
 * grid column is laid out right-to-left (column 0 = rightmost).
 */

// biome-ignore lint/suspicious/noTsIgnore: @ts-expect-error fails in production build (unused directive) so we must use @ts-ignore
// @ts-ignore — @pdf-lib/fontkit is CJS; namespace import may wrap the real instance in .default
import * as _fontkit from "@pdf-lib/fontkit";
import { toLetters } from "gematry";
import type { PDFFont, PDFPage } from "pdf-lib";
import { PDFDocument, rgb } from "pdf-lib";
import {
	type CalendarDay,
	isMergedReviewPair,
	type MonthCell,
} from "@/data/learning-schedule";
import {
	getBoldFontBytes,
	getRegularFontBytes,
	reverseGraphemes,
} from "./tanach-pdf";

/* istanbul ignore next -- branch depends on bundler environment at runtime */
// biome-ignore lint/suspicious/noExplicitAny: CJS/ESM interop — unwrap .default when bundler wraps it
const fontkit: any = (_fontkit as any).default ?? _fontkit;

export interface CalendarPdfMonth {
	/** Section heading, e.g. "אלול ה'תשפה". */
	title: string;
	cells: MonthCell[];
}

export interface CalendarPdfInput {
	/** Document title line, e.g. "שנת ה'תשפה" or the full cycle label. */
	title: string;
	/** Optional second line, e.g. the cycle range under a month/year title. */
	subtitle?: string;
	months: CalendarPdfMonth[];
	/** Marks days outside the selected cycle so they print dimmed. */
	dimmed?: (day: NonNullable<MonthCell["day"]>) => boolean;
	/** Formats a scheduled day's cell label (perek ref or review range). */
	dayLabel: (day: NonNullable<MonthCell["day"]>) => string;
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

function drawRtlCentered(
	page: PDFPage,
	text: string,
	font: PDFFont,
	size: number,
	centerX: number,
	y: number,
	color: typeof INK,
): void {
	const visual = reverseGraphemes(text);
	const width = font.widthOfTextAtSize(visual, size);
	page.drawText(visual, {
		x: centerX - width / 2,
		y,
		size,
		font,
		color,
	});
}

function fitText(text: string, font: PDFFont, size: number, maxWidth: number) {
	let out = text;
	while (
		out.length > 1 &&
		font.widthOfTextAtSize(reverseGraphemes(out), size) > maxWidth
	) {
		out = out.slice(0, -1);
	}
	return out;
}

/**
 * Renders the given months to a single-column flow of month grids.
 * Returns raw PDF bytes.
 */
export async function generateCalendarPdf(
	input: CalendarPdfInput,
): Promise<Uint8Array> {
	const doc = await PDFDocument.create();
	doc.registerFontkit(fontkit);
	const font = await doc.embedFont(getRegularFontBytes());
	const bold = await doc.embedFont(getBoldFontBytes());

	let page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
	let y = PAGE_HEIGHT - MARGIN;

	const need = (height: number) => {
		if (y - height < MARGIN + 20) {
			page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
			y = PAGE_HEIGHT - MARGIN;
		}
	};

	y -= 24;
	drawRtlCentered(page, input.title, bold, 18, PAGE_WIDTH / 2, y, INK);
	if (input.subtitle) {
		y -= 16;
		drawRtlCentered(page, input.subtitle, font, 11, PAGE_WIDTH / 2, y, MUTED);
	}
	y -= 18;

	for (const month of input.months) {
		const rows = Math.ceil(month.cells.length / 7);
		need(22 + 14 + rows * CELL_H + 10);

		y -= 16;
		drawRtlCentered(page, month.title, bold, 12, PAGE_WIDTH / 2, y, INK);
		y -= 8;

		// Weekday header — column 0 (ראשון) is the rightmost cell.
		for (let col = 0; col < 7; col++) {
			const cx = PAGE_WIDTH - MARGIN - col * CELL_W - CELL_W / 2;
			drawRtlCentered(page, WEEKDAYS[col], font, 7, cx, y, MUTED);
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
				input.dimmed?.(day) === true &&
				(merged === undefined || input.dimmed?.(merged) === true);
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
				bold,
				9,
				cx,
				top - 14,
				dim ? MUTED : INK,
			);
			if (day.perekId !== undefined && !dim) {
				const label = fitText(input.dayLabel(day), font, 6.5, cellW - 6);
				drawRtlCentered(
					page,
					label,
					font,
					6.5,
					cx,
					top - CELL_H + 8,
					day.status === "review" ? REVIEW : MUTED,
				);
			}
		}
		y -= CELL_H * rows + 14;
	}

	// Page numbers.
	doc.getPages().forEach((p, i) => {
		p.drawText(String(i + 1), {
			x: PAGE_WIDTH / 2 - 4,
			y: 18,
			size: 8,
			font,
			color: MUTED,
		});
	});

	return doc.save();
}
