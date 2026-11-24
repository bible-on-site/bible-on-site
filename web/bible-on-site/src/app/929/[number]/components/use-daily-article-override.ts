"use client";

import { useSyncExternalStore } from "react";
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

// One lookup serves every consumer: DailyArticlesSection is always mounted
// and Sefer stays mounted (display:none) once toggled, so two hook
// instances would otherwise each run their own 60s polling and reactivate
// listeners. The store starts on the first subscriber and stops when the
// last one unmounts.
let currentOverride: DailyArticleOverride | null = null;
const listeners = new Set<() => void>();
let intervalId: number | undefined;
let lastRefreshAt = Number.NEGATIVE_INFINITY;
let generation = 0;

const emit = () => {
	for (const listener of listeners) listener();
};

const refresh = () => {
	lastRefreshAt = Date.now();
	const gen = generation;
	const now = new Date();
	const todaysPerekId = getPerekIdByDate(now);
	const hebrewDate = constructTsetAwareHDate(now);
	getDailyArticleOverride(hebrewDate.getUniformMonth(), hebrewDate.day)
		.then((article) => {
			if (gen !== generation) return; // store was torn down mid-flight
			currentOverride = article
				? { perekId: todaysPerekId, articles: [article] }
				: null;
			emit();
		})
		.catch((error) => {
			// A failed lookup must not blank the list — keep the static
			// chapter articles rather than showing nothing (#3098).
			console.warn("Daily article override lookup failed:", error);
			if (gen !== generation) return;
			currentOverride = null;
			emit();
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

const subscribe = (onStoreChange: () => void): (() => void) => {
	listeners.add(onStoreChange);
	if (listeners.size === 1) {
		refresh();
		intervalId = window.setInterval(refresh, 60_000);
		window.addEventListener("focus", refreshOnReactivate);
		document.addEventListener("visibilitychange", refreshOnReactivate);
	}
	return () => {
		listeners.delete(onStoreChange);
		if (listeners.size === 0) {
			window.clearInterval(intervalId);
			intervalId = undefined;
			window.removeEventListener("focus", refreshOnReactivate);
			document.removeEventListener("visibilitychange", refreshOnReactivate);
			generation++; // drop any refresh still in flight
			currentOverride = null;
		}
	};
};

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
	return useSyncExternalStore(
		subscribe,
		() => currentOverride,
		() => null,
	);
}
