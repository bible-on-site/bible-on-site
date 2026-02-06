/**
 * Color schemes for sefarim:
 * - Torah: Red/burgundy tones
 * - Neviim: Blue tones (Trei Asar share one color)
 * - Ketuvim: Green tones
 */

// Trei Asar (12 minor prophets) - share the same color
const TREI_ASAR = [
	"הושע",
	"יואל",
	"עמוס",
	"עובדיה",
	"יונה",
	"מיכה",
	"נחום",
	"חבקוק",
	"צפניה",
	"חגי",
	"זכריה",
	"מלאכי",
];

// Torah colors - deep reds/burgundy
const TORAH_COLORS: Record<string, string> = {
	בראשית: "#8B0000", // dark red
	שמות: "#A52A2A", // brown-red
	ויקרא: "#B22222", // firebrick
	במדבר: "#CD5C5C", // indian red
	דברים: "#DC143C", // crimson
};

// Neviim colors - blues
const NEVIIM_COLORS: Record<string, string> = {
	יהושע: "#191970", // midnight blue
	שופטים: "#000080", // navy
	שמואל: "#00008B", // dark blue
	מלכים: "#0000CD", // medium blue
	ישעיהו: "#1E3A5F", // dark steel blue
	ירמיהו: "#2F4F7F", // slate blue
	יחזקאל: "#4169E1", // royal blue
	// Trei Asar - all share the same blue
	הושע: "#4682B4", // steel blue (shared)
	יואל: "#4682B4",
	עמוס: "#4682B4",
	עובדיה: "#4682B4",
	יונה: "#4682B4",
	מיכה: "#4682B4",
	נחום: "#4682B4",
	חבקוק: "#4682B4",
	צפניה: "#4682B4",
	חגי: "#4682B4",
	זכריה: "#4682B4",
	מלאכי: "#4682B4",
};

// Ketuvim colors - greens
const KETUVIM_COLORS: Record<string, string> = {
	תהילים: "#006400", // dark green
	משלי: "#228B22", // forest green
	איוב: "#2E8B57", // sea green
	"שיר השירים": "#3CB371", // medium sea green
	רות: "#008B8B", // dark cyan
	איכה: "#20B2AA", // light sea green
	קהלת: "#556B2F", // dark olive green
	אסתר: "#6B8E23", // olive drab
	דניאל: "#8FBC8F", // dark sea green
	עזרא: "#32CD32", // lime green
	"דברי הימים": "#90EE90", // light green
};

/**
 * Get the color for a sefer by name
 */
export function getSeferColor(seferName: string): string {
	return (
		TORAH_COLORS[seferName] ||
		NEVIIM_COLORS[seferName] ||
		KETUVIM_COLORS[seferName] ||
		"#333333" // fallback
	);
}

/**
 * Get the helek (section) color base
 */
export function getHelekColor(helek: string): string {
	switch (helek) {
		case "תורה":
			return "#8B0000"; // dark red
		case "נביאים":
			return "#000080"; // navy
		case "כתובים":
			return "#006400"; // dark green
		default:
			return "#333333";
	}
}

/**
 * Check if a sefer is part of Trei Asar
 */
export function isTreiAsar(seferName: string): boolean {
	return TREI_ASAR.includes(seferName);
}

/**
 * Get all sefer colors as a map
 */
export function getAllSeferColors(): Record<string, string> {
	return {
		...TORAH_COLORS,
		...NEVIIM_COLORS,
		...KETUVIM_COLORS,
	};
}

export { TREI_ASAR, TORAH_COLORS, NEVIIM_COLORS, KETUVIM_COLORS };
