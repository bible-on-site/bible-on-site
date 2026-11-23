"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	PUSH_MESSAGES,
	PUSH_SECTION_ID,
	PUSH_STATUS_EVENT,
	type PushState,
	type PushStatus,
	type PushSync,
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
	// Whether the last subscribe/unsubscribe attempt failed. `status` keeps
	// the ground truth on failure — a failed opt-out still reads "on" because
	// the subscription is still live — so every surface can retry the action
	// that actually failed (#3732).
	const [failed, setFailed] = useState(false);
	const [busy, setBusy] = useState(false);

	const refresh = useCallback(async () => {
		try {
			setState(await readPushState());
			setFailed(false);
		} catch (error) {
			console.warn("Push notification status check failed", error);
			setState({ status: "hidden", publicKey: null });
		}
	}, []);

	useEffect(() => {
		if (auto) void refresh();
		const synced = (event: Event) => {
			const detail = (event as CustomEvent<PushSync>).detail;
			setState((current) => ({ ...current, status: detail.status }));
			setFailed(detail.failed);
		};
		window.addEventListener(PUSH_STATUS_EVENT, synced);
		return () => window.removeEventListener(PUSH_STATUS_EVENT, synced);
	}, [auto, refresh]);

	const run = useCallback(
		async (action: () => Promise<PushStatus>) => {
			setBusy(true);
			let next: PushStatus = "error";
			// On failure the status does not change — the broadcast carries the
			// unchanged truth plus the failure so every surface agrees.
			let sync: PushSync = { status: state.status, failed: true };
			try {
				next = await action();
				if (next === "error") {
					setFailed(true);
				} else {
					setFailed(false);
					setState((current) => ({ ...current, status: next }));
					sync = { status: next, failed: false };
				}
			} catch (error) {
				console.warn("Push notification toggle failed", error);
				setFailed(true);
			} finally {
				setBusy(false);
				window.dispatchEvent(
					new CustomEvent<PushSync>(PUSH_STATUS_EVENT, { detail: sync }),
				);
			}
			return next;
		},
		[state.status],
	);

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

	return { ...state, busy, failed, refresh, requestEnable, subscribe, disable };
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
	const interactive = push.status === "on" || push.status === "off";

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
						// A failed opt-out keeps status "on" — the subscription is
						// still live — so this stays enabled and retries the DELETE.
						disabled={push.busy || push.status !== "on"}
						onClick={push.disable}
					>
						ביטול התראות
					</button>
				</div>
			)}
			<p className={styles.status} role="status">
				{push.failed
					? PUSH_MESSAGES.error
					: (PUSH_MESSAGES[push.status] ?? "")}
			</p>
		</article>
	);
}
