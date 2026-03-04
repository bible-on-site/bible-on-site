"use client";

import { toLetters } from "gematry";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Article } from "@/lib/articles";
import type { PerushDetail, PerushSummary } from "@/lib/perushim";
import { getArticleForBook, getPerushNotesForPage } from "../actions";
import { ArticleFullView } from "./ArticleFullView";
import { ArticlesSection } from "./ArticlesSection";
import { PerushFullView } from "./PerushFullView";
import { PerushimSection } from "./PerushimSection";
import styles from "./sefer.module.css";

interface BlankPageContentProps {
	articles: Article[];
	perushim?: PerushSummary[];
	perekId?: number;
	hebrewDateStr: string;
	/** When set, auto-expand the article (numeric) or perush (name) on mount */
	initialSlug?: string;
	/** Dynamically expand a perush (by name) or article (by numeric id string) — set by QA navigation */
	expandSlug?: string;
	/** Change token to re-trigger expansion even with the same slug */
	expandToken?: number;
	/** Target note pasuk for scrolling after perush expansion */
	expandNotePasuk?: number;
	/** Target note index for scrolling after perush expansion */
	expandNoteIdx?: number;
}

/**
 * Blank page content in the flipbook: date, perushim carousel, articles carousel, or full view.
 * Clicking a perush/article in the carousel shows it in place (whole left page); back returns to carousels.
 */
export function BlankPageContent({
	articles,
	perushim = [],
	perekId = 0,
	hebrewDateStr,
	initialSlug,
	expandSlug,
	expandToken,
	expandNotePasuk,
	expandNoteIdx,
}: BlankPageContentProps) {
	const [selectedArticle, setSelectedArticle] = useState<Article | null>(null);
	const [articleLoading, setArticleLoading] = useState(false);
	const [selectedPerush, setSelectedPerush] = useState<PerushDetail | null>(
		null,
	);
	const [perushLoading, setPerushLoading] = useState(false);
	const initialSlugHandled = useRef(false);

	const handleArticleClick = useCallback(async (article: Article) => {
		setArticleLoading(true);
		try {
			const full = await getArticleForBook(article.id);
			if (full) setSelectedArticle(full);
		} finally {
			setArticleLoading(false);
		}
	}, []);

	const handlePerushClick = useCallback(
		async (perush: PerushSummary) => {
			setPerushLoading(true);
			try {
				const notes = await getPerushNotesForPage(perush.id, perekId);
				setSelectedPerush({
					id: perush.id,
					name: perush.name,
					parshanName: perush.parshanName,
					notes,
				});
			} catch {
				setSelectedPerush(null);
			} finally {
				setPerushLoading(false);
			}
		},
		[perekId],
	);

	// Auto-expand article or perush when initialSlug is provided (e.g. /929/5/42?book)
	useEffect(() => {
		if (!initialSlug || initialSlugHandled.current) return;
		initialSlugHandled.current = true;

		const numericId = Number.parseInt(initialSlug, 10);
		if (!Number.isNaN(numericId)) {
			const article = articles.find((a) => a.id === numericId);
			if (article) {
				handleArticleClick(article);
			}
		} else {
			const perush = perushim.find((p) => p.name === initialSlug);
			if (perush) {
				handlePerushClick(perush);
			}
		}
	}, [initialSlug, articles, perushim, handleArticleClick, handlePerushClick]);

	// Dynamically expand a perush or article when QA navigation sets expandSlug
	const lastExpandToken = useRef<number>(0);
	const pendingScrollNote = useRef<string | null>(null);

	useEffect(() => {
		if (!expandSlug || expandToken == null || expandToken === lastExpandToken.current) return;
		lastExpandToken.current = expandToken;

		// Compute the scroll target id before triggering expansion
		if (expandNotePasuk != null && expandNoteIdx != null) {
			pendingScrollNote.current = `book-note-${toLetters(expandNotePasuk)}-${expandNoteIdx + 1}`;
		} else {
			pendingScrollNote.current = null;
		}

		const numericId = Number.parseInt(expandSlug, 10);
		if (!Number.isNaN(numericId)) {
			const article = articles.find((a) => a.id === numericId);
			if (article) handleArticleClick(article);
		} else {
			const perush = perushim.find((p) => p.name === expandSlug);
			if (perush) handlePerushClick(perush);
		}
	}, [expandSlug, expandToken, expandNotePasuk, expandNoteIdx, articles, perushim, handleArticleClick, handlePerushClick]);

	// After a perush expands, scroll to the target note if one is pending
	useEffect(() => {
		if (!selectedPerush || !pendingScrollNote.current) return;
		const noteId = pendingScrollNote.current;
		pendingScrollNote.current = null;
		requestAnimationFrame(() => {
			const el = document.getElementById(noteId);
			el?.scrollIntoView({ behavior: "smooth", block: "center" });
		});
	}, [selectedPerush]);

	const handleArticleBack = useCallback(() => {
		setSelectedArticle(null);
	}, []);

	const handlePerushBack = useCallback(() => {
		setSelectedPerush(null);
	}, []);

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
							onBack={handlePerushBack}
							fullPage
						/>
					</div>
				) : selectedArticle ? (
					<div className={styles.blankPageArticleFullWrapper}>
						<ArticleFullView
							article={selectedArticle}
							onBack={handleArticleBack}
							fullPage
						/>
					</div>
				) : (
					<>
						{perushim.length > 0 && (
							<PerushimSection
								perekId={perekId}
								perushim={perushim}
								onPerushClick={handlePerushClick}
								loading={perushLoading}
							/>
						)}
						<ArticlesSection
							articles={articles}
							onArticleClick={handleArticleClick}
							loading={articleLoading}
						/>
					</>
				)}
			</div>
		</section>
	);
}
