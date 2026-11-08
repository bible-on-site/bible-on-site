import { toLetters } from "gematry";
import { getPerekByPerekId } from "@/data/perek-dto";
import type { ScriptureCoordinate } from "./contract";

/**
 * Single coordinate rendered as a scripture reference, using the perek's
 * canonical printed context ("שמואל א יב ה").
 */
export function formatCoordinateRef(coordinate: ScriptureCoordinate): string {
	const perek = getPerekByPerekId(coordinate.perekId);
	return `${perek.source} ${toLetters(coordinate.pasuk)}`;
}

/**
 * Display span for a coordinate pair, e.g. "בראשית א א - ו ח".
 * Same-perek spans collapse to "שמואל א יב ה-ז"; cross-perek spans keep
 * both endpoints ("בראשית לה כב - מ א"). The sefer name prefixes the
 * start ref; the end ref repeats only the perek context.
 */
export function formatCoordinateSpan(
	start: ScriptureCoordinate,
	end: ScriptureCoordinate,
): string {
	const startRef = formatCoordinateRef(start);
	const endPerek = getPerekByPerekId(end.perekId);
	if (start.perekId === end.perekId) {
		return start.pasuk === end.pasuk
			? startRef
			: `${startRef}-${toLetters(end.pasuk)}`;
	}
	const endPerekContext = endPerek.additional
		? `${endPerek.additional} ${endPerek.perekHeb}`
		: endPerek.perekHeb;
	return `${startRef} - ${endPerekContext} ${toLetters(end.pasuk)}`;
}
