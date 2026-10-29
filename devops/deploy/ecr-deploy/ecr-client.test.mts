import assert from "node:assert/strict";
import { test } from "node:test";
import {
	DescribeImagesCommand,
	type DescribeImagesCommandOutput,
	type ECRClient,
} from "@aws-sdk/client-ecr";
import { getRemoteImageTags } from "./ecr-client.mts";
import { ECRDeployerBase } from "./ecr-deployer-base.mts";

function paginatedClient(pages: DescribeImagesCommandOutput[]) {
	const requests: DescribeImagesCommand[] = [];
	const client = {
		send: async (command: unknown) => {
			assert.ok(command instanceof DescribeImagesCommand);
			requests.push(command);
			assert.ok(
				requests.length <= pages.length,
				"Unexpected extra ECR request",
			);
			return pages[requests.length - 1];
		},
	} as unknown as ECRClient;
	return { client, requests };
}

test("remote releases exclude cache, architecture, and malformed version tags", async () => {
	const { client } = paginatedClient([
		{
			$metadata: {},
			imageDetails: [
				{
					imageTags: [
						"latest",
						"deps-cache",
						"deps-cache-arm64",
						"v99.0.0-arm64",
						"v99.0.0-amd64",
						"v99.0.0-rc.1",
						"v99.0.0+build",
						"99.0.0",
						"V99.0.0",
						"v01.2.3",
						"v1.02.3",
						"v1.2.03",
						"v1.2",
						"v1.2.3.4",
						"v1.2.3\n",
						"v9007199254740992.0.0",
						"v0.2.433",
					],
				},
				{},
			],
		},
	]);
	assert.deepEqual(await getRemoteImageTags(client, "bible-on-site"), [
		"v0.2.433",
	]);
});

test("remote releases are sorted across every page and duplicate image tags", async () => {
	const { client, requests } = paginatedClient([
		{
			$metadata: {},
			imageDetails: [
				{ imageTags: ["v1.9.20", "latest", "v0.2.433"] },
				{ imageTags: ["v1.10.0", "deps-cache"] },
			],
			nextToken: "page-2",
		},
		{
			$metadata: {},
			imageDetails: [
				{ imageTags: ["v2.0.0", "v99.0.0-arm64"] },
				{ imageTags: ["v1.9.20", "v0.2.1000"] },
			],
			nextToken: "page-3",
		},
		{
			$metadata: {},
			imageDetails: [{ imageTags: ["v10.0.0", "v0.2.99"] }],
		},
	]);
	assert.deepEqual(await getRemoteImageTags(client, "bible-on-site-api"), [
		"v0.2.99",
		"v0.2.433",
		"v0.2.1000",
		"v1.9.20",
		"v1.10.0",
		"v2.0.0",
		"v10.0.0",
	]);
	assert.deepEqual(
		requests.map((command) => command.input),
		[
			{ repositoryName: "bible-on-site-api", nextToken: undefined },
			{ repositoryName: "bible-on-site-api", nextToken: "page-2" },
			{ repositoryName: "bible-on-site-api", nextToken: "page-3" },
		],
	);
});

test("an empty page still follows its pagination token", async () => {
	const { client } = paginatedClient([
		{ $metadata: {}, nextToken: "page-2" },
		{ $metadata: {}, imageDetails: [{ imageTags: ["v0.1.0"] }] },
	]);
	assert.deepEqual(await getRemoteImageTags(client, "bible-on-site-admin"), [
		"v0.1.0",
	]);
});

test("a repository with no canonical release tags has no remote version", async () => {
	for (const imageDetails of [
		undefined,
		[],
		[{ imageTags: ["latest", "deps-cache", "v1.0.0-arm64"] }],
	]) {
		const { client } = paginatedClient([{ $metadata: {}, imageDetails }]);
		assert.deepEqual(await getRemoteImageTags(client, "bible-on-site"), []);
	}
});

test("a missing repository stays empty, while denied image lookups fail", async () => {
	for (const name of ["RepositoryNotFoundException", "AccessDeniedException"]) {
		const error = Object.assign(new Error(name), { name });
		const client = {
			send: async () => {
				throw error;
			},
		} as unknown as ECRClient;
		if (name === "RepositoryNotFoundException") {
			assert.deepEqual(await getRemoteImageTags(client, "bible-on-site"), []);
		} else {
			await assert.rejects(getRemoteImageTags(client, "bible-on-site"), error);
		}
	}
});

class VersionCheckedDeployment extends ECRDeployerBase {
	protected async getLocalVersion() {
		return "0.2.433";
	}
	protected async getDockerImageTag(): Promise<string> {
		throw new Error("Version check must not build an image");
	}
	protected async getDockerImageArchivePath(): Promise<string> {
		throw new Error("Version check must not read an image archive");
	}
	async checkVersion() {
		await this.deployPreConditions();
	}
}

test("cache and architecture tags cannot hide a newer published release from the deployer", async () => {
	const { client } = paginatedClient([
		{
			$metadata: {},
			imageDetails: [
				{ imageTags: ["deps-cache", "v0.2.433", "v99.0.0-arm64"] },
			],
			nextToken: "page-2",
		},
		{
			$metadata: {},
			imageDetails: [{ imageTags: ["v0.2.434", "v0.2.434-amd64"] }],
		},
	]);
	const deployer = new VersionCheckedDeployment(
		"website",
		"bible-on-site",
		"bible-on-site",
		client,
		{ region: "il-central-1", accountId: "test", useEnvCredentials: true },
	);
	await assert.rejects(deployer.checkVersion(), /Local version is not newer/);
});
