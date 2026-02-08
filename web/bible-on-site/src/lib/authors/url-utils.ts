/**
 * Author-specific URL slug helpers.
 * Thin wrappers over the general-purpose slug utilities in @/util/slug
 * so call-sites can use domain-specific names while the logic stays shared.
 */

export {
	sanitizeForUrl as normalizeAuthorName,
	toUrlSlug as authorNameToSlug,
} from "../../util/slug";
