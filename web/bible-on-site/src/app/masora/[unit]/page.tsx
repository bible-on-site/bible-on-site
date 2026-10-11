import type { Metadata } from "next";
import { unstable_cache } from "next/cache";
import { notFound } from "next/navigation";
import { getArticleSummariesForRanges } from "@/lib/articles/service";
import { getPerushimForRanges } from "@/lib/perushim/service";
import { unitEquivalentPerekId, unitPerekIds } from "@/lib/reading/ranges";
import { fetchAllEntityRefs } from "@/lib/tanahpedia/perek-entity-refs";
import { SITE_NAME } from "@/lib/seo/jsonld";
import {
	getAdjacentMasoraUnits,
	getMasoraUnitById,
	getMasoraUnitCount,
	MASORA_DIVISION,
	masoraPasukCount,
} from "@/data/masora/masora-units";
import { ArticlesSection } from "@/app/929/[number]/components/ArticlesSection";
import { PerushimSection } from "@/app/929/[number]/components/PerushimSection";
import perekStyles from "@/app/929/[number]/page.module.css";
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

const getCachedRangePerushim = unstable_cache(
	async (unitId: number) => {
		const unit = getMasoraUnitById(unitId);
		return getPerushimForRanges(unit.ranges);
	},
	["range-perushim"],
	{
		tags: ["perushim"],
		revalidate: false,
	},
);

const getCachedRangeArticles = unstable_cache(
	async (unitId: number) => {
		const unit = getMasoraUnitById(unitId);
		return getArticleSummariesForRanges(unit.ranges);
	},
	["range-article-summaries"],
	{
		tags: ["articles"],
		revalidate: false,
	},
);

/**
 * Deliberate SEO policy for the מסורה division: these pages re-slice the
 * same canonical corpus as /929, so they must not compete with the
 * canonical perek pages in the index.
 *
 * - A unit spanning exactly one whole perek (e.g. marker-free single-
 *   perek sefarim) consolidates: canonical points at the /929 perek.
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
	if (Number.isNaN(unitId) || unitId < 1 || unitId > getMasoraUnitCount()) {
		notFound();
	}
	const unit = getMasoraUnitById(unitId);
	const equivalentPerekId = unitEquivalentPerekId(unit, masoraPasukCount);
	const title = `${unit.heading} | ${MASORA_DIVISION.menuLabel} | ${SITE_NAME}`;
	const description = `קריאת ${unit.heading} לפי חלוקת המסורה (פתוחה/סתומה) בתנ"ך, עם פירושים ומאמרים.`;
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
		alternates: { canonical: `${MASORA_DIVISION.rootPath}/${unitId}` },
		robots: { index: false, follow: true },
	};
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
	const perekIds = unitPerekIds(unit, masoraPasukCount);
	const [perushim, articles, entityRefsByPerek] = await Promise.all([
		getCachedRangePerushim(unitId),
		getCachedRangeArticles(unitId),
		fetchAllEntityRefs(perekIds),
	]);
	const { prev, next } = getAdjacentMasoraUnits(unitId);

	return (
		<div className={perekStyles.perekContainer}>
			<UnitBreadcrumb unit={unit} />
			<h1 className={perekStyles.perekHeading}>
				{unit.heading}
				{unit.closingBreak && (
					<span className={styles.closingBreak}>
						{unit.closingBreak === "ptuha" ? "פרשה פתוחה" : "פרשה סתומה"}
					</span>
				)}
			</h1>
			<UnitText unit={unit} entityRefsByPerek={entityRefsByPerek} />
			<UnitNav prev={prev} next={next} />

			{/* Perushim section - commentaries scoped to the unit's ranges */}
			<PerushimSection
				perekId={unit.ranges[0].start.perekId}
				perushim={perushim}
				title="פרשנים על הפרשה"
				emptyMessage="אין פרשנות לפרשה זו"
			/>

			{/* Articles section - articles from every overlapping perek */}
			<ArticlesSection
				articles={articles}
				title="מאמרים על הפרשה"
				emptyMessage="אין מאמרים לפרשה זו"
			/>
		</div>
	);
}
