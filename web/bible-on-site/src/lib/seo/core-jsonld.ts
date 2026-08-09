import type { Graph, Thing } from "schema-dts";
import type { PerekObj } from "@/data/perek-dto";
import type { Article } from "@/lib/articles";
import type { AuthorDetails } from "@/lib/authors";
import type { PerushDetail } from "@/lib/perushim";
import {
	absUrl,
	breadcrumbNode,
	buildGraph,
	hasContent,
	nodeId,
	plainText,
	WEBSITE_ID,
} from "./jsonld";

const HOME_LABEL = "בית";

/** Stable `@id` for the Tanah as a whole work. */
export const TANAH_ID = "urn:bible-on-site:tanah";
export const TANAH_NAME = 'תנ"ך';

export const AUTHORS_PATH = "/929/authors";
export const AUTHORS_LABEL = "הרבנים";

/** Stable `@id` for a Sefer (book), independent of any single perek page. */
export function seferId(seferName: string): string {
	return `urn:bible-on-site:sefer:${encodeURIComponent(seferName)}`;
}

/** Stable `@id` for a Parshan (commentator without a dedicated page). */
export function parshanId(parshanName: string): string {
	return `urn:bible-on-site:parshan:${encodeURIComponent(parshanName)}`;
}

export function perekPath(perekId: number): string {
	return `/929/${perekId}`;
}

export function articlePath(perekId: number, articleId: number): string {
	return `/929/${perekId}/${articleId}`;
}

export function perushPath(perekId: number, perushName: string): string {
	return `/929/${perekId}/${encodeURIComponent(perushName)}`;
}

export function authorPath(slug: string): string {
	return `${AUTHORS_PATH}/${slug}`;
}

/** Shared Tanah + Sefer hierarchy nodes (Chapter → Book(Sefer) → Book(Tanah)). */
function tanahAndSeferNodes(seferName: string, helek: string): Thing[] {
	const tanah: Record<string, unknown> = {
		"@type": "Book",
		"@id": TANAH_ID,
		name: TANAH_NAME,
		inLanguage: "he",
	};
	const sefer: Record<string, unknown> = {
		"@type": "Book",
		"@id": seferId(seferName),
		name: seferName,
		inLanguage: "he",
		isPartOf: { "@id": TANAH_ID },
		...(helek ? { genre: helek } : {}),
	};
	return [tanah as unknown as Thing, sefer as unknown as Thing];
}

/**
 * Build the `@graph` for a perek text page (`/929/[number]`).
 *
 * Thin: one `Chapter` node in the Tanah → Sefer → Chapter hierarchy plus a
 * breadcrumb. The visible perek text is left in the page HTML (already
 * crawlable) rather than duplicated into an `articleBody`.
 */
export function buildPerekGraph(perekObj: PerekObj): Graph {
	const path = perekPath(perekObj.perekId);
	const url = absUrl(path);
	const chapterId = nodeId(path, "chapter");
	const breadcrumb = breadcrumbNode(
		[
			{ name: HOME_LABEL, path: "/" },
			{ name: perekObj.source, path },
		],
		path,
	);
	const chapter: Record<string, unknown> = {
		"@type": "Chapter",
		"@id": chapterId,
		name: perekObj.source,
		inLanguage: "he",
		isPartOf: { "@id": seferId(perekObj.sefer) },
	};
	const webPage: Record<string, unknown> = {
		"@type": "WebPage",
		"@id": nodeId(path, "webpage"),
		url,
		name: perekObj.source,
		inLanguage: "he",
		isPartOf: { "@id": WEBSITE_ID },
		about: { "@id": chapterId },
		breadcrumb: { "@id": breadcrumb["@id"] },
	};
	return buildGraph([
		webPage as unknown as Thing,
		breadcrumb,
		chapter as unknown as Thing,
		...tanahAndSeferNodes(perekObj.sefer, perekObj.helek),
	]);
}

export interface ArticleGraphInput {
	article: Article;
	perekObj: PerekObj;
	authorSlug: string;
}

/** Build the `@graph` for an article page (`/929/[number]/[articleId]`). */
export function buildArticleGraph(input: ArticleGraphInput): Graph {
	const { article, perekObj, authorSlug } = input;
	const perekPathStr = perekPath(perekObj.perekId);
	const path = articlePath(article.perekId, article.id);
	const url = absUrl(path);
	const authorUrl = absUrl(authorPath(authorSlug));
	const authorNodeId = `${authorUrl}#person`;
	const chapterId = nodeId(perekPathStr, "chapter");
	const breadcrumb = breadcrumbNode(
		[
			{ name: HOME_LABEL, path: "/" },
			{ name: perekObj.source, path: perekPathStr },
			{ name: article.name, path },
		],
		path,
	);
	const person: Record<string, unknown> = {
		"@type": "Person",
		"@id": authorNodeId,
		name: article.authorName,
		url: authorUrl,
		...(article.authorImageUrl ? { image: article.authorImageUrl } : {}),
	};
	const articleNode: Record<string, unknown> = {
		"@type": "Article",
		"@id": nodeId(path, "article"),
		headline: article.name,
		url,
		inLanguage: "he",
		author: { "@id": authorNodeId },
		about: { "@id": chapterId },
		isPartOf: { "@id": WEBSITE_ID },
		mainEntityOfPage: url,
	};
	const descSource = article.abstract ?? article.content ?? "";
	if (hasContent(descSource)) {
		articleNode.description = plainText(descSource, 300);
	}
	const webPage: Record<string, unknown> = {
		"@type": "WebPage",
		"@id": nodeId(path, "webpage"),
		url,
		name: article.name,
		inLanguage: "he",
		isPartOf: { "@id": WEBSITE_ID },
		breadcrumb: { "@id": breadcrumb["@id"] },
	};
	return buildGraph([
		webPage as unknown as Thing,
		breadcrumb,
		articleNode as unknown as Thing,
		person as unknown as Thing,
	]);
}

