import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArticlesSection } from "@/app/929/[number]/components/ArticlesSection";
import { PerushimSection } from "@/app/929/[number]/components/PerushimSection";
import perekStyles from "@/app/929/[number]/page.module.css";
import { UnitPerushimSection } from "@/app/components/reading/UnitPerushimSection";
import { SharedUnitText } from "@/app/components/reading/UnitText";
import { unitPerushHref } from "@/app/components/reading/unit-perush";
import {
	DEFAULT_ALIYAH_SCHEME,
	getStandaloneReading,
	getUnitAliyahMarkers,
	getUnitShabbatAliyahMarkers,
} from "@/data/parasha/parasha-aliyot";
import {
	getAdjacentParashaUnits,
	getParashaEntry,
	getParashaUnitById,
	getParashaUnitCount,
	getParashaUnitsForSefer,
	PARASHA_DIVISION,
	parashaAuxiliaryRanges,
	parashaRefSpan,
	rangesRefSpans,
} from "@/data/parasha/parasha-units";
import { getPerekByPerekId } from "@/data/perek-dto";
import { getArticleSummariesForRanges } from "@/lib/articles/service";
import { getPerushimForRanges } from "@/lib/perushim/service";
import { canonicalPasukCount, rangePerekSources } from "@/lib/reading/queries";
import { unitPerekIds } from "@/lib/reading/ranges";
import {
	cachedPerKey,
	COLLECTION_TAGS,
	parashaArticlesTag,
	parashaPerushimTag,
} from "@/lib/revalidate/tags";
import { getParashaDedications } from "@/lib/dedications/loaders";
import {
	DedicationLines,
	dedicationLines,
} from "@/app/components/dedications/DedicationLines";
import { SITE_NAME } from "@/lib/seo/jsonld";
import { pageMetadata } from "@/lib/seo/opengraph";
import { fetchAllEntityRefs } from "@/lib/tanahpedia/perek-entity-refs";
import { AliyahControls } from "./components/AliyahControls";
import { HaftaraSection } from "./components/HaftaraSection";
import { ParashaSeferComposite } from "./components/ParashaSeferComposite";
import { UnitBreadcrumb } from "./components/UnitBreadcrumb";
import { UnitNav } from "./components/UnitNav";
import styles from "./page.module.css";

// Parashot are a closed list of 54 units — no fallback rendering.
export const dynamicParams = false;

export function generateStaticParams() {
	return Array.from({ length: getParashaUnitCount() }, (_, i) => ({
		unit: String(i + 1),
	}));
}

const getCachedRangePerushim = cachedPerKey(
	"parasha-range-perushim",
	(unitId: number, scope: "torah" | "haftara") => `${unitId}:${scope}`,
	(key) => {
		const [unitId, scope] = key.split(":");
		return [
			COLLECTION_TAGS.perushim,
			parashaPerushimTag(Number(unitId), scope),
		];
	},
	async (unitId: number, scope: "torah" | "haftara") => {
		const unit = getParashaUnitById(unitId);
		const ranges =
			scope === "haftara" ? parashaAuxiliaryRanges(unit) : unit.ranges;
		return getPerushimForRanges(ranges);
	},
);

const getCachedRangeArticles = cachedPerKey(
	"parasha-range-article-summaries",
	(unitId: number, scope: "torah" | "haftara") => `${unitId}:${scope}`,
	(key) => {
		const [unitId, scope] = key.split(":");
		return [
			COLLECTION_TAGS.articles,
			parashaArticlesTag(Number(unitId), scope),
		];
	},
	async (unitId: number, scope: "torah" | "haftara") => {
		const unit = getParashaUnitById(unitId);
		const ranges =
			scope === "haftara" ? parashaAuxiliaryRanges(unit) : unit.ranges;
		return getArticleSummariesForRanges(ranges);
	},
);

/** Perek ids covering every parasha of a sefer with its Haftarot — the
 * book view reads the whole sefer, so its entity refs arrive up front. */
function seferUnitsPerekIds(seferName: string): number[] {
	const seen = new Set<number>();
	for (const unit of getParashaUnitsForSefer(seferName)) {
		for (const perekId of unitPerekIds(unit, canonicalPasukCount)) {
			seen.add(perekId);
		}
	}
	return [...seen];
}

