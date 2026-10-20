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
	const items: StatItem[] = [
		{ label: "רבנים כותבים על הפרק", text: "עשרות" },
		{ label: "מאמרים על הפרק", value: stats.articles },
		{ label: "ערכים על הפרק בתנכפדיה", value: stats.pediaEntries },
		{ label: "פרקים מוקלטים", value: stats.recordedPerakim },
		{ label: "שנים שהתוכנית רצה", value: stats.programmeYears },
	];
	return (
		<section id="numbers" className={styles.section}>
			<header className={styles.header}>
				<h1>מספרים על הפרק</h1>
			</header>
			<StatsCounters stats={items} />
		</section>
	);
}
