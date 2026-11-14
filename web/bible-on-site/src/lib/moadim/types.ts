import type { ScriptureRange } from "../reading/contract";

/** One published moed in the annual-wheel catalogue (#3101). */
export interface MoedSummary {
	id: number;
	slug: string;
	name: string;
	summary: string | null;
	hebrewMonth: string | null;
	dateLabel: string | null;
	annualOrder: number;
}

/** One labelled reading section with its ordered inclusive ranges. */
export interface MoedSection {
	id: number;
	label: string;
	ranges: ScriptureRange[];
}

/** The full moed detail — ordered sections + the flat range union. */
export interface Moed extends MoedSummary {
	sections: MoedSection[];
	/** Every section's ranges flattened in display order. */
	ranges: ScriptureRange[];
}
