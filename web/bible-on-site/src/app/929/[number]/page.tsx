// import Image from "next/image";

import { toLetters } from "gematry";
import { unstable_cache } from "next/cache";
import React, { Suspense } from "react";
import { isQriDifferentThanKtiv } from "../../../data/db/tanah-view-types";
import { getPerekByPerekId } from "../../../data/perek-dto";
import { getSeferByName, getPerekIdsForSefer } from "../../../data/sefer-dto";
import { getArticlesByPerekId } from "../../../lib/articles";
import { getPerushimByPerekId } from "../../../lib/perushim";
import { ArticlesSection } from "./components/ArticlesSection";
import { PerushimSection } from "./components/PerushimSection";
import Breadcrumb from "./components/Breadcrumb";
import { Ptuah } from "./components/Ptuha";
import SeferComposite from "./components/SeferComposite";
import { Stuma } from "./components/Stuma";
import styles from "./page.module.css";
// perakim are a closed list — no fallback rendering for unknown IDs.
export const dynamicParams = false;

// this reserverd function is a magic for caching
/* istanbul ignore next: only runs during next build */
export function generateStaticParams() {
	// Return an array of objects with the key "number" as a string
	return Array.from({ length: 929 }, (_, i) => ({ number: String(i + 1) }));
}

/**
 * Cache articles with on-demand revalidation support.
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
const getCachedArticles = unstable_cache(
	async (perekId: number) => getArticlesByPerekId(perekId),
	["articles"],
	{
		tags: ["articles"],
		revalidate: false, // No periodic revalidation - on-demand only
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


// TODO: figure out if need to use generateMetadata
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
	// Fetch articles and perushim for every perek in the sefer so each blank page shows the correct data
	const articlesByPerekIndex = await Promise.all(
		perekIds.map((id) => getCachedArticles(id)),
	);
	const perushimByPerekIndex = await Promise.all(
		perekIds.map((id) => getCachedPerushim(id)),
	);
	const articles = await getCachedArticles(perekId);
	const perushim = await getPerushimByPerekId(perekId);

	return (
		<>
			<Suspense>
				<SeferComposite
					perekObj={perekObj}
					articles={articles}
					articlesByPerekIndex={articlesByPerekIndex}
					perushimByPerekIndex={perushimByPerekIndex}
					perekIds={perekIds}
				/>
			</Suspense>
			<div className={`${styles.perekContainer} seo-content`}>
				<Breadcrumb perekObj={perekObj} />

				<article className={styles.perekText}>
					{perekObj.pesukim.map((pasuk, pasukIdx) => {
						const pasukKey = pasukIdx + 1;
						const pasukNumElement = (
							<span className={styles.pasukNum}>{toLetters(pasukIdx + 1)}</span>
						);
						const pasukElement = pasuk.segments.map((segment, segmentIdx) => {
							const segmentKey = `${pasukIdx + 1}-${segmentIdx + 1}`;
							const isQriWithDifferentKtiv =
								segment.type === "qri" && isQriDifferentThanKtiv(segment);
							// TODO: merge qris sequnce like in 929/406
							return (
								<React.Fragment key={segmentKey}>
									<span className={isQriWithDifferentKtiv ? styles.qri : ""}>
										{segment.type === "ktiv" ? (
											segment.value
										) : segment.type === "qri" ? (
											isQriWithDifferentKtiv ? (
												<>
													{/* biome-ignore lint/a11y/noLabelWithoutControl: It'll take some time to validate this fix altogether with css rules */}
													(<label />
													{segment.value})
												</>
											) : (
												segment.value
											)
										) : segment.type === "ptuha" ? (
											Ptuah()
										) : (
											Stuma()
										)}
									</span>
									{segmentIdx === pasuk.segments.length - 1 ||
									((segment.type === "ktiv" || segment.type === "qri") &&
										segment.value.at(segment.value.length - 1) ===
											"־") ? null : (
										<span> </span>
									)}
								</React.Fragment>
							);
						});
						return (
							<React.Fragment key={pasukKey}>
								{pasukNumElement}
								<span> </span>
								{pasukElement}
								<span> </span>
							</React.Fragment>
						);
					})}
				</article>

				{/* Perushim section - commentaries carousel */}
				<PerushimSection perekId={perekId} perushim={perushim} />

				{/* Articles section - fetched directly from database for lower latency */}
				<ArticlesSection articles={articles} />
			</div>
		</>
	);
}
