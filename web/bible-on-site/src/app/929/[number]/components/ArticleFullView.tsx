"use client";

import DOMPurify from "isomorphic-dompurify";
import Image from "next/image";
import Link from "next/link";
import type { Article } from "@/lib/articles";
import { authorNameToSlug } from "@/lib/authors/url-utils";
import { demoteHeadings } from "@/lib/html-headings";
import articleStyles from "../[slug]/page.module.css";
import { ShareButton } from "./ShareButton";
import styles from "./sefer.module.css";

interface ArticleFullViewProps {
	article: Article;
	onBack: () => void;
	/** When true, layout fills container: header fixed, body scrolls (flipbook blank page). */
	fullPage?: boolean;
	/** Article-only fullscreen is active (the caller renders the overlay). */
	fullscreen?: boolean;
	/** Toggles the article's own fullscreen overlay (#2544 item 7). */
	onToggleFullscreen?: () => void;
}

/**
 * Renders a single article (title, author, content) with a back action.
 * Used on the flipbook blank page when user clicks an article from the carousel.
 */
export function ArticleFullView({
	article,
	onBack,
	fullPage = false,
	fullscreen = false,
	onToggleFullscreen,
}: ArticleFullViewProps) {
	const rootClass = fullPage
		? `${articleStyles.expandedArticle} ${styles.articleFullViewInBook}`
		: articleStyles.expandedArticle;

	// Book-mode modifiers compact the metadata so the body gets more of the
	// limited page height (#2406); the standalone article route keeps its
	// spacious presentation.
	const compact = (bookClass: string) => (fullPage ? ` ${bookClass}` : "");

	const canonicalPath = `/929/${article.perekId}/${article.id}`;

	return (
		<div className={rootClass}>
			<header
				className={`${articleStyles.articleHeader}${compact(styles.articleHeaderInBook)}`}
			>
				<Link
					href={`/929/authors/${authorNameToSlug(article.authorName)}`}
					className={`${articleStyles.authorLink}${compact(styles.authorLinkInBook)}`}
				>
					<div
						className={`${articleStyles.authorImage}${compact(styles.authorImageInBook)}`}
					>
						<Image
							src={article.authorImageUrl}
							alt={article.authorName}
							width={80}
							height={80}
							className={articleStyles.authorImg}
						/>
					</div>
					<span className={articleStyles.authorName}>{article.authorName}</span>
				</Link>
				<h2
					className={`${articleStyles.articleTitle}${compact(styles.articleTitleInBook)}`}
				>
					{article.name}
				</h2>
				<ShareButton
					canonicalPath={canonicalPath}
					title={`${article.name} - ${article.authorName}`}
				/>
				{onToggleFullscreen && (
					<button
						type="button"
						className={styles.fullscreenToggle}
						onClick={onToggleFullscreen}
						aria-pressed={fullscreen}
					>
						{fullscreen ? "צמצם" : "מסך מלא"}
					</button>
				)}
			</header>

			{article.content && (
				<div className={fullPage ? styles.articleBodyWrapper : undefined}>
					<div
						className={articleStyles.articleBody}
						// nosemgrep -- DOMPurify-sanitized article HTML
						// biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized with DOMPurify
						dangerouslySetInnerHTML={{
							__html: DOMPurify.sanitize(demoteHeadings(article.content)),
						}}
					/>
				</div>
			)}

			<div
				className={`${articleStyles.backToPerek}${compact(styles.backToPerekInBook)}`}
			>
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
