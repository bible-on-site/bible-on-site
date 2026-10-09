import { toLetters } from "gematry";
import { unstable_cache } from "next/cache";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getPerekByPerekId } from "../../../../data/perek-dto";
import {
	getPerekIdsForSefer,
	getSeferByName,
} from "../../../../data/sefer-dto";
import {
	getAllArticlePerekIdPairs,
	getArticleById,
	getArticleSummariesByPerekId,
} from "../../../../lib/articles";
import { authorNameToSlug } from "../../../../lib/authors";
import {
	getAllPerushPerekNamePairs,
	getPerushDetail,
	getPerushimByPerekId,
} from "../../../../lib/perushim";
import {
	articlePath,
	buildArticleGraph,
	buildPerushGraph,
	perushPath,
} from "../../../../lib/seo/core-jsonld";
import { plainText, SITE_NAME } from "../../../../lib/seo/jsonld";
import { selectPerekImages } from "../../../../lib/seo/perek-illustrations";
import { getPerekImagesByChapter } from "../../../../lib/seo/perek-images-data";
import { fetchAllEntityRefs } from "../../../../lib/tanahpedia/perek-entity-refs";
import { JsonLd } from "../../../components/JsonLd";
import { ArticlesSection } from "../components/ArticlesSection";
import Breadcrumb from "../components/Breadcrumb";
import { PerekHeading } from "../components/PerekHeading";
import { PerekText } from "../components/PerekText";
import { PerushimSection } from "../components/PerushimSection";
import SeferComposite from "../components/SeferComposite";
import styles from "./page.module.css";
import { ScrollToSlug } from "./ScrollToArticle";
import { ScrollToPerushPasukNote } from "./ScrollToPerushPasuk";

/**
 * Module-level caches for bulk queries, shared across all 929 parent
 * invocations within the same build worker. Ensures exactly one DB
 * round-trip per query type regardless of parallelism.
 */
let articlePairsPromise: Promise<
	{ articleId: number; perekId: number }[]
> | null = null;
let perushPairsPromise: Promise<
	{ perekId: number; perushName: string }[]
> | null = null;

/* istanbul ignore next: only runs during next build */
export async function generateStaticParams({
	params,
}: {
	params: { number: string };
}) {
	const perekId = Number.parseInt(params.number, 10);

	if (!articlePairsPromise) {
		articlePairsPromise = getAllArticlePerekIdPairs();
	}
	if (!perushPairsPromise) {
		perushPairsPromise = getAllPerushPerekNamePairs();
	}

	const [articlePairs, perushPairs] = await Promise.all([
		articlePairsPromise,
		perushPairsPromise,
	]);

	const slugs: { slug: string }[] = [];
	for (const pair of articlePairs) {
		if (pair.perekId === perekId) {
			slugs.push({ slug: String(pair.articleId) });
		}
	}
	for (const pair of perushPairs) {
		if (pair.perekId === perekId) {
			slugs.push({ slug: encodeURIComponent(pair.perushName) });
		}
	}

	return slugs;
}

/**
 * Cache article data with on-demand revalidation support.
 */
const getCachedArticle = unstable_cache(
	async (id: number) => getArticleById(id),
	["article"],
	{
		tags: ["articles"],
		revalidate: false,
	},
);

const getCachedArticles = unstable_cache(
	async (perekId: number) => getArticleSummariesByPerekId(perekId),
	["article-summaries"],
	{
		tags: ["articles"],
		revalidate: false,
	},
);

const getCachedPerushim = unstable_cache(
	async (perekId: number) => getPerushimByPerekId(perekId),
	["perushim"],
	{
		tags: ["perushim"],
		revalidate: false,
	},
);

const getCachedPerushDetail = unstable_cache(
	async (perushId: number, perekId: number) =>
		getPerushDetail(perushId, perekId),
	["perush-detail"],
	{
		tags: ["perushim"],
		revalidate: false,
	},
);

