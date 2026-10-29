"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Clipboard-fallback feedback states; native share resolves silently. */
export type ShareOutcome = "idle" | "copied" | "failed";

const FEEDBACK_MS = 2000;

/**
 * Shared share/copy command (#2786): the Web Share API when present, else a
 * clipboard copy — the same behavior every article surface gets. A native
 * sheet dismissal (AbortError) is a user cancel, not a failure; any other
 * share exception falls back to the clipboard instead of dead-ending.
 */
export function useArticleShare(canonicalPath: string, title?: string) {
	const [outcome, setOutcome] = useState<ShareOutcome>("idle");
	const timerRef = useRef<number | undefined>(undefined);

	useEffect(() => () => window.clearTimeout(timerRef.current), []);

	const share = useCallback(async () => {
		const url = `${window.location.origin}${canonicalPath}`;
		if (navigator.share) {
			try {
				await navigator.share({ title, url });
				return;
			} catch (error) {
				if (error instanceof DOMException && error.name === "AbortError") {
					return;
				}
				// Genuine share failures (NotAllowedError, data errors) drop
				// through to the clipboard fallback.
			}
		}
		try {
			await navigator.clipboard.writeText(url);
			setOutcome("copied");
		} catch {
			setOutcome("failed");
		}
		window.clearTimeout(timerRef.current);
		timerRef.current = window.setTimeout(() => setOutcome("idle"), FEEDBACK_MS);
	}, [canonicalPath, title]);

	return { outcome, share };
}
