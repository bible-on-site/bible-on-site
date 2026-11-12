import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { resolveCalendarDay } from "@/data/learning-schedule";
import {
	isPushServiceEndpoint,
	isWebPushConfigured,
	sendDailyPerek,
} from "@/lib/web-push";
import { getCurrentDate } from "@/util/date";
import { constructTsetAwareHDate } from "@/util/hebdates-util";

export const dynamic = "force-dynamic";

/** A targeting body of `{"endpoint": "<url>"}` is well under 1 KB. */
const MAX_BODY_BYTES = 4 * 1024;

/**
 * Read the optional targeting body. An empty body is the broadcast path;
 * anything non-empty must be well-formed JSON within the size limit, so a
 * malformed request can never silently broadcast to every subscriber.
 */
async function readBody(
	request: Request,
): Promise<{ ok: boolean; body: unknown }> {
	let text: string;
	try {
		text = await request.text();
	} catch {
		console.warn("Push daily request body read failed");
		return { ok: false, body: null };
	}
	if (text.length === 0) return { ok: true, body: undefined };
	if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES)
		return { ok: false, body: null };
	try {
		return { ok: true, body: JSON.parse(text) };
	} catch {
		return { ok: false, body: null };
	}
}

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
 * An optional JSON body `{"endpoint": "<push service URL>"}` restricts the
 * send to that single subscription — the controlled one-browser delivery
 * check the operator runs before the daily schedule is armed. An empty or
 * absent body broadcasts to every subscriber; any supplied body must name a
 * valid `endpoint`, so a malformed, oversized, non-object or mistyped body
 * is rejected and can never broadcast by accident.
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
	const parsed = await readBody(request);
	const body = parsed.body;
	if (
		!parsed.ok ||
		(body !== undefined &&
			(body === null || typeof body !== "object" || Array.isArray(body)))
	) {
		return NextResponse.json({ error: "Invalid body" }, { status: 400 });
	}
	// Only the absent-body broadcast may omit `endpoint`: a supplied body is a
	// targeting request, so a missing or mistyped key fails closed as 400.
	let endpoint: string | undefined;
	if (body !== undefined) {
		const candidate = (body as { endpoint?: unknown }).endpoint;
		if (!isPushServiceEndpoint(candidate)) {
			return NextResponse.json({ error: "Invalid endpoint" }, { status: 400 });
		}
		endpoint = candidate;
	}
	const day = resolveCalendarDay(constructTsetAwareHDate(getCurrentDate()));
	if (day.status !== "study" || day.perekId === undefined) {
		return NextResponse.json({ skipped: day.status });
	}
	try {
		const result = await sendDailyPerek(day.perekId, endpoint);
		return NextResponse.json({ perekId: day.perekId, ...result });
	} catch {
		console.error("Daily web push failed");
		return NextResponse.json({ error: "Send failed" }, { status: 500 });
	}
}
