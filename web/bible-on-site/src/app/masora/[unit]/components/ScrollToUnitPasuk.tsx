"use client";

import { useSearchParams } from "next/navigation";
import { useEffect } from "react";

/**
 * Keep hash-selected verses highlighted in a reading-unit view. Unit
 * pasuk anchors carry canonical coordinates (`pasuk-{perekId}-{pasuk}`)
 * so units crossing perakim address original verses unambiguously.
 */
export function ScrollToUnitPasuk() {
	const searchParams = useSearchParams();

	// biome-ignore lint/correctness/useExhaustiveDependencies: Next.js supplies a new searchParams object on hash-only navigation, which must reselect the hash target.
	useEffect(() => {
		const unitText = document.querySelector<HTMLElement>(
			"[data-unit-text]",
		);
		if (!unitText) return;
		const article = unitText;
		article.dataset.pasukNavigationReady = "";
		let frame: number | undefined;

		function selectPasuk() {
			if (frame !== undefined) cancelAnimationFrame(frame);
			for (const verse of article.querySelectorAll(
				"[data-pasuk-highlight]",
			)) {
				verse.removeAttribute("data-pasuk-highlight");
				verse.removeAttribute("aria-current");
			}
			const match = /^#pasuk-([1-9]\d*)-([1-9]\d*)$/.exec(
				window.location.hash,
			);
			if (!match) return;
			const verse = document.getElementById(
				`pasuk-${match[1]}-${match[2]}`,
			);
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
	}, [searchParams]);

	return null;
}
