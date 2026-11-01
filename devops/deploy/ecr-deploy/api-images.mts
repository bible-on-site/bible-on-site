import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { chmod, lstat, mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import {
	BatchGetImageCommand,
	DescribeImagesCommand,
	type DescribeImagesCommandOutput,
	DescribeRepositoriesCommand,
	type ECRClient,
	PutImageCommand,
} from "@aws-sdk/client-ecr";
import * as semver from "semver";
import { getAuthorizationToken, getRemoteImageTags } from "./ecr-client.mts";

export const OCI_INDEX = "application/vnd.oci.image.index.v1+json";
const IMAGE_TYPES = new Set([
	"application/vnd.docker.distribution.manifest.v2+json",
	"application/vnd.oci.image.manifest.v1+json",
]);
const MAX_ARCHIVE_BYTES = 8 * 1024 ** 3;
const MAX_JSON_BYTES = 4 * 1024 ** 2;
const sha256 = (bytes: string | Buffer) =>
	`sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const isDigest = (value: unknown): value is string =>
	typeof value === "string" &&
	value.length === 71 &&
	/^sha256:[a-f0-9]{64}$/.test(value);
type Architecture = "amd64" | "arm64";
type TarEntry = { offset: number; size: number };
export type APIArchive = {
	path: string;
	architecture: Architecture;
	configDigest: string;
	layerCount: number;
};
export type PreparedAPIArchives = {
	directory: string;
	version: string;
	sourceRef: string;
	images: [APIArchive, APIArchive];
	dispose(): Promise<void>;
};
export type APIImageOptions = {
	amd64ArchivePath: string;
	arm64ArchivePath: string;
	sourceRef: string;
	version: string;
};

export function validateAPIImageOptions(options: APIImageOptions): void {
	if (
		options.sourceRef.length !== 40 ||
		!/^[a-f0-9]{40}$/.test(options.sourceRef)
	)
		throw new Error("source-ref must be a full lowercase 40-character Git SHA");
	if (
		!/^\d+\.\d+\.\d+$/.test(options.version) ||
		semver.valid(options.version) !== options.version
	)
		throw new Error("API image version must be plain major.minor.patch");
	if (!options.amd64ArchivePath || !options.arm64ArchivePath)
		throw new Error("Both API Docker archives are required");
}

function limitedStream() {
	let bytes = 0;
	return new Transform({
		transform(chunk, _encoding, callback) {
			bytes += chunk.length;
			callback(
				bytes > MAX_ARCHIVE_BYTES
					? new Error("Docker archive exceeds the 8 GiB safety limit")
					: null,
				chunk,
			);
		},
	});
}

async function copyArchive(source: string, destination: string): Promise<void> {
	const stat = await lstat(source);
	if (!stat.isFile() || stat.size > MAX_ARCHIVE_BYTES)
		throw new Error(
			"Docker archive must be a regular file within the 8 GiB safety limit",
		);
	const handle = await open(source, "r");
	const magic = Buffer.alloc(2);
	try {
		await handle.read(magic, 0, 2, 0);
	} finally {
		await handle.close();
	}
	const input = createReadStream(source);
	const output = createWriteStream(destination, { flags: "wx", mode: 0o600 });
	if (magic[0] === 0x1f && magic[1] === 0x8b)
		await pipeline(input, createGunzip(), limitedStream(), output);
	else await pipeline(input, limitedStream(), output);
}

function tarNumber(bytes: Buffer): number {
	const text = bytes.toString("ascii").split("\0").join("").trim();
	if (!/^[0-7]+$/.test(text)) throw new Error("Invalid Docker tar number");
	const value = Number.parseInt(text, 8);
	if (!Number.isSafeInteger(value)) throw new Error("Unsafe Docker tar size");
	return value;
}

function archiveName(value: string, directory = false): string {
	const name = value.startsWith("./") ? value.slice(2) : value;
	const parts = (
		directory && name.endsWith("/") ? name.slice(0, -1) : name
	).split("/");
	if (
		!name ||
		name.length > 512 ||
		name.includes("\\") ||
		parts.some((part) => !part || part === "." || part === "..") ||
		[...name].some(
			(char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
		)
	)
		throw new Error("Unsafe path in Docker archive");
	return parts.join("/");
}

async function inspectArchive(
	archive: string,
	architecture: Architecture,
	sourceRef: string,
	version: string,
): Promise<APIArchive> {
	const handle = await open(archive, "r");
	try {
		const { size } = await handle.stat();
		const entries = new Map<string, TarEntry>();
		let offset = 0;
		let ended = false;
		while (offset + 512 <= size) {
			const header = Buffer.alloc(512);
			await handle.read(header, 0, 512, offset);
			if (header.every((byte) => byte === 0)) {
				const remaining = createReadStream(archive, { start: offset });
				let zeros = 0;
				for await (const chunk of remaining) {
					if (!(chunk as Buffer).every((byte) => byte === 0))
						throw new Error("Trailing data in Docker tar");
					zeros += chunk.length;
				}
				if (zeros < 1024) throw new Error("Truncated Docker tar terminator");
				ended = true;
				break;
			}
			const expected = tarNumber(header.subarray(148, 156));
			const checksum = header.reduce(
				(sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte),
				0,
			);
			if (checksum !== expected) throw new Error("Invalid Docker tar checksum");
			const type = header[156];
			if (type !== 0 && type !== 48 && type !== 53)
				throw new Error(
					"Docker archive links and extended entries are unsupported",
				);
			const field = (start: number, end: number) =>
				header.subarray(start, end).toString("utf8").split("\0")[0];
			const prefix = field(345, 500);
			const name = archiveName(
				`${prefix ? `${prefix}/` : ""}${field(0, 100)}`,
				type === 53,
			);
			const length = tarNumber(header.subarray(124, 136));
			if (
				entries.size >= 10000 ||
				entries.has(name) ||
				offset + 512 + length > size ||
				(type === 53 && length !== 0)
			)
				throw new Error("Duplicate or truncated Docker tar entry");
			if (type !== 53)
				entries.set(name, { offset: offset + 512, size: length });
			offset += 512 + Math.ceil(length / 512) * 512;
		}
		if (!ended)
			throw new Error("Docker archive has no complete tar terminator");
		const json = async (name: string) => {
			const entry = entries.get(archiveName(name));
			if (!entry || entry.size > MAX_JSON_BYTES)
				throw new Error(`Missing or oversized Docker metadata: ${name}`);
			const bytes = Buffer.alloc(entry.size);
			await handle.read(bytes, 0, bytes.length, entry.offset);
			return { bytes, value: JSON.parse(bytes.toString("utf8")) };
		};
		const manifest = (await json("manifest.json")).value;
		if (
			!Array.isArray(manifest) ||
			manifest.length !== 1 ||
			typeof manifest[0]?.Config !== "string" ||
			!Array.isArray(manifest[0]?.Layers)
		)
			throw new Error("Docker archive must contain exactly one image");
		const image = manifest[0];
		const config = await json(image.Config);
		const digest = sha256(config.bytes);
		const labels = config.value.config?.Labels;
		if (
			config.value.os !== "linux" ||
			config.value.architecture !== architecture
		)
			throw new Error(`Expected linux/${architecture} Docker archive`);
		if (
			labels?.["org.opencontainers.image.revision"] !== sourceRef ||
			labels?.["org.opencontainers.image.version"] !== version
		)
			throw new Error(
				"Docker image source/version labels do not match the approved release",
			);
		const diffs = config.value.rootfs?.diff_ids;
		if (
			config.value.rootfs?.type !== "layers" ||
			!Array.isArray(diffs) ||
			diffs.length !== image.Layers.length ||
			!diffs.every(isDigest)
		)
			throw new Error("Invalid Docker root filesystem provenance");
		for (let index = 0; index < image.Layers.length; index++) {
			if (typeof image.Layers[index] !== "string")
				throw new Error("Invalid Docker layer path");
			const entry = entries.get(archiveName(image.Layers[index]));
			if (!entry || entry.size === 0)
				throw new Error("Missing or empty Docker layer");
			const magic = Buffer.alloc(2);
			await handle.read(magic, 0, 2, entry.offset);
			const input = createReadStream(archive, {
				start: entry.offset,
				end: entry.offset + entry.size - 1,
			});
			const hash = createHash("sha256");
			const consume = async (stream: AsyncIterable<Buffer>) => {
				let bytes = 0;
				for await (const chunk of stream) {
					bytes += chunk.length;
					if (bytes > MAX_ARCHIVE_BYTES)
						throw new Error("Docker layer exceeds the 8 GiB safety limit");
					hash.update(chunk);
				}
			};
			if (magic[0] === 0x1f && magic[1] === 0x8b)
				await pipeline(input, createGunzip(), consume);
			else await pipeline(input, consume);
			if (`sha256:${hash.digest("hex")}` !== diffs[index])
				throw new Error("Docker layer does not match its config diff_id");
		}
		return {
			path: archive,
			architecture,
			configDigest: digest,
			layerCount: image.Layers.length,
		};
	} finally {
		await handle.close();
	}
}

/** Private copies prevent source mutation after validation; no tar entry is extracted. */
export async function prepareAPIArchives(
	options: APIImageOptions,
): Promise<PreparedAPIArchives> {
	validateAPIImageOptions(options);
	const directory = await mkdtemp(join(tmpdir(), "bible-api-images-"));
	const dispose = () => rm(directory, { recursive: true, force: true });
	try {
		await chmod(directory, 0o700);
		const images: APIArchive[] = [];
		for (const [architecture, source] of [
			["amd64", options.amd64ArchivePath],
			["arm64", options.arm64ArchivePath],
		] as const) {
			const destination = join(directory, `${architecture}.tar`);
			await copyArchive(source, destination);
			images.push(
				await inspectArchive(
					destination,
					architecture,
					options.sourceRef,
					options.version,
				),
			);
		}
		return {
			directory,
			version: options.version,
			sourceRef: options.sourceRef,
			images: images as [APIArchive, APIArchive],
			dispose,
		};
	} catch (error) {
		await dispose();
		throw error;
	}
}

type RegistryImage = { manifest: string; mediaType: string; digest: string };
async function readTagDigest(
	client: ECRClient,
	repositoryName: string,
	tag: string,
): Promise<string | undefined> {
	// A tag's manifest read can lag behind its metadata after a retag.
	let result: DescribeImagesCommandOutput;
	try {
		result = await client.send(
			new DescribeImagesCommand({
				repositoryName,
				imageIds: [{ imageTag: tag }],
			}),
		);
	} catch (error) {
		if ((error as Error).name === "ImageNotFoundException") return undefined;
		throw error;
	}
	const images = result?.imageDetails;
	// The tag selector resolves the digest even when imageTags still lists only
	// older aliases. That cached list is not a second tag lookup.
	if (images?.length !== 1 || !isDigest(images[0].imageDigest))
		throw new Error(`Invalid registry tag metadata for ${tag}`);
	return images[0].imageDigest;
}

async function readImageByDigest(
	client: ECRClient,
	repositoryName: string,
	digest: string,
): Promise<RegistryImage> {
	const result = await client.send(
		new BatchGetImageCommand({
			repositoryName,
			imageIds: [{ imageDigest: digest }],
		}),
	);
	const images = result?.images ?? [];
	if (result?.failures?.length || !images.length)
		throw new Error(`Unable to inspect registry digest ${digest}`);
	// ECR may return one identical record per associated tag. Verify every
	// record against the requested immutable bytes, including its media type.
	const first = images[0];
	const manifest = first.imageManifest;
	const mediaType = first.imageManifestMediaType;
	if (!manifest || !mediaType)
		throw new Error(`Invalid registry manifest for digest ${digest}`);
	for (const image of images) {
		if (
			image.imageId?.imageDigest !== digest ||
			!image.imageManifest ||
			!image.imageManifestMediaType ||
			sha256(image.imageManifest) !== digest ||
			image.imageManifest !== first.imageManifest ||
			image.imageManifestMediaType !== first.imageManifestMediaType
		)
			throw new Error(`Invalid registry manifest for digest ${digest}`);
	}
	return { manifest, mediaType, digest };
}

async function readImage(
	client: ECRClient,
	repositoryName: string,
	tag: string,
): Promise<RegistryImage | undefined> {
	const result = await client.send(
		new BatchGetImageCommand({ repositoryName, imageIds: [{ imageTag: tag }] }),
	);
	for (const failure of result.failures ?? []) {
		if (
			failure.failureCode !== "ImageNotFound" ||
			failure.imageId?.imageTag !== tag
		)
			throw new Error(`Unable to inspect ${tag}: ${failure.failureCode}`);
	}
	const images = result.images ?? [];
	if (!images.length) {
		if (
			!result.failures?.some(
				(failure) => failure.failureCode === "ImageNotFound",
			)
		)
			throw new Error(`Missing registry response for ${tag}`);
		return undefined;
	}
	if (images.length !== 1 || images[0].imageId?.imageTag !== tag)
		throw new Error(`Ambiguous registry response for ${tag}`);
	const image = images[0];
	if (
		!image.imageManifest ||
		!image.imageManifestMediaType ||
		!isDigest(image.imageId?.imageDigest) ||
		sha256(image.imageManifest) !== image.imageId.imageDigest
	)
		throw new Error(`Invalid registry manifest digest for ${tag}`);
	return {
		manifest: image.imageManifest,
		mediaType: image.imageManifestMediaType,
		digest: image.imageId.imageDigest,
	};
}

function verifiedChild(
	image: RegistryImage,
	archive: APIArchive,
): RegistryImage {
	const manifest = JSON.parse(image.manifest);
	if (
		!IMAGE_TYPES.has(image.mediaType) ||
		manifest.schemaVersion !== 2 ||
		manifest.config?.digest !== archive.configDigest ||
		!Array.isArray(manifest.layers) ||
		manifest.layers.length !== archive.layerCount ||
		manifest.layers.some(
			(layer: { digest?: unknown; size?: number }) =>
				!isDigest(layer.digest) ||
				!Number.isSafeInteger(layer.size) ||
				(layer.size ?? -1) < 0,
		)
	)
		throw new Error(
			`Immutable ${archive.architecture} child does not match the validated archive`,
		);
	return image;
}

async function putImage(
	client: ECRClient,
	repositoryName: string,
	tag: string,
	image: RegistryImage,
): Promise<void> {
	const receipt = await client.send(
		new PutImageCommand({
			repositoryName,
			imageTag: tag,
			imageManifest: image.manifest,
			imageManifestMediaType: image.mediaType,
			imageDigest: image.digest,
		}),
	);
	const written = receipt.image;
	if (
		written?.repositoryName !== repositoryName ||
		written.imageId?.imageTag !== tag ||
		written.imageId?.imageDigest !== image.digest ||
		written.imageManifest !== image.manifest ||
		written.imageManifestMediaType !== image.mediaType
	)
		throw new Error(
			`Registry write receipt does not match the exact image for ${tag}`,
		);
	// BatchGetImage's manifest-by-tag path can return the previous image after
	// a successful retag. Verify the exact write acknowledgement above and the
	// tag-selected digest here, without sleeping, retrying or accepting another
	// digest. imageTags can still omit the newly added alias for an existing index.
	const result = await client.send(
		new DescribeImagesCommand({
			repositoryName,
			imageIds: [{ imageTag: tag }],
		}),
	);
	const stored = result.imageDetails;
	if (stored?.length !== 1 || stored[0].imageDigest !== image.digest)
		throw new Error(
			`Registry tag metadata does not preserve the exact digest for ${tag}`,
		);
}

async function immutableImage(
	client: ECRClient,
	repositoryName: string,
	tag: string,
	image: RegistryImage,
): Promise<void> {
	const current = await readImage(client, repositoryName, tag);
	if (current) {
		if (current.digest !== image.digest)
			throw new Error(`Immutable tag collision: ${tag}; publish a new version`);
		return;
	}
	try {
		await putImage(client, repositoryName, tag, image);
	} catch (error) {
		if (
			![
				"ImageAlreadyExistsException",
				"ImageTagAlreadyExistsException",
			].includes((error as Error).name)
		)
			throw error;
		const raced = await readImage(client, repositoryName, tag);
		if (raced?.digest !== image.digest)
			throw new Error(
				`Immutable tag collision: ${tag}; publish a new version`,
				{ cause: error },
			);
	}
}

export async function assertAPIRepositoryPolicy(
	client: ECRClient,
	repositoryName: string,
): Promise<void> {
	const result = await client.send(
		new DescribeRepositoriesCommand({ repositoryNames: [repositoryName] }),
	);
	const repository = result.repositories?.find(
		(item) => item.repositoryName === repositoryName,
	);
	const exclusions = repository?.imageTagMutabilityExclusionFilters;
	if (
		repository?.imageTagMutability !== "IMMUTABLE_WITH_EXCLUSION" ||
		exclusions?.length !== 1 ||
		exclusions[0].filterType !== "WILDCARD" ||
		exclusions[0].filter !== "latest"
	)
		throw new Error(
			"API repository must use IMMUTABLE_WITH_EXCLUSION with only latest mutable",
		);
}

async function assertNewest(
	client: ECRClient,
	repositoryName: string,
	version: string,
): Promise<void> {
	const tags = await getRemoteImageTags(client, repositoryName);
	if (tags.some((tag) => semver.gt(tag.slice(1), version)))
		throw new Error(
			"A newer canonical API version exists; refusing a latest downgrade",
		);
}

/** Once latest is an index, every ordinary API release must retain that contract. */
export async function assertAPILatestMode(
	client: ECRClient,
	repositoryName: string,
	publishIndex: boolean,
): Promise<void> {
	if (publishIndex) return;
	let digest: string | undefined;
	try {
		digest = await readTagDigest(client, repositoryName, "latest");
	} catch (error) {
		if ((error as Error).name === "RepositoryNotFoundException") return;
		throw error;
	}
	if (!digest) return;
	const latest = await readImageByDigest(client, repositoryName, digest);
	if (
		[
			OCI_INDEX,
			"application/vnd.docker.distribution.manifest.list.v2+json",
		].includes(latest.mediaType)
	) {
		throw new Error(
			"API latest is already an index; every subsequent release requires both native archives and publish-index",
		);
	}
	const manifest = JSON.parse(latest.manifest);
	if (
		!IMAGE_TYPES.has(latest.mediaType) ||
		manifest.schemaVersion !== 2 ||
		manifest.manifests ||
		!isDigest(manifest.config?.digest) ||
		!Array.isArray(manifest.layers) ||
		(manifest.mediaType !== undefined &&
			manifest.mediaType !== latest.mediaType)
	)
		throw new Error(
			"API latest has an unsupported image manifest; refusing a publication mode change",
		);
}
export type APIPublishOptions = {
	client: ECRClient;
	repositoryName: string;
	repositoryUri: string;
	version: string;
	publishIndex?: boolean;
	pushArchive?: (archive: string, reference: string) => Promise<void>;
};
/** No canonical/latest write occurs until both immutable children have been verified. */
export async function publishAPIImages(
	prepared: PreparedAPIArchives,
	options: APIPublishOptions,
) {
	const {
		client,
		repositoryName,
		repositoryUri,
		version,
		publishIndex = false,
	} = options;
	if (
		version !== prepared.version ||
		prepared.images.length !== 2 ||
		prepared.images[0].architecture !== "amd64" ||
		prepared.images[1].architecture !== "arm64"
	)
		throw new Error(
			"Publication must use the exact validated API version and architecture pair",
		);
	await assertAPIRepositoryPolicy(client, repositoryName);
	await assertAPILatestMode(client, repositoryName, publishIndex);
	await assertNewest(client, repositoryName, version);
	const versionTag = `v${version}`;
	const existing = await readImage(client, repositoryName, versionTag);
	if (
		existing &&
		((publishIndex && existing.mediaType !== OCI_INDEX) ||
			(!publishIndex && !IMAGE_TYPES.has(existing.mediaType)))
	)
		throw new Error(
			`Immutable tag collision: ${versionTag}; changing index mode requires a new version`,
		);
	const staged = new Map<Architecture, RegistryImage>();
	for (const archive of prepared.images) {
		const image = await readImage(
			client,
			repositoryName,
			`${versionTag}-${archive.architecture}`,
		);
		if (image) staged.set(archive.architecture, verifiedChild(image, archive));
	}
	let push = options.pushArchive;
	if (!push && staged.size !== 2) {
		const auth = await getAuthorizationToken(client);
		const host = new URL(auth.proxyEndpoint).host;
		if (!repositoryUri.startsWith(`${host}/`))
			throw new Error(
				"ECR authorization endpoint does not match the repository",
			);
		await writeFile(
			join(prepared.directory, "config.json"),
			JSON.stringify({
				auths: {
					[host]: {
						auth: Buffer.from(`${auth.username}:${auth.password}`).toString(
							"base64",
						),
					},
				},
			}),
			{ flag: "wx", mode: 0o600 },
		);
		push = async (archive, reference) => {
			const result = spawnSync("crane", ["push", archive, reference], {
				stdio: "inherit",
				env: { ...process.env, DOCKER_CONFIG: prepared.directory },
			});
			if (result.error || result.status !== 0)
				throw new Error(`crane archive push failed (${result.status})`, {
					cause: result.error,
				});
		};
	}
	for (const archive of prepared.images) {
		if (staged.has(archive.architecture)) continue;
		const tag = `${versionTag}-${archive.architecture}`;
		if (!push) throw new Error("No archive publisher available");
		await push(archive.path, `${repositoryUri}:${tag}`);
		const image = await readImage(client, repositoryName, tag);
		if (!image)
			throw new Error(
				`Missing ${archive.architecture} child after archive push`,
			);
		staged.set(archive.architecture, verifiedChild(image, archive));
	}
	const children = prepared.images.map((archive) => {
		const child = staged.get(archive.architecture);
		if (!child) throw new Error(`Missing ${archive.architecture} child`);
		return {
			mediaType: child.mediaType,
			digest: child.digest,
			size: Buffer.byteLength(child.manifest),
			platform: { architecture: archive.architecture, os: "linux" },
		};
	});
	const amd64 = staged.get("amd64");
	if (!amd64) throw new Error("Missing canonical amd64 child");
	const manifest = publishIndex
		? JSON.stringify({
				schemaVersion: 2,
				mediaType: OCI_INDEX,
				manifests: children,
			})
		: amd64.manifest;
	const canonical = {
		manifest,
		digest: sha256(manifest),
		mediaType: publishIndex ? OCI_INDEX : amd64.mediaType,
	};
	await immutableImage(client, repositoryName, versionTag, canonical);
	// Workflow concurrency serializes releases; recheck immediately before moving latest.
	await assertAPILatestMode(client, repositoryName, publishIndex);
	await assertNewest(client, repositoryName, version);
	const latest = await readTagDigest(client, repositoryName, "latest");
	if (latest !== canonical.digest)
		await putImage(client, repositoryName, "latest", canonical);
	return {
		versionTag,
		sourceRef: prepared.sourceRef,
		sourceConfigDigests: prepared.images.map((image) => ({
			architecture: image.architecture,
			digest: image.configDigest,
		})),
		children,
		canonicalDigest: canonical.digest,
		publishIndex,
	};
}
