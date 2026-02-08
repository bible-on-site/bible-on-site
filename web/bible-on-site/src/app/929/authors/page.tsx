import { unstable_cache } from "next/cache";
import Image from "next/image";
import Link from "next/link";
import { query } from "../../../lib/api-client";
import {
	authorNameToSlug,
	getAuthorImageUrl,
} from "../../../lib/authors";
import styles from "./page.module.css";

interface AuthorRow {
	id: number;
	name: string;
	details: string;
}

interface AuthorSummary {
	id: number;
	name: string;
	details: string;
	imageUrl: string;
}

/**
 * Fetch all authors for the listing page
 */
async function getAllAuthors(): Promise<AuthorSummary[]> {
	try {
		const rows = await query<AuthorRow>(
			`SELECT a.id, a.name, a.details
			 FROM tanah_author a
			 WHERE EXISTS (SELECT 1 FROM tanah_article art WHERE art.author_id = a.id)
			 ORDER BY a.name ASC`,
		);

		return rows.map((row) => ({
			id: row.id,
			name: row.name,
			details: row.details || "",
			imageUrl: getAuthorImageUrl(row.id),
		}));
	} catch (error) {
		console.warn(
			"Failed to fetch authors:",
			error instanceof Error ? error.message : error,
		);
		return [];
	}
}

/**
 * Cache all authors with on-demand revalidation support.
 */
const getCachedAuthors = unstable_cache(
	async () => getAllAuthors(),
	["all-authors"],
	{
		tags: ["authors"],
		revalidate: false,
	},
);

export const metadata = {
	title: "הרבנים | תנ״ך באתר",
	description: "רשימת הרבנים וכותבי המאמרים באתר תנ״ך על הפרק",
};

export default async function AuthorsPage() {
	const authors = await getCachedAuthors();

	return (
		<div className={styles.authorsPage}>
			<h1 className={styles.pageTitle}>הרבנים</h1>

			{authors.length > 0 ? (
				<div className={styles.authorsGrid}>
					{authors.map((author) => (
						<Link
							key={author.id}
							href={`/929/authors/${authorNameToSlug(author.name)}`}
							className={styles.authorCard}
						>
							<div className={styles.authorImageContainer}>
								{author.imageUrl ? (
									<Image
										src={author.imageUrl}
										alt={author.name}
										width={80}
										height={80}
										className={styles.authorImage}
										unoptimized
									/>
								) : (
									<div className={styles.authorPlaceholder}>👤</div>
								)}
							</div>
							<div className={styles.authorInfo}>
								<h2 className={styles.authorName}>{author.name}</h2>
								{author.details && (
									<p className={styles.authorDetails}>
										{author.details.length > 80
											? `${author.details.slice(0, 80)}...`
											: author.details}
									</p>
								)}
							</div>
						</Link>
					))}
				</div>
			) : (
				<div className={styles.emptyState}>אין רבנים להצגה</div>
			)}
		</div>
	);
}
