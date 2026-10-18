/**
 * Front-cover text shared by the interactive Sefer reader (#2340) and the
 * full-Sefer PDF export (#2335), so the two covers cannot drift.
 */
export const SEFER_COVER_BRANDING = 'תנ"ך על הפרק';
export const SEFER_COVER_SUBTITLE = "מקראות גדולות";
export const SEFER_COVER_EDITION = "עם מאמרים מרבנים בני זמנינו";

export function getSeferCoverTitle(seferName: string): string {
	return `ספר ${seferName}`;
}
