"use client";

import { useEffect, useState } from "react";
import type { Article, ArticleSummary } from "@/lib/articles";
import type { RangePerushSummary, RangedPerushNote } from "@/lib/perushim";
import type { DivisionId } from "@/lib/reading/contract";
import { getArticleForBook } from "@/app/929/[number]/actions";
import { ArticlesSection } from "@/app/929/[number]/components/ArticlesSection";
import { ArticleFullView } from "@/app/929/[number]/components/ArticleFullView";
import { PerushimSection } from "@/app/929/[number]/components/PerushimSection";
import { articleDocumentTitle } from "@/app/929/[number]/components/sefer-document-title";
import seferStyles from "@/app/929/[number]/components/sefer.module.css";
import { getUnitBookPerushNotes } from "./unit-book-actions";
import {
	type UnitBookContentKind,
	type UnitBookScope,
	unitBookContentHref,
} from "./unit-book-content";
import {
	setUnitOpenPerush,
	unitBookKey,
} from "./unit-book-navigation";
import { UnitPerushFullView } from "./UnitPerushFullView";

interface SelectedPerush {
	id: number;
	name: string;
	parshanName: string;
	notes: RangedPerushNote[];
}

interface UnitBlankPageContentProps {
	/** Alternative division this blank page belongs to. */
	division: DivisionId;
	unitId: number;
	/** "torah" bounds commentary to the unit's primary ranges; "haftara" to its auxiliary readings. */
	scope: UnitBookScope;
	/** Public unit path (e.g. "/מסורה/5") — deep-link + share base. */
	unitPath: string;
	articles?: ArticleSummary[] | null;
	perushim?: RangePerushSummary[] | null;
	/** Canonical perek source labels for multi-perek commentary groups. */
	perekSources: Record<number, string>;
	hebrewDateStr: string;
	/** Content slug restored from the book URL (perush name or article id). */
	initialSlug?: string;
	/** Writes the unit's content history (slug omitted closes the view). */
	onNavigate?: (kind: UnitBookContentKind | undefined, slug?: string) => void;
	/** Fallback perek id for perush hrefs lacking their own. */
	fallbackPerekId: number;
	titles: {
		perushim: string;
		articles: string;
		perushEmpty: string;
		articleEmpty: string;
	};
	scrollStorageKey?: string;
	/** Document title for an open perush (e.g. `רש"י על {heading}`). */
	perushTitle?: (perushName: string) => string;
	/** Reports the shown article/perush document title (null when none). */
	onContentTitle?: (title: string | null) => void;
}

/**
 * Blank page of an alternative-division sefer book (issue #2191): the
 * facing page of a unit's text spread, mirroring the perek reader's
 * BlankPageContent. It hosts the scope's perushim and articles
 * carousels, swaps to a bound perush view or the shared article view
 * in place, publishes the open perush so the facing text's pasuk
 * numerals become navigation targets, and reports the shown content's
 * document title.
 */
