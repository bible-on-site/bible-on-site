import assert from "node:assert/strict";
import { test } from "node:test";
import {
	BatchGetImageCommand,
	type ECRClient,
	PutImageCommand,
} from "@aws-sdk/client-ecr";
import { ECRDeployerBase } from "./ecr-deployer-base.mts";
import { resumePublishedImage } from "./resume-image.mts";

const image = (tag: string, digest = "sha256:approved") => ({
	imageId: { imageTag: tag, imageDigest: digest },
	imageManifest: "approved manifest",
	imageManifestMediaType:
		"application/vnd.docker.distribution.manifest.v2+json",
});

for (const latest of [image("latest", "sha256:old"), undefined]) {
	test(`a retry completes latest promotion (${latest ? "old latest" : "missing latest"}) using the published version`, async () => {
		const commands: unknown[] = [];
		const client = {
			send: async (command: unknown) => {
				commands.push(command);
				if (
					command instanceof BatchGetImageCommand &&
					command.input.imageIds?.[0]?.imageTag === "v0.2.433"
				)
					return { images: [image("v0.2.433")] };
				if (command instanceof BatchGetImageCommand)
					return {
						images: [image("v0.2.433"), ...(latest ? [latest] : [])],
						failures: latest
							? []
							: [
									{
										imageId: { imageTag: "latest" },
										failureCode: "ImageNotFound",
									},
								],
					};
				return {};
			},
		} as unknown as ECRClient;
		await resumePublishedImage(client, "bible-on-site", "v0.2.433");
		assert.equal(commands.length, 3);
		assert.ok(commands[2] instanceof PutImageCommand);
		assert.deepEqual(commands[2].input, {
			repositoryName: "bible-on-site",
			imageTag: "latest",
			imageManifest: "approved manifest",
			imageManifestMediaType:
				"application/vnd.docker.distribution.manifest.v2+json",
		});
	});
}

test("rerunning a completed push performs no registry writes", async () => {
	const client = {
		send: async (command: unknown) => {
			assert.ok(command instanceof BatchGetImageCommand);
			return { images: [image("v0.2.433"), image("latest")] };
		},
	} as unknown as ECRClient;
	await resumePublishedImage(client, "bible-on-site", "v0.2.433");
});

test("an unavailable published image or denied lookup cannot report success", async () => {
	for (const response of [
		{ images: [] },
		{
			images: [image("v0.2.433")],
			failures: [{ imageId: { imageTag: "latest" }, failureCode: "KmsError" }],
		},
	]) {
		const client = { send: async () => response } as unknown as ECRClient;
		await assert.rejects(
			resumePublishedImage(client, "bible-on-site", "v0.2.433"),
		);
	}
});

class RetriedDeployment extends ECRDeployerBase {
	remote = "v0.2.433";
	protected async getLocalVersion() {
		return "0.2.433";
	}
	protected override async getRemoteVersion() {
		return this.remote;
	}
	protected async getDockerImageTag(): Promise<string> {
		throw new Error("Retry must not build another image");
	}
	protected async getDockerImageArchivePath(): Promise<string> {
		throw new Error("Retry must not load another archive");
	}
	async run() {
		await this.deployPreConditions();
		await this.coreDeploy();
	}
}

test("the real deployer resumes the same version and still rejects older versions", async () => {
	const client = {
		send: async (command: unknown) => {
			if (command instanceof BatchGetImageCommand)
				return { images: [image("v0.2.433"), image("latest")] };
			return {
				repositories: [{ repositoryUri: "registry.example/bible-on-site" }],
			};
		},
	} as unknown as ECRClient;
	const deployer = new RetriedDeployment(
		"website",
		"bible-on-site",
		"bible-on-site",
		client,
		{
			region: "il-central-1",
			accountId: "test",
			useEnvCredentials: true,
		},
	);
	await deployer.run();
	deployer.remote = "v0.2.434";
	await assert.rejects(deployer.run(), /not newer/);
});
