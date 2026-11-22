import type { Perek } from "~/server/perakim";
import { formatPerekLabel } from "~/utils/hebrew";

/** One searchable perek entry for the articles combobox (#3714). */
export interface PerekOption {
	perekId: number;
	seferName: string;
	label: string;
	/** Normalized "sefer label" haystack the query matches against. */
	text: string;
}

/** Options rendered for an empty query and the cap for any query. */
export const PEREK_OPTION_LIMIT = 60;

const normalize = (value: string) => value.trim().replace(/\s+/g, " ");

export function buildPerekOptions(perakim: Perek[]): PerekOption[] {
	const options: PerekOption[] = [];
	for (const perek of perakim) {
		if (perek.perek_id == null) continue;
		const seferName = perek.sefer_name?.trim() || "אחר";
		const label = formatPerekLabel(
			perek.perek_in_context ?? perek.perek ?? 0,
			perek.additional_letter,
		);
		options.push({
			perekId: perek.perek_id,
			seferName,
			label,
			text: normalize(`${seferName} ${label}`),
		});
	}
	return options;
}

/**
 * Matches a normalized Hebrew query ("שמואל", "שמואל ג") against the
 * "sefer label" text, and a pure-digit query against the canonical perek
 * number so the old 1-929 direct jump still works.
 */
export function filterPerekOptions(
	options: PerekOption[],
	query: string,
	limit = PEREK_OPTION_LIMIT,
): PerekOption[] {
	const normalized = normalize(query);
	const matches = normalized
		? options.filter((option) =>
				/^\d+$/.test(normalized)
					? option.perekId === Number(normalized)
					: option.text.includes(normalized),
			)
		: options;
	return matches.slice(0, limit);
}
