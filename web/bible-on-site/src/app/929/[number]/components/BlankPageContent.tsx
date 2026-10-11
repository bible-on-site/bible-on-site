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
import {
	articleDocumentTitle,
	perushDocumentTitle,
	type SeferPerekTitle,
} from "./sefer-document-title";
import { setSeferOpenPerush } from "./sefer-pasuk-navigation";
import { writeSeferContentHistory } from "./useSeferContentNavigation";

interface BlankPageContentProps {
	articles?: ArticleSummary[];
	perushim?: PerushSummary[];
	perekId?: number;
	hebrewDateStr: string;
	/** Article ID or perush name selected by the current book route. */
	initialSlug?: string;
	onNavigate?: (slug?: string) => void;
	/** Title parts of this page's perek, for the perush full-view title. */
	perekTitleParts?: SeferPerekTitle;
	/** Reports the shown article/perush document title (null when none). */
	onContentTitle?: (title: string | null) => void;
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
	perekTitleParts,
	onContentTitle,
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
					if (!cancelled) {
						setSelectedArticle(full);
						if (!full) setSlug(undefined);
					}
				})
				.catch((error) => {
					console.error("Failed to load book article", {
						perekId,
						articleId: article.id,
						error,
					});
					if (!cancelled) setSlug(undefined);
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
						perekId,
						perushId: perush.id,
						error,
					});
					if (!cancelled) setSlug(undefined);
				})
				.finally(() => {
					if (!cancelled) setPerushLoading(false);
				});
		}
		return () => {
			cancelled = true;
		};
	}, [slug, articles, perushim, perekId]);

	// Report the full-view document title (issue #2176): while an article or
	// perush is shown inside the book, the tab names that content exactly like
	// its standalone page; clearing the selection hands the title back to the
	// page-level title managed by Sefer.
	useEffect(() => {
		if (!onContentTitle) return;
		const title = selectedArticle
			? articleDocumentTitle(selectedArticle)
			: selectedPerush && perekTitleParts
				? perushDocumentTitle(selectedPerush, perekTitleParts)
				: null;
		onContentTitle(title);
		// If this page unmounts while a full view is open (the flipbook buffers
		// out distant leaves), release the title back to the page-level one.
		return () => onContentTitle(null);
	}, [selectedArticle, selectedPerush, onContentTitle, perekTitleParts]);

	// Publish the open perush (with the pesukim it annotates) so pasuk numbers
	// in the facing perek text page become navigation targets; cleared on
	// close and on unmount.
	useEffect(() => {
		if (!perekId) return;
		setSeferOpenPerush(
			perekId,
			selectedPerush
				? {
						name: selectedPerush.name,
						pesukim: new Set(selectedPerush.notes.map((note) => note.pasuk)),
					}
				: null,
		);
		return () => setSeferOpenPerush(perekId, null);
	}, [perekId, selectedPerush]);

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
