import { toLetters } from "gematry";
import {
	type CalendarDay,
	getMonthLabel,
	getPerekSource,
	type MonthCell,
} from "@/data/learning-schedule";
import { CALENDAR_WEEKDAYS, type FlipMonthEntry } from "./flip-month-data";

/**
 * One month face of the vertical calendar book (#2993): a full-page Hebrew
 * month grid with day numbers, perek sources, review badges and the today
 * marker — the page-sized counterpart of the overview's month cell. Day
 * buttons stay flippable zones on purpose: the engine only turns pages for
 * drags that start in the bottom ~22% edge, and it suppresses the trailing
 * click after a real drag — so taps still open the perek while edge drags
 * turn the sheet.
 */
export function FlipMonthSheet({
	entry,
	todayDateNumber,
	onOpen,
	dayAriaLabel,
	isDimmed,
}: {
	entry: FlipMonthEntry;
	todayDateNumber: number;
	/** Called only for tappable cells, so the perek id is always present. */
	onOpen: (perekId: number) => void;
	dayAriaLabel: (day: CalendarDay) => string;
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
				{cells.map((cell) =>
					cell.day === undefined ? (
						<span
							key={`blank-${cell.blankColumn}`}
							className="cal-cell cal-cell--blank"
							aria-hidden="true"
						/>
					) : (
						<SheetCell
							key={cell.day.dateNumber}
							day={cell.day}
							isToday={cell.day.dateNumber === todayDateNumber}
							dimmed={isDimmed?.(cell.day) === true}
							onOpen={onOpen}
							ariaLabel={dayAriaLabel(cell.day)}
						/>
					),
				)}
			</div>
			<div className="cal-sheet__grip" aria-hidden="true">
				<span className="cal-sheet__gripDots" />
			</div>
		</section>
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
	isToday,
	dimmed,
	onOpen,
	ariaLabel,
}: {
	day: CalendarDay;
	isToday: boolean;
	dimmed: boolean;
	onOpen: (perekId: number) => void;
	ariaLabel: string;
}) {
	const classNames = [
		"cal-cell",
		day.status === "review" ? "cal-cell--review" : "",
		day.status === "none" ? "cal-cell--none" : "",
		dimmed ? "cal-cell--dimmed" : "",
		isToday ? "cal-cell--today" : "",
	]
		.filter(Boolean)
		.join(" ");

	const dayNumber = (
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

	const perekId = day.perekId;
	return (
		<button
			type="button"
			className={classNames}
			aria-label={ariaLabel}
			onClick={() => onOpen(perekId)}
		>
			{dayNumber}
			<span className="cal-cell__perek">
				{getPerekSource(perekId)}
			</span>
			{day.status === "review" && (
				<span className="cal-cell__review">חזרה</span>
			)}
		</button>
	);
}
