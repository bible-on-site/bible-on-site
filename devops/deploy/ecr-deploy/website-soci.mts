import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
	chmod,
	lstat,
	mkdir,
	open,
	readFile,
	rename,
	writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip, createGzip } from "node:zlib";
import {
	BatchCheckLayerAvailabilityCommand,
	BatchGetImageCommand,
	CompleteLayerUploadCommand,
	type ECRClient,
	InitiateLayerUploadCommand,
	PutImageCommand,
	UploadLayerPartCommand,
} from "@aws-sdk/client-ecr";
import {
	type APIArchive,
	type ImageDescriptor,
	OCI_INDEX,
	type RegistryImage,
} from "./api-images.mts";

export const SOCI_TYPE = "application/vnd.amazon.soci.index.v2+json";
export const SOCI_VERSION = "0.16.1";
export const SOCI_TOOL_SHA256 =
	"2ad05a0430042885a7b2ab4a707a85250117dd39f41adc097e83a00a83ae4bc7";
const OCI_IMAGE = "application/vnd.oci.image.manifest.v1+json";
const INDEX_ANNOTATION = "com.amazon.soci.index-digest";
const IMAGE_ANNOTATION = "com.amazon.soci.image-manifest-digest";
const LAYER_ANNOTATION = "com.amazon.soci.image-layer-digest";
const MAX_BYTES = 8 * 1024 ** 3;
const MAX_JSON = 4 * 1024 ** 2;
const digest = (raw: Buffer | string) =>
	`sha256:${createHash("sha256").update(raw).digest("hex")}`;
const checkedDigest = (value: unknown): string => {
	assert.equal(typeof value, "string");
	assert.match(value as string, /^sha256:[a-f0-9]{64}$/);
	return value as string;
};
type BlobDescriptor = {
	mediaType: string;
	digest: string;
	size: number;
	annotations?: Record<string, string>;
};
type Manifest = {
	schemaVersion: number;
	mediaType: string;
	config: BlobDescriptor;
	layers: BlobDescriptor[];
	annotations?: Record<string, string>;
};
function checkedBlob(value: BlobDescriptor): void {
	checkedDigest(value.digest);
	assert.ok(
		Number.isSafeInteger(value.size) &&
			value.size > 0 &&
			value.size <= MAX_BYTES,
	);
	assert.equal(typeof value.mediaType, "string");
	assert.ok(!("urls" in value));
}
function blobPath(directory: string, value: string) {
	return join(directory, "blobs", "sha256", checkedDigest(value).slice(7));
}
async function jsonBlob(directory: string, desc: BlobDescriptor) {
	checkedBlob(desc);
	assert.ok(desc.size <= MAX_JSON);
	const p = blobPath(directory, desc.digest),
		stat = await lstat(p);
	assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size === desc.size);
	const raw = await readFile(p);
	assert.equal(digest(raw), desc.digest);
	return JSON.parse(raw.toString("utf8"));
}
async function putBlob(
	directory: string,
	raw: Buffer,
	mediaType: string,
): Promise<BlobDescriptor> {
	const desc = { mediaType, digest: digest(raw), size: raw.length };
	const p = blobPath(directory, desc.digest);
	await writeFile(p, raw, { flag: "wx", mode: 0o600 });
	return desc;
}

