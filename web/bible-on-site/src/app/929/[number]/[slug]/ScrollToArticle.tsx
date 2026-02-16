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
}: { targetId?: string; behavior?: ScrollBehavior } = {}) {
	useEffect(() => {
		const el = document.getElementById(targetId);
		if (el) {
			// Small delay to ensure layout is complete
			setTimeout(() => {
				el.scrollIntoView({ behavior, block: "start" });
			}, 100);
		}
	}, [targetId, behavior]);

	return null;
}

/**
 * @deprecated Use ScrollToSlug instead.  Kept for backward-compatibility.
 */
export function ScrollToArticle() {
	return <ScrollToSlug targetId="article-view" behavior="instant" />;
}
