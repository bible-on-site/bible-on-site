import { toLetters } from "gematry";
import { unstable_cache } from "next/cache";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import React, { Suspense } from "react";
import { isQriDifferentThanKtiv } from "../../../../data/db/tanah-view-types";
import { getPerekByPerekId } from "../../../../data/perek-dto";
import { getSeferByName, getPerekIdsForSefer } from "../../../../data/sefer-dto";
import { getArticleById, getArticlesByPerekId } from "../../../../lib/articles";
import { authorNameToSlug } from "../../../../lib/authors";
import { getPerushDetail, getPerushimByPerekId } from "../../../../lib/perushim";
import { ArticlesSection } from "../components/ArticlesSection";
import { PerushimSection } from "../components/PerushimSection";
import Breadcrumb from "../components/Breadcrumb";
import { Ptuah } from "../components/Ptuha";
import SeferComposite from "../components/SeferComposite";
import { Stuma } from "../components/Stuma";
import perekStyles from "../page.module.css";
import styles from "./page.module.css";
import { ScrollToArticle } from "./ScrollToArticle";

/**
 * Generate static params for known articles and perushim at build time.
 */
export async function generateStaticParams({
	params,
}: {
	params: { number: string };
}) {
	const perekId = Number.parseInt(params.number, 10);
	const [articles, perushim] = await Promise.all([
		getArticlesByPerekId(perekId),
		getPerushimByPerekId(perekId),
	]);
	return [
		...articles.map((article) => ({ articleId: String(article.id) })),
		...perushim.map((perush) => ({ articleId: perush.name })),
	];
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
	async (perekId: number) => getArticlesByPerekId(perekId),
	["articles"],
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
	params: Promise<{ number: string; articleId: string }>;
}) {
	const { number, articleId } = await params;
	const perekId = Number.parseInt(number, 10);
	const id = Number.parseInt(articleId, 10);

	// Check if it's a numeric article ID
	if (!Number.isNaN(id)) {
		const article = await getCachedArticle(id);
		if (!article) {
			return {
				title: "מאמר לא נמצא | תנ״ך באתר",
			};
		}

		const descriptionSource = article.abstract || article.content;
		return {
			title: `${article.name} | ${article.authorName} | תנ״ך באתר`,
			description: descriptionSource
				? descriptionSource.replace(/<[^>]*>/g, "").slice(0, 160)
				: `מאמר מאת ${article.authorName}`,
		};
	}

	// Otherwise it's a perush name
	const perushim = await getCachedPerushim(perekId);
	const perush = perushim.find((p) => p.name === articleId);

	if (!perush) {
		return {
			title: "פירוש לא נמצא | תנ״ך באתר",
		};
	}

	const perekObj = getPerekByPerekId(perekId);
	const sefer = getSeferByName(perekObj.sefer);

	return {
		title: `${perush.name} על ${sefer.name} ${perekObj.perekHeb} | תנ״ך באתר`,
		description: `פירוש ${perush.name} מאת ${perush.parshanName} על ${sefer.name} פרק ${perekObj.perekHeb}`,
	};
}

