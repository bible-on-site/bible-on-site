/** @jest-environment jsdom */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { LiveLearningCalendar } from "@/app/calendar/components/LiveLearningCalendar";
import LearningCalendarPage from "@/app/calendar/page";
import {
	constructTsetAwareHDate,
	hebcalDateToNumber,
} from "@/util/hebdates-util";

jest.mock("@/app/calendar/components/LearningCalendar", () => ({
	LearningCalendar: ({
		initialYear,
		initialMonth,
		todayDateNumber,
		pdfManifestUrl,
	}: {
		initialYear: number;
		initialMonth: number;
		todayDateNumber: number;
		pdfManifestUrl: string;
	}) => (
		<div
			data-testid="calendar"
			data-year={initialYear}
			data-month={initialMonth}
			data-today={todayDateNumber}
			data-manifest={pdfManifestUrl}
		/>
	),
}));
jest.mock("@/lib/download/calendar-pdf-manifest", () => ({
	calendarPdfManifestUrl: () => "manifest",
}));

beforeEach(() => {
	jest.useFakeTimers();
	jest.setSystemTime(new Date("2026-10-28T10:00:00Z"));
});
afterEach(() => jest.useRealTimers());

it("pre-renders a static shell without baking a date into the HTML", () => {
	const html = renderToString(<LearningCalendarPage />);
	expect(html).toContain("לוח לימוד יומי");
	expect(html).toContain("טוען את הלוח");
	expect(html).not.toContain("data-today");
});

it("initializes the calendar from the browser's current Hebrew date", () => {
	render(<LiveLearningCalendar pdfManifestUrl="manifest" />);
	const today = constructTsetAwareHDate(new Date());
	expect(screen.getByTestId("calendar")).toHaveAttribute(
		"data-today",
		String(hebcalDateToNumber(today)),
	);
	expect(screen.getByTestId("calendar")).toHaveAttribute(
		"data-year",
		String(today.year),
	);
	expect(screen.getByTestId("calendar")).toHaveAttribute(
		"data-month",
		String(today.getUniformMonth()),
	);
	expect(screen.getByTestId("calendar")).toHaveAttribute(
		"data-manifest",
		"manifest",
	);
});

it("refreshes at Jerusalem nightfall while the page remains open", () => {
	render(<LiveLearningCalendar pdfManifestUrl="manifest" />);
	const before = screen.getByTestId("calendar").getAttribute("data-today");
	act(() => {
		jest.setSystemTime(new Date("2026-10-28T22:00:00Z"));
		jest.advanceTimersByTime(60_000);
	});
	expect(screen.getByTestId("calendar")).toHaveAttribute(
		"data-today",
		String(hebcalDateToNumber(constructTsetAwareHDate(new Date()))),
	);
	expect(screen.getByTestId("calendar").getAttribute("data-today")).not.toBe(
		before,
	);
});

it("refreshes a suspended page on focus or visibility change and cleans up", () => {
	const { unmount } = render(
		<LiveLearningCalendar pdfManifestUrl="manifest" />,
	);
	act(() => jest.setSystemTime(new Date("2026-10-29T10:00:00Z")));
	fireEvent.focus(window);
	expect(screen.getByTestId("calendar")).toHaveAttribute(
		"data-today",
		String(hebcalDateToNumber(constructTsetAwareHDate(new Date()))),
	);
	act(() => jest.setSystemTime(new Date("2026-10-30T10:00:00Z")));
	fireEvent(document, new Event("visibilitychange"));
	expect(screen.getByTestId("calendar")).toHaveAttribute(
		"data-today",
		String(hebcalDateToNumber(constructTsetAwareHDate(new Date()))),
	);
	unmount();
	expect(jest.getTimerCount()).toBe(0);
});
