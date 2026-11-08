import { getPerekStats } from "@/lib/stats";
import styles from "./NumbersSection.module.css";
import { type StatItem, StatsCounters } from "./StatsCounters";

/**
 * Homepage "מספרים על הפרק" section: live totals rendered
 * server-side, animated once the section scrolls into view.
 *
 * רבנים כותבים על הפרק shows the fixed word עשרות — never a computed
 * count (#2397: halakhic objection to counting rabbis).
 */
export async function NumbersSection() {
	const stats = await getPerekStats();
	/* Counter links only where a real public destination exists (#2397):
	   מאמרים have no collection route (articles live per-perek and an
	   empty /search page is not a destination), and איורים/פרקים מוקלטים
	   have no gallery/recording browse view — those stay plain text. */
	const items: StatItem[] = [
		{ label: "רבנים כותבים על הפרק", text: "עשרות", href: "/929/authors" },
		{ label: "מאמרים על הפרק", value: stats.articles },
		{
			label: "ערכים על הפרק בתנכפדיה",
			value: stats.pediaEntries,
			href: "/pedia",
		},
		{ label: "איורים על הפרק", value: stats.illustrations },
		{ label: "פרקים מוקלטים", value: stats.recordedPerakim },
		{
			label: "שנים שהתוכנית רצה",
			value: stats.programmeYears,
			href: "/calendar",
		},
	];
	return (
		<section id="numbers" className={styles.section}>
			<header className={styles.header}>
				<h2>מספרים על הפרק</h2>
			</header>
			<StatsCounters stats={items} />
			<div className={styles.bottomDivider} />
		</section>
	);
}
