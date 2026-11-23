/** Routes the dashboard cards link to. */
export type DashboardTarget =
	| "/articles"
	| "/rabbis"
	| "/dedications"
	| "/moadim"
	| "/bulletins";

/** One actionable stat card on the admin home dashboard (#3714). */
export interface DashboardStat {
	to: DashboardTarget;
	label: string;
	value: string;
}

export interface DashboardCounts {
	articles: number | null | undefined;
	rabbis: number | null | undefined;
	activeDedications: number | null | undefined;
	moadim: number | null | undefined;
	/** Today's Hebrew date label, e.g. for the daily bulletin card. */
	todayHebrew: string;
}

/** null/undefined counts render as a dash - the card still links through. */
const count = (value: number | null | undefined) =>
	value == null ? "-" : String(value);

export function dashboardStats(counts: DashboardCounts): DashboardStat[] {
	return [
		{
			to: "/articles",
			label: "מאמרים",
			value: count(counts.articles),
		},
		{
			to: "/rabbis",
			label: "רבנים",
			value: count(counts.rabbis),
		},
		{
			to: "/dedications",
			label: "הקדשות פעילות",
			value: count(counts.activeDedications),
		},
		{
			to: "/moadim",
			label: "מועדים",
			value: count(counts.moadim),
		},
		{
			to: "/bulletins",
			label: "עלון יומי",
			value: counts.todayHebrew,
		},
	];
}