export default async function ArticlePage({
	params,
}: {
	params: Promise<{ number: string; articleId: string }>;
}) {
	const { number, articleId } = await params;
	const perekId = Number.parseInt(number, 10);
	const id = Number.parseInt(articleId, 10);

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
	const articlesByPerekIndex = await Promise.all(
		perekIds.map((pid) => getCachedArticles(pid)),
	);

	if (isArticle) {
		// Handle article view
		const article = await getCachedArticle(id);

		if (!article || article.perekId !== perekId) {
			notFound();
		}

		return (
			<>
				<ScrollToArticle />
				<Suspense>
					<SeferComposite
						perekObj={perekObj}
						articles={articles}
						articlesByPerekIndex={articlesByPerekIndex}
					/>
				</Suspense>
				<div className={perekStyles.perekContainer}>
					<Breadcrumb perekObj={perekObj} />

					<article className={perekStyles.perekText}>
						{perekObj.pesukim.map((pasuk, pasukIdx) => {
							const pasukKey = pasukIdx + 1;
							const pasukNumElement = (
								<span className={perekStyles.pasukNum}>
									{toLetters(pasukIdx + 1)}
								</span>
							);
							const pasukElement = pasuk.segments.map((segment, segmentIdx) => {
								const segmentKey = `${pasukIdx + 1}-${segmentIdx + 1}`;
								const isQriWithDifferentKtiv =
									segment.type === "qri" && isQriDifferentThanKtiv(segment);
								return (
									<React.Fragment key={segmentKey}>
										<span
											className={isQriWithDifferentKtiv ? perekStyles.qri : ""}
										>
											{segment.type === "ktiv" ? (
												segment.value
											) : segment.type === "qri" ? (
												isQriWithDifferentKtiv ? (
													<>
														{/* biome-ignore lint/a11y/noLabelWithoutControl: It'll take some time to validate this fix altogether with css rules */}
														(<label />
														{segment.value})
													</>
												) : (
													segment.value
												)
											) : segment.type === "ptuha" ? (
												Ptuah()
											) : (
												Stuma()
											)}
										</span>
										{segmentIdx === pasuk.segments.length - 1 ||
										((segment.type === "ktiv" || segment.type === "qri") &&
											segment.value.at(segment.value.length - 1) ===
												"־") ? null : (
											<span> </span>
										)}
									</React.Fragment>
								);
							});
							return (
								<React.Fragment key={pasukKey}>
									{pasukNumElement}
									<span> </span>
									{pasukElement}
									<span> </span>
								</React.Fragment>
							);
						})}
					</article>

					{/* Perushim section - commentaries carousel */}
					<PerushimSection perekId={perekId} perushim={perushim} />

					{/* Articles carousel */}
					<ArticlesSection articles={articles} />

					{/* Expanded article view */}
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
										unoptimized
									/>
								</div>
								<span className={styles.authorName}>{article.authorName}</span>
							</Link>
							<h2 className={styles.articleTitle}>{article.name}</h2>
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
				</div>
			</>
		);
	}

	// Handle perush view
	const perush = perushim.find((p) => p.name === articleId);

	if (!perush) {
		notFound();
	}

	const perushDetail = await getCachedPerushDetail(perush.id, perekId);

	if (!perushDetail) {
		notFound();
	}

	return (
		<>
			<Suspense>
				<SeferComposite
					perekObj={perekObj}
					articles={articles}
					articlesByPerekIndex={articlesByPerekIndex}
				/>
			</Suspense>
			<div className={perekStyles.perekContainer}>
				<Breadcrumb perekObj={perekObj} />

				<article className={perekStyles.perekText}>
					{perekObj.pesukim.map((pasuk, pasukIdx) => {
						const pasukKey = pasukIdx + 1;
						const pasukNumElement = (
							<span className={perekStyles.pasukNum}>
								{toLetters(pasukIdx + 1)}
							</span>
						);
						const pasukElement = pasuk.segments.map((segment, segmentIdx) => {
							const segmentKey = `${pasukIdx + 1}-${segmentIdx + 1}`;
							const isQriWithDifferentKtiv =
								segment.type === "qri" && isQriDifferentThanKtiv(segment);
							return (
								<React.Fragment key={segmentKey}>
									<span
										className={isQriWithDifferentKtiv ? perekStyles.qri : ""}
									>
										{segment.type === "ktiv" ? (
											segment.value
										) : segment.type === "qri" ? (
											isQriWithDifferentKtiv ? (
												<>
													{/* biome-ignore lint/a11y/noLabelWithoutControl: It'll take some time to validate this fix altogether with css rules */}
													(<label />
													{segment.value})
												</>
											) : (
												segment.value
											)
										) : segment.type === "ptuha" ? (
											Ptuah()
										) : (
											Stuma()
										)}
									</span>
									{segmentIdx === pasuk.segments.length - 1 ||
									((segment.type === "ktiv" || segment.type === "qri") &&
										segment.value.at(segment.value.length - 1) ===
											"־") ? null : (
										<span> </span>
									)}
								</React.Fragment>
							);
						});
						return (
							<React.Fragment key={pasukKey}>
								{pasukNumElement}
								<span> </span>
								{pasukElement}
								<span> </span>
							</React.Fragment>
						);
					})}
				</article>

				{/* Perushim section - commentaries carousel */}
				<PerushimSection perekId={perekId} perushim={perushim} />

				{/* Articles carousel */}
				<ArticlesSection articles={articles} />

				{/* Expanded perush view */}
				<section id="perush-view" className={styles.expandedPerush}>
					<header className={styles.perushHeader}>
						<h2 className={styles.perushTitle}>
							{perushDetail.name}
							{perushDetail.parshanBirthYear && (
								<span className={styles.parshanYear}>
									{" "}
									({perushDetail.parshanBirthYear})
								</span>
							)}
						</h2>
						<h3 className={styles.parshanName}>{perushDetail.parshanName}</h3>
					</header>

					<div className={styles.perushContent}>
						{perushDetail.notes.map((note) => (
							<div key={`${note.pasuk}-${note.noteIdx}`} className={styles.note}>
								<span className={styles.notePasuk}>
									פסוק {toLetters(note.pasuk)}:
								</span>
								<div
									className={styles.noteContent}
									// biome-ignore lint/security/noDangerouslySetInnerHtml: Content is from trusted database
									dangerouslySetInnerHTML={{ __html: note.noteContent }}
								/>
							</div>
						))}
					</div>

					<div className={styles.backToPerek}>
						<Link href={`/929/${perekId}`} className={styles.backLink}>
							חזרה לפרק →
						</Link>
					</div>
				</section>
			</div>
		</>
	);
}
