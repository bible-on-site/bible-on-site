import type { Metadata } from "next";
import { unstable_cache } from "next/cache";
import { Suspense } from "react";
import { loadRecitation } from "@/lib/recitation-loader";
import { getAdjacentPereks, getPerekByPerekId } from "../../../data/perek-dto";
import { getPerekIdsForSefer, getSeferByName } from "../../../data/sefer-dto";
import { getArticleSummariesByPerekId } from "../../../lib/articles";
import { getPerushimByPerekId } from "../../../lib/perushim";
import { getPerekMetric, metricOrFallback } from "../../../lib/reading-metrics";
import { ReadingTime } from "@/app/components/ReadingTime";
import { buildPerekGraph } from "../../../lib/seo/core-jsonld";
import { pageMetadata } from "../../../lib/seo/opengraph";
import { selectPerekImages } from "../../../lib/seo/perek-illustrations";
import { getPerekImagesByChapter } from "../../../lib/seo/perek-images-data";
import { fetchAllEntityRefs } from "../../../lib/tanahpedia/perek-entity-refs";
import { JsonLd } from "../../components/JsonLd";
import { ArticlesSection } from "./components/ArticlesSection";
import Breadcrumb from "./components/Breadcrumb";
import { PerekHeading } from "./components/PerekHeading";
import { PerekIntro } from "./components/PerekIntro";
import { PerekNav } from "./components/PerekNav";
import { PerekText } from "./components/PerekText";
import { PerushimSection } from "./components/PerushimSection";
import { QaWidget } from "./components/QaWidget";
import SeferComposite from "./components/SeferComposite";
import styles from "./page.module.css";
// perakim are a closed list — no fallback rendering for unknown IDs.
export const dynamicParams = false;

/**
 * Cache article summaries (no full content) with on-demand revalidation support.
 *
 * IMPORTANT: We use on-demand revalidation only (no periodic/time-based revalidation).
 * Periodic revalidation should be avoided because:
 * - It causes unpredictable cache invalidation across server instances
 * - It can lead to stale data being served inconsistently
 * - It makes debugging cache issues difficult
 * - On-demand revalidation provides precise control over when content updates
 *
 * To invalidate:
 * - Single page: revalidatePath('/929/{perekId}')
 * - All articles: revalidateTag('articles')
 */
const getCachedArticleSummaries = unstable_cache(
	async (perekId: number) => getArticleSummariesByPerekId(perekId),
	["article-summaries"],
	{
		tags: ["articles"],
		revalidate: false,
	},
);

/** Cache perushim summaries per perek (same caching strategy as articles). */
const getCachedPerushim = unstable_cache(
	async (perekId: number) => getPerushimByPerekId(perekId),
	["perushim"],
	{
		tags: ["perushim"],
		revalidate: false,
	},
);

/**
 * Perek word counts decorate fixed canonical content (#2607) — the metric can
 * only change on a counting-policy redeploy, so the same `perushim`-style
 * build-time cache is correct: `reading-metrics` tag lets an operator flush it
 * explicitly without waiting for a deploy.
 */
const getCachedPerekMetric = unstable_cache(
	async (perekId: number) => getPerekMetric(perekId),
	["perek-metric"],
	{
		tags: ["reading-metrics"],
		revalidate: false,
	},
);
export async function generateMetadata({
	params,
}: {
	params: Promise<{ number: string }>;
}): Promise<Metadata> {
	const { number } = await params;
	const perekId = Number.parseInt(number, 10);
	const perekObj = getPerekByPerekId(perekId);
	const illustration = (await getPerekImagesByChapter())[perekId]?.[0];
	const title = `${perekObj.source} | תנ"ך על הפרק`;
	const description =
		illustration?.description ??
		`קריאת ${perekObj.source} בתנ"ך, עם פירושים ומאמרים על הפרק.`;
	return {
		...pageMetadata({
			title,
			description,
			canonical: `/929/${perekId}`,
			image: illustration
				? {
						url: illustration.socialSrc,
						width: illustration.socialWidth,
						height: illustration.socialHeight,
						alt: illustration.alt,
					}
				: undefined,
		}),
		...(illustration
			? {
					robots: {
						googleBot: { "max-image-preview": "large" as const },
					},
				}
			: {}),
	};
}
export default async function Perek({
	params,
}: {
	params: Promise<{ number: string }>;
}) {
	const { number } = await params;
	const perekId = Number.parseInt(number, 10); // convert string to number
	const perekObj = getPerekByPerekId(perekId);
	const recitation = loadRecitation(perekObj);
	const sefer = getSeferByName(perekObj.sefer);
	const perekIds = getPerekIdsForSefer(sefer);
	const articles = await getCachedArticleSummaries(perekId);
	const perushim = await getCachedPerushim(perekId);
	// The metric is optional decoration — a failed read renders the page
	// badge-less rather than erroring, and stays uncached so the next render
	// retries. getCachedPerekMetric itself only caches a successful read.
	const perekMetric = await metricOrFallback(`perek ${perekId}`, null, () =>
		getCachedPerekMetric(perekId),
	);
	const entityRefsByPerek = await fetchAllEntityRefs(perekIds);
	const imagesByPerek = await getPerekImagesByChapter();
	const seferImages = selectPerekImages(imagesByPerek, perekIds);
	const { prev: prevPerek, next: nextPerek } = getAdjacentPereks(perekId);

	return (
		<>
			<JsonLd
				data={buildPerekGraph(
					perekObj,
					imagesByPerek[perekId] ?? [],
					recitation,
					perekMetric,
				)}
			/>
			<Suspense>
				<SeferComposite
					perekObj={perekObj}
					articles={articles}
					perushim={perushim}
					perekIds={perekIds}
					entityRefsByPerek={entityRefsByPerek}
					imagesByPerek={seferImages}
				/>
			</Suspense>
			<div className={`${styles.perekContainer} seo-content`}>
				<Breadcrumb perekObj={perekObj} />
				<PerekHeading perekObj={perekObj} />
				<ReadingTime
					estimatedSeconds={perekMetric?.estimatedSeconds}
					className={styles.readingTime}
				/>
				<PerekIntro images={imagesByPerek[perekId] ?? []} />
				<PerekText
					perekObj={perekObj}
					entityRefs={entityRefsByPerek[perekId] ?? []}
				/>
				<PerekNav prev={prevPerek} next={nextPerek} />

				{/* Perushim section - commentaries carousel */}
				<PerushimSection
					perekId={perekId}
					perushim={perushim}
					scrollStorageKey={`perushim-perek-${perekId}`}
				/>

				{/* Articles section - fetched directly from database for lower latency */}
				<ArticlesSection
					articles={articles}
					scrollStorageKey={`articles-perek-${perekId}`}
				/>
			</div>

			{/* QaWidget must be outside perekContainer (z-index:6 stacking context)
			    so its fixed-position elements can layer above the navbar (z-index:10000). */}
			<QaWidget perekId={perekId} seferPerekIds={perekIds} />
		</>
	);
}
