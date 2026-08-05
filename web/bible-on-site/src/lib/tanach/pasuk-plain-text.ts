import type { Pasuk, Segment } from "@/data/db/tanah-view-types";
import { isKtivDifferentThanQri } from "@/data/db/tanah-view-types";

/** Trailing maqaf glues the next word without a space. */
function endsWithMaqaf(value: string): boolean {
	return value.endsWith("־");
}

/**
 * Plain readable (qri) text of a pasuk: vocalized segments joined with spaces,
 * skipping ktiv variants that have a qri pair and section marks (פתוחה/סתומה).
 */
export function pasukPlainText(pasuk: Pasuk): string {
	const words: string[] = [];
	let glue = false;
	for (const segment of pasuk.segments as Segment[]) {
		if (segment.type === "ptuha" || segment.type === "stuma") continue;
		if (segment.type === "ktiv" && isKtivDifferentThanQri(segment)) continue;
		if (glue && words.length > 0) {
			words[words.length - 1] += segment.value;
		} else {
			words.push(segment.value);
		}
		glue = endsWithMaqaf(segment.value);
	}
	return words.join(" ").trim();
}
