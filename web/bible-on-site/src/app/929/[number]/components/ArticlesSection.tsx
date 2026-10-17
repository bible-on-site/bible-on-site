import DOMPurify from "isomorphic-dompurify";
import Image from "next/image";
import Link from "next/link";
import type { ArticleSummary } from "@/lib/articles";
import { normalizeAbstractHtml } from "@/lib/authors/articles-grid";
import styles from "./articles-section.module.css";
import { Carousel } from "./Carousel";

interface ArticlesSectionProps {
	articles?: ArticleSummary[] | null;
	/** Section heading (defaults to the perek reader's title). */
	title?: string;
	/** Empty-state message (defaults to the perek reader's message). */
	emptyMessage?: string;
	/** When set, clicking an article calls this instead of navigating (e.g. open in-place in flipbook). */
	onArticleClick?: (article: ArticleSummary) => void;
	/** Overrides the canonical /929 href on each card (modifier-key/new-tab target) — e.g. an alternative-division book deep link. */
	hrefForArticle?: (article: ArticleSummary) => string;
	/** When true, show loading state (e.g. fetching article for in-place view). */
	loading?: boolean;
	/** Session-scoped key so the carousel keeps its position across unmounts. */
	scrollStorageKey?: string;
}

/**
 * Renders articles for a perek as a horizontal carousel.
 * Each item shows author image, name, and abstract.
 * Use onArticleClick to open an article in-place (e.g. on flipbook blank page) instead of navigating.
 */
export function ArticlesSection({
	articles = [],
	title = "מאמרים על הפרק",
	emptyMessage = "אין מאמרים לפרק זה",
	onArticleClick,
	hrefForArticle,
	loading = false,
	scrollStorageKey,
}: ArticlesSectionProps) {
	const safeArticles = articles ?? [];
	return (
		<section
			className={styles.articlesSection}
			data-flipbook-no-flip
			aria-busy={loading}
		>
			<header className={styles.sectionHeader}>
				<Image
					src="/icons/book.svg"
					alt=""
					aria-hidden="true"
					width={18}
					height={18}
					className={styles.sectionIcon}
				/>
				<h2 className={styles.sectionTitle}>{title}</h2>
			</header>

			<Carousel
				className={styles.carousel}
				prevLabel="מאמר קודם"
				nextLabel="מאמר הבא"
				scrollStorageKey={scrollStorageKey}
			>
				{safeArticles.length === 0 ? (
					<p className={styles.emptyMessage}>{emptyMessage}</p>
				) : loading ? (
					<p className={styles.emptyMessage}>מתחבר למאמרים...</p>
				) : (
					safeArticles.map((article) => (
						<Link
							key={article.id}
							href={
								hrefForArticle?.(article) ??
								`/929/${article.perekId}/${article.id}`
							}
							id={`article-${article.id}`}
							className={styles.carouselItem}
							onClick={
								onArticleClick
									? (e) => {
											// Modifier/new-tab clicks keep the
											// anchor's default navigation.
											if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
												return;
											}
											e.preventDefault();
											onArticleClick(article);
										}
									: undefined
							}
						>
							<div className={styles.authorImage}>
								<Image
									src={article.authorImageUrl}
									alt={article.authorName}
									width={80}
									height={80}
									className={styles.authorImg}
								/>
							</div>
							<span className={styles.authorName}>{article.authorName}</span>
							{article.abstract && (
								<div
									className={styles.articleAbstract}
									// nosemgrep -- DOMPurify-sanitized abstract
									// biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized with DOMPurify
									dangerouslySetInnerHTML={{
										__html: DOMPurify.sanitize(
											normalizeAbstractHtml(article.abstract),
										),
									}}
								/>
							)}
						</Link>
					))
				)}
			</Carousel>
		</section>
	);
}
