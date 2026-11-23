"use client";

import { useEffect, useState } from "react";
import { getPerekIdByDate } from "@/data/perek-calendar";
import type { ArticleSummary } from "@/lib/articles";
import { constructTsetAwareHDate } from "@/util/hebdates-util";
import { getDailyArticleOverride } from "../actions";

export interface DailyArticleOverride {
	/** The perek today's learning schedule resolves to. */
	perekId: number;
	/** The assigned article as the day's sole article list. */
	articles: ArticleSummary[];
}

/**
 * Resolves today's recurring Hebrew-date article assignment (#3098).
 *
 * The static page ships the ordinary chapter list — the date-dependent
 * decision is a live client check so SSG stays untouched: when the viewed
 * perek is the resolved daily perek AND today's Hebrew date (tzeit-aware,
 * Jerusalem) carries an assignment, the assigned article alone replaces the
 * list. Re-checks on an interval and on window focus/visibility so a
 * midnight/tzeit rollover in an open tab applies the next day without a
 * reload.
 */
export function useDailyArticleOverride(): DailyArticleOverride | null {
	const [override, setOverride] = useState<DailyArticleOverride | null>(null);

	useEffect(() => {
		let cancelled = false;
		let lastRefreshAt = Number.NEGATIVE_INFINITY;
		const refresh = () => {
			lastRefreshAt = Date.now();
			const now = new Date();
			const todaysPerekId = getPerekIdByDate(now);
			const hebrewDate = constructTsetAwareHDate(now);
			getDailyArticleOverride(hebrewDate.getUniformMonth(), hebrewDate.day)
				.then((article) => {
					if (!cancelled) {
						setOverride(
							article ? { perekId: todaysPerekId, articles: [article] } : null,
						);
					}
				})
				.catch((error) => {
					// A failed lookup must not blank the list — keep the static
					// chapter articles rather than showing nothing (#3098).
					console.warn("Daily article override lookup failed:", error);
					if (!cancelled) setOverride(null);
				});
		};
		// Re-showing a hidden tab fires both visibilitychange and focus —
		// coalesce them (and any refresh fresher than a second) into one
		// lookup, and skip the lookup entirely while the tab is hidden.
		const refreshOnReactivate = () => {
			if (document.visibilityState !== "visible") return;
			if (Date.now() - lastRefreshAt < 1_000) return;
			refresh();
		};
		refresh();
		const intervalId = window.setInterval(refresh, 60_000);
		window.addEventListener("focus", refreshOnReactivate);
		document.addEventListener("visibilitychange", refreshOnReactivate);
		return () => {
			cancelled = true;
			window.clearInterval(intervalId);
			window.removeEventListener("focus", refreshOnReactivate);
			document.removeEventListener("visibilitychange", refreshOnReactivate);
		};
	}, []);

	return override;
}
