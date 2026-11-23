/**
 * Browser push subscription for the daily perek reminder (#1096, #3732).
 *
 * Shared by the dedicated bulletin card (homepage) and the reader settings
 * dropdown so both surfaces read the same browser state and run the same
 * subscribe/unsubscribe operations.
 *
 * Permission policy (#3732): `Notification.requestPermission()` runs only
 * inside `requestAndSubscribe`, which is called exclusively from a direct
 * user click on the dedicated section's enable control. Everywhere else —
 * page load, reload, navigation, opening the reader dropdown, focusing the
 * section — code only reads state (`readPushState`) or subscribes under an
 * already-granted permission (`subscribePush`).
 */

export const SUBSCRIPTION_API = "/api/push/subscription";
export const SERVICE_WORKER_URL = "/sw.js";

/** Anchor of the dedicated reminder card inside the bulletin section. */
export const PUSH_SECTION_ID = "bulletin-push";
/** Navigation target that scrolls to — and focuses — that card. */
export const PUSH_SECTION_HREF = `/#${PUSH_SECTION_ID}`;

/**
 * Same-tab broadcast of a status change so every mounted surface reflects
 * the action immediately; a reload re-reads the browser state anyway.
 */
export const PUSH_STATUS_EVENT = "push-subscription-changed";

export type PushStatus =
	| "loading"
	| "hidden"
	| "unsupported"
	| "denied"
	| "off"
	| "on"
	| "error";

export const PUSH_MESSAGES: Partial<Record<PushStatus, string>> = {
	unsupported: "הדפדפן הזה אינו תומך בהתראות.",
	denied:
		"ההתראות חסומות בדפדפן. כדי לקבל אותן יש לאפשר התראות לאתר בהגדרות הדפדפן.",
	on: "ההתראה היומית פעילה. אפשר לבטל אותה כאן בכל עת.",
	error: "לא הצלחנו לעדכן את ההתראות. נסו שוב.",
};

export type PushState = {
	status: PushStatus;
	/** VAPID key — present only when the deployment has push configured. */
	publicKey: string | null;
};

/** `applicationServerKey` as bytes: Safari rejects the base64url string form. */
export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
	const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
	const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
	return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export function isPushSupported(): boolean {
	return (
		"serviceWorker" in navigator &&
		"PushManager" in window &&
		"Notification" in window
	);
}

async function currentSubscription(): Promise<PushSubscription | null> {
	const registration =
		await navigator.serviceWorker.getRegistration(SERVICE_WORKER_URL);
	return (await registration?.pushManager.getSubscription()) ?? null;
}

/**
 * Reads the deployment configuration, this browser's permission and the
 * live service-worker subscription. Never prompts for permission.
 */
export async function readPushState(): Promise<PushState> {
	const response = await fetch(SUBSCRIPTION_API);
	if (!response.ok) return { status: "hidden", publicKey: null };
	const { publicKey } = (await response.json()) as {
		publicKey: string | null;
	};
	if (!publicKey) return { status: "hidden", publicKey: null };
	// iPhone/iPad ordinary tabs land here too: Apple limits iOS Web Push
	// to Home Screen apps, and the product decision is to report
	// "unsupported" rather than funnel readers into installing (#2936).
	if (!isPushSupported()) return { status: "unsupported", publicKey: null };
	if (Notification.permission === "denied")
		return { status: "denied", publicKey };
	return {
		status: (await currentSubscription()) ? "on" : "off",
		publicKey,
	};
}

/**
 * Subscribes the browser under an already-granted notification permission
 * and registers it server-side. Does NOT call requestPermission — callers
 * that need a prompt go through `requestAndSubscribe` from a direct click
 * on the dedicated section's enable control.
 */
export async function subscribePush(publicKey: string): Promise<PushStatus> {
	const registration = await navigator.serviceWorker.register(
		SERVICE_WORKER_URL,
		{ scope: "/", updateViaCache: "none" },
	);
	await navigator.serviceWorker.ready;
	const subscription = await registration.pushManager.subscribe({
		userVisibleOnly: true,
		applicationServerKey: base64UrlToBytes(publicKey),
	});
	const response = await fetch(SUBSCRIPTION_API, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(subscription.toJSON()),
	});
	if (!response.ok) {
		await subscription.unsubscribe();
		return "error";
	}
	return "on";
}

/**
 * Section-enable path: asks the browser for notification permission and
 * subscribes on grant. May only be invoked from a direct user click on the
 * dedicated section's enable control (#3732).
 */
export async function requestAndSubscribePush(
	publicKey: string,
): Promise<PushStatus> {
	const permission = await Notification.requestPermission();
	if (permission !== "granted")
		return permission === "denied" ? "denied" : "off";
	return subscribePush(publicKey);
}

/** Removes the server registration and unsubscribes the browser. */
export async function unsubscribePush(): Promise<PushStatus> {
	const subscription = await currentSubscription();
	if (subscription) {
		const response = await fetch(SUBSCRIPTION_API, {
			method: "DELETE",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ endpoint: subscription.endpoint }),
		});
		if (!response.ok) return "error";
		await subscription.unsubscribe();
	}
	return "off";
}
