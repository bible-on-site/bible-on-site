import { formatDedication } from "@/lib/dedications/types";
import type { Dedication } from "@/lib/dedications/types";
import styles from "./dedication.module.css";

/** Pre-formatted display lines (`formatDedication`) for a dedication set. */
export function dedicationLines(dedications: Dedication[]): string[] {
	return dedications.map(formatDedication);
}

/**
 * One horizontal dedication block (#2731): a line per dedication, or
 * nothing when the set is empty. Rendered as content text — dedication
 * subjects/purposes stay escaped by React, never interpreted as markup.
 */
export function DedicationLines({
	lines,
	className,
	compact,
}: {
	/** `formatDedication` output lines, already filtered to the surface's scope. */
	lines: string[];
	className?: string;
	/** Tighter styling for the in-book page header. */
	compact?: boolean;
}) {
	if (lines.length === 0) return null;
	return (
		<div
			className={`${compact ? styles.headerLine : styles.block} ${className ?? ""}`}
		>
			{lines.map((line, index) => (
				// Two dedications can format to the same line; the index keeps
				// them distinct — the list itself is positionally stable.
				// biome-ignore lint/suspicious/noArrayIndexKey: content is the identity
				<p key={index} className={styles.line}>
					{line}
				</p>
			))}
		</div>
	);
}
