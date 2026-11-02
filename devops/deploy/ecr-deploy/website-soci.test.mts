import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
	copyFile,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { gunzipSync, gzipSync } from "node:zlib";
import type { ECRClient } from "@aws-sdk/client-ecr";
import {
	type APIArchive,
	OCI_INDEX,
	type RegistryImage,
} from "./api-images.mts";
import {
	publishWebsiteSociChild,
	SOCI_TYPE,
	uploadWebsiteSociBlob,
	websiteOCIInput,
	websiteSociIndex,
	websiteSociPair,
} from "./website-soci.mts";

const digest = (b: Buffer | string) =>
	`sha256:${createHash("sha256").update(b).digest("hex")}`;
const type = "application/vnd.oci.image.manifest.v1+json";
type FixtureManifest = {
	config: { mediaType: string };
	layers: {
		mediaType: string;
		annotations: Record<string, string>;
		urls?: string[];
	}[];
	annotations: Record<string, string>;
};
type CommandInput = {
	repositoryName?: string;
	imageIds?: { imageDigest?: string }[];
	partFirstByte?: number;
	partLastByte?: number;
	layerPartBlob?: Buffer;
};
type FixtureCommand = { constructor: { name: string }; input: CommandInput };
const layer = {
	mediaType: "application/vnd.oci.image.layer.v1.tar+gzip",
	digest: digest("layer"),
	size: 5,
};
function pair(): [RegistryImage, RegistryImage] {
	const manifest = JSON.stringify({
		schemaVersion: 2,
		mediaType: type,
		config: { mediaType: SOCI_TYPE, digest: digest("{}"), size: 2 },
		layers: [
			{
				mediaType: "application/octet-stream",
				digest: digest("ztoc"),
				size: 4,
				annotations: {
					"com.amazon.soci.image-layer-digest": layer.digest,
					"com.amazon.soci.image-layer-mediaType": layer.mediaType,
					"com.amazon.soci.span-size": "4194304",
				},
			},
		],
	});
	const artifact = { manifest, mediaType: type, digest: digest(manifest) };
	const nativeManifest = JSON.stringify({
		schemaVersion: 2,
		mediaType: type,
		config: {
			mediaType: "application/vnd.oci.image.config.v1+json",
			digest: digest("config"),
			size: 6,
		},
		layers: [layer],
		annotations: { "com.amazon.soci.index-digest": artifact.digest },
	});
	return [
		{
			manifest: nativeManifest,
			mediaType: type,
			digest: digest(nativeManifest),
		},
		artifact,
	];
}
function changed(image: RegistryImage, change: (doc: FixtureManifest) => void) {
	const d = JSON.parse(image.manifest);
	change(d);
	const manifest = JSON.stringify(d);
	return { ...image, manifest, digest: digest(manifest) };
}

test("SOCI pair binds both directions, architecture and byte sizes", () => {
	for (const architecture of ["amd64", "arm64"]) {
		const [native, artifact] = pair(),
			[n, s] = websiteSociPair(native, artifact, architecture);
		assert.equal(n.digest, native.digest);
		assert.equal(s.digest, artifact.digest);
		assert.equal(n.size, Buffer.byteLength(native.manifest));
		assert.equal(s.size, Buffer.byteLength(artifact.manifest));
		assert.equal(n.annotations?.["com.amazon.soci.index-digest"], s.digest);
		assert.equal(
			s.annotations?.["com.amazon.soci.image-manifest-digest"],
			n.digest,
		);
		assert.equal(s.artifactType, SOCI_TYPE);
		assert.deepEqual(n.platform, s.platform);
		assert.equal(n.platform.architecture, architecture);
	}
});
test("rejects unbound artifact, wrong span, omitted layer, URL and unsupported compression", () => {
	for (const mutate of [
		(d: FixtureManifest) => {
			d.config.mediaType = "application/vnd.amazon.soci.index.v1+json";
		},
		(d: FixtureManifest) => {
			d.layers[0].annotations["com.amazon.soci.span-size"] = "8388608";
		},
		(d: FixtureManifest) => {
			d.layers[0].annotations["com.amazon.soci.image-layer-digest"] =
				digest("foreign");
		},
		(d: FixtureManifest) => {
			d.layers = [];
		},
		(d: FixtureManifest) => {
			d.layers[0].urls = ["https://unexpected.example/"];
		},
	]) {
		let [native, artifact] = pair();
		artifact = changed(artifact, mutate);
		native = changed(native, (d) => {
			d.annotations["com.amazon.soci.index-digest"] = artifact.digest;
		});
		assert.throws(() => websiteSociPair(native, artifact, "amd64"));
	}
	const [native, artifact] = pair();
	assert.throws(() =>
		websiteSociPair(
			changed(native, (d) => {
				d.annotations = {};
			}),
			artifact,
			"amd64",
		),
	);
	assert.throws(() =>
		websiteSociPair(
			changed(native, (d) => {
				d.layers[0].mediaType = "application/vnd.oci.image.layer.v1.tar+zstd";
			}),
			artifact,
			"amd64",
		),
	);
	assert.throws(() =>
		websiteSociPair({ ...native, digest: digest("wrong") }, artifact, "amd64"),
	);
});
test("indexes a shared compressed layer once and rejects duplicate ztocs", () => {
	let [native, artifact] = pair();
	native = changed(native, (d) => {
		d.layers.push(d.layers[0]);
	});
	assert.equal(websiteSociPair(native, artifact, "amd64").length, 2);
	artifact = changed(artifact, (d) => {
		d.layers.push(d.layers[0]);
	});
	native = changed(native, (d) => {
		d.annotations["com.amazon.soci.index-digest"] = artifact.digest;
	});
	assert.throws(() => websiteSociPair(native, artifact, "amd64"));
});

