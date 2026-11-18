import { NextResponse } from "next/server";
import { resolveCalendarDay } from "@/data/learning-schedule";
import {
	isAppPushConfigured,
	isDeviceToken,
	isPushSendAuthorized,
	sendDailyPerekToDevices,
} from "@/lib/app-push";
import { MAX_JSON_BODY_BYTES, readBoundedJson } from "@/lib/bounded-json";
import { getCurrentDate } from "@/util/date";
import { constructTsetAwareHDate } from "@/util/hebdates-util";

export const dynamic = "force-dynamic";

/**
 * Sends today's perek to the app's `daily_perek` FCM topic (#1097). Called
 * once a day by `.github/workflows/app-push-daily.yml` with
 * `Authorization: Bearer $PUSH_SEND_SECRET` — the same sender credential
 * the web-push route uses.
 *
 * An optional JSON body `{"token": "<FCM registration token>"}` restricts
 * the send to that single device — the controlled one-device delivery
 * check the operator runs before the daily schedule is armed. An empty or
 * absent body broadcasts to every topic subscriber; any supplied body must
 * name a valid `token`, so a malformed, oversized, non-object or mistyped
 * body is rejected and can never broadcast by accident.
 *
 * Only study days notify: Shabbat, review days and days without a scheduled
 * perek return `{ skipped }` so subscribers are never pinged on those days,
 * whatever the caller's schedule.
 */
export async function POST(request: Request) {
	if (!isAppPushConfigured()) {
		return NextResponse.json(
			{ error: "App push is not configured" },
			{ status: 503 },
		);
	}
	if (!isPushSendAuthorized(request)) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}
	// An empty body is the broadcast path; anything non-empty must be
	// well-formed JSON within the size limit, so a malformed request can
	// never silently broadcast to every topic subscriber.
	const result = await readBoundedJson(request, MAX_JSON_BODY_BYTES);
	if (result.status === "unreadable") {
		console.warn("Push device daily request body read failed");
	}
	const ok = result.status === "parsed" || result.status === "empty";
	const body = result.status === "parsed" ? result.value : undefined;
	if (
		!ok ||
		(body !== undefined &&
			(body === null || typeof body !== "object" || Array.isArray(body)))
	) {
		return NextResponse.json({ error: "Invalid body" }, { status: 400 });
	}
	// Only the absent-body broadcast may omit `token`: a supplied body is a
	// targeting request, so a missing or mistyped key fails closed as 400.
	let token: string | undefined;
	if (body !== undefined) {
		const candidate = (body as { token?: unknown }).token;
		if (!isDeviceToken(candidate)) {
			return NextResponse.json({ error: "Invalid token" }, { status: 400 });
		}
		token = candidate;
	}
	const day = resolveCalendarDay(constructTsetAwareHDate(getCurrentDate()));
	if (day.status !== "study" || day.perekId === undefined) {
		return NextResponse.json({ skipped: day.status });
	}
	try {
		const send = await sendDailyPerekToDevices(day.perekId, token);
		// `curl --fail-with-body` is the only signal the scheduled workflow
		// has: a run where every attempted send failed must come back
		// non-2xx (#3499), and a targeted delivery check that matched
		// nothing live (unknown or just-pruned token) reports the miss
		// rather than a green `{sent: 0}`.
		const status =
			send.sent === 0 && send.failed > 0
				? 502
				: token !== undefined && send.sent === 0
					? 404
					: 200;
		return NextResponse.json({ perekId: day.perekId, ...send }, { status });
	} catch {
		console.error("Daily app push failed");
		return NextResponse.json({ error: "Send failed" }, { status: 500 });
	}
}
