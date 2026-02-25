import { unstable_cache } from "next/cache";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
	getAllAuthorSlugs,
	getArticlesByAuthorId,
	getAuthorById,
	getAuthorByName,
} from "../../../../lib/authors";
import type { AuthorDetails } from "../../../../lib/authors";
import { getPerekByPerekId } from "../../../../data/perek-dto";
import styles from "./page.module.css";

/**
 * Authors are pre-generated at build time using normalised-name slugs.
 * dynamicParams is true so numeric-ID URLs (legacy / backward-compat) still
 * resolve on-demand rather than returning 404.
 */
export const dynamicParams = true;

/**
 * Generate static params for known authors at build time.
 * Uses normalised author names as the URL slug.
 */
export async function generateStaticParams() {
	const slugs = await getAllAuthorSlugs();
	return slugs.map((slug) => ({ authorParam: slug }));
}

/**
 * Resolve the `authorParam` segment to an AuthorDetails.
 * Tries numeric ID first (backward-compat), then normalised-name match.
 */
async function resolveAuthor(
	authorParam: string,
): Promise<AuthorDetails | null> {
	const maybeId = Number.parseInt(authorParam, 10);
	if (!Number.isNaN(maybeId) && String(maybeId) === authorParam) {
		return getAuthorById(maybeId);
	}
	// Decode percent-encoded Hebrew name and resolve by normalised match
	const decoded = decodeURIComponent(authorParam);
	return getAuthorByName(decoded);
}

/**
 * Cache author data with on-demand revalidation support.
 */
const getCachedAuthor = unstable_cache(
	async (param: string) => resolveAuthor(param),
	["author-by-param"],
	{
		tags: ["authors"],
		revalidate: false,
	},
);

/**
 * Cache author's articles with on-demand revalidation support.
 */
const getCachedAuthorArticles = unstable_cache(
	async (authorId: number) => getArticlesByAuthorId(authorId),
	["author-articles"],
	{
		tags: ["articles", "authors"],
		revalidate: false,
	},
);

export async function generateMetadata({
	params,
}: {
	params: Promise<{ authorParam: string }>;
}) {
	const { authorParam } = await params;
	const author = await getCachedAuthor(authorParam);

	if (!author) {
		return {
			title: "הרב לא נמצא | תנ״ך באתר",
		};
	}

	return {
		title: `${author.name} | תנ״ך באתר`,
		description: author.details
			? author.details.slice(0, 160)
			: `מאמרים מאת ${author.name}`,
	};
}

export default async function AuthorPage({
	params,
}: {
	params: Promise<{ authorParam: string }>;
}) {
	const { authorParam } = await params;
	const author = await getCachedAuthor(authorParam);

	if (!author) {
		notFound();
	}

	const articles = await getCachedAuthorArticles(author.id);

	return (
		<div className={styles.authorPage}>
			<header className={styles.authorHeader}>
				<div className={styles.authorImageContainer}>
					{author.imageUrl ? (
						<Image
							src={author.imageUrl}
							alt={author.name}
							width={180}
							height={180}
							className={styles.authorImage}
						/>
					) : (
						<div className={styles.authorPlaceholder}>👤</div>
					)}
				</div>
				<div className={styles.authorInfo}>
					<h1 className={styles.authorName}>{author.name}</h1>
					{author.details && (
						<p className={styles.authorDetails}>{author.details}</p>
					)}
				</div>
			</header>

			{articles.length > 0 && (
				<section className={styles.articlesSection}>
					<header className={styles.sectionHeader}>
						<span className={styles.sectionIcon}>📚</span>
						<h2 className={styles.sectionTitle}>
							מאמרים ({articles.length})
						</h2>
					</header>

					<div className={styles.articlesList}>
						{articles.map((article) => (
							<Link
								key={article.id}
								href={`/929/${article.perekId}/${article.id}`}
								className={styles.articleCard}
							>
								<h3 className={styles.articleName}>{article.name}</h3>
								<div className={styles.articleMeta}>
								<span className={styles.perekLink}>
									{getPerekByPerekId(article.perekId).source}
								</span>
								</div>
							</Link>
						))}
					</div>
				</section>
			)}

			{articles.length === 0 && (
				<div className={styles.emptyState}>אין מאמרים עדיין</div>
			)}
		</div>
	);
}