test("OCI preparation preserves config and raw layer bytes for gzip and raw source", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "website-soci-test-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	for (const compressed of [false, true]) {
		const raw = Buffer.from(
				"validated synthetic raw filesystem bytes".repeat(100),
			),
			input = compressed ? gzipSync(raw) : raw,
			config = Buffer.from(
				JSON.stringify({ rootfs: { type: "layers", diff_ids: [digest(raw)] } }),
			),
			archive = join(root, `source-${compressed}`),
			out = join(root, `out-${compressed}`);
		await writeFile(archive, Buffer.concat([config, input]));
		await websiteOCIInput(
			{
				path: archive,
				architecture: "arm64",
				configDigest: digest(config),
				layerCount: 1,
				ociSource: {
					config: { offset: 0, size: config.length },
					layers: [{ offset: config.length, size: input.length }],
					diffIds: [digest(raw)],
				},
			},
			out,
		);
		const index = JSON.parse(await readFile(join(out, "index.json"), "utf8"));
		const manifest = JSON.parse(
			await readFile(
				join(out, "blobs", "sha256", index.manifests[0].digest.slice(7)),
				"utf8",
			),
		);
		assert.equal(index.manifests[0].platform.architecture, "arm64");
		assert.equal(manifest.config.digest, digest(config));
		assert.deepEqual(
			await readFile(join(out, "blobs", "sha256", digest(config).slice(7))),
			config,
		);
		assert.deepEqual(
			gunzipSync(
				await readFile(
					join(out, "blobs", "sha256", manifest.layers[0].digest.slice(7)),
				),
			),
			raw,
		);
	}
});
test("OCI preparation rejects changed source bytes before publication", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "website-soci-test-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const config = Buffer.from("{}"),
		input = Buffer.from("changed"),
		path = join(root, "source");
	await writeFile(path, Buffer.concat([config, input]));
	await assert.rejects(
		websiteOCIInput(
			{
				path,
				architecture: "amd64",
				configDigest: digest(config),
				layerCount: 1,
				ociSource: {
					config: { offset: 0, size: 2 },
					layers: [{ offset: 2, size: input.length }],
					diffIds: [digest("original")],
				},
			},
			join(root, "out"),
		),
	);
});

