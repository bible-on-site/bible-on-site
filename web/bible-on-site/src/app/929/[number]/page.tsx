// import Image from "next/image";

import { toLetters } from "gematry";
import { unstable_cache } from "next/cache";
import React, { Suspense } from "react";
import { getPerekByPerekId } from "../../../data/perek-dto";
import { getSeferByName, getPerekIdsForSefer } from "../../../data/sefer-dto";
import { getArticleSummariesByPerekId } from "../../../lib/articles";
import { getPerushimByPerekId } from "../../../lib/perushim";
import { buildEntityRefLookup } from "../../../lib/tanahpedia/entity-ref-lookup";
import type { PerekEntityReference } from "../../../lib/tanahpedia/service";
import { getEntityReferencesForPerek } from "../../../lib/tanahpedia/service";
import { ArticlesSection } from "./components/ArticlesSection";
import { PerushimSection } from "./components/PerushimSection";
import Breadcrumb from "./components/Breadcrumb";
import { Ptuah } from "./components/Ptuha";
import SeferComposite from "./components/SeferComposite";
import { Stuma } from "./components/Stuma";
import { TanahpediaLink } from "./components/TanahpediaLink";
import { renderPasukWithEntityRefs } from "./components/pasuk-renderer";
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
/** Cache entity references for tanahpedia links in pasuk text. */
const getCachedEntityRefs = unstable_cache(
	async (perekId: number) => getEntityReferencesForPerek(perekId),
	["tanahpedia-entity-refs"],
	{
		tags: ["tanahpedia-entity-refs"],
		revalidate: false,
	},
);

/**
 * Fetch entity references for all perekIds in a sefer.
 * Returns a serializable record (perekId → refs[]) for passing to client components.
 */
async function fetchAllEntityRefs(
	perekIds: number[],
): Promise<Record<number, PerekEntityReference[]>> {
	const allRefs = await Promise.all(
		perekIds.map((id) => getCachedEntityRefs(id)),
	);
	const result: Record<number, PerekEntityReference[]> = {};
	for (let i = 0; i < perekIds.length; i++) {
		if (allRefs[i].length > 0) {
			result[perekIds[i]] = allRefs[i];
		}
	}
	return result;
}

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
	const articles = await getCachedArticleSummaries(perekId);
	const perushim = await getCachedPerushim(perekId);
	const entityRefsByPerek = await fetchAllEntityRefs(perekIds);
	const entityRefLookup = buildEntityRefLookup(entityRefsByPerek[perekId] ?? []);

	return (
		<>
			<Suspense>
				<SeferComposite
					perekObj={perekObj}
					articles={articles}
					perushim={perushim}
					perekIds={perekIds}
					entityRefsByPerek={entityRefsByPerek}
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
						const pasukElement = renderPasukWithEntityRefs(
							pasuk.segments,
							pasukIdx,
							entityRefLookup,
							Ptuah,
							Stuma,
							styles.qri,
							(entryUniqueName, children, key) => (
								<TanahpediaLink
									key={key}
									entryUniqueName={entryUniqueName}
									className={styles.tanahpediaLink}
								>
									{children}
								</TanahpediaLink>
							),
						);
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
