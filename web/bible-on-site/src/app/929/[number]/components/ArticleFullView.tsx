"use client";

import DOMPurify from "isomorphic-dompurify";
import Image from "next/image";
import Link from "next/link";
import type { Article } from "@/lib/articles";
import { authorNameToSlug } from "@/lib/authors/url-utils";
import { DedicationLines } from "@/app/components/dedications/DedicationLines";
import { demoteHeadings } from "@/lib/html-headings";
import articleStyles from "../[slug]/page.module.css";
import { ArticleActionsBar } from "./ArticleActionsBar";
import styles from "./sefer.module.css";

interface ArticleFullViewProps {
	article: Article;
	/** The article's own scope dedication lines (#2731) — the standalone
	 * route renders the same set under its title. */
	dedicationLines?: string[];
	onBack: () => void;
	/** When true, layout fills container: header fixed, body scrolls (flipbook blank page). */
	fullPage?: boolean;
	/** Article-only fullscreen is active — the row shows the exit command. */
	fullscreen?: boolean;
	/** Toggles the article's own fullscreen overlay (#2544 item 7, #2786). */
	onToggleFullscreen?: () => void;
}

/**
 * Renders a single article (title, author, content) with a back action.
 * Used on the flipbook blank page when user clicks an article from the carousel.
 */
export function ArticleFullView({
	article,
	dedicationLines = [],
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
			{/* The unified command row: return at the leading edge, Share +
			 * Fullscreen grouped at the trailing edge (#2786). */}
			<ArticleActionsBar
				backLabel="חזרה למאמרים"
				onBack={onBack}
				sharePath={canonicalPath}
				shareTitle={`${article.name} - ${article.authorName}`}
				fullscreen={fullscreen}
				onToggleFullscreen={onToggleFullscreen}
			/>
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
			</header>

			{/* The article's own dedication scope under its title — same slot
			 * the standalone /929/{perek}/{article} route uses (#2731). */}
			<DedicationLines lines={dedicationLines} compact />

			{article.content && (
				<div
					className={fullPage ? styles.articleBodyWrapper : undefined}
					data-article-body-scroll
				>
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
		</div>
	);
}
