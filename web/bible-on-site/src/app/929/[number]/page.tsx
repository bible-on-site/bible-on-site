import type { Metadata } from "next";
import { unstable_cache } from "next/cache";
import { Suspense } from "react";
import { getPerekByPerekId } from "../../../data/perek-dto";
import { getPerekIdsForSefer, getSeferByName } from "../../../data/sefer-dto";
import { getArticleSummariesByPerekId } from "../../../lib/articles";
import { getPerushimByPerekId } from "../../../lib/perushim";
import { buildPerekGraph } from "../../../lib/seo/core-jsonld";
import { absUrl } from "../../../lib/seo/jsonld";
import { selectPerekImages } from "../../../lib/seo/perek-illustrations";
import { getPerekImagesByChapter } from "../../../lib/seo/perek-images-data";
import { fetchAllEntityRefs } from "../../../lib/tanahpedia/perek-entity-refs";
import { JsonLd } from "../../components/JsonLd";
import { ArticlesSection } from "./components/ArticlesSection";
import Breadcrumb from "./components/Breadcrumb";
import { PerekHeading } from "./components/PerekHeading";
import { PerekIntro } from "./components/PerekIntro";
import { PerekText } from "./components/PerekText";
import { PerushimSection } from "./components/PerushimSection";
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
		title,
		description,
		alternates: { canonical: `/929/${perekId}` },
		...(illustration
			? {
					robots: {
						googleBot: { "max-image-preview": "large" as const },
					},
					openGraph: {
						title,
						description,
						url: `/929/${perekId}`,
						locale: "he_IL",
						images: [
							{
								url: absUrl(illustration.socialSrc),
								width: illustration.socialWidth,
								height: illustration.socialHeight,
								alt: illustration.alt,
							},
						],
					},
					twitter: {
						card: "summary_large_image" as const,
						images: [absUrl(illustration.socialSrc)],
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
	const sefer = getSeferByName(perekObj.sefer);
	const perekIds = getPerekIdsForSefer(sefer);
	const articles = await getCachedArticleSummaries(perekId);
	const perushim = await getCachedPerushim(perekId);
	const entityRefsByPerek = await fetchAllEntityRefs(perekIds);
	const imagesByPerek = await getPerekImagesByChapter();
	const seferImages = selectPerekImages(imagesByPerek, perekIds);

	return (
		<>
			<JsonLd data={buildPerekGraph(perekObj, imagesByPerek[perekId] ?? [])} />
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
				<PerekIntro images={imagesByPerek[perekId] ?? []} />
				<PerekText
					perekObj={perekObj}
					entityRefs={entityRefsByPerek[perekId] ?? []}
				/>

				{/* Perushim section - commentaries carousel */}
				<PerushimSection perekId={perekId} perushim={perushim} />

				{/* Articles section - fetched directly from database for lower latency */}
				<ArticlesSection articles={articles} />
			</div>
		</>
	);
}