/** Construct OCI input from the already validated, private Docker archive ranges. */
export async function websiteOCIInput(
	archive: APIArchive,
	directory: string,
): Promise<void> {
	assert.ok(archive.ociSource);
	const source = archive.ociSource;
	await mkdir(join(directory, "blobs", "sha256"), {
		recursive: true,
		mode: 0o700,
	});
	const handle = await open(archive.path, "r");
	let config: BlobDescriptor;
	try {
		assert.ok(source.config.size <= MAX_JSON);
		const raw = Buffer.alloc(source.config.size);
		const r = await handle.read(raw, 0, raw.length, source.config.offset);
		assert.equal(r.bytesRead, raw.length);
		assert.equal(digest(raw), archive.configDigest);
		config = await putBlob(
			directory,
			raw,
			"application/vnd.oci.image.config.v1+json",
		);
	} finally {
		await handle.close();
	}
	const layers: BlobDescriptor[] = [];
	let total = 0;
	for (const [index, entry] of source.layers.entries()) {
		const path = join(directory, `layer-${index}.partial`),
			hash = createHash("sha256"),
			rawHash = createHash("sha256");
		let compressed = 0;
		const first = await open(archive.path, "r");
		const magic = Buffer.alloc(2);
		try {
			await first.read(magic, 0, 2, entry.offset);
		} finally {
			await first.close();
		}
		const rawObserver = new Transform({
			transform(chunk, _encoding, callback) {
				total += chunk.length;
				rawHash.update(chunk);
				callback(
					total > MAX_BYTES
						? new Error("OCI source exceeds archive bound")
						: null,
					chunk,
				);
			},
		});
		const observer = new Transform({
			transform(chunk, _encoding, callback) {
				compressed += chunk.length;
				hash.update(chunk);
				callback(
					compressed > MAX_BYTES
						? new Error("OCI compressed layer exceeds bound")
						: null,
					chunk,
				);
			},
		});
		const input = createReadStream(archive.path, {
			start: entry.offset,
			end: entry.offset + entry.size - 1,
		});
		const output = createWriteStream(path, { flags: "wx", mode: 0o600 });
		if (magic[0] === 0x1f && magic[1] === 0x8b)
			await pipeline(
				input,
				createGunzip(),
				rawObserver,
				createGzip({ level: 1 }),
				observer,
				output,
			);
		else
			await pipeline(
				input,
				rawObserver,
				createGzip({ level: 1 }),
				observer,
				output,
			);
		assert.equal(`sha256:${rawHash.digest("hex")}`, source.diffIds[index]);
		const layer = {
			mediaType: "application/vnd.oci.image.layer.v1.tar+gzip",
			digest: `sha256:${hash.digest("hex")}`,
			size: compressed,
		};
		await rename(path, blobPath(directory, layer.digest));
		layers.push(layer);
	}
	const native = await putBlob(
		directory,
		Buffer.from(
			JSON.stringify({
				schemaVersion: 2,
				mediaType: OCI_IMAGE,
				config,
				layers,
			}),
		),
		OCI_IMAGE,
	);
	await writeFile(
		join(directory, "index.json"),
		JSON.stringify({
			schemaVersion: 2,
			mediaType: OCI_INDEX,
			manifests: [
				{
					...native,
					platform: { architecture: archive.architecture, os: "linux" },
				},
			],
		}),
		{ flag: "wx", mode: 0o600 },
	);
	await writeFile(
		join(directory, "oci-layout"),
		JSON.stringify({ imageLayoutVersion: "1.0.0" }),
		{ flag: "wx", mode: 0o600 },
	);
}

/** Verify the native/SOCI association without trusting unbound registry artifacts. */
export function websiteSociPair(
	native: RegistryImage,
	artifact: RegistryImage,
	architecture: string,
): [ImageDescriptor, ImageDescriptor] {
	assert.ok(["amd64", "arm64"].includes(architecture));
	assert.equal(native.mediaType, OCI_IMAGE);
	assert.equal(artifact.mediaType, OCI_IMAGE);
	assert.equal(digest(native.manifest), native.digest);
	assert.equal(digest(artifact.manifest), artifact.digest);
	const image = JSON.parse(native.manifest) as Manifest,
		index = JSON.parse(artifact.manifest) as Manifest;
	assert.equal(image.schemaVersion, 2);
	assert.equal(image.mediaType, OCI_IMAGE);
	checkedBlob(image.config);
	assert.equal(
		image.config.mediaType,
		"application/vnd.oci.image.config.v1+json",
	);
	assert.ok(image.layers.length > 0);
	for (const layer of image.layers) {
		checkedBlob(layer);
		assert.equal(
			layer.mediaType,
			"application/vnd.oci.image.layer.v1.tar+gzip",
		);
	}
	assert.equal(image.annotations?.[INDEX_ANNOTATION], artifact.digest);
	assert.equal(index.schemaVersion, 2);
	assert.equal(index.mediaType, OCI_IMAGE);
	assert.equal(index.config.mediaType, SOCI_TYPE);
	assert.equal(index.config.digest, digest("{}"));
	assert.equal(index.config.size, 2);
	assert.equal(
		index.layers.length,
		new Set(image.layers.map((x) => x.digest)).size,
	);
	const seen = new Set<string>();
	for (const ztoc of index.layers) {
		checkedBlob(ztoc);
		assert.equal(ztoc.mediaType, "application/octet-stream");
		const associated = ztoc.annotations?.[LAYER_ANNOTATION];
		assert.ok(associated && !seen.has(associated));
		seen.add(associated);
		const layer = image.layers.find((x) => x.digest === associated);
		assert.ok(layer);
		assert.equal(
			ztoc.annotations?.["com.amazon.soci.image-layer-mediaType"],
			layer.mediaType,
		);
		assert.equal(ztoc.annotations?.["com.amazon.soci.span-size"], "4194304");
	}
	const platform = { architecture, os: "linux" };
	return [
		{
			mediaType: OCI_IMAGE,
			digest: native.digest,
			size: Buffer.byteLength(native.manifest),
			platform,
			annotations: { [INDEX_ANNOTATION]: artifact.digest },
		},
		{
			mediaType: OCI_IMAGE,
			digest: artifact.digest,
			size: Buffer.byteLength(artifact.manifest),
			platform,
			artifactType: SOCI_TYPE,
			annotations: { [IMAGE_ANNOTATION]: native.digest },
		},
	];
}

