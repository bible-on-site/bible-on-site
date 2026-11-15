import { useSyncExternalStore } from "react";

/**
 * Shared archive operation state. The archive page owns the flag but the top
 * bar lives outside it, so a tiny external store carries "an archive
 * operation is in flight" between the two trees. The archive logout stays
 * disabled while busy so a mid-upload sign-out cannot strand a reserved
 * file behind expired session cookies.
 */
const listeners = new Set<() => void>();
let busy = false;

export function setArchiveBusy(value: boolean) {
	if (busy === value) return;
	busy = value;
	for (const listener of listeners) listener();
}

function subscribeArchiveBusy(listener: () => void) {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

export function archiveBusy() {
	return busy;
}

export function useArchiveBusy() {
	return useSyncExternalStore(
		subscribeArchiveBusy,
		() => busy,
		() => false,
	);
}
