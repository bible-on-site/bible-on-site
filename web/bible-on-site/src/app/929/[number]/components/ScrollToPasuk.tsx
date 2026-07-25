"use client";

import { useEffect } from "react";
import { parsePasukSlugToRange } from "@/lib/tanach/tanach-pasuk-range";
import styles from "../page.module.css";

function getPasukSlugFromLocation(): string | null {
	const value = new URLSearchParams(window.location.search).get("pasuk");
	return value?.trim() ? value : null;
}

/** מסמן ומגלגל לפסוק (או טווח פסוקים) המצוין ב־`?pasuk=` בדף הפרק. */
export function ScrollToPasuk({ maxVerse }: { maxVerse: number }) {
	useEffect(() => {
		const slug = getPasukSlugFromLocation();
		if (!slug) return;
		const range = parsePasukSlugToRange(slug, maxVerse);
		if (!range) return;

		let firstEl: HTMLElement | null = null;
		for (let n = range.start; n <= range.end; n++) {
			const el = document.getElementById(`pasuk-${n}`);
			if (!el) continue;
			el.classList.add(styles.pasukHighlight);
			if (!firstEl) firstEl = el;
		}

		if (firstEl) {
			const target = firstEl;
			setTimeout(() => {
				target.scrollIntoView({ behavior: "instant", block: "center" });
			}, 120);
		}
	}, [maxVerse]);

	return null;
}
