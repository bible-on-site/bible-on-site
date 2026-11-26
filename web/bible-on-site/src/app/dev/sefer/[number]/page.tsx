/**
 * Dev-only route: renders Sefer (FlipBook) view directly — no SEO overlay,
 * no toggle, no breadcrumb.  Useful for isolated debugging.
 *
 * URL: /dev/sefer/{perekId}
 *
 * This page is NOT statically generated (uses `force-dynamic`) so it works
 * without a full build step.
 */

import { Suspense } from "react";
import { getPerekByPerekId } from "@/data/perek-dto";
import { getSeferByName, getPerekIdsForSefer } from "@/data/sefer-dto";
import {
	getArticleSummariesByPerekId,
	getFurtherReadingSummariesByPerekId,
} from "@/lib/articles";
import { authorPortraitCacheKey } from "@/lib/authors/portrait-snapshot";
import { getPerushimByPerekId } from "@/lib/perushim";
import {
	cachedPerKey,
	COLLECTION_TAGS,
	perekArticlesTag,
	perekPerushimTag,
} from "@/lib/revalidate/tags";

import SeferDirect from "./SeferDirect";

export const dynamic = "force-dynamic";

const getCachedArticleSummaries = cachedPerKey(
	authorPortraitCacheKey("article-summaries"),
	(perekId: number) => String(perekId),
	(key) => [COLLECTION_TAGS.articles, perekArticlesTag(Number(key))],
	(perekId: number) => getArticleSummariesByPerekId(perekId),
);

const getCachedPerushim = cachedPerKey(
	"perushim",
	(perekId: number) => String(perekId),
	(key) => [COLLECTION_TAGS.perushim, perekPerushimTag(Number(key))],
	(perekId: number) => getPerushimByPerekId(perekId),
);

const getCachedFurtherReading = cachedPerKey(
	authorPortraitCacheKey("further-reading-summaries"),
	(perekId: number) => String(perekId),
	(key) => [COLLECTION_TAGS.articles, perekArticlesTag(Number(key))],
	(perekId: number) => getFurtherReadingSummariesByPerekId(perekId),
);

export default async function DevSeferPage({
	params,
}: {
	params: Promise<{ number: string }>;
}) {
	const { number } = await params;
	const perekId = Number.parseInt(number, 10);
	const perekObj = getPerekByPerekId(perekId);
	const sefer = getSeferByName(perekObj.sefer);
	const perekIds = getPerekIdsForSefer(sefer);
	const [articles, furtherArticles, perushim] = await Promise.all([
		getCachedArticleSummaries(perekId),
		getCachedFurtherReading(perekId),
		getCachedPerushim(perekId),
	]);

	return (
		<Suspense fallback={<div style={{ padding: 40, textAlign: "center" }}>טוען ספר…</div>}>
			<SeferDirect
				perekObj={perekObj}
				articles={articles}
				furtherArticles={furtherArticles}
				perushim={perushim}
				perekIds={perekIds}
			/>
		</Suspense>
	);
}
