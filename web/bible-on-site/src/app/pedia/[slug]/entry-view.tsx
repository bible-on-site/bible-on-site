import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { JsonLd } from "@/app/components/JsonLd";
import { buildEntryGraph } from "@/lib/seo/tanahpedia-jsonld";
import { categoryHref } from "@/lib/tanahpedia/category-slug";
import {
	ENTITY_TYPE_LABELS,
	getEntries,
	getEntriesByEntityType,
	getEntryByUniqueName,
	getPersonFamilySummary,
	getPlaceMapMarkersForEntry,
} from "@/lib/tanahpedia/service";
import {
	entryHref,
	resolveSynonymSlug,
} from "@/lib/tanahpedia/synonym-resolution";
import type { CategoryKey, EntityType } from "@/lib/tanahpedia/types";
import { normalizedUniqueNameFromParam } from "@/lib/tanahpedia/unique-name-param";
import { PersonFamilyTree } from "../components/PersonFamilyTree";
import { TanahpediaBreadcrumb } from "../components/TanahpediaBreadcrumb";
import { TanahpediaPlacesMap } from "../components/TanahpediaPlacesMap";
import { DisambiguationView, disambiguationMetadata } from "./disambiguation-view";
import styles from "../page.module.css";

/** Plain-text snippet for meta description (entry content may be HTML). */
function metaDescriptionFromContent(html: string, maxLen: number): string {
	const plain = html
		.replace(/<[^>]*>/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	return plain.slice(0, maxLen);
}

export async function entryMetadata(slug: string): Promise<Metadata> {
	try {
		const name = normalizedUniqueNameFromParam(slug);
		const entry = await getEntryByUniqueName(name);
		if (!entry) {
			const resolution = await resolveSynonymSlug(name);
			if (resolution.kind === "disambiguation") {
				return disambiguationMetadata(name);
			}
			return { title: "לא נמצא" };
		}
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

export async function EntryView({ slug }: { slug: string }) {
	const name = normalizedUniqueNameFromParam(slug);
	const entry = await getEntryByUniqueName(name);
	if (!entry) {
		const resolution = await resolveSynonymSlug(name);
		if (resolution.kind === "alias") {
			permanentRedirect(entryHref(resolution.target.uniqueName));
		}
		if (resolution.kind === "disambiguation") {
			return <DisambiguationView name={name} targets={resolution.targets} />;
		}
		notFound();
	}

	// Get the primary entity type for breadcrumb (use first entity if available)
	const primaryEntityType =
		entry.entities.length > 0
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
	const personEntity = entry.entities.find((e) => e.entityType === "PERSON");
	try {
		if (personEntity) {
			personFamily = await getPersonFamilySummary(
				personEntity.entityId,
				personEntity.entityName,
			);
		}
	} catch (error) {
		console.error(
			"[tanahpedia] person family load failed",
			{
				uniqueName: entry.uniqueName,
				entityId: personEntity?.entityId,
			},
			error,
		);
		personFamily = null;
	}

	let placeMapMarkers: Awaited<ReturnType<typeof getPlaceMapMarkersForEntry>> =
		[];
	try {
		placeMapMarkers = await getPlaceMapMarkersForEntry(entry.id);
	} catch {
		placeMapMarkers = [];
	}

	const primaryEntity = entry.entities[0] ?? null;
	const entryGraph = buildEntryGraph({
		entry,
		personFamily,
		placeMarkers: placeMapMarkers,
		category: primaryEntity
			? {
					label: ENTITY_TYPE_LABELS[primaryEntity.entityType],
					entityType: primaryEntity.entityType,
				}
			: null,
	});

	return (
		<div className={styles.tanahpediaPage}>
			<JsonLd data={entryGraph} />
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
							href={categoryHref(ee.entityType as EntityType)}
							className={styles.entityBadge}
						>
							{ENTITY_TYPE_LABELS[ee.entityType as EntityType] ?? ee.entityType}
						</Link>
					))}
				</div>
			)}

			{placeMapMarkers.length > 0 ? (
				<section
					className={styles.entryMapSection}
					aria-labelledby="entry-place-map-heading"
				>
					<h2 id="entry-place-map-heading" className={styles.sectionTitle}>
						מפה
					</h2>
					<TanahpediaPlacesMap markers={placeMapMarkers} />
				</section>
			) : null}

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
				<Link href="/pedia" className={styles.backLink}>
					חזרה לתנכפדיה
				</Link>
			</div>
		</div>
	);
}
