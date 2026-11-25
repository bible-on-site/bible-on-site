import { NextResponse } from "next/server";
import {
	MAX_JSON_BODY_BYTES,
	readBoundedJson,
} from "@/lib/bounded-json";
import {
	pushRegistrationAllowed,
	requestClientKey,
} from "@/lib/rate-limit";
import {
	SubscriptionStoreFullError,
	deleteSubscription,
	getVapidPublicKey,
	isPushServiceEndpoint,
	isWebPushConfigured,
	parseSubscription,
	saveSubscription,
} from "@/lib/web-push";

export const dynamic = "force-dynamic";

const notConfigured = () =>
	NextResponse.json({ error: "Web push is not configured" }, { status: 404 });

/**
 * Daily perek push subscriptions (#1096).
 *
 * - `GET` returns the VAPID public key the browser subscribes with, or
 *   `null` when the deployment has push turned off (the UI then hides
 *   itself). It stays 200 so the home page logs no console error.
 * - `POST` stores a `PushSubscription.toJSON()` body (opt-in, idempotent).
 * - `DELETE` with `{ endpoint }` removes it (opt-out).
 */
export function GET() {
	return NextResponse.json({
		publicKey: isWebPushConfigured() ? getVapidPublicKey() : null,
	});
}

export async function POST(request: Request) {
	if (!isWebPushConfigured()) return notConfigured();
	// Anonymous endpoint: bound writes per client address (#3500). The
	// store cap in saveSubscription is the backstop for a distributed
	// flood.
	if (!pushRegistrationAllowed(requestClientKey(request))) {
		return NextResponse.json(
			{ error: "Too many requests" },
			{ status: 429 },
		);
	}
	const body = await readBoundedJson(request, MAX_JSON_BODY_BYTES);
	if (body.status === "unreadable") {
		console.warn("Push subscription body read failed");
	}
	const subscription = parseSubscription(
		body.status === "parsed" ? body.value : null,
	);
	if (!subscription) {
		return NextResponse.json(
			{ error: "Invalid subscription" },
			{ status: 400 },
		);
	}
	try {
		await saveSubscription(subscription);
	} catch (error) {
		console.error(
			error instanceof SubscriptionStoreFullError
				? "Push subscription store is full"
				: "Failed to save push subscription",
		);
		return NextResponse.json({ error: "Unavailable" }, { status: 503 });
	}
	return NextResponse.json({ subscribed: true }, { status: 201 });
}

export async function DELETE(request: Request) {
	const result = await readBoundedJson(request, MAX_JSON_BODY_BYTES);
	if (result.status === "unreadable") {
		console.warn("Push subscription body read failed");
	}
	const body =
		result.status === "parsed"
			? (result.value as { endpoint?: unknown } | null)
			: null;
	const endpoint = body?.endpoint;
	if (!isPushServiceEndpoint(endpoint)) {
		return NextResponse.json({ error: "Invalid endpoint" }, { status: 400 });
	}
	try {
		await deleteSubscription(endpoint);
	} catch {
		console.error("Failed to delete push subscription");
		return NextResponse.json({ error: "Unavailable" }, { status: 503 });
	}
	return NextResponse.json({ subscribed: false });
}
