"use client";

import { useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { highlightDomMatch } from "../../../../lib/search/dom-match";
import styles from "./page.module.css";

/**
 * Lands on the exact note a perush search hit points at (#2078):
 * `pasuk` names the verse, optional `note` the note_idx fragment within it,
 * and optional `q` the phrase — re-located in the rendered note with the
 * index's normalization, then highlighted and centered. Without `note`/`q`
 * the behavior is the original first-note pasuk scroll.
 */
export function ScrollToPerushPasukNote() {
	const searchParams = useSearchParams();
	const pasukValue = searchParams.get("pasuk");
	const noteValue = searchParams.get("note");
	const phrase = searchParams.get("q") ?? "";
	useEffect(() => {
		if (!pasukValue || !/^[1-9]\d*$/.test(pasukValue)) return undefined;
		const pasuk = Number(pasukValue);
		if (!Number.isSafeInteger(pasuk)) return undefined;
		const noteIdx =
			noteValue && /^\d+$/.test(noteValue) ? Number(noteValue) : null;

		// `note` selects the hit fragment itself; otherwise every note of the
		// pasuk is highlighted as before.
		const hitNote =
			noteIdx !== null
				? document.querySelector(
						`[data-perush-pasuk="${pasuk}"][data-perush-note="${noteIdx}"]`,
					)
				: null;
		const notes = hitNote
			? [hitNote]
			: Array.from(document.querySelectorAll(`[data-perush-pasuk="${pasuk}"]`));
		for (const el of notes) {
			el.classList.add(styles.noteHighlight);
		}

		const anchor = hitNote ?? document.getElementById(`perush-pasuk-${pasuk}`);
		let marks: HTMLElement[] = [];
		const timer = anchor
			? setTimeout(() => {
					let target: Element = anchor;
					if (phrase && anchor instanceof HTMLElement) {
						marks = highlightDomMatch(anchor, phrase, styles.searchMatch);
						if (marks.length > 0) target = marks[0];
					}
					target.scrollIntoView({ behavior: "instant", block: "center" });
				}, 120)
			: undefined;
		return () => {
			clearTimeout(timer);
			for (const mark of marks) {
				mark.replaceWith(...Array.from(mark.childNodes));
			}
			for (const note of notes) note.classList.remove(styles.noteHighlight);
		};
	}, [pasukValue, noteValue, phrase]);

	return null;
}
