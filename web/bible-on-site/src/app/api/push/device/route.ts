import { NextResponse } from "next/server";
import {
	deleteDevice,
	isDeviceRegistryConfigured,
	parseDeviceRegistration,
	parseDeviceUserId,
	saveDevice,
} from "@/lib/app-push";
import { MAX_JSON_BODY_BYTES, readBoundedJson } from "@/lib/bounded-json";

export const dynamic = "force-dynamic";

const notConfigured = () =>
	NextResponse.json({ error: "App push is not configured" }, { status: 404 });

/**
 * Mobile-app daily perek device registrations (#1097).
 *
 * - `POST` upserts the `PushDeviceRegistration` body the app emits on
 *   opt-in, startup re-sync and token rotation (unauthenticated, matching
 *   the web-push subscription model — the daily-perek payload is public,
 *   non-personal content). Hidden when the deployment has no FCM service
 *   account, so the app's best-effort call stays quiet until the sender
 *   side is armed.
 * - `DELETE` with `{ userId }` removes the registration (opt-out). It is
 *   intentionally not gated on configuration, so an opt-out always works.
 */
export async function POST(request: Request) {
	if (!isDeviceRegistryConfigured()) return notConfigured();
	const body = await readBoundedJson(request, MAX_JSON_BODY_BYTES);
	if (body.status === "unreadable") {
		console.warn("Push device body read failed");
	}
	const device = parseDeviceRegistration(
		body.status === "parsed" ? body.value : null,
	);
	if (!device) {
		return NextResponse.json(
			{ error: "Invalid registration" },
			{ status: 400 },
		);
	}
	try {
		await saveDevice(device);
	} catch {
		console.error("Failed to save push device");
		return NextResponse.json({ error: "Unavailable" }, { status: 503 });
	}
	return NextResponse.json({ registered: true }, { status: 201 });
}

export async function DELETE(request: Request) {
	const result = await readBoundedJson(request, MAX_JSON_BODY_BYTES);
	if (result.status === "unreadable") {
		console.warn("Push device body read failed");
	}
	const userId = parseDeviceUserId(
		result.status === "parsed" ? result.value : null,
	);
	if (!userId) {
		return NextResponse.json({ error: "Invalid user id" }, { status: 400 });
	}
	try {
		await deleteDevice(userId);
	} catch {
		console.error("Failed to delete push device");
		return NextResponse.json({ error: "Unavailable" }, { status: 503 });
	}
	return NextResponse.json({ registered: false });
}
