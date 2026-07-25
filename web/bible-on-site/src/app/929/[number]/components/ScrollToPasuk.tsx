"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { parsePasukSlugToRange } from "@/lib/tanach/tanach-pasuk-range";
import styles from "../page.module.css";

/** מסמן ומגלגל לפסוק (או טווח פסוקים) המצוין ב־`?pasuk=` בדף הפרק. */
export function ScrollToPasuk({ maxVerse }: { maxVerse: number }) {
	const searchParams = useSearchParams();

	useEffect(() => {
		const slug = searchParams.get("pasuk")?.trim();
		if (!slug) return;
		const range = parsePasukSlugToRange(slug, maxVerse);
		if (!range) return;

		let firstEl: HTMLElement | null = null;
		const highlightedElements: HTMLElement[] = [];
		for (let n = range.start; n <= range.end; n++) {
			const el = document.getElementById(`pasuk-${n}`);
			if (!el) continue;
			el.classList.add(styles.pasukHighlight);
			highlightedElements.push(el);
			if (!firstEl) firstEl = el;
		}

		const scrollTimer = firstEl
			? setTimeout(() => {
					firstEl.scrollIntoView({ behavior: "instant", block: "center" });
				}, 120)
			: undefined;

		return () => {
			if (scrollTimer !== undefined) clearTimeout(scrollTimer);
			for (const element of highlightedElements) {
				element.classList.remove(styles.pasukHighlight);
			}
		};
	}, [maxVerse, searchParams]);

	return null;
}
