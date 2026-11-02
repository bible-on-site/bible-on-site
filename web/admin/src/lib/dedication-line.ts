const HEALING_PURPOSES = new Set([
	"רפואה",
	"לרפואה",
	"לרפואת",
	"רפואה שלמה",
	"רפואה שלימה",
	"לרפואה שלמה",
	"לרפואה שלימה",
]);

function displayPurpose(purpose: string): string {
	const clean = purpose
		.trim()
		.replace(/\s+/g, " ")
		.replace(/[״“”„]/g, '"')
		.replace(/[׳‘’]/g, "'");
	return HEALING_PURPOSES.has(clean) ? "לרפואת" : clean;
}

/**
 * The public line the website renders — mirrors the website's
 * formatDedication (#2849): purposes first (healing variants folded to
 * לרפואת, joined with ו) then the exact subject; the subject alone when no
 * purpose is given.
 */
export function previewDedicationLine(
	subject: string,
	purposes: string[],
): string {
	const clean = [...new Set(purposes.map(displayPurpose).filter(Boolean))];
	return clean.length === 0 ? subject : `${clean.join(" ו")} ${subject}`;
}
