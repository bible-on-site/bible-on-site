"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	PUSH_MESSAGES,
	PUSH_SECTION_ID,
	PUSH_STATUS_EVENT,
	type PushState,
	type PushStatus,
	readPushState,
	requestAndSubscribePush,
	subscribePush,
	unsubscribePush,
} from "@/lib/push-notifications";
import cardStyles from "./DailyBulletinSection.module.css";
import styles from "./PushNotificationsToggle.module.css";

/**
 * Shared subscription state and operations for the daily perek browser
 * reminder (#3732). The dedicated bulletin card and the reader settings
 * dropdown both drive the same browser subscription through this hook, and
 * a same-tab event keeps every mounted surface in sync (a reload re-reads
 * the real state anyway).
 */
export function usePushSubscription({ auto = true }: { auto?: boolean } = {}) {
	const [state, setState] = useState<PushState>({
		status: "loading",
		publicKey: null,
	});
	const [busy, setBusy] = useState(false);

	const refresh = useCallback(async () => {
		try {
			setState(await readPushState());
		} catch (error) {
			console.warn("Push notification status check failed", error);
			setState({ status: "hidden", publicKey: null });
		}
	}, []);

	useEffect(() => {
		if (auto) void refresh();
		const synced = (event: Event) =>
			setState((current) => ({
				...current,
				status: (event as CustomEvent<PushStatus>).detail,
			}));
		window.addEventListener(PUSH_STATUS_EVENT, synced);
		return () => window.removeEventListener(PUSH_STATUS_EVENT, synced);
	}, [auto, refresh]);

	const run = useCallback(async (action: () => Promise<PushStatus>) => {
		setBusy(true);
		let next: PushStatus = "error";
		try {
			next = await action();
			setState((current) => ({ ...current, status: next }));
		} catch (error) {
			console.warn("Push notification toggle failed", error);
			setState((current) => ({ ...current, status: "error" }));
		} finally {
			setBusy(false);
			window.dispatchEvent(
				new CustomEvent<PushStatus>(PUSH_STATUS_EVENT, { detail: next }),
			);
		}
		return next;
	}, []);

	// The controls only render for interactive states, which are only
	// reachable after the VAPID key loaded.
	/** Section-only path: requestPermission must stay behind this click. */
	const requestEnable = useCallback(
		() =>
			run(async () => {
				/* istanbul ignore next: controls render only after the key loads */
				if (!state.publicKey) throw new Error("push public key not loaded");
				return requestAndSubscribePush(state.publicKey);
			}),
		[run, state.publicKey],
	);
	/** Already-granted path: subscribes without any permission prompt. */
	const subscribe = useCallback(
		() =>
			run(async () => {
				/* istanbul ignore next: controls render only after the key loads */
				if (!state.publicKey) throw new Error("push public key not loaded");
				return subscribePush(state.publicKey);
			}),
		[run, state.publicKey],
	);
	const disable = useCallback(() => run(unsubscribePush), [run]);

	return { ...state, busy, refresh, requestEnable, subscribe, disable };
}

/**
 * The dedicated browser-reminder card, mounted inside the bulletin section
 * alongside the Telegram, WhatsApp and email cards (#3732). The service
 * worker is only registered when the reader opts in, so visitors who never
 * enable notifications get no worker at all. Renders nothing while loading
 * or when the deployment has push turned off.
 *
 * Enable/disable controls: `requestEnable` is the only call path that can
 * reach `Notification.requestPermission()`, and it runs exclusively from a
 * direct click on this card's enable button.
 */
export function PushNotificationsToggle() {
	const push = usePushSubscription();
	const cardRef = useRef<HTMLElement>(null);

	// The reader dropdown navigates here (PUSH_SECTION_HREF) when a permission
	// prompt is required; once the state load resolves and the card exists it
	// takes focus — focusing is a read-only operation, never a prompt (#3732).
	useEffect(() => {
		if (
			push.status !== "loading" &&
			push.status !== "hidden" &&
			window.location.hash === `#${PUSH_SECTION_ID}`
		)
			cardRef.current?.focus();
	}, [push.status]);

	if (push.status === "loading" || push.status === "hidden") return null;
	const interactive =
		push.status === "on" || push.status === "off" || push.status === "error";

	return (
		<article
			id={PUSH_SECTION_ID}
			ref={cardRef}
			// Programmatic focus target for the dropdown's navigation path.
			tabIndex={-1}
			className={`${cardStyles.card} ${cardStyles.cardPush}`}
			aria-labelledby="push-notifications-title"
		>
			<Image
				className={cardStyles.cardIcon}
				src="/icons/bell.svg"
				alt=""
				width={40}
				height={40}
			/>
			<h3 id="push-notifications-title" className={cardStyles.cardTitle}>
				דפדפן
			</h3>
			<p className={cardStyles.cardText}>
				התראה יומית בדפדפן - הפרק היומי ישירות אליכם.
			</p>
			{interactive && (
				<div className={styles.actions}>
					<button
						type="button"
						className={cardStyles.cardAction}
						disabled={push.busy || push.status === "on"}
						onClick={push.requestEnable}
					>
						הפעלת התראות
					</button>
					<button
						type="button"
						className={styles.disableAction}
						disabled={push.busy || push.status !== "on"}
						onClick={push.disable}
					>
						ביטול התראות
					</button>
				</div>
			)}
			<p className={styles.status} role="status">
				{PUSH_MESSAGES[push.status] ?? ""}
			</p>
		</article>
	);
}
