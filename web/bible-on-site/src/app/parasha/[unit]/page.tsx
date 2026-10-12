import type { Metadata } from "next";
import { unstable_cache } from "next/cache";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getArticleSummariesForRanges } from "@/lib/articles/service";
import { getPerushimForRanges } from "@/lib/perushim/service";
import { canonicalPasukCount } from "@/lib/reading/queries";
import { unitEquivalentPerekId, unitPerekIds } from "@/lib/reading/ranges";
import { fetchAllEntityRefs } from "@/lib/tanahpedia/perek-entity-refs";
import { SITE_NAME } from "@/lib/seo/jsonld";
import { getPerekByPerekId } from "@/data/perek-dto";
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
import { SharedUnitText } from "@/app/components/reading/UnitText";
import { ArticlesSection } from "@/app/929/[number]/components/ArticlesSection";
import { PerushimSection } from "@/app/929/[number]/components/PerushimSection";
import perekStyles from "@/app/929/[number]/page.module.css";
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

const getCachedRangePerushim = unstable_cache(
	async (unitId: number, scope: "torah" | "haftara") => {
		const unit = getParashaUnitById(unitId);
		const ranges =
			scope === "haftara" ? parashaAuxiliaryRanges(unit) : unit.ranges;
		return getPerushimForRanges(ranges);
	},
	["parasha-range-perushim"],
	{
		tags: ["perushim"],
		revalidate: false,
	},
);

const getCachedRangeArticles = unstable_cache(
	async (unitId: number, scope: "torah" | "haftara") => {
		const unit = getParashaUnitById(unitId);
		const ranges =
			scope === "haftara" ? parashaAuxiliaryRanges(unit) : unit.ranges;
		return getArticleSummariesForRanges(ranges);
	},
	["parasha-range-article-summaries"],
	{
		tags: ["articles"],
		revalidate: false,
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
 * Deliberate SEO policy for the פרשה division: these pages re-slice the
 * same canonical corpus as /929, so they must not compete with the
 * canonical perek pages in the index.
 *
 * - A unit spanning exactly one whole perek with no auxiliary readings
 *   would consolidate to the /929 perek (none today — every parasha
 *   carries Haftarot).
 * - Every other unit is a deliberate alternate slicing — `noindex` with
 *   `follow`, so crawlers still discover links but the pages stay out of
 *   the index. The canonical stays self-referential rather than pointing
 *   at an unrelated span.
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
	const equivalentPerekId = unitEquivalentPerekId(unit, canonicalPasukCount);
	const title = `פרשת ${unit.heading} | ${PARASHA_DIVISION.menuLabel} | ${SITE_NAME}`;
	const description = `קריאת פרשת ${unit.heading} (${parashaRefSpan(unit)}) וההפטרה למנהגי הספרדים האשכנזים והתימנים, עם פירושים ומאמרים.`;
	if (equivalentPerekId !== null) {
		return {
			title,
			description,
			alternates: { canonical: `/929/${equivalentPerekId}` },
		};
	}
	return {
		title,
		description,
		alternates: { canonical: `${PARASHA_DIVISION.rootPath}/${unitId}` },
		robots: { index: false, follow: true },
	};
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
	const bookUnits = getParashaUnitsForSefer(unit.seferName).map((bookUnit) => {
		const bookEntry = getParashaEntry(bookUnit.unitId);
		return {
			unitId: bookUnit.unitId,
			name: bookEntry.name,
			order: bookUnit.order,
			refSpan: parashaRefSpan(bookUnit),
			ranges: bookUnit.ranges,
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
				/>
			</Suspense>
			<div className={`${perekStyles.perekContainer} seo-content`}>
				<UnitBreadcrumb unit={unit} />
				<h1 className={perekStyles.perekHeading}>
					פרשת {unit.heading}
					<span className={styles.refSpan}>{parashaRefSpan(unit)}</span>
				</h1>
				<h2 className={styles.readingLabel}>קריאת התורה</h2>
				<SharedUnitText
					ranges={unit.ranges}
					entityRefsByPerek={entityRefsByPerek}
					pasukCount={canonicalPasukCount}
					scrollScope="torah"
				/>
				<HaftaraSection unit={unit} entityRefsByPerek={entityRefsByPerek} />
				<UnitNav prev={prev} next={next} />

				{/* Perushim/articles scoped to the parasha's Torah ranges */}
				<PerushimSection
					perekId={unit.ranges[0].start.perekId}
					perushim={perushim}
					title="פרשנים על הפרשה"
					emptyMessage="אין פרשנות לפרשה זו"
				/>
				<ArticlesSection
					articles={articles}
					title="מאמרים על הפרשה"
					emptyMessage="אין מאמרים לפרשה זו"
				/>

				{/* Perushim/articles scoped to the Haftarah ranges */}
				<PerushimSection
					perekId={auxPerekId ?? unit.ranges[0].start.perekId}
					perushim={haftaraPerushim}
					title="פרשנים על ההפטרה"
					emptyMessage="אין פרשנות להפטרה זו"
				/>
				<ArticlesSection
					articles={haftaraArticles}
					title="מאמרים על ההפטרה"
					emptyMessage="אין מאמרים להפטרה זו"
				/>
			</div>
		</>
	);
}
