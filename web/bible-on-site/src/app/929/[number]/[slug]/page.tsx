import { toLetters } from "gematry";
import DOMPurify from "isomorphic-dompurify";
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
	getArticleDedications,
	getSeferDedications,
	getSeferPerekDedicationLines,
} from "../../../../lib/dedications/loaders";
import { seferIdByName } from "../../../../lib/dedications/service";
import { demoteHeadings } from "../../../../lib/html-headings";
import { decorateArticleContent } from "../../../../lib/tanahpedia/article-mention-refs";
import {
	getAllPerushPerekNamePairs,
	getPerushDetail,
	getPerushimByPerekId,
} from "../../../../lib/perushim";
import {
	articleTag,
	cachedPerKey,
	COLLECTION_TAGS,
	perekArticlesTag,
	perekPerushimTag,
	perushDetailTag,
} from "../../../../lib/revalidate/tags";
import {
	articlePath,
	authorPath,
	buildArticleGraph,
	buildPerushGraph,
	perushPath,
} from "../../../../lib/seo/core-jsonld";
import { absUrl, plainText, SITE_NAME } from "../../../../lib/seo/jsonld";
import { pageMetadata } from "../../../../lib/seo/opengraph";
import { selectPerekImages } from "../../../../lib/seo/perek-illustrations";
import { getPerekImagesByChapter } from "../../../../lib/seo/perek-images-data";
import { fetchAllEntityRefs } from "../../../../lib/tanahpedia/perek-entity-refs";
import {
	DedicationLines,
	dedicationLines,
} from "../../../components/dedications/DedicationLines";
import { JsonLd } from "../../../components/JsonLd";
import { ReadingTime } from "@/app/components/ReadingTime";
import { ArticleActions } from "../components/ArticleActions";
import { ArticlesSection } from "../components/ArticlesSection";
import Breadcrumb from "../components/Breadcrumb";
import { PerekHeading } from "../components/PerekHeading";
import { PerekText } from "../components/PerekText";
import { PerushimSection } from "../components/PerushimSection";
import SeferComposite from "../components/SeferComposite";
import { ShareButton } from "../components/ShareButton";
import styles from "./page.module.css";
import { ScrollToSlug } from "./ScrollToArticle";
import { ScrollToArticleMatch } from "./ScrollToArticleMatch";
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
 * Entity-scoped caches with on-demand revalidation support: each entry
 * carries both its collection tag and its entity tag so an admin change
 * invalidates exactly the data and routes that consume it.
 */
const getCachedArticle = cachedPerKey(
	"article",
	(id: number) => String(id),
	(key) => [COLLECTION_TAGS.articles, articleTag(Number(key))],
	(id: number) => getArticleById(id),
);

const getCachedArticles = cachedPerKey(
	"article-summaries",
	(perekId: number) => String(perekId),
	(key) => [COLLECTION_TAGS.articles, perekArticlesTag(Number(key))],
	(perekId: number) => getArticleSummariesByPerekId(perekId),
);

const getCachedPerushim = cachedPerKey(
	"perushim",
	(perekId: number) => String(perekId),
	(key) => [COLLECTION_TAGS.perushim, perekPerushimTag(Number(key))],
	(perekId: number) => getPerushimByPerekId(perekId),
);

