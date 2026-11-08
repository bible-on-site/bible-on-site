import Link from "next/link";
import type { PerekObj } from "@/data/perek-dto";
import styles from "../page.module.css";

/** Adjacent-perek link target — only the fields the nav renders. */
export type PerekNavTarget = Pick<PerekObj, "perekId" | "source">;

/**
 * Previous/next perek links in canonical order, following the מסורה/פרשה
 * unit navigation. The perek source (e.g. "מלכים ב ג", "עזרא נ א")
 * doubles as the link label so the reader sees where each direction
 * leads; edges of the 1-929 sequence render a placeholder instead of a
 * fabricated route.
 */
export function PerekNav({
	prev,
	next,
}: {
	prev: PerekNavTarget | null;
	next: PerekNavTarget | null;
}) {
	return (
		<nav className={styles.unitNav} aria-label="ניווט בין פרקים">
			{prev ? (
				<Link
					className={styles.unitNavLink}
					href={`/929/${prev.perekId}`}
					rel="prev"
				>
					<span className={styles.unitNavDir}>הפרק הקודם</span>
					<span className={styles.unitNavRef}>{prev.source}</span>
				</Link>
			) : (
				<span />
			)}
			{next ? (
				<Link
					className={`${styles.unitNavLink} ${styles.unitNavNext}`}
					href={`/929/${next.perekId}`}
					rel="next"
				>
					<span className={styles.unitNavDir}>הפרק הבא</span>
					<span className={styles.unitNavRef}>{next.source}</span>
				</Link>
			) : (
				<span />
			)}
		</nav>
	);
}
