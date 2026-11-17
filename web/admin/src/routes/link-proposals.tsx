import { createFileRoute, redirect } from "@tanstack/react-router";
import { getArticleLinkContribution } from "~/server/article-link-proposals";

export const Route = createFileRoute("/link-proposals")({
	validateSearch: (
		search: Record<string, unknown>,
	): { articleId: number | undefined; id?: string } => ({
		articleId:
			Number.isSafeInteger(Number(search.articleId)) &&
			Number(search.articleId) > 0
				? Number(search.articleId)
				: undefined,
		id: typeof search.id === "string" ? search.id : undefined,
	}),
	beforeLoad: async ({ search }) => {
		const id = await getArticleLinkContribution({ data: search });
		throw redirect({
			to: "/",
			search: { tab: "prs", ...(id ? { id } : {}) },
			replace: true,
		});
	},
});
