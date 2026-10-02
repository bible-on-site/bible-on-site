"use client";

import { useSearchParams } from "next/navigation";
import { useEffect } from "react";
import styles from "./page.module.css";

export function ScrollToPerushPasukNote() {
	const searchParams = useSearchParams();
	const pasukValue = searchParams.get("pasuk");
	useEffect(() => {
		if (!pasukValue || !/^[1-9]\d*$/.test(pasukValue)) return;
		const pasuk = Number(pasukValue);
		if (!Number.isSafeInteger(pasuk)) return;

		const notes = document.querySelectorAll(`[data-perush-pasuk="${pasuk}"]`);
		for (const el of notes) {
			el.classList.add(styles.noteHighlight);
		}

		const id = `perush-pasuk-${pasuk}`;
		const el = document.getElementById(id);
		const timer = el
			? setTimeout(() => {
					el.scrollIntoView({ behavior: "instant", block: "center" });
				}, 120)
			: undefined;
		return () => {
			clearTimeout(timer);
			for (const note of notes) note.classList.remove(styles.noteHighlight);
		};
	}, [pasukValue]);

	return null;
}