test("SDK uploader checks availability and streams exact contiguous parts before completion", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "website-soci-test-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	await mkdir(join(root, "blobs", "sha256"), { recursive: true });
	const raw = Buffer.alloc(21 * 1024 ** 2, 47),
		sha = digest(raw);
	await writeFile(join(root, "blobs", "sha256", sha.slice(7)), raw);
	const calls: { name: string; input: CommandInput }[] = [];
	const client = {
		send: async (cmd: FixtureCommand) => {
			calls.push({ name: cmd.constructor.name, input: cmd.input });
			switch (cmd.constructor.name) {
				case "BatchCheckLayerAvailabilityCommand":
					return { layers: [], failures: [] };
				case "InitiateLayerUploadCommand":
					return { uploadId: "owned-upload", partSize: 20 * 1024 ** 2 };
				case "CompleteLayerUploadCommand":
					return { layerDigest: sha };
				default:
					return {};
			}
		},
	} as unknown as ECRClient;
	await uploadWebsiteSociBlob(client, "owned-repository", root, {
		mediaType: "application/octet-stream",
		digest: sha,
		size: raw.length,
	});
	assert.deepEqual(
		calls.map((c) => c.name),
		[
			"BatchCheckLayerAvailabilityCommand",
			"InitiateLayerUploadCommand",
			"UploadLayerPartCommand",
			"UploadLayerPartCommand",
			"CompleteLayerUploadCommand",
		],
	);
	const parts = calls
		.filter((c) => c.name === "UploadLayerPartCommand")
		.map((c) => c.input);
	assert.equal(parts[0].partFirstByte, 0);
	assert.equal(parts[0].partLastByte, 20 * 1024 ** 2 - 1);
	assert.equal(parts[1].partFirstByte, 20 * 1024 ** 2);
	assert.equal(parts[1].partLastByte, raw.length - 1);
	assert.deepEqual(
		Buffer.concat(
			parts.map((p) => {
				assert.ok(p.layerPartBlob);
				return p.layerPartBlob;
			}),
		),
		raw,
	);
	assert.ok(calls.every((c) => c.input.repositoryName === "owned-repository"));
});
test("SDK uploader refuses corrupted bytes without completing or publishing", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "website-soci-test-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	await mkdir(join(root, "blobs", "sha256"), { recursive: true });
	const sha = digest("good"),
		calls: string[] = [];
	await writeFile(join(root, "blobs", "sha256", sha.slice(7)), "evil");
	const client = {
		send: async (cmd: FixtureCommand) => {
			calls.push(cmd.constructor.name);
			return cmd.constructor.name === "BatchCheckLayerAvailabilityCommand"
				? { layers: [], failures: [] }
				: { uploadId: "owned" };
		},
	} as unknown as ECRClient;
	await assert.rejects(
		uploadWebsiteSociBlob(client, "owned", root, {
			mediaType: "application/octet-stream",
			digest: sha,
			size: 4,
		}),
	);
	assert.ok(
		!calls.includes("CompleteLayerUploadCommand") &&
			!calls.includes("PutImageCommand"),
	);
});
test("index replay verifies immutable artifacts without conversion and rejects registry mismatch", async () => {
	const [native, artifact] = pair();
	const client = {
		send: async (cmd: FixtureCommand) => {
			assert.equal(cmd.input.imageIds?.[0]?.imageDigest, artifact.digest);
			return {
				images: [
					{
						imageId: { imageDigest: artifact.digest },
						imageManifest: artifact.manifest,
						imageManifestMediaType: artifact.mediaType,
					},
				],
				failures: [],
			};
		},
	} as unknown as ECRClient;
	const rows = await websiteSociIndex(
		client,
		"bible-on-site",
		new Map([
			["amd64", native],
			["arm64", native],
		]),
	);
	assert.equal(rows.length, 4);
	assert.deepEqual(
		rows.map((x) => x.platform.architecture),
		["amd64", "arm64", "amd64", "arm64"],
	);
	const bad = {
		send: async () => ({
			images: [
				{
					imageId: { imageDigest: artifact.digest },
					imageManifest: "{}",
					imageManifestMediaType: type,
				},
			],
			failures: [],
		}),
	} as unknown as ECRClient;
	await assert.rejects(
		websiteSociIndex(
			bad,
			"bible-on-site",
			new Map([
				["amd64", native],
				["arm64", native],
			]),
		),
	);
});

