import assert from "node:assert/strict";
import { test } from "node:test";
import {
	DescribeRepositoriesCommand,
	type ECRClient,
	PutImageTagMutabilityCommand,
} from "@aws-sdk/client-ecr";
import {
	ADMIN_PRIOR_POLICY,
	ADMIN_REPOSITORY_NAME,
	ADMIN_TARGET_POLICY,
	describeRepositoryTagPolicy,
	formatTagPolicy,
	planPolicyTransition,
	repairAdminRepositoryPolicy,
	type RepositoryTagPolicy,
	rollbackAdminRepositoryPolicy,
	sameTagPolicy,
} from "./admin-repository-policy.mts";

type PutInput = {
	repositoryName?: string;
	imageTagMutability?: string;
	imageTagMutabilityExclusionFilters?: { filterType?: string; filter?: string }[];
};

function registryClient(
	initial: RepositoryTagPolicy | undefined,
	options: {
		putFails?: boolean;
		postPutPolicy?: RepositoryTagPolicy;
		receiptRepositoryName?: string;
	} = {},
) {
	const calls: PutInput[] = [];
	let describes = 0;
	const state = { policy: initial };
	const client = {
		send: async (command: unknown) => {
			if (command instanceof DescribeRepositoriesCommand) {
				describes += 1;
				assert.deepEqual(command.input.repositoryNames, [
					ADMIN_REPOSITORY_NAME,
				]);
				if (!state.policy)
					throw Object.assign(new Error("Repository is missing"), {
						name: "RepositoryNotFoundException",
					});
				return {
					repositories: [
						{
							repositoryName: ADMIN_REPOSITORY_NAME,
							imageTagMutability: state.policy.mutability,
							imageTagMutabilityExclusionFilters: state.policy.exclusions.map(
								(entry) => ({ ...entry }),
							),
						},
					],
				};
			}
			if (command instanceof PutImageTagMutabilityCommand) {
				calls.push(command.input);
				if (options.putFails) throw new Error("Access denied");
				state.policy = options.postPutPolicy ?? {
					mutability: command.input
						.imageTagMutability as RepositoryTagPolicy["mutability"],
					exclusions: (
						command.input.imageTagMutabilityExclusionFilters ?? []
					).map((entry) => ({
						filterType: entry.filterType ?? "",
						filter: entry.filter ?? "",
					})),
				};
				return {
					repositoryName:
						options.receiptRepositoryName ?? ADMIN_REPOSITORY_NAME,
					imageTagMutability: command.input.imageTagMutability,
				};
			}
			throw new Error("Unexpected ECR command");
		},
	} as unknown as ECRClient;
	return {
		client,
		calls,
		state,
		get describes() {
			return describes;
		},
	};
}

test("sameTagPolicy compares mutability and exclusions as a set", () => {
	const target = {
		mutability: "IMMUTABLE_WITH_EXCLUSION",
		exclusions: [
			{ filterType: "WILDCARD", filter: "latest" },
			{ filterType: "WILDCARD", filter: "deps-cache" },
		],
	} as RepositoryTagPolicy;
	assert.ok(
		sameTagPolicy(target, {
			mutability: "IMMUTABLE_WITH_EXCLUSION",
			exclusions: [
				{ filterType: "WILDCARD", filter: "deps-cache" },
				{ filterType: "WILDCARD", filter: "latest" },
			],
		}),
	);
	assert.ok(!sameTagPolicy(target, ADMIN_TARGET_POLICY));
	assert.ok(
		!sameTagPolicy(target, {
			mutability: "IMMUTABLE",
			exclusions: target.exclusions,
		}),
	);
	assert.ok(
		!sameTagPolicy(target, {
			mutability: target.mutability,
			exclusions: target.exclusions.slice(1),
		}),
	);
});

test("describeRepositoryTagPolicy normalizes the live repository record", async () => {
	const { client } = registryClient({
		mutability: "IMMUTABLE_WITH_EXCLUSION",
		exclusions: [{ filterType: "WILDCARD", filter: "latest" }],
	});
	assert.deepEqual(
		await describeRepositoryTagPolicy(client, ADMIN_REPOSITORY_NAME),
		ADMIN_TARGET_POLICY,
	);
});

test("describeRepositoryTagPolicy treats absent filters as an empty list", async () => {
	const client = {
		send: async (command: unknown) => {
			assert.ok(command instanceof DescribeRepositoriesCommand);
			return {
				repositories: [
					{
						repositoryName: ADMIN_REPOSITORY_NAME,
						imageTagMutability: "MUTABLE",
					},
				],
			};
		},
	} as unknown as ECRClient;
	assert.deepEqual(
		await describeRepositoryTagPolicy(client, ADMIN_REPOSITORY_NAME),
		ADMIN_PRIOR_POLICY,
	);
});

test("describeRepositoryTagPolicy propagates a missing repository", async () => {
	const { client } = registryClient(undefined);
	await assert.rejects(
		describeRepositoryTagPolicy(client, ADMIN_REPOSITORY_NAME),
		(error: Error) => error.name === "RepositoryNotFoundException",
	);
});

test("planPolicyTransition applies from the recorded prior state", () => {
	assert.deepEqual(
		planPolicyTransition(
			ADMIN_PRIOR_POLICY,
			ADMIN_PRIOR_POLICY,
			ADMIN_TARGET_POLICY,
			ADMIN_REPOSITORY_NAME,
		),
		{ action: "apply" },
	);
});

test("planPolicyTransition converges when the target is already live", () => {
	assert.deepEqual(
		planPolicyTransition(
			ADMIN_TARGET_POLICY,
			ADMIN_PRIOR_POLICY,
			ADMIN_TARGET_POLICY,
			ADMIN_REPOSITORY_NAME,
		),
		{ action: "converged" },
	);
	assert.deepEqual(
		planPolicyTransition(
			ADMIN_PRIOR_POLICY,
			ADMIN_TARGET_POLICY,
			ADMIN_PRIOR_POLICY,
			ADMIN_REPOSITORY_NAME,
		),
		{ action: "converged" },
	);
});

