"use client";

import type { ArticleSummary } from "@/lib/articles";
import { ArticlesSection } from "./ArticlesSection";
import { useDailyArticleOverride } from "./use-daily-article-override";

interface DailyArticlesSectionProps {
	/** The perek this articles slot belongs to. */
	perekId: number;
	articles?: ArticleSummary[] | null;
	title?: string;
	emptyMessage?: string;
	onArticleClick?: (article: ArticleSummary) => void;
	hrefForArticle?: (article: ArticleSummary) => string;
	loading?: boolean;
	scrollStorageKey?: string;
}

/**
 * ArticlesSection wrapper for the daily reading surface (#3098): when the
 * slot's perek is today's resolved daily perek and today's Hebrew date has
 * a recurring assignment, only the assigned article renders. Otherwise the
 * server-loaded chapter list passes through untouched.
 */
export function DailyArticlesSection({
	perekId,
	articles,
	...rest
}: DailyArticlesSectionProps) {
	const override = useDailyArticleOverride();
	const dailyArticles =
		override && override.perekId === perekId ? override.articles : null;
	return <ArticlesSection articles={dailyArticles ?? articles} {...rest} />;
}
