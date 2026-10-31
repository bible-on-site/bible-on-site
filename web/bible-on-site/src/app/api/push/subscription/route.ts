import { NextResponse } from "next/server";
import {
	deleteSubscription,
	getVapidPublicKey,
	isPushServiceEndpoint,
	isWebPushConfigured,
	parseSubscription,
	saveSubscription,
} from "@/lib/web-push";

export const dynamic = "force-dynamic";

/** A `PushSubscription.toJSON()` body is well under 1 KB. */
const MAX_BODY_BYTES = 4 * 1024;

const notConfigured = () =>
	NextResponse.json({ error: "Web push is not configured" }, { status: 404 });

async function readJson(request: Request): Promise<unknown> {
	const text = await request.text();
	if (text.length > MAX_BODY_BYTES) return null;
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

/**
 * Daily perek push subscriptions (#1096).
 *
 * - `GET` returns the VAPID public key the browser subscribes with, or 404
 *   when the deployment has push turned off (the UI then hides itself).
 * - `POST` stores a `PushSubscription.toJSON()` body (opt-in, idempotent).
 * - `DELETE` with `{ endpoint }` removes it (opt-out).
 */
export function GET() {
	if (!isWebPushConfigured()) return notConfigured();
	return NextResponse.json({ publicKey: getVapidPublicKey() });
}

export async function POST(request: Request) {
	if (!isWebPushConfigured()) return notConfigured();
	const subscription = parseSubscription(await readJson(request));
	if (!subscription) {
		return NextResponse.json(
			{ error: "Invalid subscription" },
			{ status: 400 },
		);
	}
	try {
		await saveSubscription(subscription);
	} catch (error) {
		console.error("Failed to save push subscription", error);
		return NextResponse.json({ error: "Unavailable" }, { status: 503 });
	}
	return NextResponse.json({ subscribed: true }, { status: 201 });
}

export async function DELETE(request: Request) {
	const body = await readJson(request);
	const endpoint = (body as { endpoint?: unknown } | null)?.endpoint;
	if (!isPushServiceEndpoint(endpoint)) {
		return NextResponse.json({ error: "Invalid endpoint" }, { status: 400 });
	}
	try {
		await deleteSubscription(endpoint);
	} catch (error) {
		console.error("Failed to delete push subscription", error);
		return NextResponse.json({ error: "Unavailable" }, { status: 503 });
	}
	return NextResponse.json({ subscribed: false });
}