test("planPolicyTransition refuses every unexpected live state", () => {
	for (const unexpected of [
		{ mutability: "IMMUTABLE", exclusions: [] },
		{
			mutability: "MUTABLE_WITH_EXCLUSION",
			exclusions: [{ filterType: "WILDCARD", filter: "latest" }],
		},
		{
			mutability: "IMMUTABLE_WITH_EXCLUSION",
			exclusions: [
				{ filterType: "WILDCARD", filter: "latest" },
				{ filterType: "WILDCARD", filter: "deps-cache" },
			],
		},
		{
			mutability: "MUTABLE",
			exclusions: [{ filterType: "WILDCARD", filter: "latest" }],
		},
		{ mutability: undefined, exclusions: [] },
	] as RepositoryTagPolicy[]) {
		assert.throws(
			() =>
				planPolicyTransition(
					unexpected,
					ADMIN_PRIOR_POLICY,
					ADMIN_TARGET_POLICY,
					ADMIN_REPOSITORY_NAME,
				),
			(error: Error) => {
				assert.match(error.message, /Unexpected live tag policy/);
				assert.match(error.message, /bible-on-site-admin/);
				return true;
			},
		);
	}
});

test("repair writes the publisher contract to the admin repository only", async () => {
	const { client, calls } = registryClient(ADMIN_PRIOR_POLICY);
	const result = await repairAdminRepositoryPolicy(client);
	assert.equal(result.action, "applied");
	assert.deepEqual(result.policy, ADMIN_TARGET_POLICY);
	assert.equal(calls.length, 1);
	assert.deepEqual(calls[0], {
		repositoryName: "bible-on-site-admin",
		imageTagMutability: "IMMUTABLE_WITH_EXCLUSION",
		imageTagMutabilityExclusionFilters: [
			{ filterType: "WILDCARD", filter: "latest" },
		],
	});
});

test("repair is a no-op once the target is already live", async () => {
	const registry = registryClient(ADMIN_TARGET_POLICY);
	const result = await repairAdminRepositoryPolicy(registry.client);
	assert.equal(result.action, "converged");
	assert.deepEqual(result.policy, ADMIN_TARGET_POLICY);
	assert.equal(registry.calls.length, 0);
	// Initial describe, plus the publisher-guard re-verification.
	assert.ok(registry.describes >= 2);
});

test("repair refuses an unexpected live policy without writing", async () => {
	const { client, calls } = registryClient({
		mutability: "IMMUTABLE_WITH_EXCLUSION",
		exclusions: [
			{ filterType: "WILDCARD", filter: "latest" },
			{ filterType: "WILDCARD", filter: "deps-cache" },
		],
	});
	await assert.rejects(
		repairAdminRepositoryPolicy(client),
		/Unexpected live tag policy/,
	);
	assert.equal(calls.length, 0);
});

test("repair propagates a denied policy write", async () => {
	const { client, calls } = registryClient(ADMIN_PRIOR_POLICY, {
		putFails: true,
	});
	await assert.rejects(repairAdminRepositoryPolicy(client), /Access denied/);
	assert.equal(calls.length, 1);
});

test("repair fails when the live read-back does not match the target", async () => {
	const { client } = registryClient(ADMIN_PRIOR_POLICY, {
		postPutPolicy: ADMIN_PRIOR_POLICY,
	});
	await assert.rejects(
		repairAdminRepositoryPolicy(client),
		/Post-change verification failed/,
	);
});

test("repair distrusts a receipt naming another repository", async () => {
	const { client } = registryClient(ADMIN_PRIOR_POLICY, {
		receiptRepositoryName: "bible-on-site-api",
	});
	await assert.rejects(
		repairAdminRepositoryPolicy(client),
		/receipt does not match/,
	);
});

test("rollback restores the recorded prior policy", async () => {
	const { client, calls } = registryClient(ADMIN_TARGET_POLICY);
	const result = await rollbackAdminRepositoryPolicy(client);
	assert.equal(result.action, "applied");
	assert.deepEqual(result.policy, ADMIN_PRIOR_POLICY);
	assert.equal(calls.length, 1);
	assert.equal(calls[0].repositoryName, "bible-on-site-admin");
	assert.equal(calls[0].imageTagMutability, "MUTABLE");
	// A MUTABLE repository must not carry exclusion filters.
	assert.equal(
		"imageTagMutabilityExclusionFilters" in calls[0],
		false,
	);
});

test("rollback is a no-op from the recorded prior policy", async () => {
	const { client, calls } = registryClient(ADMIN_PRIOR_POLICY);
	const result = await rollbackAdminRepositoryPolicy(client);
	assert.equal(result.action, "converged");
	assert.equal(calls.length, 0);
});

test("rollback refuses an unexpected live policy without writing", async () => {
	const { client, calls } = registryClient({
		mutability: "IMMUTABLE",
		exclusions: [],
	});
	await assert.rejects(
		rollbackAdminRepositoryPolicy(client),
		/Unexpected live tag policy/,
	);
	assert.equal(calls.length, 0);
});

test("formatTagPolicy renders the mutability and exclusions readably", () => {
	assert.equal(
		formatTagPolicy(ADMIN_TARGET_POLICY),
		"IMMUTABLE_WITH_EXCLUSION with exclusion filters: WILDCARD:latest",
	);
	assert.equal(
		formatTagPolicy(ADMIN_PRIOR_POLICY),
		"MUTABLE with exclusion filters: none",
	);
});
