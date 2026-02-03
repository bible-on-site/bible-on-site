import { unstable_cache } from "next/cache";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
	getAllAuthorIds,
	getArticlesByAuthorId,
	getAuthorById,
} from "../../../lib/authors";
import styles from "./page.module.css";

// Authors are pre-generated at build time. ISR handles new authors via revalidation.
export const dynamicParams = false;

/**
 * Generate static params for known authors at build time.
 * New authors will be generated on-demand.
 */
export async function generateStaticParams() {
	const authorIds = await getAllAuthorIds();
	return authorIds.map((id) => ({ id: String(id) }));
}

/**
 * Cache author data with on-demand revalidation support.
 */
const getCachedAuthor = unstable_cache(
	async (id: number) => getAuthorById(id),
	["author"],
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
	params: Promise<{ id: string }>;
}) {
	const { id } = await params;
	const authorId = Number.parseInt(id, 10);
	const author = await getCachedAuthor(authorId);

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
	params: Promise<{ id: string }>;
}) {
	const { id } = await params;
	const authorId = Number.parseInt(id, 10);

	if (Number.isNaN(authorId)) {
		notFound();
	}

	const author = await getCachedAuthor(authorId);

	if (!author) {
		notFound();
	}

	const articles = await getCachedAuthorArticles(authorId);

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
							unoptimized
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
						<h2 className={styles.sectionTitle}>מאמרים ({articles.length})</h2>
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
										פרק {article.perekId}
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
