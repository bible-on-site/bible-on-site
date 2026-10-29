import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArticlesSection } from "@/app/929/[number]/components/ArticlesSection";
import { PerushimSection } from "@/app/929/[number]/components/PerushimSection";
import perekStyles from "@/app/929/[number]/page.module.css";
import { UnitPerushimSection } from "@/app/components/reading/UnitPerushimSection";
import { unitPerushHref } from "@/app/components/reading/unit-perush";
import {
	getAdjacentMasoraUnits,
	getMasoraUnitById,
	getMasoraUnitCount,
	getMasoraUnitsForSefer,
	MASORA_DIVISION,
	masoraPasukCount,
} from "@/data/masora/masora-units";
import { getPerekByPerekId } from "@/data/perek-dto";
import {
	DedicationLines,
	dedicationLines,
} from "@/app/components/dedications/DedicationLines";
import { getArticleSummariesForRanges } from "@/lib/articles/service";
import { getMasoraDedications } from "@/lib/dedications/loaders";
import { getPerushimForRanges } from "@/lib/perushim/service";
import { rangePerekSources } from "@/lib/reading/queries";
import { unitEquivalentPerekId, unitPerekIds } from "@/lib/reading/ranges";
import {
	cachedPerKey,
	COLLECTION_TAGS,
	masoraArticlesTag,
	masoraPerushimTag,
} from "@/lib/revalidate/tags";
import { SITE_NAME } from "@/lib/seo/jsonld";
import { pageMetadata } from "@/lib/seo/opengraph";
import { fetchAllEntityRefs } from "@/lib/tanahpedia/perek-entity-refs";
import { MasoraSeferComposite } from "./components/MasoraSeferComposite";
import { UnitBreadcrumb } from "./components/UnitBreadcrumb";
import { UnitNav } from "./components/UnitNav";
import { UnitText } from "./components/UnitText";
import styles from "./page.module.css";

// Masoretic units are a closed list derived from the canonical corpus —
// no fallback rendering for unknown ids.
export const dynamicParams = false;

export function generateStaticParams() {
	return Array.from({ length: getMasoraUnitCount() }, (_, i) => ({
		unit: String(i + 1),
	}));
}

const getCachedRangePerushim = cachedPerKey(
	"range-perushim",
	(unitId: number) => String(unitId),
	(key) => [COLLECTION_TAGS.perushim, masoraPerushimTag(Number(key))],
	async (unitId: number) => {
		const unit = getMasoraUnitById(unitId);
		return getPerushimForRanges(unit.ranges);
	},
);

const getCachedRangeArticles = cachedPerKey(
	"range-article-summaries",
	(unitId: number) => String(unitId),
	(key) => [COLLECTION_TAGS.articles, masoraArticlesTag(Number(key))],
	async (unitId: number) => {
		const unit = getMasoraUnitById(unitId);
		return getArticleSummariesForRanges(unit.ranges);
	},
);

/** Perek ids covering every masora unit of a sefer — the book view
 * reads the whole sefer, so its entity refs arrive up front. */
function seferUnitsPerekIds(seferName: string): number[] {
	const seen = new Set<number>();
	for (const unit of getMasoraUnitsForSefer(seferName)) {
		for (const perekId of unitPerekIds(unit, masoraPasukCount)) {
			seen.add(perekId);
		}
	}
	return [...seen];
}

/**
 * Deliberate SEO policy for the מסורה division: these pages re-slice the
 * same canonical corpus as /929, so they must not compete with the
 * canonical perek pages in the index.
 *
 * The section layout applies noindex,follow to every unit, including exact
 * whole-perek equivalents. Preserve the /929 canonical for an equivalent
 * span; other units stay self-canonical rather than pointing at unrelated
 * scripture.
 */
export async function generateMetadata({
	params,
}: {
	params: Promise<{ unit: string }>;
}): Promise<Metadata> {
	const { unit: unitParam } = await params;
	const unitId = Number.parseInt(unitParam, 10);
	if (Number.isNaN(unitId) || unitId < 1 || unitId > getMasoraUnitCount()) {
		notFound();
	}
	const unit = getMasoraUnitById(unitId);
	const equivalentPerekId = unitEquivalentPerekId(unit, masoraPasukCount);
	const title = `${unit.heading} | ${MASORA_DIVISION.menuLabel} | ${SITE_NAME}`;
	const description = `קריאת ${unit.heading} לפי חלוקת המסורה (פתוחה/סתומה) בתנ"ך, עם פירושים ומאמרים.`;
	// og:url stays aligned with the canonical link even when the canonical
	// points at the equivalent /929 perek page.
	return pageMetadata({
		title,
		description,
		canonical:
			equivalentPerekId !== null
				? `/929/${equivalentPerekId}`
				: `${MASORA_DIVISION.rootPath}/${unitId}`,
	});
}

