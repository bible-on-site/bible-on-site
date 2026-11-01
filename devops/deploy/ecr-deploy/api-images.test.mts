import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import {
	BatchGetImageCommand,
	DescribeImagesCommand,
	DescribeRepositoriesCommand,
	type ECRClient,
	GetAuthorizationTokenCommand,
	PutImageCommand,
} from "@aws-sdk/client-ecr";
import {
	type APIArchive,
	assertAPILatestMode,
	OCI_INDEX,
	type PreparedAPIArchives,
	prepareAPIArchives,
	publishAPIImages,
	validateAPIImageOptions,
} from "./api-images.mts";
import { ECRDeployerBase } from "./ecr-deployer-base.mts";

const sourceRef = "a".repeat(40);
const version = "0.1.96";
const repositoryName = "bible-on-site-api";
const repositoryUri = `registry.example/${repositoryName}`;
const digest = (bytes: Buffer | string) =>
	`sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const childType = "application/vnd.docker.distribution.manifest.v2+json";
type Image = { manifest: string; mediaType: string; digest: string };

function tar(
	entries: { name: string; bytes: Buffer; type?: string }[],
): Buffer {
	const parts: Buffer[] = [];
	for (const entry of entries) {
		const header = Buffer.alloc(512);
		header.write(entry.name, 0, 100);
		header.write("0000600\0", 100);
		header.write("0000000\0", 108);
		header.write("0000000\0", 116);
		header.write(`${entry.bytes.length.toString(8).padStart(11, "0")}\0`, 124);
		header.write("00000000000\0", 136);
		header.fill(32, 148, 156);
		header.write(entry.type ?? "0", 156);
		header.write("ustar\0", 257);
		header.write("00", 263);
		const checksum = header.reduce((sum, byte) => sum + byte, 0);
		header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148);
		parts.push(
			header,
			entry.bytes,
			Buffer.alloc((512 - (entry.bytes.length % 512)) % 512),
		);
	}
	return Buffer.concat([...parts, Buffer.alloc(1024)]);
}

function dockerArchive(
	architecture: string,
	overrides: {
		os?: string;
		revision?: string;
		version?: string;
		wrongLayer?: boolean;
		extra?: { name: string; bytes: Buffer; type?: string }[];
	} = {},
): Buffer {
	const layer = tar([]);
	const config = Buffer.from(
		JSON.stringify({
			architecture,
			os: overrides.os ?? "linux",
			config: {
				Labels: {
					"org.opencontainers.image.revision": overrides.revision ?? sourceRef,
					"org.opencontainers.image.version": overrides.version ?? version,
				},
			},
			rootfs: {
				type: "layers",
				diff_ids: [
					digest(overrides.wrongLayer ? Buffer.from("wrong layer") : layer),
				],
			},
		}),
	);
	const configName = `${digest(config).slice(7)}.json`;
	return tar([
		{
			name: "manifest.json",
			bytes: Buffer.from(
				JSON.stringify([
					{
						Config: configName,
						RepoTags: ["api:release"],
						Layers: ["layer.tar"],
					},
				]),
			),
		},
		{ name: configName, bytes: config },
		{ name: "layer.tar", bytes: layer },
		...(overrides.extra ?? []),
	]);
}

async function fixture(
	run: (
		prepared: PreparedAPIArchives,
		paths: { amd64: string; arm64: string },
	) => Promise<void>,
) {
	const directory = await mkdtemp(join(tmpdir(), "api-publisher-test-"));
	let prepared: PreparedAPIArchives | undefined;
	try {
		const paths = {
			amd64: join(directory, "amd64 image.tar"),
			arm64: join(directory, "arm64 image.tar.gz"),
		};
		await writeFile(paths.amd64, dockerArchive("amd64"));
		await writeFile(paths.arm64, gzipSync(dockerArchive("arm64")));
		prepared = await prepareAPIArchives({
			amd64ArchivePath: paths.amd64,
			arm64ArchivePath: paths.arm64,
			sourceRef,
			version,
		});
		await run(prepared, paths);
	} finally {
		if (prepared) {
			await prepared.dispose();
			await assert.rejects(access(prepared.directory));
		}
		await rm(directory, { recursive: true, force: true });
	}
}

function child(archive: APIArchive): Image {
	const manifest = JSON.stringify({
		schemaVersion: 2,
		mediaType: childType,
		config: {
			mediaType: "application/vnd.docker.container.image.v1+json",
			digest: archive.configDigest,
			size: 123,
		},
		layers: Array.from({ length: archive.layerCount }, () => ({
			mediaType: "application/vnd.docker.image.rootfs.diff.tar.gzip",
			digest: digest("compressed fixture layer"),
			size: 123,
		})),
	});
	return { manifest, mediaType: childType, digest: digest(manifest) };
}

class Registry {
	images = new Map<string, Image>();
	pushed: string[] = [];
	puts: string[] = [];
	policy = "IMMUTABLE_WITH_EXCLUSION";
	exclusions = [{ filterType: "WILDCARD", filter: "latest" }];
	extraTags: string[] = [];
	failPush?: string;
	loseChild?: string;
	failPut?: string;
	raceCanonical?: Image;
	newerBeforeLatest = false;
	client = {
		send: async (command: unknown) => {
			if (command instanceof GetAuthorizationTokenCommand)
				return {
					authorizationData: [
						{
							authorizationToken: Buffer.from("AWS:fixture").toString("base64"),
							proxyEndpoint: "https://different-registry.example",
						},
					],
				};
			if (command instanceof DescribeRepositoriesCommand)
				return {
					repositories: [
						{
							repositoryName,
							repositoryUri,
							imageTagMutability: this.policy,
							imageTagMutabilityExclusionFilters: this.exclusions,
						},
					],
				};
			if (command instanceof DescribeImagesCommand) {
				const tag = command.input.imageIds?.[0]?.imageTag;
				if (tag) {
					const image = this.images.get(tag);
					if (!image)
						throw Object.assign(new Error("Tag not found"), {
							name: "ImageNotFoundException",
						});
					return {
						imageDetails: [{ imageTags: [tag], imageDigest: image.digest }],
					};
				}
				return {
					imageDetails: [...this.images.keys(), ...this.extraTags].map(
						(tag) => ({ imageTags: [tag] }),
					),
				};
			}
			if (command instanceof BatchGetImageCommand) {
				const requestedDigest = command.input.imageIds?.[0]?.imageDigest;
				if (requestedDigest) {
					const matches = [...this.images].filter(
						([, image]) => image.digest === requestedDigest,
					);
					return matches.length
						? {
								images: matches.map(([tag, image]) => ({
									imageId: { imageTag: tag, imageDigest: image.digest },
									imageManifest: image.manifest,
									imageManifestMediaType: image.mediaType,
								})),
							}
						: {
								failures: [
									{
										imageId: { imageDigest: requestedDigest },
										failureCode: "ImageNotFound",
									},
								],
							};
				}
				const tag = command.input.imageIds?.[0]?.imageTag;
				assert.ok(tag);
				const image = this.images.get(tag);
				return image
					? {
							images: [
								{
									imageId: { imageTag: tag, imageDigest: image.digest },
									imageManifest: image.manifest,
									imageManifestMediaType: image.mediaType,
								},
							],
						}
					: {
							failures: [
								{ imageId: { imageTag: tag }, failureCode: "ImageNotFound" },
							],
						};
			}
			if (command instanceof PutImageCommand) {
				const {
					imageTag: tag,
					imageManifest: manifest,
					imageManifestMediaType: mediaType,
					imageDigest: expected,
				} = command.input;
				assert.ok(tag && manifest && mediaType);
				if (expected !== undefined) assert.equal(digest(manifest), expected);
				this.puts.push(tag);
				if (this.failPut === tag) throw new Error(`Interrupted ${tag} write`);
				if (tag === `v${version}` && this.raceCanonical) {
					this.images.set(tag, this.raceCanonical);
					this.raceCanonical = undefined;
					throw Object.assign(new Error("Concurrent immutable publication"), {
						name: "ImageTagAlreadyExistsException",
					});
				}
				const existing = this.images.get(tag);
				if (tag !== "latest" && existing)
					throw Object.assign(new Error("Immutable collision"), {
						name: "ImageTagAlreadyExistsException",
					});
				this.images.set(tag, { manifest, mediaType, digest: digest(manifest) });
				if (this.newerBeforeLatest && tag === `v${version}`)
					this.extraTags.push("v0.1.97");
				return {
					image: {
						repositoryName,
						imageId: { imageTag: tag, imageDigest: expected },
						imageManifest: manifest,
						imageManifestMediaType: mediaType,
					},
				};
			}
			throw new Error(`Unexpected SDK command ${String(command)}`);
		},
	} as unknown as ECRClient;
	options(prepared: PreparedAPIArchives, publishIndex = false) {
		return {
			client: this.client,
			repositoryName,
			repositoryUri,
			version,
			publishIndex,
			pushArchive: async (archivePath: string, reference: string) => {
				const archive = prepared.images.find(
					(item) => item.path === archivePath,
				);
				assert.ok(archive);
				const tag = reference.slice(reference.lastIndexOf(":") + 1);
				this.pushed.push(tag);
				if (this.failPush === archive.architecture)
					throw new Error("Interrupted archive push");
				if (this.loseChild === archive.architecture) return;
				assert.ok(
					!this.images.has(tag),
					"must not overwrite immutable staged tag",
				);
				this.images.set(tag, child(archive));
			},
		};
	}
}

test("validates both native configs and privately decompresses without modifying inputs", async () =>
	fixture(async (prepared, paths) => {
		assert.deepEqual(
			prepared.images.map((image) => image.architecture),
			["amd64", "arm64"],
		);
		assert.equal(
			(await readFile(prepared.images[1].path)).subarray(0, 2).toString(),
			"ma",
		);
		await writeFile(paths.amd64, "changed after validation");
		assert.notEqual(
			(await readFile(prepared.images[0].path)).toString(),
			"changed after validation",
		);
	}));

for (const [name, archive] of [
	["wrong architecture", dockerArchive("amd64")],
	["wrong OS", dockerArchive("arm64", { os: "windows" })],
	["wrong source", dockerArchive("arm64", { revision: "b".repeat(40) })],
	["prefixed version", dockerArchive("arm64", { version: `v${version}` })],
	["changed layer", dockerArchive("arm64", { wrongLayer: true })],
	[
		"traversal",
		dockerArchive("arm64", {
			extra: [{ name: "../escape", bytes: Buffer.from("unsafe") }],
		}),
	],
	[
		"symlink",
		dockerArchive("arm64", {
			extra: [{ name: "link", bytes: Buffer.alloc(0), type: "2" }],
		}),
	],
	[
		"duplicate",
		dockerArchive("arm64", {
			extra: [{ name: "manifest.json", bytes: Buffer.from("[]") }],
		}),
	],
	["truncated", dockerArchive("arm64").subarray(0, 520)],
] as const)
	test(`rejects ${name} before any registry call`, async () => {
		const directory = await mkdtemp(join(tmpdir(), "api-invalid-"));
		try {
			const amd64 = join(directory, "amd64.tar"),
				arm64 = join(directory, "arm64.tar");
			await writeFile(amd64, dockerArchive("amd64"));
			await writeFile(arm64, archive);
			await assert.rejects(
				prepareAPIArchives({
					amd64ArchivePath: amd64,
					arm64ArchivePath: arm64,
					sourceRef,
					version,
				}),
			);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

test("rejects abbreviated source refs and noncanonical versions", () => {
	for (const invalid of [
		{ sourceRef: "abc" },
		{ sourceRef: "A".repeat(40) },
		{ version: `v${version}` },
		{ version: "01.1.2" },
		{ version: "0.1.96-arm64" },
	])
		assert.throws(() =>
			validateAPIImageOptions({
				amd64ArchivePath: "a",
				arm64ArchivePath: "b",
				sourceRef,
				version,
				...invalid,
			}),
		);
});

test("default OFF verifies both children then promotes the exact amd64 manifest", async () =>
	fixture(async (prepared) => {
		const registry = new Registry();
		const result = await publishAPIImages(prepared, registry.options(prepared));
		assert.deepEqual(registry.pushed, [
			`v${version}-amd64`,
			`v${version}-arm64`,
		]);
		assert.deepEqual(registry.puts, [`v${version}`, "latest"]);
		assert.equal(
			registry.images.get(`v${version}`)?.digest,
			registry.images.get(`v${version}-amd64`)?.digest,
		);
		assert.equal(registry.images.get("latest")?.digest, result.canonicalDigest);
		assert.equal(result.sourceRef, sourceRef);
		assert.equal(result.publishIndex, false);
	}));

test("ON publishes exactly two verified OCI descriptors with byte sizes and platforms", async () =>
	fixture(async (prepared) => {
		const registry = new Registry();
		const result = await publishAPIImages(
			prepared,
			registry.options(prepared, true),
		);
		const canonical = registry.images.get(`v${version}`);
		assert.ok(canonical);
		assert.equal(canonical.mediaType, OCI_INDEX);
		const index = JSON.parse(canonical.manifest);
		assert.equal(index.schemaVersion, 2);
		assert.deepEqual(
			index.manifests,
			prepared.images.map((archive) => {
				const image = registry.images.get(
					`v${version}-${archive.architecture}`,
				);
				assert.ok(image);
				return {
					mediaType: image.mediaType,
					digest: image.digest,
					size: Buffer.byteLength(image.manifest),
					platform: { architecture: archive.architecture, os: "linux" },
				};
			}),
		);
		assert.equal(registry.images.get("latest")?.digest, result.canonicalDigest);
	}));

test("resumes an interrupted second child push without rewriting the first", async () =>
	fixture(async (prepared) => {
		const registry = new Registry();
		registry.failPush = "arm64";
		await assert.rejects(
			publishAPIImages(prepared, registry.options(prepared)),
			/Interrupted/,
		);
		assert.deepEqual(registry.puts, []);
		registry.failPush = undefined;
		registry.pushed = [];
		await publishAPIImages(prepared, registry.options(prepared));
		assert.deepEqual(registry.pushed, [`v${version}-arm64`]);
		registry.pushed = [];
		registry.puts = [];
		await publishAPIImages(prepared, registry.options(prepared));
		assert.deepEqual(registry.pushed, []);
		assert.deepEqual(registry.puts, []);
	}));

test("missing child or canonical write failure never promotes latest", async () =>
	fixture(async (prepared) => {
		for (const failure of ["missing", "canonical"]) {
			const registry = new Registry();
			if (failure === "missing") registry.loseChild = "arm64";
			else registry.failPut = `v${version}`;
			await assert.rejects(
				publishAPIImages(prepared, registry.options(prepared, true)),
			);
			assert.ok(!registry.puts.includes("latest"));
			assert.ok(!registry.images.has("latest"));
		}
	}));

test("resumes after latest failure using immutable canonical and children", async () =>
	fixture(async (prepared) => {
		const registry = new Registry();
		registry.failPut = "latest";
		await assert.rejects(
			publishAPIImages(prepared, registry.options(prepared, true)),
		);
		registry.failPut = undefined;
		registry.puts = [];
		registry.pushed = [];
		await publishAPIImages(prepared, registry.options(prepared, true));
		assert.deepEqual(registry.pushed, []);
		assert.deepEqual(registry.puts, ["latest"]);
	}));

test("refuses a different immutable child and never writes canonical/latest", async () =>
	fixture(async (prepared) => {
		const registry = new Registry();
		registry.images.set(
			`v${version}-arm64`,
			child({ ...prepared.images[1], configDigest: digest("another source") }),
		);
		await assert.rejects(
			publishAPIImages(prepared, registry.options(prepared)),
			/does not match/,
		);
		assert.deepEqual(registry.pushed, []);
		assert.deepEqual(registry.puts, []);
	}));

test("an existing amd64 version cannot be converted to an index or replaced", async () =>
	fixture(async (prepared) => {
		const registry = new Registry();
		registry.images.set(`v${version}`, child(prepared.images[0]));
		await assert.rejects(
			publishAPIImages(prepared, registry.options(prepared, true)),
			/new version/,
		);
		assert.deepEqual(registry.pushed, []);
		registry.images.set(
			`v${version}`,
			child({ ...prepared.images[0], configDigest: digest("other config") }),
		);
		await assert.rejects(
			publishAPIImages(prepared, registry.options(prepared)),
			/Immutable tag collision/,
		);
		assert.ok(!registry.puts.includes("latest"));
	}));

test("canonical newer releases block initial writes and a late newer release blocks latest", async () =>
	fixture(async (prepared) => {
		const registry = new Registry();
		registry.extraTags = ["v0.1.97", "v0.1.99-arm64", "deps-cache"];
		await assert.rejects(
			publishAPIImages(prepared, registry.options(prepared)),
			/downgrade/,
		);
		assert.deepEqual(registry.pushed, []);
		registry.extraTags = ["v0.1.99-arm64", "deps-cache"];
		registry.newerBeforeLatest = true;
		await assert.rejects(
			publishAPIImages(prepared, registry.options(prepared)),
			/downgrade/,
		);
		assert.ok(registry.images.has(`v${version}`));
		assert.ok(!registry.puts.includes("latest"));
	}));

test("mutable, fully immutable, or broader mutable exclusions fail closed", async () =>
	fixture(async (prepared) => {
		for (const policy of ["MUTABLE", "IMMUTABLE", "MUTABLE_WITH_EXCLUSION"]) {
			const registry = new Registry();
			registry.policy = policy;
			await assert.rejects(
				publishAPIImages(prepared, registry.options(prepared)),
				/only latest/,
			);
			assert.deepEqual(registry.pushed, []);
		}
		const registry = new Registry();
		registry.exclusions = [{ filterType: "WILDCARD", filter: "*" }];
		await assert.rejects(
			publishAPIImages(prepared, registry.options(prepared)),
			/only latest/,
		);
	}));

test("publication cannot switch the version after archive validation", async () =>
	fixture(async (prepared) => {
		const registry = new Registry();
		await assert.rejects(
			publishAPIImages(prepared, {
				...registry.options(prepared),
				version: "0.1.97",
			}),
			/exact validated/,
		);
		assert.deepEqual(registry.pushed, []);
	}));

class ExistingRelease extends ECRDeployerBase {
	protected async getLocalVersion() {
		return version;
	}
	protected override async getRemoteVersion() {
		return `v${version}`;
	}
	protected async getDockerImageTag(): Promise<string> {
		throw new Error("Legacy retry must not build");
	}
	protected async getDockerImageArchivePath(): Promise<string> {
		throw new Error("Legacy retry must not open archives");
	}
	async run() {
		await this.deployPreConditions();
		await this.coreDeploy();
	}
}

test("legacy single-archive retry remains compatible with immutable versions/latest exclusion", async () =>
	fixture(async (prepared) => {
		const registry = new Registry();
		registry.images.set(`v${version}`, child(prepared.images[0]));
		const deployer = new ExistingRelease(
			"api",
			repositoryName,
			repositoryName,
			registry.client,
			{ region: "test", accountId: "test", useEnvCredentials: true },
		);
		await deployer.run();
		assert.deepEqual(registry.puts, ["latest"]);
		registry.puts = [];
		await deployer.run();
		assert.deepEqual(registry.puts, []);
		const other = new ExistingRelease(
			"website",
			"website",
			"website",
			registry.client,
			{ region: "test", accountId: "test" },
		);
		assert.throws(
			() =>
				other.setAPIImageOptions({ arm64ArchivePath: "arm.tar", sourceRef }),
			/only for API/,
		);
	}));

for (const args of [
	["--module-name", "website", "--publish-index"],
	["--module-name", "admin", "--publish-index=false"],
	["--module-name", "admin", "--no-publish-index"],
	["--module-name", "api", "--publish-index"],
	[
		"--module-name",
		"api",
		"--docker-image",
		"a",
		"--docker-image-arm64",
		"b",
		"--source-ref",
		"short",
	],
])
	test(`CLI rejects invalid API options before AWS setup: ${args.join(" ")}`, () => {
		const result = spawnSync(
			process.execPath,
			[fileURLToPath(new URL("./index.mts", import.meta.url)), ...args],
			{
				encoding: "utf8",
				env: { ...process.env, AWS_REGION: "", AWS_PROFILE: "", CI: "" },
			},
		);
		assert.notEqual(result.status, 0);
		assert.match(
			result.stderr,
			/API-only|requires docker-image|full lowercase/,
		);
		assert.doesNotMatch(result.stderr, /Missing AWS_REGION/);
	});

test("real ECRDeployerBase integrates dual validation and index promotion without legacy archive logic", async () =>
	fixture(async (prepared, paths) => {
		const registry = new Registry();
		for (const archive of prepared.images)
			registry.images.set(
				`v${version}-${archive.architecture}`,
				child(archive),
			);
		const deployer = new ExistingRelease(
			"api",
			repositoryName,
			repositoryName,
			registry.client,
			{ region: "test", accountId: "test" },
		);
		deployer.setDockerImagePath(paths.amd64);
		deployer.setAPIImageOptions({
			arm64ArchivePath: paths.arm64,
			sourceRef,
			publishIndex: true,
		});
		await deployer.run();
		assert.equal(registry.images.get(`v${version}`)?.mediaType, OCI_INDEX);
		assert.deepEqual(registry.puts, [`v${version}`, "latest"]);
	}));

test("deployer rejects a bad second archive before any ECR command or write", async () =>
	fixture(async (_prepared, paths) => {
		const client = {
			send: async () => {
				throw new Error("No ECR command should precede archive validation");
			},
		} as unknown as ECRClient;
		const deployer = new ExistingRelease(
			"api",
			repositoryName,
			repositoryName,
			client,
			{ region: "test", accountId: "test" },
		);
		deployer.setDockerImagePath(paths.amd64);
		assert.throws(() => deployer.setAPIImageOptions({ sourceRef }), /requires/);
		await writeFile(paths.arm64, gzipSync(dockerArchive("amd64")));
		deployer.setAPIImageOptions({ arm64ArchivePath: paths.arm64, sourceRef });
		await assert.rejects(deployer.run(), /Expected linux\/arm64/);
	}));

test("immutable canonical races resume only the exact already-published digest", async () =>
	fixture(async (prepared) => {
		for (const same of [true, false]) {
			const registry = new Registry();
			registry.raceCanonical = child(
				same
					? prepared.images[0]
					: { ...prepared.images[0], configDigest: digest("different source") },
			);
			if (same) {
				await publishAPIImages(prepared, registry.options(prepared));
				assert.equal(
					registry.images.get("latest")?.digest,
					registry.images.get(`v${version}`)?.digest,
				);
			} else {
				await assert.rejects(
					publishAPIImages(prepared, registry.options(prepared)),
					/Immutable tag collision/,
				);
				assert.ok(!registry.puts.includes("latest"));
			}
		}
	}));

test("a staged manifest with a forged response digest fails before any write", async () =>
	fixture(async (prepared) => {
		const registry = new Registry();
		registry.images.set(`v${version}-amd64`, {
			...child(prepared.images[0]),
			digest: digest("not this manifest"),
		});
		await assert.rejects(
			publishAPIImages(prepared, registry.options(prepared)),
			/Invalid registry manifest digest/,
		);
		assert.deepEqual(registry.pushed, []);
		assert.deepEqual(registry.puts, []);
	}));

test("default credential setup refuses a mismatched registry before invoking crane", async () =>
	fixture(async (prepared) => {
		const registry = new Registry();
		const { pushArchive: _push, ...options } = registry.options(prepared);
		await assert.rejects(
			publishAPIImages(prepared, options),
			/authorization endpoint does not match/,
		);
		assert.deepEqual(registry.puts, []);
		await assert.rejects(access(join(prepared.directory, "config.json")));
	}));

function completeIndex(prepared: PreparedAPIArchives): Image {
	const manifest = JSON.stringify({
		schemaVersion: 2,
		mediaType: OCI_INDEX,
		manifests: prepared.images.map((archive) => {
			const image = child(archive);
			return {
				mediaType: image.mediaType,
				digest: image.digest,
				size: Buffer.byteLength(image.manifest),
				platform: { architecture: archive.architecture, os: "linux" },
			};
		}),
	});
	return { manifest, mediaType: OCI_INDEX, digest: digest(manifest) };
}

test("once latest is an index neither dual default-OFF nor legacy API may downgrade it", async () =>
	fixture(async (prepared) => {
		const registry = new Registry();
		const established = completeIndex(prepared);
		registry.images.set("latest", established);
		const { publishIndex: _mode, ...defaultOptions } =
			registry.options(prepared);
		await assert.rejects(
			publishAPIImages(prepared, defaultOptions),
			/every subsequent release requires both/,
		);
		assert.deepEqual(registry.pushed, []);
		assert.deepEqual(registry.puts, []);
		const deployer = new ExistingRelease(
			"api",
			repositoryName,
			repositoryName,
			registry.client,
			{ region: "test", accountId: "test" },
		);
		await assert.rejects(
			deployer.run(),
			/every subsequent release requires both/,
		);
		assert.deepEqual(registry.puts, []);
		assert.equal(registry.images.get("latest")?.digest, established.digest);
		await publishAPIImages(prepared, registry.options(prepared, true));
		assert.equal(registry.images.get(`v${version}`)?.mediaType, OCI_INDEX);
	}));

test("a late index promotion is rechecked immediately before latest changes", async () =>
	fixture(async (prepared) => {
		const registry = new Registry();
		const established = completeIndex(prepared);
		const transport = registry.client;
		const client = {
			send: async (command: unknown) => {
				const result = await Reflect.apply(transport.send, transport, [
					command,
				]);
				if (
					command instanceof PutImageCommand &&
					command.input.imageTag === `v${version}`
				)
					registry.images.set("latest", established);
				return result;
			},
		} as unknown as ECRClient;
		await assert.rejects(
			publishAPIImages(prepared, { ...registry.options(prepared), client }),
			/every subsequent release requires both/,
		);
		assert.ok(registry.images.has(`v${version}`));
		assert.ok(!registry.puts.includes("latest"));
		assert.equal(registry.images.get("latest")?.digest, established.digest);
	}));

test("a stale tag manifest cannot hide an index from the publication mode guard", async () =>
	fixture(async (prepared) => {
		const registry = new Registry();
		await publishAPIImages(prepared, registry.options(prepared, true));
		const current = registry.images.get("latest");
		assert.ok(current);
		const previous = child(prepared.images[0]);
		const original = registry.client.send.bind(registry.client);
		let staleTagReads = 0;
		let digestReads = 0;
		registry.client.send = (async (command: unknown) => {
			if (command instanceof BatchGetImageCommand) {
				if (command.input.imageIds?.[0]?.imageTag === "latest") {
					staleTagReads++;
					return {
						images: [
							{
								imageId: { imageTag: "latest", imageDigest: previous.digest },
								imageManifest: previous.manifest,
								imageManifestMediaType: previous.mediaType,
							},
						],
					};
				}
				if (command.input.imageIds?.[0]?.imageDigest === current.digest) {
					digestReads++;
					return {
						images: ["latest", `v${version}`].map((tag) => ({
							imageId: { imageTag: tag, imageDigest: current.digest },
							imageManifest: current.manifest,
							imageManifestMediaType: current.mediaType,
						})),
					};
				}
			}
			return original(command as never);
		}) as typeof registry.client.send;
		await assert.rejects(
			assertAPILatestMode(registry.client, repositoryName, false),
			/every subsequent release requires/,
		);
		assert.equal(staleTagReads, 0);
		assert.equal(digestReads, 1);
	}));

test("an already correct latest mapping is not rewritten because its tag manifest is stale", async () =>
	fixture(async (prepared) => {
		const registry = new Registry();
		await publishAPIImages(prepared, registry.options(prepared, true));
		const current = registry.images.get("latest");
		assert.ok(current);
		const previous = child(prepared.images[0]);
		registry.puts = [];
		const original = registry.client.send.bind(registry.client);
		let staleTagReads = 0;
		let duplicateWrites = 0;
		registry.client.send = (async (command: unknown) => {
			if (
				command instanceof BatchGetImageCommand &&
				command.input.imageIds?.[0]?.imageTag === "latest"
			) {
				staleTagReads++;
				return {
					images: [
						{
							imageId: { imageTag: "latest", imageDigest: previous.digest },
							imageManifest: previous.manifest,
							imageManifestMediaType: previous.mediaType,
						},
					],
				};
			}
			if (
				command instanceof PutImageCommand &&
				command.input.imageTag === "latest" &&
				command.input.imageDigest === current.digest
			) {
				duplicateWrites++;
				throw Object.assign(new Error("Same image already tagged"), {
					name: "ImageAlreadyExistsException",
				});
			}
			return original(command as never);
		}) as typeof registry.client.send;
		await publishAPIImages(prepared, registry.options(prepared, true));
		assert.equal(staleTagReads, 0);
		assert.equal(duplicateWrites, 0);
		assert.deepEqual(registry.puts, []);
	}));

test("verifies a retag using its write receipt and tag metadata despite a stale manifest read", async () =>
	fixture(async (prepared) => {
		const registry = new Registry();
		const previous = child({
			...prepared.images[0],
			configDigest: digest("previous release config"),
		});
		registry.images.set("latest", previous);
		const transport = registry.client;
		const metadataTags: string[] = [];
		let staleReads = 0;
		const client = {
			send: async (command: unknown) => {
				if (
					command instanceof BatchGetImageCommand &&
					command.input.imageIds?.[0]?.imageTag === "latest" &&
					registry.puts.includes("latest")
				) {
					staleReads++;
					return {
						images: [
							{
								imageId: { imageTag: "latest", imageDigest: previous.digest },
								imageManifest: previous.manifest,
								imageManifestMediaType: previous.mediaType,
							},
						],
					};
				}
				if (command instanceof DescribeImagesCommand) {
					const tag = command.input.imageIds?.[0]?.imageTag;
					if (tag) metadataTags.push(tag);
				}
				return Reflect.apply(transport.send, transport, [command]);
			},
		} as unknown as ECRClient;
		const result = await publishAPIImages(prepared, {
			...registry.options(prepared),
			client,
		});
		assert.equal(result.canonicalDigest, child(prepared.images[0]).digest);
		assert.equal(registry.images.get("latest")?.digest, result.canonicalDigest);
		assert.deepEqual(metadataTags, [
			"latest",
			`v${version}`,
			"latest",
			"latest",
			"latest",
		]);
		assert.equal(staleReads, 0);
		assert.deepEqual(registry.puts, [`v${version}`, "latest"]);
	}));

const cachedAliasLists: [string, string[] | undefined][] = [
	["missing", undefined],
	["empty", []],
	["canonical-only", [`v${version}`]],
];
for (const [name, aliases] of cachedAliasLists) {
	test(`publishes an index with ${name} cached aliases in post-write metadata`, async () =>
		fixture(async (prepared) => {
			const registry = new Registry();
			const original = registry.client.send.bind(registry.client);
			let reads = 0;
			registry.client.send = (async (command: unknown) => {
				const result = await original(command as never);
				if (
					command instanceof DescribeImagesCommand &&
					command.input.imageIds?.[0]?.imageTag === "latest" &&
					registry.puts.includes("latest")
				) {
					reads++;
					return {
						imageDetails: [
							{
								imageDigest: registry.images.get("latest")?.digest,
								imageTags: aliases,
							},
						],
					};
				}
				return result;
			}) as typeof registry.client.send;
			const result = await publishAPIImages(
				prepared,
				registry.options(prepared, true),
			);
			assert.equal(
				result.canonicalDigest,
				registry.images.get("latest")?.digest,
			);
			assert.equal(reads, 1);
			assert.equal(registry.puts.filter((tag) => tag === "latest").length, 1);
		}));

	test(`an index with ${name} cached aliases still blocks a single-platform downgrade`, async () =>
		fixture(async (prepared) => {
			const registry = new Registry();
			await publishAPIImages(prepared, registry.options(prepared, true));
			const original = registry.client.send.bind(registry.client);
			registry.client.send = (async (command: unknown) => {
				if (
					command instanceof DescribeImagesCommand &&
					command.input.imageIds?.[0]?.imageTag === "latest"
				)
					return {
						imageDetails: [
							{
								imageDigest: registry.images.get("latest")?.digest,
								imageTags: aliases,
							},
						],
					};
				return original(command as never);
			}) as typeof registry.client.send;
			await assert.rejects(
				assertAPILatestMode(registry.client, repositoryName, false),
				/every subsequent release requires/,
			);
		}));

	test(`a native image with ${name} cached aliases is resolved by its selected tag digest`, async () =>
		fixture(async (prepared) => {
			const registry = new Registry();
			const current = child(prepared.images[0]);
			registry.images.set("latest", current);
			const original = registry.client.send.bind(registry.client);
			registry.client.send = (async (command: unknown) => {
				if (
					command instanceof DescribeImagesCommand &&
					command.input.imageIds?.[0]?.imageTag === "latest"
				)
					return {
						imageDetails: [{ imageDigest: current.digest, imageTags: aliases }],
					};
				return original(command as never);
			}) as typeof registry.client.send;
			await assertAPILatestMode(registry.client, repositoryName, false);
			assert.deepEqual(registry.puts, []);
		}));

	test(`an already-current index with ${name} cached aliases is not rewritten`, async () =>
		fixture(async (prepared) => {
			const registry = new Registry();
			await publishAPIImages(prepared, registry.options(prepared, true));
			registry.puts = [];
			const original = registry.client.send.bind(registry.client);
			registry.client.send = (async (command: unknown) => {
				if (
					command instanceof DescribeImagesCommand &&
					command.input.imageIds?.[0]?.imageTag === "latest"
				)
					return {
						imageDetails: [
							{
								imageDigest: registry.images.get("latest")?.digest,
								imageTags: aliases,
							},
						],
					};
				return original(command as never);
			}) as typeof registry.client.send;
			await publishAPIImages(prepared, registry.options(prepared, true));
			assert.deepEqual(registry.puts, []);
		}));
}

const badWriteReceipts: [
	string,
	(image: Record<string, unknown>) => unknown,
][] = [
	["missing image", () => undefined],
	["wrong repository", (image) => ({ ...image, repositoryName: "other" })],
	[
		"wrong tag",
		(image) => ({
			...image,
			imageId: { ...(image.imageId as object), imageTag: "other" },
		}),
	],
	[
		"wrong digest",
		(image) => ({
			...image,
			imageId: { ...(image.imageId as object), imageDigest: digest("other") },
		}),
	],
	["wrong manifest", (image) => ({ ...image, imageManifest: "{}" })],
	[
		"wrong media type",
		(image) => ({ ...image, imageManifestMediaType: OCI_INDEX }),
	],
];
for (const [name, corrupt] of badWriteReceipts) {
	test(`rejects a latest write receipt with ${name} before post-write metadata verification`, async () =>
		fixture(async (prepared) => {
			const registry = new Registry();
			const transport = registry.client;
			let latestMetadataReads = 0;
			const client = {
				send: async (command: unknown) => {
					if (
						command instanceof DescribeImagesCommand &&
						command.input.imageIds?.[0]?.imageTag === "latest" &&
						registry.puts.includes("latest")
					)
						latestMetadataReads++;
					const result = await Reflect.apply(transport.send, transport, [
						command,
					]);
					if (
						command instanceof PutImageCommand &&
						command.input.imageTag === "latest"
					)
						return {
							image: corrupt(
								(result as { image: Record<string, unknown> }).image,
							),
						};
					return result;
				},
			} as unknown as ECRClient;
			await assert.rejects(
				publishAPIImages(prepared, { ...registry.options(prepared), client }),
				/Registry write receipt does not match the exact image for latest/,
			);
			assert.equal(latestMetadataReads, 0);
			assert.equal(registry.puts.filter((tag) => tag === "latest").length, 1);
		}));
}

const badTagMetadata: [string, (expected: string) => unknown][] = [
	["missing response", () => undefined],
	["missing image", () => []],
	[
		"ambiguous images",
		(expected) => [
			{ imageTags: ["latest"], imageDigest: expected },
			{ imageTags: ["latest"], imageDigest: expected },
		],
	],
	["missing digest", () => [{ imageTags: ["latest"] }]],
	[
		"invalid digest",
		() => [{ imageTags: ["latest"], imageDigest: "sha256:invalid" }],
	],
	[
		"wrong digest",
		() => [{ imageTags: ["latest"], imageDigest: digest("other") }],
	],
];
for (const [name, corrupt] of badTagMetadata) {
	test(`rejects ${name} in post-write latest metadata without retrying the write or read`, async () =>
		fixture(async (prepared) => {
			const registry = new Registry();
			const transport = registry.client;
			let metadataReads = 0;
			const client = {
				send: async (command: unknown) => {
					if (
						command instanceof DescribeImagesCommand &&
						command.input.imageIds?.[0]?.imageTag === "latest" &&
						registry.puts.includes("latest")
					) {
						metadataReads++;
						return { imageDetails: corrupt(child(prepared.images[0]).digest) };
					}
					return Reflect.apply(transport.send, transport, [command]);
				},
			} as unknown as ECRClient;
			await assert.rejects(
				publishAPIImages(prepared, { ...registry.options(prepared), client }),
				/Registry tag metadata does not preserve the exact digest for latest/,
			);
			assert.equal(metadataReads, 1);
			assert.equal(registry.puts.filter((tag) => tag === "latest").length, 1);
		}));
}

for (const [name, corrupt] of badTagMetadata) {
	test(`publication mode guard rejects ${name} in current tag metadata`, async () =>
		fixture(async (prepared) => {
			const registry = new Registry();
			const current = child(prepared.images[0]);
			registry.images.set("latest", current);
			const original = registry.client.send.bind(registry.client);
			let metadataReads = 0;
			registry.client.send = (async (command: unknown) => {
				if (
					command instanceof DescribeImagesCommand &&
					command.input.imageIds?.[0]?.imageTag === "latest"
				) {
					metadataReads++;
					return { imageDetails: corrupt(current.digest) };
				}
				return original(command as never);
			}) as typeof registry.client.send;
			await assert.rejects(
				assertAPILatestMode(registry.client, repositoryName, false),
				/Invalid registry tag metadata|Unable to inspect registry digest/,
			);
			assert.equal(metadataReads, 1);
			assert.deepEqual(registry.puts, []);
		}));
}

test("publication mode guard distinguishes absent tags/repositories from metadata errors", async () => {
	for (const name of [
		"ImageNotFoundException",
		"RepositoryNotFoundException",
		"AccessDeniedException",
	]) {
		let reads = 0;
		const client = {
			send: async (command: unknown) => {
				assert.ok(command instanceof DescribeImagesCommand);
				reads++;
				throw Object.assign(new Error("Metadata lookup failed"), { name });
			},
		} as unknown as ECRClient;
		if (name === "AccessDeniedException")
			await assert.rejects(
				assertAPILatestMode(client, repositoryName, false),
				/Metadata lookup failed/,
			);
		else await assertAPILatestMode(client, repositoryName, false);
		assert.equal(reads, 1);
	}
});

const corruptDigestReplies: [
	string,
	(images: Record<string, unknown>[]) => Record<string, unknown>,
][] = [
	["missing images", () => ({})],
	[
		"failure after metadata",
		() => ({ failures: [{ failureCode: "ImageNotFound" }] }),
	],
	[
		"partial response failure",
		(images) => ({ images, failures: [{ failureCode: "Unknown" }] }),
	],
	[
		"missing first manifest",
		(images) => ({ images: [{ ...images[0], imageManifest: undefined }] }),
	],
	[
		"missing first media type",
		(images) => ({
			images: [{ ...images[0], imageManifestMediaType: undefined }],
		}),
	],
	[
		"wrong requested digest",
		(images) => ({
			images: [{ ...images[0], imageId: { imageDigest: digest("different") } }],
		}),
	],
	[
		"tampered first manifest",
		(images) => ({ images: [{ ...images[0], imageManifest: "{}" }] }),
	],
	[
		"missing duplicate manifest",
		(images) => ({
			images: [images[0], { ...images[1], imageManifest: undefined }],
		}),
	],
	[
		"missing duplicate media type",
		(images) => ({
			images: [images[0], { ...images[1], imageManifestMediaType: undefined }],
		}),
	],
	[
		"conflicting duplicate media type",
		(images) => ({
			images: [images[0], { ...images[1], imageManifestMediaType: childType }],
		}),
	],
];
for (const [name, corrupt] of corruptDigestReplies) {
	test(`publication mode guard fails closed on ${name}`, async () =>
		fixture(async (prepared) => {
			const current = completeIndex(prepared);
			let metadataReads = 0,
				digestReads = 0;
			const client = {
				send: async (command: unknown) => {
					if (command instanceof DescribeImagesCommand) {
						metadataReads++;
						return {
							imageDetails: [
								{ imageTags: ["latest"], imageDigest: current.digest },
							],
						};
					}
					assert.ok(command instanceof BatchGetImageCommand);
					assert.deepEqual(command.input.imageIds, [
						{ imageDigest: current.digest },
					]);
					digestReads++;
					return corrupt(
						["latest", `v${version}`].map((tag) => ({
							imageId: { imageTag: tag, imageDigest: current.digest },
							imageManifest: current.manifest,
							imageManifestMediaType: current.mediaType,
						})),
					);
				},
			} as unknown as ECRClient;
			await assert.rejects(
				assertAPILatestMode(client, repositoryName, false),
				/Unable to inspect registry digest|Invalid registry manifest for digest/,
			);
			assert.equal(metadataReads, 1);
			assert.equal(digestReads, 1);
		}));
}

test("publication mode guard accepts identical legacy digest aliases", async () =>
	fixture(async (prepared) => {
		const registry = new Registry();
		const current = child(prepared.images[0]);
		registry.images.set("latest", current);
		registry.images.set(`v${version}`, current);
		await assertAPILatestMode(registry.client, repositoryName, false);
		assert.deepEqual(registry.puts, []);
	}));

test("publication mode guard accepts a valid image whose body omits optional mediaType", async () =>
	fixture(async (prepared) => {
		const registry = new Registry();
		const current = child(prepared.images[0]);
		const body = JSON.parse(current.manifest);
		delete body.mediaType;
		const manifest = JSON.stringify(body);
		registry.images.set("latest", {
			...current,
			manifest,
			digest: digest(manifest),
		});
		await assertAPILatestMode(registry.client, repositoryName, false);
		assert.deepEqual(registry.puts, []);
	}));

test("publication mode guard rejects invalid JSON even when its digest is genuine", async () =>
	fixture(async (prepared) => {
		const registry = new Registry();
		const current = child(prepared.images[0]);
		const manifest = "not JSON";
		registry.images.set("latest", {
			...current,
			manifest,
			digest: digest(manifest),
		});
		await assert.rejects(
			assertAPILatestMode(registry.client, repositoryName, false),
			SyntaxError,
		);
		assert.deepEqual(registry.puts, []);
	}));

for (const [name, corrupt] of [
	[
		"unknown media type",
		(image: Image) => ({ ...image, mediaType: "application/x-unknown" }),
	],
	[
		"wrong schema",
		(image: Image) => {
			const value = JSON.parse(image.manifest);
			value.schemaVersion = 1;
			const manifest = JSON.stringify(value);
			return { ...image, manifest, digest: digest(manifest) };
		},
	],
	[
		"index body with image header",
		() => {
			const manifest = JSON.stringify({ schemaVersion: 2, manifests: [] });
			return { manifest, mediaType: childType, digest: digest(manifest) };
		},
	],
	[
		"bad config digest",
		(image: Image) => {
			const value = JSON.parse(image.manifest);
			value.config.digest = "invalid";
			const manifest = JSON.stringify(value);
			return { ...image, manifest, digest: digest(manifest) };
		},
	],
	[
		"missing layers",
		(image: Image) => {
			const value = JSON.parse(image.manifest);
			delete value.layers;
			const manifest = JSON.stringify(value);
			return { ...image, manifest, digest: digest(manifest) };
		},
	],
	[
		"mismatched body media type",
		(image: Image) => {
			const value = JSON.parse(image.manifest);
			value.mediaType = OCI_INDEX;
			const manifest = JSON.stringify(value);
			return { ...image, manifest, digest: digest(manifest) };
		},
	],
] as const) {
	test(`publication mode guard rejects ${name}`, async () =>
		fixture(async (prepared) => {
			const registry = new Registry();
			registry.images.set("latest", corrupt(child(prepared.images[0])));
			await assert.rejects(
				assertAPILatestMode(registry.client, repositoryName, false),
				/unsupported image manifest/,
			);
			assert.deepEqual(registry.puts, []);
		}));
}

test("publication mode guard does not fall back when immutable bytes disappear", async () =>
	fixture(async (prepared) => {
		const current = child(prepared.images[0]);
		let reads = 0;
		const client = {
			send: async (command: unknown) => {
				reads++;
				if (command instanceof DescribeImagesCommand)
					return {
						imageDetails: [
							{ imageTags: ["latest"], imageDigest: current.digest },
						],
					};
				assert.ok(command instanceof BatchGetImageCommand);
				throw Object.assign(
					new Error("Repository disappeared after metadata"),
					{ name: "RepositoryNotFoundException" },
				);
			},
		} as unknown as ECRClient;
		await assert.rejects(
			assertAPILatestMode(client, repositoryName, false),
			/Repository disappeared/,
		);
		assert.equal(reads, 2);
	}));

class RacingLegacyRelease extends ExistingRelease {
	private calls = 0;
	protected override async getRemoteVersion() {
		return ++this.calls === 1 ? `v${version}` : "v0.1.97";
	}
}

test("legacy same-version resume also rechecks canonical semver before latest", async () =>
	fixture(async (prepared) => {
		const registry = new Registry();
		registry.images.set(`v${version}`, child(prepared.images[0]));
		const deployer = new RacingLegacyRelease(
			"api",
			repositoryName,
			repositoryName,
			registry.client,
			{ region: "test", accountId: "test" },
		);
		await assert.rejects(deployer.run(), /refusing a latest downgrade/);
		assert.deepEqual(registry.puts, []);
	}));

test("rejects directory inputs and a trailing-newline source SHA", async () =>
	fixture(async (prepared, paths) => {
		await assert.rejects(
			prepareAPIArchives({
				amd64ArchivePath: paths.amd64,
				arm64ArchivePath: prepared.directory,
				sourceRef,
				version,
			}),
			/regular file/,
		);
		assert.throws(
			() =>
				validateAPIImageOptions({
					amd64ArchivePath: paths.amd64,
					arm64ArchivePath: paths.arm64,
					sourceRef: `${sourceRef}\n`,
					version,
				}),
			/40-character/,
		);
	}));
