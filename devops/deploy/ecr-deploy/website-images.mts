import {
	type APIPublishOptions,
	type PreparedAPIArchives,
	publishAPIImages,
} from "./api-images.mts";

// Reuse the source/config/layer validation and immutable publication used by API.
// Website build caches are the only additional mutable tags.
export const WEBSITE_MUTABLE_TAGS = [
	"latest",
	"deps-cache",
	"deps-cache-arm64",
] as const;

export async function publishWebsiteImages(
	prepared: PreparedAPIArchives,
	options: Omit<APIPublishOptions, "mutableTags">,
) {
	if (options.repositoryName !== "bible-on-site")
		throw new Error(
			"Website images require the existing bible-on-site repository",
		);
	return publishAPIImages(prepared, {
		...options,
		mutableTags: WEBSITE_MUTABLE_TAGS,
	});
}