export default async function MasoraUnitPage({
	params,
}: {
	params: Promise<{ unit: string }>;
}) {
	const { unit: unitParam } = await params;
	const unitId = Number.parseInt(unitParam, 10);
	if (Number.isNaN(unitId) || unitId < 1 || unitId > getMasoraUnitCount()) {
		notFound();
	}
	const unit = getMasoraUnitById(unitId);
	const [perushim, articles, entityRefsByPerek, masoraDedications] =
		await Promise.all([
			getCachedRangePerushim(unitId),
			getCachedRangeArticles(unitId),
			fetchAllEntityRefs(seferUnitsPerekIds(unit.seferName)),
			getMasoraDedications(),
		]);
	// Feature-level מסורה על הפרק dedications (#2731): one shared set for the
	// whole feature — the flat page shows it once and the book renders it on
	// the cover, never duplicated per internal unit.
	const coverDedications = dedicationLines(masoraDedications);
	const { prev, next } = getAdjacentMasoraUnits(unitId);
	const bookUnits = getMasoraUnitsForSefer(unit.seferName).map((bookUnit) => ({
		unitId: bookUnit.unitId,
		order: bookUnit.order,
		heading: bookUnit.heading,
		ranges: bookUnit.ranges,
		closingBreak: bookUnit.closingBreak,
	}));
	/** Canonical perek source labels for every perek the book renders. */
	const bookPerekSources: Record<number, string> = {};
	for (const perekId of seferUnitsPerekIds(unit.seferName)) {
		bookPerekSources[perekId] = getPerekByPerekId(perekId).source;
	}

	return (
		<>
			{/* useSearchParams inside the composite requires a boundary so
			 * the static shell can prerender (same pattern as /929). */}
			<Suspense>
				<MasoraSeferComposite
					units={bookUnits}
					seferName={unit.seferName}
					currentUnitId={unitId}
					entityRefsByPerek={entityRefsByPerek}
					perekSources={bookPerekSources}
					articles={articles}
					perushim={perushim}
					coverDedications={coverDedications}
				/>
			</Suspense>
			<div className={`${perekStyles.perekContainer} seo-content`}>
				<UnitBreadcrumb unit={unit} />
				<h1 className={perekStyles.perekHeading}>
					{unit.heading}
					{unit.closingBreak && (
						<span className={styles.closingBreak}>
							{unit.closingBreak === "ptuha" ? "פרשה פתוחה" : "פרשה סתומה"}
						</span>
					)}
				</h1>
				<DedicationLines lines={coverDedications} />
				<UnitText unit={unit} entityRefsByPerek={entityRefsByPerek} />
				<UnitNav prev={prev} next={next} />

				{/* Perushim section - commentaries bounded to the unit's ranges,
					opening in place rather than redirecting to /929 (issue #2190).
					useSearchParams inside the section requires a boundary so the
					static shell can prerender; the fallback keeps the same
					carousel with division-internal perush links. */}
				<Suspense
					fallback={
						<PerushimSection
							perekId={unit.ranges[0].start.perekId}
							perushim={perushim}
							title="פרשנים על הפרשה"
							emptyMessage="אין פרשנות לפרשה זו"
							hrefForPerush={(perush) =>
								unitPerushHref(
									`${MASORA_DIVISION.rootPath}/${unitId}`,
									"torah",
									perush.name,
								)
							}
							scrollStorageKey={`perushim-masora-${unitId}`}
						/>
					}
				>
					<UnitPerushimSection
						division="masora"
						unitId={unitId}
						scope="torah"
						unitPath={`${MASORA_DIVISION.rootPath}/${unitId}`}
						perekId={unit.ranges[0].start.perekId}
						perushim={perushim}
						title="פרשנים על הפרשה"
						emptyMessage="אין פרשנות לפרשה זו"
						scrollStorageKey={`perushim-masora-${unitId}`}
						perekSources={rangePerekSources(unit.ranges)}
					/>
				</Suspense>

				{/* Articles section - articles from every overlapping perek */}
				<ArticlesSection
					articles={articles}
					title="מאמרים על הפרשה"
					emptyMessage="אין מאמרים לפרשה זו"
					scrollStorageKey={`articles-masora-${unitId}`}
				/>
			</div>
		</>
	);
}
