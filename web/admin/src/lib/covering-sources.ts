import type { ArticleFormData } from "~/server/articles";
import {
	type CoveringSource,
	normalizeCoveringSources,
} from "~/server/covering-sources";
import type { Perek } from "~/server/perakim";
import { formatPerekLabel } from "~/utils/hebrew";

/**
 * Display label for a canonical perek, e.g. "בראשית א" or "שמואל ב ה" —
 * sefer name plus the perek label inside its context (the same source
 * formatting used by the articles navigation page).
 */
export function perekSourceLabel(perek: Perek): string {
	const perekLabel = formatPerekLabel(
		perek.perek_in_context ?? perek.perek ?? 0,
		perek.additional_letter,
	);
	return perek.sefer_name ? `${perek.sefer_name} ${perekLabel}` : perekLabel;
}

/** Orders covering sources canonically: perek id first, then pasuk. */
export function sortCoveringSources(rows: CoveringSource[]): CoveringSource[] {
	return [...rows].sort((a, b) => a.perek_id - b.perek_id || a.pasuk - b.pasuk);
}

/** Counts distinct perakim and total pesukim for the review summary. */
export function summarizeCoverage(rows: CoveringSource[]): {
	perekCount: number;
	pasukCount: number;
} {
	return {
		perekCount: new Set(rows.map((row) => row.perek_id)).size,
		pasukCount: rows.length,
	};
}

/** Canonical `{perek_id}:{pasuk}` key used for duplicate detection. */
export function coveringSourceKey(row: CoveringSource): string {
	return `${row.perek_id}:${row.pasuk}`;
}

/**
 * Why a draft row can never be saved, else null. Mirrors the coordinate
 * checks of `normalizeCoveringSources` so the editor can flag the exact row
 * before the payload guard throws.
 */
export function coveringSourceError(row: CoveringSource): string | null {
	if (!Number.isInteger(row.perek_id) || !Number.isInteger(row.pasuk)) {
		return "יש להזין מספר פסוק שלם";
	}
	if (row.pasuk < 1) {
		return "מספר הפסוק חייב להיות לפחות 1";
	}
	return null;
}

/**
 * Returns the keys appearing more than once — the editor flags them so the
 * author can fix duplicates before the server rejects the save.
 */
export function duplicateCoveringSourceKeys(
	rows: CoveringSource[],
): Set<string> {
	const seen = new Set<string>();
	const duplicates = new Set<string>();
	for (const row of rows) {
		const key = coveringSourceKey(row);
		if (seen.has(key)) duplicates.add(key);
		seen.add(key);
	}
	return duplicates;
}

/**
 * Builds the coverage fields of the save payload: when the loaded article
 * reported `coveringSources: undefined` (covering-source schema not
 * deployed), the keys are omitted entirely so the save never touches
 * coverage state; otherwise both fields are sent together.
 */
export function coverageFieldsForSave(
	coveringSources: CoveringSource[] | undefined,
	coverageVerified: boolean,
): Pick<ArticleFormData, "coveringSources" | "coverageVerified"> {
	return coveringSources === undefined
		? {}
		: {
				/* Cleared inputs stay in draft state as NaN/0; the save must
				   never carry them, so the shared server contract throws
				   instead of letting an invalid coordinate through. */
				coveringSources: sortCoveringSources(
					normalizeCoveringSources(coveringSources),
				),
				coverageVerified,
			};
}
