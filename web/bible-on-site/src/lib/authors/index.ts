export {
	getAllAuthorIds,
	getAllAuthorSlugs,
	getArticlesByAuthorId,
	getAuthorById,
	getAuthorByName,
	getAuthorImageUrl,
} from "./service";
export type { AuthorArticle, AuthorDetails } from "./types";
export { authorNameToSlug, normalizeAuthorName } from "./url-utils";
