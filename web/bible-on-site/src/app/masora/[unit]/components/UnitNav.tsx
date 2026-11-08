import Link from "next/link";
import type { ReadingUnit } from "@/lib/reading/contract";
import { MASORA_DIVISION } from "@/data/masora/masora-units";
import styles from "../page.module.css";

/**
 * Previous/next unit links in canonical order. The unit heading doubles
 * as the link label so the reader sees where each direction leads.
 */
export function UnitNav({
	prev,
	next,
}: {
	prev: ReadingUnit | null;
	next: ReadingUnit | null;
}) {
	return (
		<nav className={styles.unitNav} aria-label="ניווט בין פרשות">
			{prev ? (
				<Link
					className={styles.unitNavLink}
					href={`${MASORA_DIVISION.rootPath}/${prev.unitId}`}
				>
					<span className={styles.unitNavDir}>פרשה קודמת</span>
					<span className={styles.unitNavRef}>{prev.heading}</span>
				</Link>
			) : (
				<span />
			)}
			{next ? (
				<Link
					className={`${styles.unitNavLink} ${styles.unitNavNext}`}
					href={`${MASORA_DIVISION.rootPath}/${next.unitId}`}
				>
					<span className={styles.unitNavDir}>פרשה הבאה</span>
					<span className={styles.unitNavRef}>{next.heading}</span>
				</Link>
			) : (
				<span />
			)}
		</nav>
	);
}
