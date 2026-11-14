import {
	type APIPublishOptions,
	type PreparedAPIArchives,
	publishAPIImages,
} from "./api-images.mts";

// Reuse the source/config/layer validation and immutable publication used by API.
// Admin keeps the default repository policy: only `latest` is mutable.
export async function publishAdminImages(
	prepared: PreparedAPIArchives,
	options: Omit<APIPublishOptions, "mutableTags">,
) {
	if (options.repositoryName !== "bible-on-site-admin")
		throw new Error(
			"Admin images require the existing bible-on-site-admin repository",
		);
	return publishAPIImages(prepared, options);
}