export function UnitBlankPageContent({
	division,
	unitId,
	scope,
	unitPath,
	articles = [],
	perushim = [],
	perekSources,
	hebrewDateStr,
	initialSlug,
	onNavigate,
	fallbackPerekId,
	titles,
	scrollStorageKey,
	perushTitle,
	onContentTitle,
}: UnitBlankPageContentProps) {
	const [selectedArticle, setSelectedArticle] = useState<Article | null>(
		null,
	);
	const [articleLoading, setArticleLoading] = useState(false);
	const [selectedPerush, setSelectedPerush] = useState<SelectedPerush | null>(
		null,
	);
	const [perushLoading, setPerushLoading] = useState(false);
	const [slug, setSlug] = useState(initialSlug);
	useEffect(() => setSlug(initialSlug), [initialSlug]);
	// Summary arrays may arrive as explicit null while a scope's batch
	// is still loading — normalize once for the effect and the carousels.
	const safeArticles = articles ?? [];
	const safePerushim = perushim ?? [];

	useEffect(() => {
		let cancelled = false;
		setSelectedArticle(null);
		setSelectedPerush(null);
		setArticleLoading(false);
		setPerushLoading(false);
		const article = safeArticles.find((item) => String(item.id) === slug);
		const perush = safePerushim.find((item) => item.name === slug);
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
					console.error("Failed to load unit book article", {
						division,
						unitId,
						scope,
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
			getUnitBookPerushNotes(division, unitId, scope, perush.id)
				.then((notes) => {
					if (!cancelled) {
						setSelectedPerush({
							id: perush.id,
							name: perush.name,
							parshanName: perush.parshanName,
							notes,
						});
					}
				})
				.catch((error) => {
					console.error("Failed to load unit book commentary", {
						division,
						unitId,
						scope,
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
	}, [slug, safeArticles, safePerushim, division, unitId, scope]);

	// Report the full-view document title: while an article or perush is
	// shown inside the book, the tab names that content like its
	// standalone view; clearing the selection hands the title back to the
	// page-level title managed by the book.
	useEffect(() => {
		if (!onContentTitle) return;
		const title = selectedArticle
			? articleDocumentTitle(selectedArticle)
			: selectedPerush && perushTitle
				? perushTitle(selectedPerush.name)
				: null;
		onContentTitle(title);
		// If this page unmounts while a full view is open (the flipbook
		// buffers out distant leaves), release the title back to the
		// page-level one.
		return () => onContentTitle(null);
	}, [selectedArticle, selectedPerush, onContentTitle, perushTitle]);

	// Publish the open perush (with the canonical pesukim it annotates)
	// so pasuk numerals in the facing unit text become navigation
	// targets; cleared on close and on unmount.
	const bookKey = unitBookKey(unitId, scope);
	useEffect(() => {
		setUnitOpenPerush(
			bookKey,
			selectedPerush
				? {
						name: selectedPerush.name,
						pesukim: new Set(
							selectedPerush.notes.map(
								(note) => `${note.perekId}-${note.pasuk}`,
							),
						),
					}
				: null,
		);
		return () => setUnitOpenPerush(bookKey, null);
	}, [bookKey, selectedPerush]);

	const navigate = (kind?: UnitBookContentKind, nextSlug?: string) => {
		onNavigate?.(kind, nextSlug);
		setSlug(nextSlug);
	};

	const hasFullView = selectedPerush || selectedArticle;

	return (
		<section
			className={`${seferStyles.pageBlank} flipbook-page-bounded`}
			aria-label="עמוד ריק (פירושים ומאמרים)"
		>
			<div className={seferStyles.blankPageDate}>{hebrewDateStr}</div>
			<div
				className={
					hasFullView
						? `${seferStyles.blankPageArticles} ${seferStyles.blankPageArticlesFullArticle}`
						: seferStyles.blankPageArticles
				}
			>
				{selectedPerush ? (
					<div className={seferStyles.blankPageArticleFullWrapper}>
						<UnitPerushFullView
							name={selectedPerush.name}
							parshanName={selectedPerush.parshanName}
							notes={selectedPerush.notes}
							bookKey={bookKey}
							perekSources={perekSources}
							sharePath={unitBookContentHref(
								unitPath,
								scope,
								"perush",
								selectedPerush.name,
							)}
							onBack={() => navigate()}
						/>
					</div>
				) : selectedArticle ? (
					<div className={seferStyles.blankPageArticleFullWrapper}>
						<ArticleFullView
							article={selectedArticle}
							onBack={() => navigate()}
							fullPage
						/>
					</div>
				) : (
					<>
						{safePerushim.length > 0 && (
							<PerushimSection
								perekId={fallbackPerekId}
								perushim={safePerushim}
								title={titles.perushim}
								emptyMessage={titles.perushEmpty}
								onPerushClick={(perush) =>
									navigate("perush", perush.name)
								}
								hrefForPerush={(perush) =>
									unitBookContentHref(
										unitPath,
										scope,
										"perush",
										perush.name,
									)
								}
								loading={perushLoading}
								scrollStorageKey={
									scrollStorageKey
										? `perushim-${scrollStorageKey}`
										: undefined
								}
							/>
						)}
						<ArticlesSection
							articles={safeArticles}
							title={titles.articles}
							emptyMessage={titles.articleEmpty}
							onArticleClick={(article) =>
								navigate("article", String(article.id))
							}
							hrefForArticle={(article) =>
								unitBookContentHref(
									unitPath,
									scope,
									"article",
									String(article.id),
								)
							}
							loading={articleLoading}
							scrollStorageKey={
								scrollStorageKey
									? `articles-${scrollStorageKey}`
									: undefined
							}
						/>
					</>
				)}
			</div>
		</section>
	);
}
