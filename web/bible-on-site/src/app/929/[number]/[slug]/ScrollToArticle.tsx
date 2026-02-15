"use client";

import { useEffect } from "react";

/**
 * Client component that scrolls to the article view on mount.
 * Uses smooth scroll for better UX.
 */
export function ScrollToArticle() {
	useEffect(() => {
		const articleElement = document.getElementById("article-view");
		if (articleElement) {
			// Small delay to ensure layout is complete
			setTimeout(() => {
				articleElement.scrollIntoView({ behavior: "smooth", block: "start" });
			}, 100);
		}
	}, []);

	return null;
}
