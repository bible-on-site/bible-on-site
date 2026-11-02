"use client";

import { useEffect, useState } from "react";
import styles from "./PushNotificationsToggle.module.css";

const SUBSCRIPTION_API = "/api/push/subscription";
const SERVICE_WORKER_URL = "/sw.js";

type Status =
	| "loading"
	| "hidden"
	| "unsupported"
	| "ios-install"
	| "denied"
	| "off"
	| "on"
	| "error";

const MESSAGES: Partial<Record<Status, string>> = {
	unsupported: "הדפדפן הזה אינו תומך בהתראות.",
	"ios-install":
		"באייפון ובאייפד אפשר לקבל התראות אחרי הוספת האתר למסך הבית (שיתוף - הוספה למסך הבית) ופתיחתו משם.",
	denied:
		"ההתראות חסומות בדפדפן. כדי לקבל אותן יש לאפשר התראות לאתר בהגדרות הדפדפן.",
	on: "ההתראה היומית פעילה. אפשר לבטל אותה כאן בכל עת.",
	error: "לא הצלחנו לעדכן את ההתראות. נסו שוב.",
};

/** `applicationServerKey` as bytes: Safari rejects the base64url string form. */
export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
	const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
	const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
	return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function isPushSupported(): boolean {
	return (
		"serviceWorker" in navigator &&
		"PushManager" in window &&
		"Notification" in window
	);
}

// iOS/iPadOS only expose Web Push to sites added to the home screen (16.4+).
function needsHomeScreenInstall(): boolean {
	const ios =
		/iPad|iPhone|iPod/.test(navigator.userAgent) ||
		(navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
	return ios && !window.matchMedia("(display-mode: standalone)").matches;
}

async function currentSubscription(): Promise<PushSubscription | null> {
	const registration =
		await navigator.serviceWorker.getRegistration(SERVICE_WORKER_URL);
	return (await registration?.pushManager.getSubscription()) ?? null;
}

/**
 * Opt-in/out control for the daily perek browser notification (#1096). The
 * service worker is only registered when the reader opts in, so visitors who
 * never enable notifications get no worker at all. Renders nothing when the
 * deployment has push turned off.
 */
export function PushNotificationsToggle() {
	const [status, setStatus] = useState<Status>("loading");
	const [publicKey, setPublicKey] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		let active = true;
		(async () => {
			const response = await fetch(SUBSCRIPTION_API);
			if (!response.ok) return "hidden";
			const { publicKey: key } = (await response.json()) as {
				publicKey: string | null;
			};
			if (!key) return "hidden";
			if (!isPushSupported())
				return needsHomeScreenInstall() ? "ios-install" : "unsupported";
			setPublicKey(key);
			if (Notification.permission === "denied") return "denied";
			return (await currentSubscription()) ? "on" : "off";
		})()
			.catch((error: unknown) => {
				console.warn("Push notification status check failed", error);
				return "hidden" as const;
			})
			.then((next) => {
				if (active) setStatus(next);
			});
		return () => {
			active = false;
		};
	}, []);

	async function enable(key: string): Promise<Status> {
		const permission = await Notification.requestPermission();
		if (permission !== "granted")
			return permission === "denied" ? "denied" : "off";
		const registration = await navigator.serviceWorker.register(
			SERVICE_WORKER_URL,
			{ scope: "/", updateViaCache: "none" },
		);
		await navigator.serviceWorker.ready;
		const subscription = await registration.pushManager.subscribe({
			userVisibleOnly: true,
			applicationServerKey: base64UrlToBytes(key),
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

	async function disable(): Promise<Status> {
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

	async function toggle(checked: boolean) {
		setBusy(true);
		try {
			// Interactive states are only reachable after the key loaded.
			setStatus(checked ? await enable(publicKey as string) : await disable());
		} catch (error) {
			console.warn("Push notification toggle failed", error);
			setStatus("error");
		} finally {
			setBusy(false);
		}
	}

	if (status === "loading" || status === "hidden") return null;
	const interactive = status === "on" || status === "off" || status === "error";

	return (
		<section className={styles.push} aria-labelledby="push-notifications-title">
			<h3 id="push-notifications-title">התראה יומית בדפדפן</h3>
			{interactive && (
				<label className={styles.toggle}>
					<input
						type="checkbox"
						checked={status === "on"}
						disabled={busy}
						onChange={(event) => toggle(event.target.checked)}
					/>
					<span>קבלו בכל יום לימוד התראה עם הפרק היומי</span>
				</label>
			)}
			<p className={styles.status} role="status">
				{MESSAGES[status] ?? ""}
			</p>
		</section>
	);
}
