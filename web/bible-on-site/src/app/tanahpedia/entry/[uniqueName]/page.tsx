import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { normalizedUniqueNameFromParam } from "@/lib/tanahpedia/unique-name-param";
import {
	ENTITY_TYPE_LABELS,
	getAllEntryUniqueNames,
	getEntries,
	getEntriesByEntityType,
	getEntryByUniqueName,
	getPersonFamilySummary,
} from "@/lib/tanahpedia/service";
import type { EntityType, CategoryKey } from "@/lib/tanahpedia/types";
import { PersonFamilyTree } from "../../components/PersonFamilyTree";
import { TanahpediaBreadcrumb } from "../../components/TanahpediaBreadcrumb";
import styles from "../../page.module.css";

/** Plain-text snippet for meta description (entry content may be HTML). */
function metaDescriptionFromContent(html: string, maxLen: number): string {
	const plain = html
		.replace(/<[^>]*>/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	return plain.slice(0, maxLen);
}

// this reserverd function is a magic for caching
/* istanbul ignore next: only runs during next build */
export async function generateStaticParams() {
	try {
		const uniqueNames = await getAllEntryUniqueNames();
		// Decoded segment values — Next encodes URLs; runtime `params` match this shape.
		return uniqueNames.map((uniqueName) => ({ uniqueName }));
	} catch {
		// If database is unavailable during build, return empty array
		// Pages will be generated on-demand
		return [];
	}
}

export async function generateMetadata({
	params,
}: {
	params: Promise<{ uniqueName: string }>;
}): Promise<Metadata> {
	const { uniqueName } = await params;
	try {
		const entry = await getEntryByUniqueName(
			normalizedUniqueNameFromParam(uniqueName),
		);
		if (!entry) return { title: "לא נמצא" };
		const fromContent = entry.content
			? metaDescriptionFromContent(entry.content, 200)
			: "";
		return {
			title: `${entry.title} | תנכפדיה`,
			description: fromContent.length > 0 ? fromContent : entry.title,
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
	const entry = await getEntryByUniqueName(
		normalizedUniqueNameFromParam(uniqueName),
	);
	if (!entry) notFound();

	// Get the primary entity type for breadcrumb (use first entity if available)
	const primaryEntityType = entry.entities.length > 0
		? (entry.entities[0].entityType as CategoryKey)
		: null;

	let siblingEntries: { uniqueName: string; title: string }[] = [];
	try {
		if (primaryEntityType) {
			const list = await getEntriesByEntityType(
				primaryEntityType as EntityType,
			);
			siblingEntries = list.map((e) => ({
				uniqueName: e.uniqueName,
				title: e.title,
			}));
		} else {
			const list = await getEntries(500, 0);
			siblingEntries = list.map((e) => ({
				uniqueName: e.uniqueName,
				title: e.title,
			}));
		}
	} catch {
		siblingEntries = [];
	}

	let personFamily = null;
	try {
		const personEntity = entry.entities.find((e) => e.entityType === "PERSON");
		if (personEntity) {
			personFamily = await getPersonFamilySummary(
				personEntity.entityId,
				personEntity.entityName,
			);
		}
	} catch {
		personFamily = null;
	}

	return (
		<div className={styles.tanahpediaPage}>
			<TanahpediaBreadcrumb
				currentCategory={primaryEntityType}
				currentEntryTitle={entry.title}
				currentEntryUniqueName={entry.uniqueName}
				siblingEntries={siblingEntries}
			/>
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

			{personFamily ? <PersonFamilyTree summary={personFamily} /> : null}

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
