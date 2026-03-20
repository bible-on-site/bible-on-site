import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
	CATEGORY_LABELS,
	ENTITY_TYPE_LABELS,
	ENTITY_TYPES,
	getAllEntityTypeParams,
	getAnimalsByClassification,
	getCategoryHomepage,
	getEntitiesWithEntries,
	getEntitiesWithEntriesByRole,
} from "@/lib/tanahpedia/service";
import type {
	AnimalKind,
	AnimalPurity,
	CategoryKey,
	EntityType,
	PersonRole,
} from "@/lib/tanahpedia/types";
import { TanahpediaBreadcrumb } from "../components/TanahpediaBreadcrumb";
import { EntityListItem } from "../components/EntityListItem";
import styles from "../page.module.css";

// this reserverd function is a magic for caching
/* istanbul ignore next: only runs during next build */
export async function generateStaticParams() {
	try {
		const params = await getAllEntityTypeParams();
		return params;
	} catch {
		// If database is unavailable during build, return base entity types only
		return ENTITY_TYPES.map((et) => ({ entityType: et.toLowerCase() }));
	}
}

const VALID_ROLES: PersonRole[] = ["PROPHET", "KING"];
const VALID_ANIMAL_KINDS: AnimalKind[] = ["BEHEMA", "CHAYA", "OF", "SHERETZ"];
const VALID_ANIMAL_PURITIES: AnimalPurity[] = ["TAHOR", "TAMEH"];

function normalizeEntityType(param: string): EntityType | null {
	const upper = param.toUpperCase();
	if (ENTITY_TYPES.includes(upper as EntityType)) return upper as EntityType;
	return null;
}

function normalizeRole(param: string | null): PersonRole | null {
	if (!param) return null;
	const upper = param.toUpperCase();
	if (VALID_ROLES.includes(upper as PersonRole)) return upper as PersonRole;
	return null;
}

function normalizeAnimalKind(param: string | null): AnimalKind | null {
	if (!param) return null;
	const upper = param.toUpperCase();
	if (VALID_ANIMAL_KINDS.includes(upper as AnimalKind))
		return upper as AnimalKind;
	return null;
}

function normalizeAnimalPurity(param: string | null): AnimalPurity | null {
	if (!param) return null;
	const upper = param.toUpperCase();
	if (VALID_ANIMAL_PURITIES.includes(upper as AnimalPurity))
		return upper as AnimalPurity;
	return null;
}

interface SubFilter {
	label: string;
	key: CategoryKey;
}

function resolveSubFilter(
	entityType: EntityType,
	searchP: { role?: string; kind?: string; purity?: string },
): SubFilter | null {
	if (entityType === "PERSON") {
		const role = normalizeRole(searchP.role ?? null);
		if (role) return { label: CATEGORY_LABELS[role], key: role };
	}
	if (entityType === "ANIMAL") {
		const kind = normalizeAnimalKind(searchP.kind ?? null);
		if (kind) return { label: CATEGORY_LABELS[kind], key: kind };
		const purity = normalizeAnimalPurity(searchP.purity ?? null);
		if (purity) return { label: CATEGORY_LABELS[purity], key: purity };
	}
	return null;
}

export async function generateMetadata({
	params,
	searchParams,
}: {
	params: Promise<{ entityType: string }>;
	searchParams: Promise<{ role?: string; kind?: string; purity?: string }>;
}): Promise<Metadata> {
	const { entityType: param } = await params;
	const sp = await searchParams;
	const entityType = normalizeEntityType(param);
	if (!entityType) return { title: "לא נמצא" };
	const sub = resolveSubFilter(entityType, sp);
	const label = sub ? sub.label : ENTITY_TYPE_LABELS[entityType];
	return {
		title: `${label} | תנכפדיה`,
		description: `רשימת ${label} בתנ"ך`,
	};
}

export default async function EntityTypePage({
	params,
	searchParams,
}: {
	params: Promise<{ entityType: string }>;
	searchParams: Promise<{ role?: string; kind?: string; purity?: string }>;
}) {
	const { entityType: param } = await params;
	const sp = await searchParams;
	const entityType = normalizeEntityType(param);
	if (!entityType) notFound();
	const sub = resolveSubFilter(entityType, sp);

	let entities: Awaited<ReturnType<typeof getEntitiesWithEntries>>;
	let homepage: Awaited<ReturnType<typeof getCategoryHomepage>>;
	try {
		let entitiesPromise: Promise<typeof entities>;
		if (sub && entityType === "PERSON") {
			entitiesPromise = getEntitiesWithEntriesByRole(
				sub.key as PersonRole,
			);
		} else if (sub && entityType === "ANIMAL") {
			const kind = normalizeAnimalKind(sp.kind ?? null);
			const purity = normalizeAnimalPurity(sp.purity ?? null);
			if (kind) {
				entitiesPromise = getAnimalsByClassification("kind", kind);
			} else if (purity) {
				entitiesPromise = getAnimalsByClassification("purity", purity);
			} else {
				entitiesPromise = getEntitiesWithEntries(entityType);
			}
		} else {
			entitiesPromise = getEntitiesWithEntries(entityType);
		}
		[entities, homepage] = await Promise.all([
			entitiesPromise,
			getCategoryHomepage(entityType),
		]);
	} catch {
		entities = [];
		homepage = null;
	}

	const label = sub ? sub.label : ENTITY_TYPE_LABELS[entityType];
	const currentCategory = sub ? sub.key : (entityType as CategoryKey);

	return (
		<div className={styles.tanahpediaPage}>
			<TanahpediaBreadcrumb currentCategory={currentCategory} />
			<h1 className={styles.pageTitle}>{label}</h1>

			{homepage?.content && !sub && (
				<div
					// biome-ignore lint/security/noDangerouslySetInnerHtml: admin-authored content
					dangerouslySetInnerHTML={{ __html: homepage.content }}
				/>
			)}

			{homepage?.layoutType === "MAP" && entityType === "PLACE" && (
				<div className={styles.mapPlaceholder}>
					מפת מקומות (OpenGIS) - תתווסף בקרוב
				</div>
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
				<Link href="/tanahpedia" className={styles.backLink}>
					חזרה לתנכפדיה
				</Link>
			</div>
		</div>
	);
}
