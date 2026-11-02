import Image from "next/image";
import { notFound } from "next/navigation";
import { getPerekByPerekId } from "../../../../data/perek-dto";
import type { AuthorDetails } from "../../../../lib/authors";
import {
	authorNameToSlug,
	getAllAuthorSlugs,
	getArticlesByAuthorId,
	getAuthorByName,
} from "../../../../lib/authors";
import {
	authorArticlesTag,
	authorTag,
	cachedPerKey,
	COLLECTION_TAGS,
} from "../../../../lib/revalidate/tags";
import { authorPath, buildAuthorGraph } from "../../../../lib/seo/core-jsonld";
import { pageMetadata } from "../../../../lib/seo/opengraph";
import { JsonLd } from "../../../components/JsonLd";
import { AuthorArticlesTable } from "./AuthorArticlesTable";
import styles from "./page.module.css";

/**
 * Authors are pre-generated at build time using normalised-name slugs.
 * dynamicParams is true so authors added after the build still render
 * on demand.
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
 * Resolve the `authorParam` segment (a percent-encoded normalised author
 * name) to an AuthorDetails. Author pages are addressed by name only.
 */
async function resolveAuthor(
	authorParam: string,
): Promise<AuthorDetails | null> {
	return getAuthorByName(decodeURIComponent(authorParam));
}

/**
 * Author data keyed by the URL param (normalised name slug) with
 * entity-scoped tags: an author change expires exactly the
 * `author:{param}` entries that name it, not every author's page.
 */
const getCachedAuthor = cachedPerKey(
	"author-by-param",
	(param: string) => param,
	(key) => [COLLECTION_TAGS.authors, authorTag(key)],
	(param: string) => resolveAuthor(param),
);

/**
 * Cache author's articles with on-demand revalidation support.
 */
const getCachedAuthorArticles = cachedPerKey(
	"author-articles",
	(authorId: number) => String(authorId),
	(key) => [
		COLLECTION_TAGS.articles,
		COLLECTION_TAGS.authors,
		authorArticlesTag(Number(key)),
	],
	(authorId: number) => getArticlesByAuthorId(authorId),
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
			title: 'הרב לא נמצא | תנ"ך באתר',
		};
	}

	return pageMetadata({
		title: `${author.name} | תנ"ך באתר`,
		description: author.details
			? author.details.slice(0, 160)
			: `מאמרים מאת ${author.name}`,
		canonical: authorPath(authorNameToSlug(author.name)),
		type: "profile",
		image: {
			// Author portrait — the page's own content image. Its intrinsic
			// dimensions are not tracked, so they are omitted, not guessed.
			url: author.imageUrl,
			alt: author.name,
			type: "image/jpeg",
		},
	});
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

	// Edge rows may reference perakim outside the canon (e.g. non-distributable
	// test data) — they cannot render a source link, so skip them instead of
	// letting getPerekByPerekId fail the whole prerender.
	const articles = (await getCachedAuthorArticles(author.id)).filter(
		({ perekId }) =>
			Number.isInteger(perekId) && perekId >= 1 && perekId <= 929,
	);
	const rows = articles.map((article) => {
		const perek = getPerekByPerekId(article.perekId);
		return { ...article, sefer: perek.sefer, source: perek.source };
	});

	return (
		<div className={styles.authorPage}>
			<JsonLd
				data={buildAuthorGraph({
					author,
					slug: authorNameToSlug(author.name),
				})}
			/>
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
						<Image
							src="/icons/book.svg"
							alt=""
							aria-hidden="true"
							width={24}
							height={24}
							className={styles.sectionIcon}
						/>
						<h2 className={styles.sectionTitle}>מאמרים ({articles.length})</h2>
					</header>

					<AuthorArticlesTable rows={rows} />
				</section>
			)}

			{articles.length === 0 && (
				<div className={styles.emptyState}>אין מאמרים עדיין</div>
			)}
		</div>
	);
}
