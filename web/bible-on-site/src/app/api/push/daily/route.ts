import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { resolveCalendarDay } from "@/data/learning-schedule";
import { isWebPushConfigured, sendDailyPerek } from "@/lib/web-push";
import { getCurrentDate } from "@/util/date";
import { constructTsetAwareHDate } from "@/util/hebdates-util";

export const dynamic = "force-dynamic";

const digest = (value: string) => createHash("sha256").update(value).digest();

function isAuthorized(request: Request): boolean {
	const header = request.headers.get("authorization") ?? "";
	const expected = `Bearer ${process.env.PUSH_SEND_SECRET}`;
	return timingSafeEqual(digest(header), digest(expected));
}

/**
 * Sends today's perek to every push subscriber (#1096). Called once a day by
 * `.github/workflows/web-push-daily.yml` with `Authorization: Bearer
 * $PUSH_SEND_SECRET`.
 *
 * Only study days notify: Shabbat, review days and days without a scheduled
 * perek return `{ skipped }` so subscribers are never pinged on those days,
 * whatever the caller's schedule.
 */
export async function POST(request: Request) {
	if (!isWebPushConfigured()) {
		return NextResponse.json(
			{ error: "Web push is not configured" },
			{ status: 503 },
		);
	}
	if (!isAuthorized(request)) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}
	const day = resolveCalendarDay(constructTsetAwareHDate(getCurrentDate()));
	if (day.status !== "study" || day.perekId === undefined) {
		return NextResponse.json({ skipped: day.status });
	}
	try {
		const result = await sendDailyPerek(day.perekId);
		return NextResponse.json({ perekId: day.perekId, ...result });
	} catch (error) {
		console.error("Daily web push failed", error);
		return NextResponse.json({ error: "Send failed" }, { status: 500 });
	}
}
