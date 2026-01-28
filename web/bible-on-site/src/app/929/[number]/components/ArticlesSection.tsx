import type { Article } from "../../../../lib/articles";
import styles from "./articles-section.module.css";

interface ArticlesSectionProps {
	articles: Article[];
}

/**
 * Renders a list of articles for a perek in a CEO-friendly polished UI.
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

			<div className={styles.articlesList}>
				{articles.map((article) => (
					<article
						key={article.id}
						id={`article-${article.id}`}
						className={styles.articleCard}
					>
						<h3 className={styles.articleName}>{article.name}</h3>
						{article.abstract && (
							<div
								className={styles.articleAbstract}
								// Article abstract is stored as HTML
								// biome-ignore lint/security/noDangerouslySetInnerHtml: Content is from trusted database
								dangerouslySetInnerHTML={{ __html: article.abstract }}
							/>
						)}
						<div className={styles.articleMeta}>
							<span className={styles.readMore}>קרא עוד</span>
						</div>
					</article>
				))}
			</div>
		</section>
	);
}
