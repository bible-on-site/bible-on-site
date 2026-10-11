"use client";

import { useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { highlightDomMatch } from "../../../../lib/search/dom-match";
import styles from "./page.module.css";

/**
 * Scrolls to the exact in-content match a search result carries via `?q=`
 * (#2078): the phrase is re-located in the rendered article body with the
 * same normalization the index applied, then highlighted and centered. With
 * no `q` — or no match — the regular `article-view` anchor scroll stays the
 * landing.
 */
export function ScrollToArticleMatch() {
	const searchParams = useSearchParams();
	const phrase = searchParams.get("q") ?? "";
	useEffect(() => {
		if (!phrase) return undefined;
		const body = document.querySelector<HTMLElement>(`.${styles.articleBody}`);
		if (!body) return undefined;
		let marks: HTMLElement[] = [];
		// Small delay to ensure layout is complete, like the anchor scroll.
		const timer = setTimeout(() => {
			marks = highlightDomMatch(body, phrase, styles.searchMatch);
			marks[0]?.scrollIntoView({ behavior: "instant", block: "center" });
		}, 120);
		return () => {
			clearTimeout(timer);
			for (const mark of marks) {
				mark.replaceWith(...Array.from(mark.childNodes));
			}
		};
	}, [phrase]);

	return null;
}
