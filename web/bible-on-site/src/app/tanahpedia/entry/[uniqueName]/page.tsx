import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
	ENTITY_TYPE_LABELS,
	getEntryByUniqueName,
} from "@/lib/tanahpedia/service";
import type { EntityType } from "@/lib/tanahpedia/types";
import styles from "../../page.module.css";

export async function generateMetadata({
	params,
}: {
	params: Promise<{ uniqueName: string }>;
}): Promise<Metadata> {
	const { uniqueName } = await params;
	try {
		const entry = await getEntryByUniqueName(decodeURIComponent(uniqueName));
		if (!entry) return { title: "לא נמצא" };
		return {
			title: `${entry.title} | תנכפדיה`,
			description: entry.content?.slice(0, 200) ?? entry.title,
		};
	} catch {
		return { title: "לא נמצא" };
	}
}

export default async function EntryPage({
	params,
}: {
	params: Promise<{ uniqueName: string }>;
}) {
	const { uniqueName } = await params;
	let entry: Awaited<ReturnType<typeof getEntryByUniqueName>>;
	try {
		entry = await getEntryByUniqueName(decodeURIComponent(uniqueName));
	} catch {
		notFound();
	}
	if (!entry) notFound();

	return (
		<div className={styles.tanahpediaPage}>
			<nav className={styles.breadcrumb}>
				<Link href="/tanahpedia" className={styles.breadcrumbLink}>
					תנכפדיה
				</Link>
				{" > "}
				<span>{entry.title}</span>
			</nav>
			<h1 className={styles.pageTitle}>{entry.title}</h1>

			{entry.entities.length > 0 && (
				<div className={styles.entityBadges}>
					{entry.entities.map((ee) => (
						<Link
							key={ee.id}
							href={`/tanahpedia/${ee.entityType.toLowerCase()}`}
							className={styles.entityBadge}
						>
							{ENTITY_TYPE_LABELS[ee.entityType as EntityType] ?? ee.entityType}
						</Link>
					))}
				</div>
			)}

			{entry.content ? (
				<article
					// biome-ignore lint/security/noDangerouslySetInnerHtml: admin-authored content
					dangerouslySetInnerHTML={{ __html: entry.content }}
					className={styles.entryContent}
				/>
			) : (
				<p className={styles.emptyContent}>אין תוכן עדיין לערך זה.</p>
			)}

			<div className={styles.backLinkWrapper}>
				<Link href="/tanahpedia" className={styles.backLink}>
					חזרה לתנכפדיה
				</Link>
			</div>
		</div>
	);
}