export async function generateMetadata({
	params,
}: {
	params: Promise<{ number: string; slug: string }>;
}) {
	const { number, slug: rawSlug } = await params;
	const slug = decodeURIComponent(rawSlug);
	const perekId = Number.parseInt(number, 10);
	const id = Number.parseInt(slug, 10);

	// Check if it's a numeric article ID
	if (!Number.isNaN(id)) {
		const article = await getCachedArticle(id);
		if (!article) {
			return {
				title: `מאמר לא נמצא | ${SITE_NAME}`,
			};
		}

		const descriptionSource = article.abstract || article.content;
		const title = `${article.name} | ${article.authorName} | ${SITE_NAME}`;
		const description =
			(descriptionSource ? plainText(descriptionSource, 160) : "") ||
			`מאמר מאת ${article.authorName}`;
		const url = articlePath(perekId, article.id);
		return {
			title,
			description,
			alternates: {
				canonical: url,
			},
			openGraph: {
				title,
				description,
				url,
				siteName: SITE_NAME,
				locale: "he_IL",
				type: "article",
			},
		};
	}

	// Otherwise it's a perush name
	const perushim = await getCachedPerushim(perekId);
	const perush = perushim.find((p) => p.name === slug);

	if (!perush) {
		return {
			title: `פירוש לא נמצא | ${SITE_NAME}`,
		};
	}

	const perekObj = getPerekByPerekId(perekId);
	const sefer = getSeferByName(perekObj.sefer);
	const perushDetail = await getCachedPerushDetail(perush.id, perekId);
	const notesExcerpt = perushDetail
		? plainText(
				perushDetail.notes.map((note) => note.noteContent).join(" "),
				160,
			)
		: "";

	const title = `${perush.name} על ${sefer.name} ${perekObj.perekHeb} | ${SITE_NAME}`;
	const description =
		notesExcerpt ||
		`פירוש ${perush.name} מאת ${perush.parshanName} על ${sefer.name} פרק ${perekObj.perekHeb}`;
	const url = perushPath(perekId, perush.name);
	return {
		title,
		description,
		alternates: {
			canonical: url,
		},
		openGraph: {
			title,
			description,
			url,
			siteName: SITE_NAME,
			locale: "he_IL",
			type: "article",
			authors: [perush.parshanName],
		},
	};
}