export interface PerushGraphInput {
	perush: PerushDetail;
	perekObj: PerekObj;
	/** Verified external references for the parshan (Phase 4 external-ref). */
	sameAs?: string[];
}

/** Build the `@graph` for a perush page (`/929/[number]/[perushName]`). */
export function buildPerushGraph(input: PerushGraphInput): Graph {
	const { perush, perekObj, sameAs } = input;
	const perekPathStr = perekPath(perekObj.perekId);
	const path = perushPath(perekObj.perekId, perush.name);
	const url = absUrl(path);
	const chapterId = nodeId(perekPathStr, "chapter");
	const commentatorId = parshanId(perush.parshanName);
	const title = `${perush.name} על ${perekObj.source}`;
	const breadcrumb = breadcrumbNode(
		[
			{ name: HOME_LABEL, path: "/" },
			{ name: perekObj.source, path: perekPathStr },
			{ name: perush.name, path },
		],
		path,
	);
	const person: Record<string, unknown> = {
		"@type": "Person",
		"@id": commentatorId,
		name: perush.parshanName,
	};
	if (perush.parshanBirthYear) {
		person.birthDate = String(perush.parshanBirthYear);
	}
	if (sameAs && sameAs.length > 0) {
		person.sameAs = sameAs;
	}
	const articleNode: Record<string, unknown> = {
		"@type": "Article",
		"@id": nodeId(path, "article"),
		headline: title,
		name: title,
		url,
		inLanguage: "he",
		author: { "@id": commentatorId },
		about: { "@id": chapterId },
		isPartOf: { "@id": WEBSITE_ID },
		mainEntityOfPage: url,
	};
	const webPage: Record<string, unknown> = {
		"@type": "WebPage",
		"@id": nodeId(path, "webpage"),
		url,
		name: title,
		inLanguage: "he",
		isPartOf: { "@id": WEBSITE_ID },
		breadcrumb: { "@id": breadcrumb["@id"] },
	};
	return buildGraph([
		webPage as unknown as Thing,
		breadcrumb,
		articleNode as unknown as Thing,
		person as unknown as Thing,
	]);
}

export interface AuthorGraphInput {
	author: AuthorDetails;
	slug: string;
	/** Verified external references for the author (Phase 4 external-ref). */
	sameAs?: string[];
}

/** Build the `@graph` for an author page (`/929/authors/[slug]`). */
export function buildAuthorGraph(input: AuthorGraphInput): Graph {
	const { author, slug, sameAs } = input;
	const path = authorPath(slug);
	const url = absUrl(path);
	const personId = `${url}#person`;
	const breadcrumb = breadcrumbNode(
		[
			{ name: HOME_LABEL, path: "/" },
			{ name: AUTHORS_LABEL, path: AUTHORS_PATH },
			{ name: author.name, path },
		],
		path,
	);
	const person: Record<string, unknown> = {
		"@type": "Person",
		"@id": personId,
		name: author.name,
		url,
	};
	if (author.imageUrl) {
		person.image = author.imageUrl;
	}
	if (hasContent(author.details)) {
		person.description = plainText(author.details, 300);
	}
	if (sameAs && sameAs.length > 0) {
		person.sameAs = sameAs;
	}
	const profilePage: Record<string, unknown> = {
		"@type": "ProfilePage",
		"@id": nodeId(path, "webpage"),
		url,
		name: author.name,
		inLanguage: "he",
		isPartOf: { "@id": WEBSITE_ID },
		mainEntity: { "@id": personId },
		breadcrumb: { "@id": breadcrumb["@id"] },
	};
	return buildGraph([
		profilePage as unknown as Thing,
		breadcrumb,
		person as unknown as Thing,
	]);
}

export interface AuthorsListGraphInput {
	authors: { name: string; slug: string }[];
}

/** Build the `@graph` for the authors listing page (`/929/authors`). */
export function buildAuthorsListGraph(input: AuthorsListGraphInput): Graph {
	const { authors } = input;
	const url = absUrl(AUTHORS_PATH);
	const listId = nodeId(AUTHORS_PATH, "itemlist");
	const breadcrumb = breadcrumbNode(
		[
			{ name: HOME_LABEL, path: "/" },
			{ name: AUTHORS_LABEL, path: AUTHORS_PATH },
		],
		AUTHORS_PATH,
	);
	const itemList: Record<string, unknown> = {
		"@type": "ItemList",
		"@id": listId,
		numberOfItems: authors.length,
		itemListElement: authors.map((author, index) => ({
			"@type": "ListItem",
			position: index + 1,
			url: absUrl(authorPath(author.slug)),
			name: author.name,
		})),
	};
	const page: Record<string, unknown> = {
		"@type": "CollectionPage",
		"@id": nodeId(AUTHORS_PATH, "webpage"),
		url,
		name: AUTHORS_LABEL,
		inLanguage: "he",
		isPartOf: { "@id": WEBSITE_ID },
		mainEntity: { "@id": listId },
		breadcrumb: { "@id": breadcrumb["@id"] },
	};
	return buildGraph([
		page as unknown as Thing,
		breadcrumb,
		itemList as unknown as Thing,
	]);
}
