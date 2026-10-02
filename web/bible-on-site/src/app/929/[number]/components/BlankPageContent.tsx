"use client";

import { useEffect, useState } from "react";
import type { Article, ArticleSummary } from "@/lib/articles";
import type { PerushDetail, PerushSummary } from "@/lib/perushim";
import { getArticleForBook, getPerushNotesForPage } from "../actions";
import { ArticleFullView } from "./ArticleFullView";
import { ArticlesSection } from "./ArticlesSection";
import { PerushFullView } from "./PerushFullView";
import { PerushimSection } from "./PerushimSection";
import styles from "./sefer.module.css";
import { writeSeferContentHistory } from "./useSeferContentNavigation";

interface BlankPageContentProps {
	articles?: ArticleSummary[];
	perushim?: PerushSummary[];
	perekId?: number;
	hebrewDateStr: string;
	/** Article ID or perush name selected by the current book route. */
	initialSlug?: string;
	onNavigate?: (slug?: string) => void;
}

const NO_ARTICLES: ArticleSummary[] = [];
const NO_PERUSHIM: PerushSummary[] = [];

/**
 * Blank page content in the flipbook: date, perushim carousel, articles carousel, or full view.
 * Clicking a perush/article in the carousel shows it in place (whole left page); back returns to carousels.
 * History state is pushed so the browser back button works.
 */
export function BlankPageContent({
	articles = NO_ARTICLES,
	perushim = NO_PERUSHIM,
	perekId = 0,
	hebrewDateStr,
	initialSlug,
	onNavigate,
}: BlankPageContentProps) {
	const [selectedArticle, setSelectedArticle] = useState<Article | null>(null);
	const [articleLoading, setArticleLoading] = useState(false);
	const [selectedPerush, setSelectedPerush] = useState<PerushDetail | null>(
		null,
	);
	const [perushLoading, setPerushLoading] = useState(false);
	const [slug, setSlug] = useState(initialSlug);
	useEffect(() => setSlug(initialSlug), [initialSlug]);

	useEffect(() => {
		let cancelled = false;
		setSelectedArticle(null);
		setSelectedPerush(null);
		setArticleLoading(false);
		setPerushLoading(false);
		const article = articles.find((item) => String(item.id) === slug);
		const perush = perushim.find((item) => item.name === slug);
		if (article) {
			setArticleLoading(true);
			getArticleForBook(article.id)
				.then((full) => {
					if (!cancelled) setSelectedArticle(full);
				})
				.catch((error) => {
					console.error("Failed to load book article", {
						perekId, articleId: article.id, error,
					});
				})
				.finally(() => {
					if (!cancelled) setArticleLoading(false);
				});
		} else if (perush) {
			setPerushLoading(true);
			getPerushNotesForPage(perush.id, perekId)
				.then((notes) => {
					if (!cancelled) setSelectedPerush({ ...perush, notes });
				})
				.catch((error) => {
					console.error("Failed to load book commentary", {
						perekId, perushId: perush.id, error,
					});
				})
				.finally(() => {
					if (!cancelled) setPerushLoading(false);
				});
		}
		return () => {
			cancelled = true;
		};
	}, [slug, articles, perushim, perekId]);

	const navigate = (nextSlug?: string) => {
		if (onNavigate) onNavigate(nextSlug);
		else if (perekId) writeSeferContentHistory(perekId, nextSlug);
		setSlug(nextSlug);
	};

	const hasFullView = selectedPerush || selectedArticle;

	return (
		<section
			className={styles.pageBlank}
			aria-label="עמוד ריק (פירושים ומאמרים)"
		>
			<div className={styles.blankPageDate}>{hebrewDateStr}</div>
			<div
				className={
					hasFullView
						? `${styles.blankPageArticles} ${styles.blankPageArticlesFullArticle}`
						: styles.blankPageArticles
				}
			>
				{selectedPerush ? (
					<div className={styles.blankPageArticleFullWrapper}>
						<PerushFullView
							perush={selectedPerush}
							onBack={() => navigate()}
							perekId={perekId}
							fullPage
						/>
					</div>
				) : selectedArticle ? (
					<div className={styles.blankPageArticleFullWrapper}>
						<ArticleFullView
							article={selectedArticle}
							onBack={() => navigate()}
							fullPage
						/>
					</div>
				) : (
					<>
						{perushim.length > 0 && (
							<PerushimSection
								perekId={perekId}
								perushim={perushim}
								onPerushClick={(perush) => navigate(perush.name)}
								loading={perushLoading}
							/>
						)}
						<ArticlesSection
							articles={articles}
							onArticleClick={(article) => navigate(String(article.id))}
							loading={articleLoading}
						/>
					</>
				)}
			</div>
		</section>
	);
}
