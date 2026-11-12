import { toLetters } from "gematry";
import {
	type CalendarDay,
	getDaySourceLabel,
	getMonthLabel,
	isMergedReviewPair,
	type MonthCell,
} from "@/data/learning-schedule";
import { CALENDAR_WEEKDAYS, type FlipMonthEntry } from "./flip-month-data";

/**
 * One month face of the vertical calendar book (#2993): a full-page Hebrew
 * month grid with day numbers, perek sources, review badges, merged
 * Friday/Saturday review blocks and the today marker — the page-sized
 * counterpart of the overview's month cells, following the same merged-pair
 * and dimmed-cell rules as MiniMonth (#2365, #2975). Day buttons stay
 * flippable zones on purpose: the engine only turns pages for drags that
 * start in the bottom ~22% edge, and it suppresses the trailing click after
 * a real drag — so taps still open the perek while edge drags turn the
 * sheet.
 */
export function FlipMonthSheet({
	entry,
	todayDateNumber,
	onOpen,
	dayAriaLabel,
	mergedDayAriaLabel,
	isDimmed,
}: {
	entry: FlipMonthEntry;
	todayDateNumber: number;
	/** Called only for tappable cells, so the perek id is always present. */
	onOpen: (perekId: number) => void;
	dayAriaLabel: (day: CalendarDay) => string;
	/** Both dates in one name for a merged review block (#2365). */
	mergedDayAriaLabel: (friday: CalendarDay, shabbat: CalendarDay) => string;
	/** Out-of-cycle days in a full-cycle book render dimmed and inert. */
	isDimmed?: (day: CalendarDay) => boolean;
}) {
	const cells = padMonthCells(entry.cells);
	const label = getMonthLabel(entry.ref);
	return (
		<section className="cal-sheet" aria-label={label}>
			<header className="cal-sheet__head">
				<h3 className="cal-sheet__title">{label}</h3>
			</header>
			<div className="cal-sheet__weekdays" aria-hidden="true">
				{CALENDAR_WEEKDAYS.map((name) => (
					<span key={name.full} className="cal-sheet__weekday">
						{name.short}
					</span>
				))}
			</div>
			<div className="cal-sheet__grid">
				{cells.map((cell, index) => {
					if (cell.day === undefined) {
						return (
							<span
								key={`blank-${cell.blankColumn}`}
								className="cal-cell cal-cell--blank"
								aria-hidden="true"
							/>
						);
					}
					const day = cell.day;
					// The Saturday of a merged review pair is swallowed by
					// Friday's spanning cell — same rule as MiniMonth.
					if (
						index > 0 &&
						isMergedReviewPair(cells[index - 1].day, day)
					) {
						return null;
					}
					const shabbat = cells[index + 1]?.day;
					const merged = isMergedReviewPair(day, shabbat)
						? shabbat
						: undefined;
					return (
						<SheetCell
							key={day.dateNumber}
							day={day}
							mergedWith={merged}
							isToday={
								day.dateNumber === todayDateNumber ||
								merged?.dateNumber === todayDateNumber
							}
							dimmed={
								isDimmed?.(day) === true &&
								(!merged || isDimmed(merged))
							}
							onOpen={onOpen}
							ariaLabel={
								merged
									? mergedDayAriaLabel(day, merged)
									: dayAriaLabel(day)
							}
						/>
					);
				})}
			</div>
			<div className="cal-sheet__grip" aria-hidden="true">
				<span className="cal-sheet__gripDots" />
			</div>
		</section>
	);
}

/**
 * The card-back face paired with a month sheet (#2993): the decorative
 * divider a reader sees beneath the month grid and while the sheet lifts
 * over the spiral binding — the physical calendar's printed card backing.
 * It carries no interactive content, so the reader-facing face stays
 * decorative; the month caption keeps the transient face identifiable.
 */
export function FlipMonthSheetBack({ entry }: { entry: FlipMonthEntry }) {
	return (
		<div className="cal-sheet-back" aria-hidden="true">
			<span className="cal-sheet-back__tab">{getMonthLabel(entry.ref)}</span>
			<span className="cal-sheet-back__rule" />
		</div>
	);
}

/**
 * Appends inert trailing blanks so every month fills complete weeks — the
 * grid then stretches its rows evenly across the page.
 */
function padMonthCells(cells: MonthCell[]): MonthCell[] {
	const padded = [...cells];
	const remainder = padded.length % 7;
	if (remainder !== 0) {
		// Negative blankColumn values mark synthetic trailing blanks so their
		// keys stay unique without relying on array position.
		for (let index = remainder; index < 7; index += 1) {
			padded.push({ blankColumn: -1 - index });
		}
	}
	return padded;
}

function SheetCell({
	day,
	mergedWith,
	isToday,
	dimmed,
	onOpen,
	ariaLabel,
}: {
	day: CalendarDay;
	/** Saturday when this Friday cell spans the shared review block (#2365). */
	mergedWith?: CalendarDay;
	isToday: boolean;
	dimmed: boolean;
	onOpen: (perekId: number) => void;
	ariaLabel: string;
}) {
	const classNames = [
		"cal-cell",
		day.status === "review" ? "cal-cell--review" : "",
		mergedWith ? "cal-cell--merged" : "",
		day.status === "none" ? "cal-cell--none" : "",
		dimmed ? "cal-cell--dimmed" : "",
		isToday ? "cal-cell--today" : "",
	]
		.filter(Boolean)
		.join(" ");

	// Merged block: each date sits centered over its own weekday column —
	// the column headers already mark ו/ש, so no day letters inside (#2365).
	const dayNumber = mergedWith ? (
		<span className="cal-cell__day">
			<span className="cal-cell__mergedDate">
				{toLetters(day.day, { addQuotes: true })}
			</span>
			<span className="cal-cell__mergedDate">
				{toLetters(mergedWith.day, { addQuotes: true })}
			</span>
			{isToday ? <span className="cal-sr-only"> (היום)</span> : null}
		</span>
	) : (
		<span className="cal-cell__day">
			{toLetters(day.day, { addQuotes: true })}
			{isToday ? <span className="cal-sr-only"> (היום)</span> : null}
		</span>
	);

	if (day.perekId === undefined || day.status === "none" || dimmed) {
		return (
			<div className={classNames}>
				{dayNumber}
				<span className="cal-sr-only">{ariaLabel}</span>
			</div>
		);
	}

	// Dimmed out-of-cycle cells returned early above, so this button always
	// belongs to the selected cycle and prints its perek label — exactly like
	// the calendar PDFs and the overview grid (#2975).
	const source = getDaySourceLabel(day);
	const perekId = day.perekId;
	return (
		<button
			type="button"
			className={classNames}
			aria-label={ariaLabel}
			onClick={() => onOpen(perekId)}
		>
			{dayNumber}
			{source !== "" && (
				<span className="cal-cell__perek">{source}</span>
			)}
			{source !== "" && day.status === "review" && (
				<span className="cal-cell__review">חזרה</span>
			)}
		</button>
	);
}
