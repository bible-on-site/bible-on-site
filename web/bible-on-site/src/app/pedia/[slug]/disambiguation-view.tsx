import type { Metadata } from "next";
import Link from "next/link";
import type { SynonymTarget } from "@/lib/tanahpedia/types";
import styles from "../page.module.css";

interface DisambiguationViewProps {
	name: string;
	targets: SynonymTarget[];
}

export function disambiguationMetadata(name: string): Metadata {
	return {
		title: `${name} (פירושונים) | תנכפדיה`,
		description: `לשם «${name}» יש יותר מערך אחד בתנכפדיה.`,
	};
}

export function DisambiguationView({ name, targets }: DisambiguationViewProps) {
	return (
		<div className={styles.tanahpediaPage}>
			<h1 className={styles.pageTitle}>{name}</h1>
			<p className={styles.pageSubtitle}>
				השם «{name}» מוביל ליותר מערך אחד. בחר את הערך המבוקש:
			</p>

			<ul className={styles.entityList}>
				{targets.map((target) => (
					<li key={target.entryId} className={styles.entityItem}>
						<Link
							href={`/pedia/${encodeURIComponent(target.uniqueName)}`}
							className={styles.entityEntryLink}
						>
							{target.title}
						</Link>
						{target.label && (
							<span className={styles.entityName}> — {target.label}</span>
						)}
					</li>
				))}
			</ul>

			<div className={styles.backLinkWrapper}>
				<Link href="/pedia" className={styles.backLink}>
					חזרה לתנכפדיה
				</Link>
			</div>
		</div>
	);
}
