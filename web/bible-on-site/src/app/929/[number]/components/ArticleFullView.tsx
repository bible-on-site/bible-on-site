"use client";

import Image from "next/image";
import Link from "next/link";
import type { Article } from "@/lib/articles";
import articleStyles from "../[articleId]/page.module.css";
import styles from "./sefer.module.css";

interface ArticleFullViewProps {
	article: Article;
	onBack: () => void;
	/** When true, layout fills container: title fixed, body scrolls (flipbook blank page). */
	fullPage?: boolean;
}

/**
 * Renders a single article (title, author, content) with a back action.
 * Used on the flipbook blank page when user clicks an article from the carousel.
 */
export function ArticleFullView({
	article,
	onBack,
	fullPage = false,
}: ArticleFullViewProps) {
	const rootClass = fullPage
		? `${articleStyles.expandedArticle} ${styles.articleFullViewInBook}`
		: articleStyles.expandedArticle;

	return (
		<div className={rootClass}>
			<header className={articleStyles.articleHeader}>
				<Link
					href={`/authors/${article.authorId}`}
					className={articleStyles.authorLink}
				>
					<div className={articleStyles.authorImage}>
						<Image
							src={article.authorImageUrl}
							alt={article.authorName}
							width={80}
							height={80}
							className={articleStyles.authorImg}
							unoptimized
						/>
					</div>
					<span className={articleStyles.authorName}>{article.authorName}</span>
				</Link>
				<h2 className={articleStyles.articleTitle}>{article.name}</h2>
			</header>

			{article.content && (
				<div className={fullPage ? styles.articleBodyWrapper : undefined}>
					<div
						className={articleStyles.articleBody}
						// biome-ignore lint/security/noDangerouslySetInnerHtml: Content is from trusted database
						dangerouslySetInnerHTML={{ __html: article.content }}
					/>
				</div>
			)}

			<div className={articleStyles.backToPerek}>
				<button
					type="button"
					onClick={onBack}
					className={articleStyles.backLink}
				>
					חזרה למאמרים →
				</button>
			</div>
		</div>
	);
}