/**
 * Each weekly parasha has one indexable, self-canonical page, including
 * its auxiliary Haftarah readings. Presentation and selected-content
 * variants are excluded by the proxy response policy without making
 * this prerendered metadata depend on request query parameters.
 */
export async function generateMetadata({
	params,
}: {
	params: Promise<{ unit: string }>;
}): Promise<Metadata> {
	const { unit: unitParam } = await params;
	const unitId = Number.parseInt(unitParam, 10);
	if (Number.isNaN(unitId) || unitId < 1 || unitId > getParashaUnitCount()) {
		notFound();
	}
	const unit = getParashaUnitById(unitId);
	const title = `פרשת ${unit.heading} | ${PARASHA_DIVISION.menuLabel} | ${SITE_NAME}`;
	const description = `קריאת פרשת ${unit.heading} (${parashaRefSpan(unit)}) וההפטרה למנהגי הספרדים האשכנזים והתימנים, עם פירושים ומאמרים.`;
	return pageMetadata({
		title,
		description,
		canonical: `${PARASHA_DIVISION.rootPath}/${unit.slug}`,
	});
}

export default async function ParashaUnitPage({
	params,
}: {
	params: Promise<{ unit: string }>;
}) {
	const { unit: unitParam } = await params;
	const unitId = Number.parseInt(unitParam, 10);
	if (Number.isNaN(unitId) || unitId < 1 || unitId > getParashaUnitCount()) {
		notFound();
	}
	const unit = getParashaUnitById(unitId);
	const auxPerekId = unit.auxiliaryReadings?.[0]?.ranges[0]?.start.perekId;
	const [
		perushim,
		articles,
		haftaraPerushim,
		haftaraArticles,
		entityRefsByPerek,
	] = await Promise.all([
		getCachedRangePerushim(unitId, "torah"),
		getCachedRangeArticles(unitId, "torah"),
		getCachedRangePerushim(unitId, "haftara"),
		getCachedRangeArticles(unitId, "haftara"),
		fetchAllEntityRefs(seferUnitsPerekIds(unit.seferName)),
	]);
	const { prev, next } = getAdjacentParashaUnits(unitId);
	// Aliyah boundary layer (issue #2519): every context/scheme marker
	// embeds in the text; AliyahControls swaps the visible key without
	// remounting scripture. The book spreads get the fixed standalone
	// Shabbat layer per unit.
	const aliyahLayer = getUnitAliyahMarkers(unitId);
	const bookUnits = getParashaUnitsForSefer(unit.seferName).map((bookUnit) => {
		const bookEntry = getParashaEntry(bookUnit.unitId);
		return {
			unitId: bookUnit.unitId,
			name: bookEntry.name,
			order: bookUnit.order,
			refSpan: parashaRefSpan(bookUnit),
			ranges: bookUnit.ranges,
			aliyahMarkers: getUnitShabbatAliyahMarkers(bookUnit.unitId),
			aliyahMarkerKey: `${getStandaloneReading(bookUnit.unitId).id}:${DEFAULT_ALIYAH_SCHEME}`,
			haftarot: bookEntry.haftarot.map((haftara) => ({
				...haftara,
				refSpan: rangesRefSpans(haftara.ranges).join(", "),
			})),
			notes: bookEntry.notes,
		};
	});
	/** Canonical perek source labels for every perek the book renders. */
	const bookPerekSources: Record<number, string> = {};
	for (const perekId of seferUnitsPerekIds(unit.seferName)) {
		bookPerekSources[perekId] = getPerekByPerekId(perekId).source;
	}

	// Parasha dedications (#2731): each unit's dedication renders once on
	// its Torah spread in the book, so the page collects a cached
	// `parasha:{id}:dedications` tag per unit the book can reach.
	const dedicationsByUnit: Record<number, string[]> = {};
	await Promise.all(
		bookUnits.map(async (bookUnit) => {
			const lines = dedicationLines(
				await getParashaDedications(bookUnit.unitId),
			);
			if (lines.length > 0) dedicationsByUnit[bookUnit.unitId] = lines;
		}),
	);

	return (
		<>
			{/* useSearchParams inside the composite requires a boundary so
			 * the static shell can prerender (same pattern as /929). The
			 * overlay stays OUTSIDE .seo-content — book view hides that
			 * container, and the composite inside it would hide itself.
			 * The current unit's flat-page summaries double as its book
			 * blank pages' carousel data; every other unit loads lazily. */}
			<Suspense>
				<ParashaSeferComposite
					units={bookUnits}
					seferName={unit.seferName}
					currentUnitId={unitId}
					entityRefsByPerek={entityRefsByPerek}
					perekSources={bookPerekSources}
					articles={articles}
					perushim={perushim}
					haftaraArticles={haftaraArticles}
					haftaraPerushim={haftaraPerushim}
					dedicationsByUnit={dedicationsByUnit}
				/>
			</Suspense>
			<div className={`${perekStyles.perekContainer} seo-content`}>
				<UnitBreadcrumb unit={unit} />
				<h1 className={perekStyles.perekHeading}>
					פרשת {unit.heading}
					<span className={styles.refSpan}>{parashaRefSpan(unit)}</span>
				</h1>
				<DedicationLines lines={dedicationsByUnit[unitId] ?? []} />
				<h2 className={styles.readingLabel}>קריאת התורה</h2>
				<Suspense>
					<AliyahControls
						contexts={aliyahLayer.contexts}
						defaultKey={aliyahLayer.defaultKey}
					/>
				</Suspense>
				<SharedUnitText
					ranges={unit.ranges}
					entityRefsByPerek={entityRefsByPerek}
					pasukCount={canonicalPasukCount}
					scrollScope="torah"
					boundaryMarkers={new Map(Object.entries(aliyahLayer.markers))}
					defaultMarkerKey={aliyahLayer.defaultKey}
				/>
				<HaftaraSection unit={unit} entityRefsByPerek={entityRefsByPerek} />
				<UnitNav prev={prev} next={next} />

				{/* Perushim/articles scoped to the parasha's Torah ranges —
					commentary opens in place, bounded to the unit's canonical
					bounds rather than redirecting to /929 (issue #2190). The
					Suspense fallback keeps the same carousel with
					division-internal perush links for prerendering. */}
				<Suspense
					fallback={
						<PerushimSection
							perekId={unit.ranges[0].start.perekId}
							perushim={perushim}
							title="פרשנים על הפרשה"
							emptyMessage="אין פרשנות לפרשה זו"
							hrefForPerush={(perush) =>
								unitPerushHref(
									`${PARASHA_DIVISION.rootPath}/${unitId}`,
									"torah",
									perush.name,
								)
							}
						/>
					}
				>
					<UnitPerushimSection
						division="parasha"
						unitId={unitId}
						scope="torah"
						unitPath={`${PARASHA_DIVISION.rootPath}/${unitId}`}
						perekId={unit.ranges[0].start.perekId}
						perushim={perushim}
						title="פרשנים על הפרשה"
						emptyMessage="אין פרשנות לפרשה זו"
						perekSources={rangePerekSources(unit.ranges)}
					/>
				</Suspense>
				<ArticlesSection
					articles={articles}
					title="מאמרים על הפרשה"
					emptyMessage="אין מאמרים לפרשה זו"
				/>

				{/* Perushim/articles scoped to the Haftarah ranges — the
					"haftara" scope bounds commentary to the union of the unit's
					auxiliary readings and keeps a separate URL param so both
					scopes can stay open independently. */}
				<Suspense
					fallback={
						<PerushimSection
							perekId={auxPerekId ?? unit.ranges[0].start.perekId}
							perushim={haftaraPerushim}
							title="פרשנים על ההפטרה"
							emptyMessage="אין פרשנות להפטרה זו"
							hrefForPerush={(perush) =>
								unitPerushHref(
									`${PARASHA_DIVISION.rootPath}/${unitId}`,
									"haftara",
									perush.name,
								)
							}
						/>
					}
				>
					<UnitPerushimSection
						division="parasha"
						unitId={unitId}
						scope="haftara"
						unitPath={`${PARASHA_DIVISION.rootPath}/${unitId}`}
						perekId={auxPerekId ?? unit.ranges[0].start.perekId}
						perushim={haftaraPerushim}
						title="פרשנים על ההפטרה"
						emptyMessage="אין פרשנות להפטרה זו"
						perekSources={rangePerekSources(parashaAuxiliaryRanges(unit))}
					/>
				</Suspense>
				<ArticlesSection
					articles={haftaraArticles}
					title="מאמרים על ההפטרה"
					emptyMessage="אין מאמרים להפטרה זו"
				/>
			</div>
		</>
	);
}
