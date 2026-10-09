"use client";

import { toLetters } from "gematry";
import { useCallback, useEffect, useRef, useState } from "react";
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
	/** Dynamically expand a perush (by name) or article (by numeric id string) — set by QA navigation */
	expandSlug?: string;
	/** Change token to re-trigger expansion even with the same slug */
	expandToken?: number;
	/** Target note pasuk for scrolling after perush expansion */
	expandNotePasuk?: number;
	/** Target note index for scrolling after perush expansion */
	expandNoteIdx?: number;
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
	expandSlug,
	expandToken,
	expandNotePasuk,
	expandNoteIdx,
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
					if (!cancelled) {
						setSelectedArticle(full);
						if (!full) setSlug(undefined);
					}
				})
				.catch((error) => {
					console.error("Failed to load book article", {
						perekId, articleId: article.id, error,
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
						perekId, perushId: perush.id, error,
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

	const navigate = useCallback(
		(nextSlug?: string) => {
			if (onNavigate) onNavigate(nextSlug);
			else if (perekId) writeSeferContentHistory(perekId, nextSlug);
			setSlug(nextSlug);
		},
		[onNavigate, perekId],
	);

	// Dynamically expand a perush or article when QA navigation sets expandSlug
	const lastExpandToken = useRef<number>(0);
	const pendingScrollNote = useRef<string | null>(null);

	useEffect(() => {
		if (!expandSlug || expandToken == null || expandToken === lastExpandToken.current) return;
		lastExpandToken.current = expandToken;

		// Compute the scroll target id before triggering expansion
		pendingScrollNote.current =
			expandNotePasuk != null && expandNoteIdx != null
				? `book-note-${toLetters(expandNotePasuk)}-${expandNoteIdx + 1}`
				: null;

		navigate(expandSlug);
	}, [expandSlug, expandToken, expandNotePasuk, expandNoteIdx, navigate]);

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
