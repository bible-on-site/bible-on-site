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
			if (command instanceof DescribeImagesCommand)
				return {
					imageDetails: [...this.images.keys(), ...this.extraTags].map(
						(tag) => ({ imageTags: [tag] }),
					),
				};
			if (command instanceof BatchGetImageCommand) {
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
				return { image: { imageId: { imageTag: tag, imageDigest: expected } } };
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
