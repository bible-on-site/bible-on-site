import Link from "next/link";
import type { ReadingUnit } from "@/lib/reading/contract";
import { PARASHA_DIVISION } from "@/data/parasha/parasha-units";
import styles from "../page.module.css";

/**
 * Previous/next parasha links in canonical order. The parasha name
 * doubles as the link label so the reader sees where each direction
 * leads.
 */
export function UnitNav({
	prev,
	next,
}: {
	prev: ReadingUnit | null;
	next: ReadingUnit | null;
}) {
	return (
		<nav className={styles.unitNav} aria-label="ניווט בין פרשיות">
			{prev ? (
				<Link
					className={styles.unitNavLink}
					href={`${PARASHA_DIVISION.rootPath}/${prev.unitId}`}
				>
					<span className={styles.unitNavDir}>פרשה קודמת</span>
					<span className={styles.unitNavRef}>פרשת {prev.heading}</span>
				</Link>
			) : (
				<span />
			)}
			{next ? (
				<Link
					className={`${styles.unitNavLink} ${styles.unitNavNext}`}
					href={`${PARASHA_DIVISION.rootPath}/${next.unitId}`}
				>
					<span className={styles.unitNavDir}>פרשה הבאה</span>
					<span className={styles.unitNavRef}>פרשת {next.heading}</span>
				</Link>
			) : (
				<span />
			)}
		</nav>
	);
}
