/**
 * Dev-only route: renders Sefer (FlipBook) view directly — no SEO overlay,
 * no toggle, no breadcrumb.  Useful for isolated debugging.
 *
 * URL: /dev/sefer/{perekId}
 *
 * This page is NOT statically generated (uses `force-dynamic`) so it works
 * without a full build step.
 */

import { unstable_cache } from "next/cache";
import { Suspense } from "react";
import { getPerekByPerekId } from "@/data/perek-dto";
import { getSeferByName, getPerekIdsForSefer } from "@/data/sefer-dto";
import { getArticlesByPerekId } from "@/lib/articles";
import { getPerushimByPerekId } from "@/lib/perushim";

import SeferDirect from "./SeferDirect";

export const dynamic = "force-dynamic";

const getCachedArticles = unstable_cache(
	async (perekId: number) => getArticlesByPerekId(perekId),
	["articles"],
	{ tags: ["articles"], revalidate: false },
);

const getCachedPerushim = unstable_cache(
	async (perekId: number) => getPerushimByPerekId(perekId),
	["perushim"],
	{ tags: ["perushim"], revalidate: false },
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

	const articlesByPerekIndex = await Promise.all(
		perekIds.map((id) => getCachedArticles(id)),
	);
	const perushimByPerekIndex = await Promise.all(
		perekIds.map((id) => getCachedPerushim(id)),
	);
	const articles = await getCachedArticles(perekId);

	return (
		<Suspense fallback={<div style={{ padding: 40, textAlign: "center" }}>טוען ספר…</div>}>
			<SeferDirect
				perekObj={perekObj}
				articles={articles}
				articlesByPerekIndex={articlesByPerekIndex}
				perushimByPerekIndex={perushimByPerekIndex}
				perekIds={perekIds}
			/>
		</Suspense>
	);
}
