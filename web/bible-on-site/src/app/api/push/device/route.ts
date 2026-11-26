import { NextResponse } from "next/server";
import {
	DeviceOwnershipError,
	DeviceStoreFullError,
	deleteDevice,
	deleteLegacyDevice,
	FirebaseIdentityUnavailableError,
	isDeviceRegistryConfigured,
	parseDeviceRegistration,
	parseDeviceUserId,
	saveDevice,
	verifyFirebaseIdToken,
} from "@/lib/app-push";
import { MAX_JSON_BODY_BYTES, readBoundedJson } from "@/lib/bounded-json";
import { pushRegistrationAllowed, requestClientKey } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const notConfigured = () =>
	NextResponse.json({ error: "App push is not configured" }, { status: 404 });

const unauthorized = () =>
	NextResponse.json(
		{ error: "Invalid installation credential" },
		{ status: 401 },
	);
const forbidden = () =>
	NextResponse.json(
		{ error: "Registration belongs to another installation" },
		{ status: 403 },
	);
const verificationUnavailable = () =>
	NextResponse.json(
		{ error: "Identity verification unavailable" },
		{ status: 503 },
	);

function bearerToken(request: Request): string | null {
	const match =
		/^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(
			request.headers.get("authorization") ?? "",
		);
	return match?.[1] ?? null;
}

async function verifiedUserId(request: Request) {
	const token = bearerToken(request);
	if (!token) return { status: "missing" as const };
	try {
		const identity = await verifyFirebaseIdToken(token);
		return identity
			? { status: "verified" as const, userId: identity.userId }
			: { status: "invalid" as const };
	} catch (error) {
		if (error instanceof FirebaseIdentityUnavailableError) {
			console.error("Firebase identity verification unavailable");
			return { status: "unavailable" as const };
		}
		throw error;
	}
}

function identityFailureResponse(
	identity: Awaited<ReturnType<typeof verifiedUserId>>,
) {
	if (identity.status === "verified") return null;
	if (identity.status === "unavailable") return verificationUnavailable();
	return unauthorized();
}

/**
 * Mobile-app daily perek device registrations (#1097).
 *
 * - `POST` upserts the `PushDeviceRegistration` body the app emits on
 *   opt-in, startup re-sync and token rotation after verifying the bearer
 *   Firebase Auth ID token belongs to the claimed installation identity.
 *   Hidden when the deployment has no FCM service account, so the app's
 *   best-effort call stays quiet until the sender side is armed.
 * - `DELETE` with `{ userId }` removes the registration after the same
 *   ownership check. A bearer-less request is the pre-auth compatibility
 *   lane and can delete only rows that were never auth-bound. It is
 *   intentionally not gated on configuration, so an opt-out always works.
 */
export async function POST(request: Request) {
	if (!isDeviceRegistryConfigured()) return notConfigured();
	// Anonymous Firebase identities cost no account setup: bound writes per
	// client address (#3500). The store cap in saveDevice is the backstop for
	// a distributed flood.
	if (!pushRegistrationAllowed(requestClientKey(request))) {
		return NextResponse.json({ error: "Too many requests" }, { status: 429 });
	}
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
	const identity = await verifiedUserId(request);
	const failure = identityFailureResponse(identity);
	if (failure) return failure;
	if (identity.userId !== device.userId) return forbidden();
	try {
		const legacyMigrated = await saveDevice(device, identity.userId);
		return NextResponse.json(
			{ registered: true, legacyMigrated },
			{ status: 201 },
		);
	} catch (error) {
		if (error instanceof DeviceOwnershipError) return forbidden();
		console.error(
			error instanceof DeviceStoreFullError
				? "Push device store is full"
				: "Failed to save push device",
		);
		return NextResponse.json({ error: "Unavailable" }, { status: 503 });
	}
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
	const identity = await verifiedUserId(request);
	try {
		if (identity.status === "missing") {
			// Supported pre-auth clients cannot present a Firebase credential;
			// their opt-out remains limited to rows that were never auth-bound.
			await deleteLegacyDevice(userId);
			return NextResponse.json({ registered: false });
		}
		const failure = identityFailureResponse(identity);
		if (failure) return failure;
		if (identity.userId !== userId) return forbidden();
		await deleteDevice(userId, identity.userId);
	} catch (error) {
		if (error instanceof DeviceOwnershipError) return forbidden();
		console.error("Failed to delete push device");
		return NextResponse.json({ error: "Unavailable" }, { status: 503 });
	}
	return NextResponse.json({ registered: false });
}
