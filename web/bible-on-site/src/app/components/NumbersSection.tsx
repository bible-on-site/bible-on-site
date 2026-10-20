import { getPerekStats } from "@/lib/stats";
import styles from "./NumbersSection.module.css";
import { type StatItem, StatsCounters } from "./StatsCounters";

/**
 * Homepage "מספרים על הפרק" section: live totals rendered
 * server-side, animated once the section scrolls into view.
 */
export async function NumbersSection() {
	const stats = await getPerekStats();
	const items: StatItem[] = [
		{ label: "רבנים כותבים על הפרק", value: stats.rabbis },
		{ label: "מאמרים על הפרק", value: stats.articles },
		{ label: "ערכים על הפרק בתנכפדיה", value: stats.pediaEntries },
	];
	return (
		<section id="numbers" className={styles.section}>
			<header className={styles.header}>
				<h2>מספרים על הפרק</h2>
			</header>
			<StatsCounters stats={items} />
		</section>
	);
}
