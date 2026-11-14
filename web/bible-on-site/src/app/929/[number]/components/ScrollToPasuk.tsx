"use client";

import { useSearchParams } from "next/navigation";
import { useEffect } from "react";

/** Keep hash-selected verses highlighted after Next.js updates browser history. */
export function ScrollToPasuk({ perekId }: { perekId: number }) {
	const searchParams = useSearchParams();

	// biome-ignore lint/correctness/useExhaustiveDependencies: chapter and router URL changes must reselect the hash target, including Next.js hash-only navigation.
	useEffect(() => {
		const firstVerse = document.getElementById("pasuk-1");
		if (!firstVerse?.parentElement) return;
		const article = firstVerse.parentElement;
		article.dataset.pasukNavigationReady = "";
		let frame: number | undefined;

		function selectPasuk() {
			if (frame !== undefined) cancelAnimationFrame(frame);
			for (const verse of article.querySelectorAll("[data-pasuk-highlight]")) {
				verse.removeAttribute("data-pasuk-highlight");
				verse.removeAttribute("aria-current");
			}
			const match = /^#pasuk-([1-9]\d*)$/.exec(window.location.hash);
			if (!match) return;
			const verse = document.getElementById(`pasuk-${match[1]}`);
			if (!verse || verse.parentElement !== article) return;
			verse.dataset.pasukHighlight = "";
			verse.setAttribute("aria-current", "location");
			frame = requestAnimationFrame(() => {
				verse.scrollIntoView({ behavior: "instant", block: "start" });
			});
		}

		selectPasuk();
		window.addEventListener("hashchange", selectPasuk);
		window.addEventListener("popstate", selectPasuk);
		return () => {
			if (frame !== undefined) cancelAnimationFrame(frame);
			window.removeEventListener("hashchange", selectPasuk);
			window.removeEventListener("popstate", selectPasuk);
		};
		// Next.js supplies a new searchParams object when its canonical URL changes,
		// including hash-only navigation, which does not emit a native hashchange.
	}, [perekId, searchParams]);

	return null;
}
