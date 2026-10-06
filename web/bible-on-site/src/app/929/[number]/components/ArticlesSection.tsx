import DOMPurify from "isomorphic-dompurify";
import Image from "next/image";
import Link from "next/link";
import type { ArticleSummary } from "@/lib/articles";
import styles from "./articles-section.module.css";
import { Carousel } from "./Carousel";

interface ArticlesSectionProps {
	articles?: ArticleSummary[] | null;
	/** When set, clicking an article calls this instead of navigating (e.g. open in-place in flipbook). */
	onArticleClick?: (article: ArticleSummary) => void;
	/** When true, show loading state (e.g. fetching article for in-place view). */
	loading?: boolean;
}

/**
 * Renders articles for a perek as a horizontal carousel.
 * Each item shows author image, name, and abstract.
 * Use onArticleClick to open an article in-place (e.g. on flipbook blank page) instead of navigating.
 */
export function ArticlesSection({
	articles = [],
	onArticleClick,
	loading = false,
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
				<h2 className={styles.sectionTitle}>מאמרים על הפרק</h2>
			</header>

			<Carousel
				className={styles.carousel}
				prevLabel="מאמר קודם"
				nextLabel="מאמר הבא"
			>
				{safeArticles.length === 0 ? (
					<p className={styles.emptyMessage}>אין מאמרים לפרק זה</p>
				) : loading ? (
					<p className={styles.emptyMessage}>מתחבר למאמרים...</p>
				) : (
					safeArticles.map((article) =>
						onArticleClick ? (
							<button
								key={article.id}
								type="button"
								id={`article-${article.id}`}
								className={styles.carouselItem}
								onClick={() => onArticleClick(article)}
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
										// biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized with DOMPurify
										dangerouslySetInnerHTML={{
											__html: DOMPurify.sanitize(article.abstract),
										}}
									/>
								)}
							</button>
						) : (
							<Link
								key={article.id}
								href={`/929/${article.perekId}/${article.id}`}
								id={`article-${article.id}`}
								className={styles.carouselItem}
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
										// biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized with DOMPurify
										dangerouslySetInnerHTML={{
											__html: DOMPurify.sanitize(article.abstract),
										}}
									/>
								)}
							</Link>
						),
					)
				)}
			</Carousel>
		</section>
	);
}
