"use client";

import { useEffect } from "react";

/**
 * Client component that scrolls to a target element on mount.
 * Used for both article and perush expanded views so they're
 * visible immediately (important for SEO — crawlers see the
 * final scroll position).
 *
 * @param targetId – the DOM id to scroll to (default: "article-view")
 * @param behavior – scroll behaviour; "instant" avoids animation for SEO,
 *                   "smooth" gives nice UX for client navigation.
 */
export function ScrollToSlug({
	targetId = "article-view",
	behavior = "instant",
}: {
	targetId?: string;
	behavior?: ScrollBehavior;
} = {}) {
	useEffect(() => {
		const el = document.getElementById(targetId);
		if (el) {
			// The browser re-applies its restored scroll position as late-arriving
			// content grows the page — potentially after the one-shot scroll below
			// has already fired — so take over restoration for this entry; these
			// pages always want the anchored target, not the saved position.
			history.scrollRestoration = "manual";
			// New history entries inherit the current entry's restoration mode,
			// so reset it for entries created from here — otherwise Back on a
			// later page (e.g. the author list) would never restore its saved
			// position. This also hands normal restoration back to this entry.
			const { pushState, replaceState } = history;
			const autoForNewEntry = <T extends typeof history.pushState>(fn: T) =>
				function (this: History, ...args: Parameters<T>) {
					history.scrollRestoration = "auto";
					return fn.apply(this, args);
				};
			history.pushState = autoForNewEntry(pushState);
			history.replaceState = autoForNewEntry(replaceState);
			// Small delay to ensure layout is complete
			const timer = setTimeout(() => {
				el.scrollIntoView({ behavior, block: "start" });
			}, 100);
			return () => {
				clearTimeout(timer);
				history.pushState = pushState;
				history.replaceState = replaceState;
			};
		}
	}, [targetId, behavior]);

	return null;
}
