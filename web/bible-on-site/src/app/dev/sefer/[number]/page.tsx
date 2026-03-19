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
import { getArticleSummariesByPerekId } from "@/lib/articles";

import SeferDirect from "./SeferDirect";

export const dynamic = "force-dynamic";

const getCachedArticleSummaries = unstable_cache(
	async (perekId: number) => getArticleSummariesByPerekId(perekId),
	["article-summaries"],
	{ tags: ["articles"], revalidate: false },
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
	const articles = await getCachedArticleSummaries(perekId);

	return (
		<Suspense fallback={<div style={{ padding: 40, textAlign: "center" }}>טוען ספר…</div>}>
			<SeferDirect
				perekObj={perekObj}
				articles={articles}
				perekIds={perekIds}
			/>
		</Suspense>
	);
}
