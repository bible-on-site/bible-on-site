import type { PerekObj } from "@/data/perek-dto";
import styles from "../page.module.css";

export function PerekHeading({
	perekObj,
	level = 1,
}: {
	perekObj: PerekObj;
	/** h1 on the canonical perek page; h2 where a page owns another h1 (#2393). */
	level?: 1 | 2;
}) {
	const header = perekObj.header.trim();
	const Heading = `h${level}` as const;
	return (
		<Heading className={styles.perekHeading}>
			{header ? `${perekObj.source} - ${header}` : perekObj.source}
		</Heading>
	);
}
