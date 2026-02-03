"use client";

import { useCallback, useState } from "react";
import type { Article } from "@/lib/articles";
import { getArticleForBook } from "../actions";
import { ArticleFullView } from "./ArticleFullView";
import { ArticlesSection } from "./ArticlesSection";
import styles from "./sefer.module.css";

interface BlankPageContentProps {
	articles: Article[];
	hebrewDateStr: string;
}

/**
 * Blank page content in the flipbook: date, articles carousel, or full article view.
 * Clicking an article in the carousel shows it in place (whole left page); back returns to carousel.
 */
export function BlankPageContent({
	articles,
	hebrewDateStr,
}: BlankPageContentProps) {
	const [selectedArticle, setSelectedArticle] = useState<Article | null>(null);
	const [loading, setLoading] = useState(false);

	const handleArticleClick = useCallback(async (article: Article) => {
		setLoading(true);
		try {
			const full = await getArticleForBook(article.id);
			if (full) setSelectedArticle(full);
		} finally {
			setLoading(false);
		}
	}, []);

	const handleBack = useCallback(() => {
		setSelectedArticle(null);
	}, []);

	return (
		<section
			className={styles.pageBlank}
			aria-label="עמוד ריק (פירושים ומאמרים)"
		>
			<div className={styles.blankPageDate}>{hebrewDateStr}</div>
			<div
				className={
					selectedArticle
						? `${styles.blankPageArticles} ${styles.blankPageArticlesFullArticle}`
						: styles.blankPageArticles
				}
			>
				{selectedArticle ? (
					<div className={styles.blankPageArticleFullWrapper}>
						<ArticleFullView
							article={selectedArticle}
							onBack={handleBack}
							fullPage
						/>
					</div>
				) : (
					<ArticlesSection
						articles={articles}
						onArticleClick={handleArticleClick}
						loading={loading}
					/>
				)}
			</div>
		</section>
	);
}
