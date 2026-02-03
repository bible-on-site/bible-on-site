import Image from "next/image";
import Link from "next/link";
import type { Article } from "../../../../lib/articles";
import styles from "./articles-section.module.css";

interface ArticlesSectionProps {
	articles: Article[];
}

/**
 * Renders articles for a perek as a horizontal carousel.
 * Each item shows author image, name, article title, and abstract.
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
						href={`/authors/${article.authorId}`}
						id={`article-${article.id}`}
						className={styles.carouselItem}
					>
						<div className={styles.authorSection}>
							<div className={styles.authorImage}>
								<Image
									src={article.authorImageUrl}
									alt={article.authorName}
									width={48}
									height={48}
									className={styles.authorImg}
									unoptimized
								/>
							</div>
							<span className={styles.authorName}>{article.authorName}</span>
						</div>
						<div className={styles.articleContent}>
							<h3 className={styles.articleTitle}>{article.name}</h3>
							{article.abstract && (
								<div
									className={styles.articleAbstract}
									// biome-ignore lint/security/noDangerouslySetInnerHtml: Content is from trusted database
									dangerouslySetInnerHTML={{ __html: article.abstract }}
								/>
							)}
						</div>
					</Link>
				))}
			</div>
		</section>
	);
}
