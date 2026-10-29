import { validateBulletinDate } from "./daily-bulletin";

const hebrewCalendar = new Intl.DateTimeFormat("en-US-u-ca-hebrew", {
	timeZone: "Asia/Jerusalem",
	month: "long",
	day: "numeric",
});
const jerusalem = new Intl.DateTimeFormat("en-CA", {
	timeZone: "Asia/Jerusalem",
	year: "numeric",
	month: "2-digit",
	day: "2-digit",
	hour: "2-digit",
	minute: "2-digit",
	second: "2-digit",
	hourCycle: "h23",
});
function day(date: string): Date {
	return new Date(`${validateBulletinDate(date)}T12:00:00Z`);
}
function hebrew(date: string): { month: string; day: number } {
	const parts = hebrewCalendar.formatToParts(day(date));
	return {
		month: parts.find((p) => p.type === "month")?.value ?? "",
		day: Number(parts.find((p) => p.type === "day")?.value),
	};
}
/** Israeli yom tov, matching the legacy CHAG/il calendar (not the diaspora). */
export function isBulletinHoliday(date: string): boolean {
	const h = hebrew(date);
	return (
		(h.month === "Tishri" && [1, 2, 10, 15, 22].includes(h.day)) ||
		(h.month === "Nisan" && [15, 21].includes(h.day)) ||
		(h.month === "Sivan" && h.day === 6)
	);
}
function next(date: string): string {
	const result = day(date);
	result.setUTCDate(result.getUTCDate() + 1);
	return result.toISOString().slice(0, 10);
}
/** Sunday-Thursday; advance a weekday yom tov, including Rosh Hashana II. */
export function bulletinDatesForRun(date: string): string[] {
	const weekday = day(date).getUTCDay();
	if (weekday >= 5 || isBulletinHoliday(date)) return [];
	const dates = [date];
	if (weekday === 4) return dates;
	const tomorrow = next(date);
	if (!isBulletinHoliday(tomorrow)) return dates;
	dates.push(tomorrow);
	if (day(tomorrow).getUTCDay() === 4) return dates;
	const afterTomorrow = next(tomorrow);
	const h = hebrew(afterTomorrow);
	if (h.month === "Tishri" && h.day === 2) dates.push(afterTomorrow);
	return dates;
}
/** Reject old/future/replayed dates rather than silently posting yesterday's content. */
export function scheduledBulletinDate(
	value: unknown,
	now: Date,
): string | null {
	if (
		typeof value !== "string" ||
		!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)
	)
		return null;
	const instant = new Date(value);
	if (
		!Number.isFinite(instant.valueOf()) ||
		!Number.isFinite(now.valueOf()) ||
		instant.toISOString() !== value.replace("Z", ".000Z") ||
		instant > now
	)
		return null;
	const local = (at: Date) =>
		Object.fromEntries(
			jerusalem.formatToParts(at).map((p) => [p.type, p.value]),
		);
	const run = local(instant);
	const today = local(now);
	const date = `${run.year}-${run.month}-${run.day}`;
	if (
		date !== `${today.year}-${today.month}-${today.day}` ||
		run.hour !== "10" ||
		run.minute !== "00" ||
		run.second !== "00"
	)
		return null;
	return date;
}
