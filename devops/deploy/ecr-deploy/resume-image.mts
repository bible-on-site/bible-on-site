import {
	BatchGetImageCommand,
	type ECRClient,
	PutImageCommand,
} from "@aws-sdk/client-ecr";

/** Resume a partially completed push without rebuilding or replacing its version. */
export async function resumePublishedImage(
	client: ECRClient,
	repositoryName: string,
	versionTag: string,
): Promise<void> {
	const response = await client.send(
		new BatchGetImageCommand({
			repositoryName,
			imageIds: [{ imageTag: versionTag }],
		}),
	);
	const target = response.images?.find(
		(image) => image.imageId?.imageTag === versionTag,
	);
	if (!target?.imageManifest || !target.imageId?.imageDigest) {
		throw new Error(`Published version ${versionTag} could not be retrieved`);
	}
	const current = await client.send(
		new BatchGetImageCommand({
			repositoryName,
			imageIds: [{ imageTag: "latest" }],
		}),
	);
	const latest = current.images?.find(
		(image) => image.imageId?.imageTag === "latest",
	);
	for (const failure of current.failures ?? []) {
		if (
			failure.imageId?.imageTag !== "latest" ||
			failure.failureCode !== "ImageNotFound"
		) {
			throw new Error(
				`Unable to inspect published image: ${failure.failureCode}`,
			);
		}
	}
	if (latest?.imageId?.imageDigest === target.imageId.imageDigest) return;
	await client.send(
		new PutImageCommand({
			repositoryName,
			imageTag: "latest",
			imageManifest: target.imageManifest,
			imageManifestMediaType: target.imageManifestMediaType,
		}),
	);
}
