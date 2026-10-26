import DOMPurify from "isomorphic-dompurify";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { JsonLd } from "@/app/components/JsonLd";
import { ReadingTime } from "@/app/components/ReadingTime";
import { demoteHeadings } from "@/lib/html-headings";
import { plainText } from "@/lib/seo/jsonld";
import { pageMetadata } from "@/lib/seo/opengraph";
import { buildEntryGraph } from "@/lib/seo/tanahpedia-jsonld";
import { categoryHref } from "@/lib/tanahpedia/category-slug";
import { normalizeFootnoteHtml } from "@/lib/tanahpedia/normalize-footnotes";
import {
	ENTITY_TYPE_LABELS,
	getEntries,
	getEntriesByEntityType,
	getEntryByUniqueName,
	getEntryOccurrences,
	getPersonFamilySummary,
	getPlaceMapMarkersForEntry,
} from "@/lib/tanahpedia/service";
import {
	entryHref,
	resolveSynonymSlug,
} from "@/lib/tanahpedia/synonym-resolution";
import type { CategoryKey, EntityType } from "@/lib/tanahpedia/types";
import { normalizedUniqueNameFromParam } from "@/lib/tanahpedia/unique-name-param";
import { EntryOccurrencesTable } from "../components/EntryOccurrencesTable";
import { PersonFamilyTree } from "../components/PersonFamilyTree";
import { TanahpediaBreadcrumb } from "../components/TanahpediaBreadcrumb";
import { TanahpediaPlacesMap } from "../components/TanahpediaPlacesMap";
import styles from "../page.module.css";
import {
	DisambiguationView,
	disambiguationMetadata,
} from "./disambiguation-view";

export async function entryMetadata(slug: string): Promise<Metadata> {
	const name = normalizedUniqueNameFromParam(slug);
	const entry = await getEntryByUniqueName(name);
	if (!entry) {
		const resolution = await resolveSynonymSlug(name);
		if (resolution.kind === "disambiguation") {
			return disambiguationMetadata(name);
		}
		// "Not found" metadata only for a confirmed-missing slug: a lookup
		// failure propagates so the stale page (or a failed render) is kept
		// instead of caching a false negative.
		return { title: "לא נמצא" };
	}
	/* Stored footnote markers are decorative — normalized HTML keeps them
	   out of the extracted description (#2615). */
	const fromContent = entry.content
		? plainText(normalizeFootnoteHtml(entry.content), 200)
		: "";
	return pageMetadata({
		title: `${entry.title} | תנכפדיה`,
		description: fromContent.length > 0 ? fromContent : entry.title,
		canonical: entryHref(entry.uniqueName),
	});
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

	// A load failure rejects the render rather than caching a page missing
	// its breadcrumb/family/map/occurrence sections — the last good page
	// keeps serving and the next request retries against a recovered DB.
	const siblingEntries = (
		primaryEntityType
			? await getEntriesByEntityType(primaryEntityType as EntityType)
			: await getEntries(500, 0)
	).map((e) => ({
		uniqueName: e.uniqueName,
		title: e.title,
	}));

	const personEntity = entry.entities.find((e) => e.entityType === "PERSON");
	const personFamily = personEntity
		? await getPersonFamilySummary(
				personEntity.entityId,
				personEntity.entityName,
			)
		: null;

	const placeMapMarkers = await getPlaceMapMarkersForEntry(entry.id);

	const primaryEntity = entry.entities[0] ?? null;
	const occurrences = await getEntryOccurrences(entry.id);
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
			<ReadingTime
				estimatedSeconds={entry.metric?.estimatedSeconds}
				className={styles.readingTime}
			/>

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
					// biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized with DOMPurify
					dangerouslySetInnerHTML={{
						__html: DOMPurify.sanitize(
							normalizeFootnoteHtml(demoteHeadings(entry.content)),
						),
					}}
					className={styles.entryContent}
				/>
			) : placeMapMarkers.length === 0 && occurrences.length === 0 ? (
				<p className={styles.emptyContent}>אין תוכן עדיין לערך זה.</p>
			) : null}

			<EntryOccurrencesTable occurrences={occurrences} />

			<div className={styles.backLinkWrapper}>
				<Link href="/pedia" className={styles.backLink}>
					חזרה לתנכפדיה
				</Link>
			</div>
		</div>
	);
}
