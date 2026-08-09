import type { Metadata } from "next";
import Link from "next/link";
import { JsonLd } from "@/app/components/JsonLd";
import { buildCategoryGraph } from "@/lib/seo/tanahpedia-jsonld";
import type { ResolvedCategoryRoute } from "@/lib/tanahpedia/category-slug";
import {
	CATEGORY_LABELS,
	ENTITY_TYPE_LABELS,
	getAnimalsByClassification,
	getCategoryHomepage,
	getEntitiesWithEntries,
	getEntitiesWithEntriesByRole,
	getPlaceMapMarkers,
} from "@/lib/tanahpedia/service";
import type {
	AnimalKind,
	AnimalPurity,
	CategoryKey,
	PersonRole,
} from "@/lib/tanahpedia/types";
import { EntityListItem } from "../components/EntityListItem";
import { TanahpediaBreadcrumb } from "../components/TanahpediaBreadcrumb";
import { TanahpediaPlacesMap } from "../components/TanahpediaPlacesMap";
import styles from "../page.module.css";

const ANIMAL_PURITIES: CategoryKey[] = ["TAHOR", "TAMEH"];

export function categoryLabel(resolved: ResolvedCategoryRoute): string {
	return resolved.sub
		? CATEGORY_LABELS[resolved.sub]
		: ENTITY_TYPE_LABELS[resolved.entityType];
}

export function categoryMetadata(resolved: ResolvedCategoryRoute): Metadata {
	const label = categoryLabel(resolved);
	return {
		title: `${label} | תנכפדיה`,
		description: `רשימת ${label} בתנ"ך`,
		alternates: { canonical: resolved.canonicalPath },
	};
}

function loadEntities(
	resolved: ResolvedCategoryRoute,
): Promise<Awaited<ReturnType<typeof getEntitiesWithEntries>>> {
	const { entityType, sub } = resolved;
	if (sub && entityType === "PERSON") {
		return getEntitiesWithEntriesByRole(sub as PersonRole);
	}
	if (sub && entityType === "ANIMAL") {
		return ANIMAL_PURITIES.includes(sub)
			? getAnimalsByClassification("purity", sub as AnimalPurity)
			: getAnimalsByClassification("kind", sub as AnimalKind);
	}
	return getEntitiesWithEntries(entityType);
}

export async function CategoryView({
	resolved,
}: {
	resolved: ResolvedCategoryRoute;
}) {
	const { entityType, sub } = resolved;

	let entities: Awaited<ReturnType<typeof getEntitiesWithEntries>>;
	let homepage: Awaited<ReturnType<typeof getCategoryHomepage>>;
	let placeMapMarkers: Awaited<ReturnType<typeof getPlaceMapMarkers>> = [];
	let listLoadError: string | null = null;
	try {
		const mapPromise =
			entityType === "PLACE"
				? getPlaceMapMarkers().catch(() => [])
				: Promise.resolve([]);
		[entities, homepage, placeMapMarkers] = await Promise.all([
			loadEntities(resolved),
			getCategoryHomepage(entityType),
			mapPromise,
		]);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		if (process.env.NODE_ENV === "development") {
			console.error("[tanahpedia] category list DB load failed:", err);
		}
		listLoadError = msg;
		entities = [];
		homepage = null;
		placeMapMarkers = [];
	}

	const label = categoryLabel(resolved);
	const currentCategory: CategoryKey = sub ?? entityType;

	const listItems = entities.flatMap((entity) =>
		entity.linkedEntries.map((le) => ({
			uniqueName: le.uniqueName,
			title: le.title,
		})),
	);
	const categoryGraph = buildCategoryGraph({
		entityType,
		label,
		items: listItems,
	});

	return (
		<div className={styles.tanahpediaPage}>
			<JsonLd data={categoryGraph} />
			<TanahpediaBreadcrumb currentCategory={currentCategory} />
			<h1 className={styles.pageTitle}>{label}</h1>

			{listLoadError ? (
				<div className={styles.dbLoadWarning} role="alert">
					<strong className={styles.dbLoadWarningTitle}>
						לא נטענה הרשימה מהמסד
					</strong>
					<p className={styles.dbLoadWarningText}>
						בדקו חיבור ל-MySQL ושהמסד מכיל את טבלאות תנכפדיה (למשל אחרי{" "}
						<code className={styles.dbLoadWarningCode}>
							cargo make mysql-populate-dev
						</code>
						).
					</p>
					{process.env.NODE_ENV === "development" ? (
						<pre className={styles.dbLoadWarningPre}>{listLoadError}</pre>
					) : null}
				</div>
			) : null}

			{homepage?.content && !sub && (
				<div
					// biome-ignore lint/security/noDangerouslySetInnerHtml: admin-authored content
					dangerouslySetInnerHTML={{ __html: homepage.content }}
				/>
			)}

			{homepage?.layoutType === "MAP" && entityType === "PLACE" && (
				<TanahpediaPlacesMap markers={placeMapMarkers} />
			)}

			<section>
				<h2 className={styles.sectionTitle}>
					{entities.length} {label}
				</h2>
				<ul className={styles.entityList}>
					{entities.map((entity) => (
						<EntityListItem key={entity.entityId} entity={entity} />
					))}
				</ul>
			</section>

			<div className={styles.backLinkWrapper}>
				<Link href="/pedia" className={styles.backLink}>
					חזרה לתנכפדיה
				</Link>
			</div>
		</div>
	);
}
