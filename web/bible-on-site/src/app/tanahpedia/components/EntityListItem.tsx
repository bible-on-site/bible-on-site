import Link from "next/link";
import type { EntityWithEntries } from "@/lib/tanahpedia/types";
import styles from "../page.module.css";

export function EntityListItem({ entity }: { entity: EntityWithEntries }) {
	const { entityName, linkedEntries } = entity;

	if (linkedEntries.length === 0) {
		return (
			<li className={styles.entityItem}>
				<span className={styles.entityName}>{entityName}</span>
				<span className={styles.noEntryBadge}> (אין ערך)</span>
			</li>
		);
	}

	if (linkedEntries.length === 1) {
		const entry = linkedEntries[0];
		return (
			<li className={styles.entityItem}>
				<Link
					href={`/tanahpedia/entry/${encodeURIComponent(entry.uniqueName)}`}
					className={styles.entityEntryLink}
				>
					{entityName}
				</Link>
			</li>
		);
	}

	return (
		<li className={styles.entityItem}>
			<span className={styles.entityName}>{entityName}</span>
			<span className={styles.entityEntryList}>
				{" ["}
				{linkedEntries.map((entry, i) => (
					<span key={entry.id}>
						{i > 0 && ", "}
						<Link
							href={`/tanahpedia/entry/${encodeURIComponent(entry.uniqueName)}`}
							className={styles.entityEntryLink}
						>
							{entry.title}
						</Link>
					</span>
				))}
				{"]"}
			</span>
		</li>
	);
}
