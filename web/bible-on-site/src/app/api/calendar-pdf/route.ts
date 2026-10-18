import { NextResponse } from "next/server";
import {
	buildMonth,
	type CalendarDay,
	compareMonths,
	getCycle,
	getCycleLabel,
	getCycleStartMonth,
	getMonthLabel,
	getMonthName,
	getMonthOrder,
	getPerekSource,
	getYearLabel,
	type MonthCell,
	type MonthRef,
	nextMonth,
} from "@/data/learning-schedule";
import {
	type CalendarPdfMonth,
	generateCalendarPdf,
} from "@/lib/download/calendar-pdf";

export const dynamic = "force-dynamic";

function dayLabel(day: CalendarDay): string {
	/* istanbul ignore next -- dayLabel is only invoked for scheduled days (perekId set) */
	if (day.perekId === undefined) {
		return "";
	}
	const ids = day.status === "review" ? day.reviewPerekIds : undefined;
	if (ids && ids.length > 1) {
		return `${getPerekSource(ids[0])} - ${getPerekSource(ids[ids.length - 1])}`;
	}
	return getPerekSource(day.perekId);
}

function monthsForCycle(cycleNumber: number): CalendarPdfMonth[] {
	const cycle = getCycle(cycleNumber);
	const months: CalendarPdfMonth[] = [];
	let ref: MonthRef = getCycleStartMonth(cycle);
	const endRef: MonthRef = {
		year: cycle.end.year,
		month: cycle.end.getUniformMonth(),
	};
	for (let guard = 0; guard < 50 && compareMonths(ref, endRef) <= 0; guard++) {
		const cells: MonthCell[] = buildMonth(ref.year, ref.month);
		months.push({ title: getMonthLabel(ref), cells });
		ref = nextMonth(ref);
	}
	return months;
}

export async function GET(request: Request) {
	const { searchParams } = new URL(request.url);
	const monthParam = searchParams.get("month") ?? "";
	const view = searchParams.get("view") ?? "month";
	const cycleParam = Number.parseInt(searchParams.get("cycle") ?? "", 10);

	const year = Number.parseInt(monthParam.slice(0, 4), 10);
	const uniformMonth = Number.parseInt(monthParam.slice(4), 10);

	let title: string;
	let subtitle: string | undefined;
	let months: CalendarPdfMonth[];
	let dimmed: ((day: CalendarDay) => boolean) | undefined;

	if (view === "cycle" && Number.isInteger(cycleParam) && cycleParam >= 1) {
		title = `לוח לימוד יומי`;
		subtitle = getCycleLabel(getCycle(cycleParam));
		months = monthsForCycle(cycleParam);
		dimmed = (day) => day.cycle !== cycleParam;
	} else if (view === "year" && Number.isInteger(year)) {
		title = `לוח לימוד יומי - שנת ${getYearLabel(year)}`;
		months = getMonthOrder(year).map((month) => ({
			title: getMonthName(year, month),
			cells: buildMonth(year, month),
		}));
	} else if (Number.isInteger(year) && Number.isInteger(uniformMonth)) {
		title = `לוח לימוד יומי - ${getMonthLabel({ year, month: uniformMonth })}`;
		months = [
			{
				title: getMonthLabel({ year, month: uniformMonth }),
				cells: buildMonth(year, uniformMonth),
			},
		];
	} else {
		return NextResponse.json(
			{ error: "missing or invalid month=YYYYMM (or view/cycle)" },
			{ status: 400 },
		);
	}

	const pdf = await generateCalendarPdf({ title, subtitle, months, dimmed, dayLabel });
	const filename =
		view === "cycle" && Number.isInteger(cycleParam)
			? `learning-calendar-cycle-${cycleParam}.pdf`
			: view === "year"
				? `learning-calendar-year-${year}.pdf`
				: `learning-calendar-${monthParam}.pdf`;

	return new NextResponse(Buffer.from(pdf), {
		headers: {
			"Content-Type": "application/pdf",
			"Content-Disposition": `attachment; filename="${filename}"`,
		},
	});
}
