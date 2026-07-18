"use client";

import { useEffect } from "react";
import styles from "./page.module.css";

function getPasukFromLocation(): number | null {
	const value = new URLSearchParams(window.location.search).get("pasuk");
	if (value == null || value === "") return null;
	const pasuk = Number.parseInt(value, 10);
	return Number.isFinite(pasuk) && pasuk > 0 ? pasuk : null;
}

export function ScrollToPerushPasukNote() {
	useEffect(() => {
		const pasuk = getPasukFromLocation();
		if (pasuk == null || pasuk < 1) return;

		for (const el of document.querySelectorAll(
			`[data-perush-pasuk="${pasuk}"]`,
		)) {
			el.classList.add(styles.noteHighlight);
		}

		const id = `perush-pasuk-${pasuk}`;
		const el = document.getElementById(id);
		if (el) {
			setTimeout(() => {
				el.scrollIntoView({ behavior: "instant", block: "center" });
			}, 120);
		}
	}, []);

	return null;
}
