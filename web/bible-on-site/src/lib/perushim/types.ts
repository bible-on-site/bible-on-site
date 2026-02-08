/**
 * Summary of a perush available for a specific perek (for carousel display).
 */
export interface PerushSummary {
	id: number;
	name: string;
	parshanName: string;
	/** Number of notes this perush has for the current perek */
	noteCount: number;
}

/**
 * A single commentary note on a pasuk.
 */
export interface PerushNote {
	pasuk: number;
	noteIdx: number;
	/** HTML commentary text */
	noteContent: string;
}

/**
 * Full perush detail with all notes for a specific perek.
 */
export interface PerushDetail {
	id: number;
	name: string;
	parshanName: string;
	/** Parshan birth year when known (e.g. from Sefaria). */
	parshanBirthYear?: number;
	notes: PerushNote[];
}