/** Only the checksum-pinned regular CLI member is extracted, into an owned directory. */
export async function websiteSociTool(directory: string): Promise<string> {
	assert.ok(
		process.platform === "linux" && process.arch === "x64",
		"New SOCI images are published by the native Linux x64 release runner",
	);
	const name = `soci-snapshotter-${SOCI_VERSION}-linux-amd64-static.tar.gz`;
	const response = await fetch(
		`https://github.com/awslabs/soci-snapshotter/releases/download/v${SOCI_VERSION}/${name}`,
		{ signal: AbortSignal.timeout(20_000) },
	);
	assert.ok(response.ok);
	const chunks: Buffer[] = [];
	let size = 0;
	assert.ok(response.body);
	for await (const chunk of response.body) {
		size += chunk.length;
		assert.ok(size <= 64 * 1024 ** 2);
		chunks.push(Buffer.from(chunk));
	}
	const raw = Buffer.concat(chunks);
	assert.equal(digest(raw), `sha256:${SOCI_TOOL_SHA256}`);
	const archive = join(directory, name),
		toolDirectory = join(directory, "soci-tool");
	await mkdir(toolDirectory, { mode: 0o700 });
	await writeFile(archive, raw, { flag: "wx", mode: 0o600 });
	const listing = spawnSync("tar", ["-tzf", archive], {
		encoding: "utf8",
		timeout: 10_000,
		maxBuffer: 1024 * 1024,
	});
	assert.equal(listing.status, 0);
	const members = listing.stdout
		.split("\n")
		.filter((name) => name === "soci" || name === "bin/soci");
	assert.equal(members.length, 1);
	const extracted = spawnSync("tar", ["-xOzf", archive, members[0]], {
		timeout: 10_000,
		maxBuffer: 64 * 1024 ** 2,
	});
	assert.equal(extracted.status, 0);
	const tool = join(toolDirectory, "soci");
	await writeFile(tool, extracted.stdout, { flag: "wx", mode: 0o700 });
	await chmod(tool, 0o700);
	return tool;
}

async function readManifest(
	client: ECRClient,
	repositoryName: string,
	imageDigest: string,
): Promise<RegistryImage> {
	checkedDigest(imageDigest);
	const r = await client.send(
		new BatchGetImageCommand({ repositoryName, imageIds: [{ imageDigest }] }),
	);
	assert.ok(!r.failures?.length && r.images?.length);
	for (const image of r.images) {
		assert.equal(image.imageId?.imageDigest, imageDigest);
		assert.ok(image.imageManifest);
		assert.equal(digest(image.imageManifest), imageDigest);
		assert.equal(image.imageManifestMediaType, OCI_IMAGE);
	}
	assert.equal(new Set(r.images.map((x) => x.imageManifest)).size, 1);
	const manifest = r.images[0].imageManifest;
	assert.ok(manifest);
	return {
		digest: imageDigest,
		manifest,
		mediaType: OCI_IMAGE,
	};
}

/** SDK uploads reuse existing ECR permissions; config/layer bytes are verified as streamed. */
export async function uploadWebsiteSociBlob(
	client: ECRClient,
	repositoryName: string,
	directory: string,
	desc: BlobDescriptor,
): Promise<void> {
	checkedBlob(desc);
	const file = blobPath(directory, desc.digest),
		stat = await lstat(file);
	assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size === desc.size);
	const available = await client.send(
		new BatchCheckLayerAvailabilityCommand({
			repositoryName,
			layerDigests: [desc.digest],
		}),
	);
	assert.ok(!available.failures?.length);
	if (
		available.layers?.some(
			(x) =>
				x.layerDigest === desc.digest && x.layerAvailability === "AVAILABLE",
		)
	)
		return;
	const init = await client.send(
		new InitiateLayerUploadCommand({ repositoryName }),
	);
	assert.ok(init.uploadId);
	assert.ok(!init.partSize || init.partSize <= 20 * 1024 ** 2);
	const hash = createHash("sha256");
	let offset = 0;
	for await (const chunk of createReadStream(file, {
		highWaterMark: 20 * 1024 ** 2,
	})) {
		hash.update(chunk);
		await client.send(
			new UploadLayerPartCommand({
				repositoryName,
				uploadId: init.uploadId,
				partFirstByte: offset,
				partLastByte: offset + chunk.length - 1,
				layerPartBlob: chunk,
			}),
		);
		offset += chunk.length;
	}
	assert.equal(offset, desc.size);
	assert.equal(`sha256:${hash.digest("hex")}`, desc.digest);
	const done = await client.send(
		new CompleteLayerUploadCommand({
			repositoryName,
			uploadId: init.uploadId,
			layerDigests: [desc.digest],
		}),
	);
	assert.equal(done.layerDigest, desc.digest);
}

