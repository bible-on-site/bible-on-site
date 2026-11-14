import {
	type APIPublishOptions,
	type PreparedAPIArchives,
	publishAPIImages,
} from "./api-images.mts";
import {
	publishWebsiteSociChild,
	websiteSociIndex,
	websiteSociTool,
} from "./website-soci.mts";

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
	const useSoci = prepared.images.some((image) => image.ociSource);
	if (
		useSoci &&
		(!prepared.images.every((image) => image.ociSource) ||
			!options.publishIndex ||
			options.pushArchive ||
			options.indexManifests)
	)
		throw new Error(
			"SOCI publication requires the exact marked architecture pair and its validated index publisher",
		);
	let tool: Promise<string> | undefined;
	return publishAPIImages(prepared, {
		...options,
		mutableTags: WEBSITE_MUTABLE_TAGS,
		...(useSoci
			? ({
					pushArchive: async (path: string, reference: string) => {
						const archive = prepared.images.find(
							(image) => image.path === path,
						);
						if (
							!archive ||
							reference !==
								`${options.repositoryUri}:v${options.version}-${archive.architecture}`
						)
							throw new Error("Unexpected SOCI publication target");
						tool ??= websiteSociTool(prepared.directory);
						await publishWebsiteSociChild(
							archive,
							prepared.directory,
							options.client,
							options.repositoryName,
							`v${options.version}-${archive.architecture}`,
							await tool,
						);
					},
					indexManifests: async (_children, staged) =>
						websiteSociIndex(options.client, options.repositoryName, staged),
				} satisfies Partial<APIPublishOptions>)
			: {}),
	});
}
