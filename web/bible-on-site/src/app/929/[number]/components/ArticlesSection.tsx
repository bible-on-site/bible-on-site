import Image from "next/image";
import Link from "next/link";
import type { Article } from "../../../../lib/articles";
import styles from "./articles-section.module.css";

interface ArticlesSectionProps {
	articles: Article[];
}

/**
 * Renders articles for a perek as a horizontal carousel.
 * Each item shows author image, name, and abstract.
 * SSG-compatible server component.
 */
export function ArticlesSection({ articles }: ArticlesSectionProps) {
	if (articles.length === 0) {
		return null;
	}

	return (
		<section className={styles.articlesSection}>
			<header className={styles.sectionHeader}>
				<span className={styles.sectionIcon}>📚</span>
				<h2 className={styles.sectionTitle}>מאמרים על הפרק</h2>
			</header>

			<div className={styles.carousel}>
				{articles.map((article) => (
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
								unoptimized
							/>
						</div>
						<span className={styles.authorName}>{article.authorName}</span>
						{article.abstract && (
							<div
								className={styles.articleAbstract}
								// biome-ignore lint/security/noDangerouslySetInnerHtml: Content is from trusted database
								dangerouslySetInnerHTML={{ __html: article.abstract }}
							/>
						)}
					</Link>
				))}
			</div>
		</section>
	);
}