function convertSoci(tool: string, input: string, output: string): void {
	const result = spawnSync(
		tool,
		[
			"convert",
			"--standalone",
			"--format",
			"oci-dir",
			"--min-layer-size",
			"0",
			input,
			output,
		],
		{ encoding: "utf8", timeout: 300_000, maxBuffer: 4 * 1024 ** 2 },
	);
	assert.equal(
		result.status,
		0,
		"Pinned SOCI conversion must complete before immutable publication",
	);
}

export async function publishWebsiteSociChild(
	archive: APIArchive,
	directory: string,
	client: ECRClient,
	repositoryName: string,
	tag: string,
	tool: string,
	convert: (
		tool: string,
		input: string,
		output: string,
	) => void | Promise<void> = convertSoci,
): Promise<void> {
	assert.match(
		tag,
		/^v[0-9]+\.[0-9]+\.[0-9]+-(?:amd64|arm64)$/,
	);
	assert.ok(tag.endsWith(`-${archive.architecture}`));
	const input = join(directory, `soci-input-${archive.architecture}`),
		output = join(directory, `soci-output-${archive.architecture}`);
	await websiteOCIInput(archive, input);
	await convert(tool, input, output);
	const layout = JSON.parse(await readFile(join(output, "index.json"), "utf8"));
	assert.equal(layout.manifests.length, 1);
	const root = await jsonBlob(output, layout.manifests[0]);
	assert.equal(root.mediaType, OCI_INDEX);
	assert.equal(root.manifests.length, 2);
	const nativeDesc = root.manifests.find(
			(d: ImageDescriptor) => !d.artifactType,
		),
		sociDesc = root.manifests.find(
			(d: ImageDescriptor) => d.artifactType === SOCI_TYPE,
		);
	assert.ok(nativeDesc && sociDesc);
	const nativeDoc = (await jsonBlob(output, nativeDesc)) as Manifest,
		sociDoc = (await jsonBlob(output, sociDesc)) as Manifest;
	assert.equal(nativeDoc.config.digest, archive.configDigest);
	assert.equal(nativeDoc.config.size, archive.ociSource?.config.size);
	assert.equal(nativeDoc.layers.length, archive.layerCount);
	const native: RegistryImage = {
		digest: nativeDesc.digest,
		mediaType: OCI_IMAGE,
		manifest: (await readFile(blobPath(output, nativeDesc.digest))).toString(
			"utf8",
		),
	};
	const artifact: RegistryImage = {
		digest: sociDesc.digest,
		mediaType: OCI_IMAGE,
		manifest: (await readFile(blobPath(output, sociDesc.digest))).toString(
			"utf8",
		),
	};
	assert.deepEqual(
		root.manifests,
		websiteSociPair(native, artifact, archive.architecture),
	);
	for (const [image, doc, imageTag] of [
		[artifact, sociDoc, undefined],
		[native, nativeDoc, tag],
	] as const) {
		for (const blob of [doc.config, ...doc.layers])
			await uploadWebsiteSociBlob(client, repositoryName, output, blob);
		const written = await client.send(
			new PutImageCommand({
				repositoryName,
				imageDigest: image.digest,
				imageManifest: image.manifest,
				imageManifestMediaType: image.mediaType,
				...(imageTag ? { imageTag } : {}),
			}),
		);
		assert.equal(written.image?.imageId?.imageDigest, image.digest);
		assert.deepEqual(
			await readManifest(client, repositoryName, image.digest),
			image,
		);
	}
}

export async function websiteSociIndex(
	client: ECRClient,
	repositoryName: string,
	staged: ReadonlyMap<"amd64" | "arm64", RegistryImage>,
): Promise<ImageDescriptor[]> {
	const pairs = [];
	for (const architecture of ["amd64", "arm64"] as const) {
		const native = staged.get(architecture);
		assert.ok(native);
		const doc = JSON.parse(native.manifest) as Manifest;
		const artifact = await readManifest(
			client,
			repositoryName,
			checkedDigest(doc.annotations?.[INDEX_ANNOTATION]),
		);
		pairs.push(websiteSociPair(native, artifact, architecture));
	}
	return [...pairs.map((x) => x[0]), ...pairs.map((x) => x[1])];
}
