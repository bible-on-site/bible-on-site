import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArticlesSection } from "@/app/929/[number]/components/ArticlesSection";
import { PerushimSection } from "@/app/929/[number]/components/PerushimSection";
import {
	RangeRecitationControls,
	RangeRecitationPlayer,
} from "@/app/components/reading/RangeRecitationPlayer";
import { SharedUnitText } from "@/app/components/reading/UnitText";
import { rangesRefSpans } from "@/data/parasha/parasha-units";
import { getPerekByPerekId } from "@/data/perek-dto";
import {
	getMoedArticleSummaries,
	getMoedBySlug,
	getPublishedMoedSlugs,
	type Moed,
	MOED_STALE_BOUND_SECONDS,
	moedHref,
} from "@/lib/moadim";
import { getCachedMoadim } from "@/lib/moadim/catalogue-cache";
import { getPerushimForRanges } from "@/lib/perushim/service";
import { canonicalPasukCount, rangePerekSources } from "@/lib/reading/queries";
import type { ScriptureRange } from "@/lib/reading/contract";
import { rangesPerekIds } from "@/lib/reading/ranges";
import { cachedPerKey, COLLECTION_TAGS, moedTag } from "@/lib/revalidate/tags";
import { SITE_NAME } from "@/lib/seo/jsonld";
import { pageMetadata } from "@/lib/seo/opengraph";
import { fetchAllEntityRefs } from "@/lib/tanahpedia/perek-entity-refs";
import { MoedBreadcrumb } from "../components/MoedBreadcrumb";
import styles from "./page.module.css";

// Published moadim are a growing DB set — a slug added after build
// renders on demand under the moed:{slug} tag, never 404s the deploy.
export const dynamicParams = true;

export async function generateStaticParams() {
	return (await getPublishedMoedSlugs()).map((slug) => ({ slug }));
}

/** One moed detail — tagged by slug so editorial changes expire it. The
 * hourly bound lets a pre-migration not-found self-heal after the seed
 * deploys (it emits no invalidation); tagged expiry stays instant. */
const getCachedMoed = cachedPerKey(
	"moed-detail",
	(slug: string) => slug,
	(slug) => [COLLECTION_TAGS.moadim, moedTag(slug)],
	(slug) => getMoedBySlug(slug),
	MOED_STALE_BOUND_SECONDS,
);

/** Range-bounded perushim — expire with the moed and the perush corpus. */
const getCachedMoedPerushim = cachedPerKey(
	"moed-perushim",
	(moed: Moed) => moed.slug,
	(slug) => [COLLECTION_TAGS.perushim, moedTag(slug)],
	(moed) => getPerushimForRanges(moed.ranges),
);

/** The unioned article set — article/author changes that touch a stored
 * range or explicit link emit moed:{slug} (dependencies.ts), so the tag
 * keeps the card list honest without waiting on the moed itself. */
const getCachedMoedArticles = cachedPerKey(
	"moed-article-summaries",
	(moed: Moed) => moed.slug,
	(slug) => [COLLECTION_TAGS.articles, moedTag(slug)],
	(moed) => getMoedArticleSummaries(moed.id, moed.ranges),
);

/** Every perek a section's ranges touch — the range player loads and
 * validates each one's recitation manifest (issue #3259). */
function sectionPerakim(ranges: ScriptureRange[]) {
	return rangesPerekIds(ranges).map((perekId) => {
		const perek = getPerekByPerekId(perekId);
		return {
			perekId,
			pesukim: perek.pesukim,
			hasRecording: Boolean(perek.recitation),
		};
	});
}

function decodeSlug(param: string): string {
	try {
		return decodeURIComponent(param);
	} catch {
		notFound();
	}
}

export async function generateMetadata({
	params,
}: {
	params: Promise<{ slug: string }>;
}): Promise<Metadata> {
	const { slug } = await params;
	const moed = await getCachedMoed(decodeSlug(slug));
	if (!moed) {
		return {};
	}
	return pageMetadata({
		title: `${moed.name} | מועדים על הפרק | ${SITE_NAME}`,
		description:
			moed.summary ??
			`קריאת התנ"ך ל${moed.name} — פסוקים, פירושים ומאמרים על הפרק.`,
		canonical: moedHref(moed.slug),
	});
}

/**
 * Moed detail — the stored reading plan rendered as scripture, then the
 * range-bounded commentary carousel and the unioned article cards.
 * Sections and ranges render in their stored order; each range label is
 * the canonical source span, so a cross-sefer plan shows its true
 * coordinates rather than one invented parent sefer.
 */
export default async function MoedPage({
	params,
}: {
	params: Promise<{ slug: string }>;
}) {
	const { slug } = await params;
	const moed = await getCachedMoed(decodeSlug(slug));
	if (!moed) {
		notFound();
	}
	const perekSources = rangePerekSources(moed.ranges);
	const perekIds = Object.keys(perekSources).map(Number);
	const [entityRefsByPerek, perushim, articles, siblings] = await Promise.all([
		fetchAllEntityRefs(perekIds),
		getCachedMoedPerushim(moed),
		getCachedMoedArticles(moed),
		getCachedMoadim(),
	]);
	const firstPerekId = perekIds[0] ?? 1;

	return (
		<div className={styles.container}>
			<MoedBreadcrumb moed={moed} siblings={siblings} />
			<header className={styles.header}>
				<h1 className={styles.heading}>{moed.name}</h1>
				{(moed.hebrewMonth || moed.dateLabel) && (
					<p className={styles.dateLine}>
						{[moed.hebrewMonth, moed.dateLabel].filter(Boolean).join(" · ")}
					</p>
				)}
				{moed.summary && <p className={styles.summary}>{moed.summary}</p>}
			</header>
			{moed.sections.map((section) => (
				<section
					key={section.id}
					className={styles.section}
					aria-labelledby={`moed-section-${section.id}`}
				>
					<h2
						id={`moed-section-${section.id}`}
						className={styles.sectionHeading}
					>
						{section.label}
					</h2>
					<p className={styles.sectionRefs}>
						{rangesRefSpans(section.ranges).join(" · ")}
					</p>
					<RangeRecitationPlayer
						ranges={section.ranges}
						perakim={sectionPerakim(section.ranges)}
					>
						<RangeRecitationControls playLabel={`השמעת ${section.label}`} />
						<SharedUnitText
							ranges={section.ranges}
							entityRefsByPerek={entityRefsByPerek}
							pasukCount={canonicalPasukCount}
							scrollScope={`moed-${moed.id}-s${section.id}`}
							anchorScope={`moed-${moed.id}-s${section.id}`}
							recitationWords
						/>
					</RangeRecitationPlayer>
				</section>
			))}
			<Suspense>
				<PerushimSection
					perekId={firstPerekId}
					perushim={perushim}
					title={`פירושים על ${moed.name}`}
					emptyMessage="אין פירושים למועד זה"
					scrollStorageKey={`moed-${moed.id}-perushim`}
				/>
			</Suspense>
			<ArticlesSection
				articles={articles}
				title={`מאמרים על ${moed.name}`}
				emptyMessage="אין מאמרים למועד זה"
				scrollStorageKey={`moed-${moed.id}-articles`}
			/>
		</div>
	);
}