const getCachedPerushDetail = cachedPerKey(
	"perush-detail",
	(perushId: number, perekId: number) => `${perushId}:${perekId}`,
	(key) => {
		const [perushId, perekId] = key.split(":").map(Number);
		return [
			COLLECTION_TAGS.perushim,
			perushDetailTag(perushId, perekId),
		];
	},
	(perushId: number, perekId: number) => getPerushDetail(perushId, perekId),
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
		// `article:section` is optional enrichment — an out-of-range perek
		// segment must not fail metadata (the component still 404s mismatches).
		const seferName =
			perekId >= 1 && perekId <= 929
				? getPerekByPerekId(perekId)?.sefer
				: undefined;
		const illustration = (await getPerekImagesByChapter())?.[perekId]?.[0];
		return pageMetadata({
			title,
			description,
			canonical: url,
			type: "article",
			// `article:author` must be a profile URL — the author's public page.
			authors: [absUrl(authorPath(authorNameToSlug(article.authorName)))],
			section: seferName,
			image: illustration
				? {
						url: illustration.socialSrc,
						width: illustration.socialWidth,
						height: illustration.socialHeight,
						alt: illustration.alt,
					}
				: {
						// The author's portrait is the page's own content image;
						// intrinsic dimensions are unknown, so they are omitted
						// rather than guessed.
						url: article.authorImageUrl,
						alt: article.authorName,
						type: "image/jpeg",
					},
		});
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
	const perushDetail = await getCachedPerushDetail(perush.id, perekId);
	const notesExcerpt = perushDetail
		? plainText(
				perushDetail.notes.map((note) => note.noteContent).join(" "),
				160,
			)
		: "";

	const title = `${perush.name} על ${perekObj.source} | ${SITE_NAME}`;
	const description =
		notesExcerpt ||
		`פירוש ${perush.name} מאת ${perush.parshanName} על ${perekObj.source}`;
	const url = perushPath(perekId, perush.name);
	const illustration = (await getPerekImagesByChapter())?.[perekId]?.[0];
	return pageMetadata({
		title,
		description,
		canonical: url,
		type: "article",
		// Classical commentators have no public profile page, and OGP requires
		// `article:author` to be a URL — so no `authors` value is emitted here.
		section: perekObj.sefer,
		image: illustration
			? {
					url: illustration.socialSrc,
					width: illustration.socialWidth,
					height: illustration.socialHeight,
					alt: illustration.alt,
				}
			: undefined,
	});
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

	// Dedications (#2731): the book keeps the sefer+helek cover set and the
	// perek-scoped spread lines regardless of the route it opens from — the
	// article/perush routes share the same `SeferComposite` mount contract
	// as the flat perek page.
	const seferId = seferIdByName(perekObj.sefer);
	const seferDedicationLines = dedicationLines(
		seferId === undefined ? [] : await getSeferDedications(seferId),
	);
	const perekDedications =
		seferId === undefined ? {} : await getSeferPerekDedicationLines(seferId);

	if (isArticle) {
		// Handle article view; mention decorations (#2516) resolve against
		// live entries per render — the returned copy carries them.
		let article = await getCachedArticle(id);

		if (!article || article.perekId !== perekId) {
			notFound();
		}

		// Mention decorations (#2516) resolve against live entries per
		// render; unresolved targets stay plain text.
		article = await decorateArticleContent(article);

		// The article's own dedication scope renders under its title (#2731).
		const articleDedicationLines = dedicationLines(
			await getArticleDedications(article.id),
		);

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
				<Suspense fallback={null}>
					<ScrollToArticleMatch />
				</Suspense>
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
						<DedicationLines lines={articleDedicationLines} />
						<ReadingTime
							estimatedSeconds={article.metric?.estimatedSeconds}
							className={styles.readingTime}
						/>
					</header>

					{article.content && (
						<div
							className={styles.articleBody}
							// biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized with DOMPurify
							dangerouslySetInnerHTML={{
								__html: DOMPurify.sanitize(demoteHeadings(article.content)),
							}}
						/>
					)}
					{/* The unified article command row (#2786) trails the article
					 * here — review ask: the standalone route keeps its main
					 * content on top and its commands at the bottom. */}
					<div className={styles.backToPerek}>
						<ArticleActions
							backLabel="חזרה לפרק"
							backHref={`/929/${perekId}`}
							canonicalPath={`/929/${perekId}/${article.id}`}
							shareTitle={`${article.name} - ${article.authorName}`}
						/>
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
						seferDedications={seferDedicationLines}
						perekDedications={perekDedications}
						initialSlug={slug}
					/>
				</Suspense>
				<div className={styles.articlePerekContainer}>
					<Breadcrumb perekObj={perekObj} />
					<PerekHeading perekObj={perekObj} level={2} />

					<PerekText
						perekObj={perekObj}
						entityRefs={entityRefsByPerek[perekId] ?? []}
					/>

					{/* Perushim section - commentaries carousel */}
					<PerushimSection
						perekId={perekId}
						perushim={perushim}
						scrollStorageKey={`perushim-perek-${perekId}`}
					/>

					{/* Articles carousel */}
					<ArticlesSection
						articles={articles}
						scrollStorageKey={`articles-perek-${perekId}`}
					/>
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
					<ReadingTime
						estimatedSeconds={perushDetail.metric?.estimatedSeconds}
						className={styles.readingTime}
					/>
					<ShareButton
						canonicalPath={perushPath(perekId, perushDetail.name)}
						title={`${perushDetail.name} - ${perushDetail.parshanName}`}
					/>
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
								data-perush-note={note.noteIdx}
							>
								<span className={styles.notePasuk}>
									פסוק {toLetters(note.pasuk)}:
								</span>
								<div
									className={styles.noteContent}
									// biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized with DOMPurify
									dangerouslySetInnerHTML={{
										__html: DOMPurify.sanitize(
											demoteHeadings(note.noteContent),
										),
									}}
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
					seferDedications={seferDedicationLines}
					perekDedications={perekDedications}
					initialSlug={slug}
				/>
			</Suspense>
			<div className={styles.articlePerekContainer}>
				<Breadcrumb perekObj={perekObj} />
				<PerekHeading perekObj={perekObj} level={2} />

				<PerekText
					perekObj={perekObj}
					entityRefs={entityRefsByPerek[perekId] ?? []}
				/>

				{/* Perushim section - commentaries carousel */}
				<PerushimSection
					perekId={perekId}
					perushim={perushim}
					scrollStorageKey={`perushim-perek-${perekId}`}
				/>

				{/* Articles carousel */}
				<ArticlesSection
					articles={articles}
					scrollStorageKey={`articles-perek-${perekId}`}
				/>
			</div>
		</>
	);
}
