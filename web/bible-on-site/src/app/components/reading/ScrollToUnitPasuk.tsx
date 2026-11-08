"use client";

import { useSearchParams } from "next/navigation";
import { useEffect } from "react";

/**
 * Keep hash-selected verses highlighted in a reading-unit view. Unit
 * pasuk anchors carry canonical coordinates (`pasuk-{perekId}-{pasuk}`)
 * so units crossing perakim — and auxiliary readings pointing into
 * other sefarim — address original verses unambiguously. `scope` marks
 * which unit-text article this instance manages when a page renders
 * several (e.g. Torah text plus separate Haftarah variants).
 */
export function ScrollToUnitPasuk({ scope = "" }: { scope?: string }) {
	const searchParams = useSearchParams();

	// biome-ignore lint/correctness/useExhaustiveDependencies: Next.js supplies a new searchParams object on hash-only navigation, which must reselect the hash target.
	useEffect(() => {
		const article = document.querySelector<HTMLElement>(
			`[data-unit-text="${scope}"]`,
		);
		if (!article) return;
		const scopeArticle = article;
		scopeArticle.dataset.pasukNavigationReady = "";
		let frame: number | undefined;

		function selectPasuk() {
			if (frame !== undefined) cancelAnimationFrame(frame);
			for (const verse of scopeArticle.querySelectorAll(
				"[data-pasuk-highlight]",
			)) {
				verse.removeAttribute("data-pasuk-highlight");
				verse.removeAttribute("aria-current");
			}
			const match = /^#pasuk-([1-9]\d*)-([1-9]\d*)$/.exec(window.location.hash);
			if (!match) return;
			let verse = document.getElementById(`pasuk-${match[1]}-${match[2]}`);
			if (
				(!verse || !scopeArticle.contains(verse)) &&
				scope !== "" &&
				scope !== "torah"
			) {
				// Auxiliary readings scope-suffix their anchors so several
				// variants can render the same canonical pasuk on one page.
				const scoped = document.getElementById(
					`pasuk-${match[1]}-${match[2]}-${scope}`,
				);
				if (scoped) verse = scoped;
			}
			if (!verse || !scopeArticle.contains(verse)) return;
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
	}, [searchParams, scope]);

	return null;
}