export default async function ArticlePage({
	params,
}: {
	params: Promise<{ number: string; slug: string }>;
}) {
	const { number, slug: rawSlug } = await params;
	const slug = decodeURIComponent(rawSlug);
	const perekId = Number.parseInt(number, 10);
	const id = Number.parseInt(slug, 10);

	if (Number.isNaN(perekId)) {
		notFound();
	}

	// Determine if this is an article (numeric) or perush (Hebrew name)
	const isArticle = !Number.isNaN(id);

	const perekObj = getPerekByPerekId(perekId);
	const articles = await getCachedArticles(perekId);
	const perushim = await getCachedPerushim(perekId);

	const sefer = getSeferByName(perekObj.sefer);
	const perekIds = getPerekIdsForSefer(sefer);
	const entityRefsByPerek = await fetchAllEntityRefs(perekIds);
	const imagesByPerek = await getPerekImagesByChapter();
	const seferImages = selectPerekImages(imagesByPerek, perekIds);

	if (isArticle) {
		// Handle article view
		const article = await getCachedArticle(id);

		if (!article || article.perekId !== perekId) {
			notFound();
		}

		return (
			<>
				<JsonLd
					data={buildArticleGraph({
						article,
						perekObj,
						authorSlug: authorNameToSlug(article.authorName),
					})}
				/>
				<ScrollToSlug targetId="article-view" />
				<section id="article-view" className={styles.expandedArticle}>
					<header className={styles.articleHeader}>
						<Link
							href={`/929/authors/${authorNameToSlug(article.authorName)}`}
							className={styles.authorLink}
						>
							<div className={styles.authorImage}>
								<Image
									src={article.authorImageUrl}
									alt={article.authorName}
									width={80}
									height={80}
									className={styles.authorImg}
								/>
							</div>
							<span className={styles.authorName}>{article.authorName}</span>
						</Link>
						<h1 className={styles.articleTitle}>{article.name}</h1>
					</header>

					{article.content && (
						<div
							className={styles.articleBody}
							// biome-ignore lint/security/noDangerouslySetInnerHtml: Content is from trusted database
							dangerouslySetInnerHTML={{ __html: article.content }}
						/>
					)}

					<div className={styles.backToPerek}>
						<Link href={`/929/${perekId}`} className={styles.backLink}>
							חזרה לפרק →
						</Link>
					</div>
				</section>
				<Suspense>
					<SeferComposite
						perekObj={perekObj}
						articles={articles}
						perushim={perushim}
						perekIds={perekIds}
						entityRefsByPerek={entityRefsByPerek}
						imagesByPerek={seferImages}
						initialSlug={slug}
					/>
				</Suspense>
				<div className={styles.articlePerekContainer}>
					<Breadcrumb perekObj={perekObj} />
					<PerekHeading perekObj={perekObj} />

					<PerekText
						perekObj={perekObj}
						entityRefs={entityRefsByPerek[perekId] ?? []}
					/>

					{/* Perushim section - commentaries carousel */}
					<PerushimSection perekId={perekId} perushim={perushim} />

					{/* Articles carousel */}
					<ArticlesSection articles={articles} />
				</div>
			</>
		);
	}

	// Handle perush view
	const perush = perushim.find((p) => p.name === slug);

	if (!perush) {
		notFound();
	}

	const perushDetail = await getCachedPerushDetail(perush.id, perekId);

	if (!perushDetail) {
		notFound();
	}

	return (
		<>
			<JsonLd data={buildPerushGraph({ perush: perushDetail, perekObj })} />
			<ScrollToSlug targetId="perush-view" />
			<Suspense fallback={null}>
				<ScrollToPerushPasukNote />
			</Suspense>
			<section id="perush-view" className={styles.expandedPerush}>
				<header className={styles.perushHeader}>
					<h1 className={styles.perushTitle}>
						{perushDetail.name} על {perekObj.source}
					</h1>
					<h2 className={styles.parshanName}>{perushDetail.parshanName}</h2>
				</header>

				<div className={styles.perushContent}>
					{perushDetail.notes.map((note, idx) => {
						const prevSamePasuk =
							idx > 0 && perushDetail.notes[idx - 1].pasuk === note.pasuk;
						const noteAnchorId = !prevSamePasuk
							? `perush-pasuk-${note.pasuk}`
							: undefined;
						return (
							<div
								key={`${note.pasuk}-${note.noteIdx}`}
								id={noteAnchorId}
								className={styles.note}
								data-perush-pasuk={note.pasuk}
							>
								<span id={`note-${toLetters(note.pasuk)}-${note.noteIdx + 1}`} />
								<span className={styles.notePasuk}>
									פסוק {toLetters(note.pasuk)}:
								</span>
								<div
									className={styles.noteContent}
									// biome-ignore lint/security/noDangerouslySetInnerHtml: Content is from trusted database
									dangerouslySetInnerHTML={{ __html: note.noteContent }}
								/>
							</div>
						);
					})}
				</div>

				<div className={styles.backToPerek}>
					<Link href={`/929/${perekId}`} className={styles.backLink}>
						חזרה לפרק →
					</Link>
				</div>
			</section>
			<Suspense>
				<SeferComposite
					perekObj={perekObj}
					articles={articles}
					perushim={perushim}
					perekIds={perekIds}
					entityRefsByPerek={entityRefsByPerek}
					imagesByPerek={seferImages}
					initialSlug={slug}
				/>
			</Suspense>
			<div className={styles.articlePerekContainer}>
				<Breadcrumb perekObj={perekObj} />
				<PerekHeading perekObj={perekObj} />

				<PerekText
					perekObj={perekObj}
					entityRefs={entityRefsByPerek[perekId] ?? []}
				/>

				{/* Perushim section - commentaries carousel */}
				<PerushimSection perekId={perekId} perushim={perushim} />

				{/* Articles carousel */}
				<ArticlesSection articles={articles} />
			</div>
		</>
	);
}