async function sourceArchive(directory: string): Promise<APIArchive> {
	const raw = Buffer.from("synthetic filesystem"),
		config = Buffer.from(
			JSON.stringify({
				architecture: "amd64",
				os: "linux",
				rootfs: { type: "layers", diff_ids: [digest(raw)] },
			}),
		),
		path = join(directory, "source");
	await writeFile(path, Buffer.concat([config, raw]));
	return {
		path,
		architecture: "amd64",
		configDigest: digest(config),
		layerCount: 1,
		ociSource: {
			config: { offset: 0, size: config.length },
			layers: [{ offset: config.length, size: raw.length }],
			diffIds: [digest(raw)],
		},
	};
}
async function fixtureConversion(
	_tool: string,
	input: string,
	output: string,
): Promise<void> {
	await mkdir(join(output, "blobs", "sha256"), { recursive: true });
	for (const name of await readdir(join(input, "blobs", "sha256")))
		await copyFile(
			join(input, "blobs", "sha256", name),
			join(output, "blobs", "sha256", name),
		);
	const layout = JSON.parse(await readFile(join(input, "index.json"), "utf8"));
	const nativeDoc = JSON.parse(
		await readFile(
			join(input, "blobs", "sha256", layout.manifests[0].digest.slice(7)),
			"utf8",
		),
	);
	async function blob(raw: Buffer, mediaType: string) {
		const d = { digest: digest(raw), size: raw.length, mediaType };
		await writeFile(join(output, "blobs", "sha256", d.digest.slice(7)), raw);
		return d;
	}
	const config = await blob(Buffer.from("{}"), SOCI_TYPE),
		ztoc = await blob(Buffer.from("ztoc"), "application/octet-stream");
	const artifactRaw = Buffer.from(
		JSON.stringify({
			schemaVersion: 2,
			mediaType: type,
			config,
			layers: [
				{
					...ztoc,
					annotations: {
						"com.amazon.soci.image-layer-digest": nativeDoc.layers[0].digest,
						"com.amazon.soci.image-layer-mediaType":
							nativeDoc.layers[0].mediaType,
						"com.amazon.soci.span-size": "4194304",
					},
				},
			],
		}),
	);
	const artifact = await blob(artifactRaw, type);
	nativeDoc.annotations = { "com.amazon.soci.index-digest": artifact.digest };
	const nativeRaw = Buffer.from(JSON.stringify(nativeDoc)),
		native = await blob(nativeRaw, type);
	const descriptors = websiteSociPair(
		{ manifest: nativeRaw.toString(), digest: native.digest, mediaType: type },
		{
			manifest: artifactRaw.toString(),
			digest: artifact.digest,
			mediaType: type,
		},
		"amd64",
	);
	const root = await blob(
		Buffer.from(
			JSON.stringify({
				schemaVersion: 2,
				mediaType: OCI_INDEX,
				manifests: descriptors,
			}),
		),
		OCI_INDEX,
	);
	await writeFile(
		join(output, "index.json"),
		JSON.stringify({
			schemaVersion: 2,
			mediaType: OCI_INDEX,
			manifests: [root],
		}),
	);
}
test("publishes only a fully bound SOCI artifact then its immutable native child", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "website-soci-test-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const archive = await sourceArchive(root);
	const images = new Map<string, { manifest: string; mediaType: string }>(),
		writes: { tag?: string; digest: string }[] = [];
	type Input = {
		imageIds?: { imageDigest: string }[];
		imageTag?: string;
		imageDigest?: string;
		imageManifest?: string;
		imageManifestMediaType?: string;
	};
	const client = {
		send: async (cmd: { constructor: { name: string }; input: Input }) => {
			const p = cmd.input;
			switch (cmd.constructor.name) {
				case "BatchCheckLayerAvailabilityCommand":
					return {
						layers: [
							{
								layerDigest: (cmd.input as { layerDigests: string[] })
									.layerDigests[0],
								layerAvailability: "AVAILABLE",
							},
						],
						failures: [],
					};
				case "PutImageCommand": {
					assert.ok(
						p.imageDigest && p.imageManifest && p.imageManifestMediaType,
					);
					assert.equal(digest(p.imageManifest), p.imageDigest);
					images.set(p.imageDigest, {
						manifest: p.imageManifest,
						mediaType: p.imageManifestMediaType,
					});
					writes.push({ tag: p.imageTag, digest: p.imageDigest });
					return { image: { imageId: { imageDigest: p.imageDigest } } };
				}
				case "BatchGetImageCommand": {
					const requested = p.imageIds?.[0]?.imageDigest;
					assert.ok(requested);
					const image = images.get(requested);
					assert.ok(image);
					return {
						failures: [],
						images: [
							{
								imageId: { imageDigest: requested },
								imageManifest: image.manifest,
								imageManifestMediaType: image.mediaType,
							},
						],
					};
				}
				default:
					throw new Error("Unexpected SDK mutation");
			}
		},
	} as unknown as ECRClient;
	await publishWebsiteSociChild(
		archive,
		root,
		client,
		"owned-repository",
		"v0.2.606-amd64",
		"fixture-converter",
		fixtureConversion,
	);
	assert.equal(writes.length, 2);
	assert.equal(writes[0].tag, undefined);
	assert.equal(writes[1].tag, "v0.2.606-amd64");
	const native = images.get(writes[1].digest);
	assert.ok(native);
	assert.equal(JSON.parse(native.manifest).config.digest, archive.configDigest);
	assert.equal(
		JSON.parse(native.manifest).annotations["com.amazon.soci.index-digest"],
		writes[0].digest,
	);
});
test("a failed conversion or wrong immutable target performs no registry operations", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "website-soci-test-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const archive = await sourceArchive(root);
	let calls = 0;
	const client = {
		send: async () => {
			calls++;
			throw new Error("unexpected registry operation");
		},
	} as unknown as ECRClient;
	await assert.rejects(
		publishWebsiteSociChild(
			archive,
			root,
			client,
			"owned",
			"v0.2.606-arm64",
			"fixture",
			fixtureConversion,
		),
	);
	assert.equal(calls, 0);
	await assert.rejects(
		publishWebsiteSociChild(
			archive,
			root,
			client,
			"owned",
			"v0.2.606-amd64",
			"fixture",
			async () => {
				throw new Error("conversion failed");
			},
		),
	);
	assert.equal(calls, 0);
});
