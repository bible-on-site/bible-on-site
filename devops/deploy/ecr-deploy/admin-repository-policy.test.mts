import assert from "node:assert/strict";
import { type TestContext, test } from "node:test";
import {
	DescribeRepositoriesCommand,
	type ECRClient,
	PutImageTagMutabilityCommand,
} from "@aws-sdk/client-ecr";
import {
	GetCallerIdentityCommand,
	type GetCallerIdentityCommandOutput,
	STSClient,
} from "@aws-sdk/client-sts";
import {
	ADMIN_PRIOR_POLICY,
	ADMIN_REPOSITORY_NAME,
	ADMIN_TARGET_POLICY,
	assertExpectedCallerIdentity,
	describeRepositoryTagPolicy,
	EXPECTED_ACCOUNT_ID,
	EXPECTED_REGION,
	formatTagPolicy,
	planPolicyTransition,
	type RepositoryTagPolicy,
	repairAdminRepositoryPolicy,
	rollbackAdminRepositoryPolicy,
	sameTagPolicy,
} from "./admin-repository-policy.mts";
import { createECRClient, getECRConfig } from "./ecr-client.mts";

type PutInput = {
	registryId?: string;
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
		region?: string;
	} = {},
) {
	const calls: PutInput[] = [];
	let describes = 0;
	const state = { policy: initial };
	const client = {
		config: {
			region: async () => options.region ?? EXPECTED_REGION,
			credentials: async () => ({
				accessKeyId: "test-access-key",
				secretAccessKey: "test-secret-key",
			}),
		},
		send: async (command: unknown) => {
			if (command instanceof DescribeRepositoriesCommand) {
				describes += 1;
				assert.equal(command.input.registryId, EXPECTED_ACCOUNT_ID);
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
							registryId: EXPECTED_ACCOUNT_ID,
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
				assert.equal(command.input.registryId, EXPECTED_ACCOUNT_ID);
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
					registryId: EXPECTED_ACCOUNT_ID,
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

function stubCallerIdentity(
	t: TestContext,
	output: () => Promise<Partial<GetCallerIdentityCommandOutput>>,
) {
	return t.mock.method(
		STSClient.prototype,
		"send",
		output as unknown as STSClient["send"],
	);
}

/** STS proves the approved caller; every mutating-path test needs this stub. */
function approveCaller(t: TestContext) {
	return stubCallerIdentity(t, async () => ({
		Account: EXPECTED_ACCOUNT_ID,
		$metadata: {},
	}));
}

const DEPLOY_ENV_KEYS = [
	"AWS_REGION",
	"AWS_ACCOUNT_ID",
	"AWS_PROFILE",
	"AWS_ACCESS_KEY_ID",
	"AWS_SECRET_ACCESS_KEY",
	"AWS_SESSION_TOKEN",
	"CI",
] as const;

function stubEnvironment(
	t: TestContext,
	vars: Partial<Record<(typeof DEPLOY_ENV_KEYS)[number], string>>,
): void {
	const saved = new Map<string, string | undefined>();
	for (const key of DEPLOY_ENV_KEYS) {
		saved.set(key, process.env[key]);
		const value = vars[key];
		if (value === undefined) {
			delete process.env[key];
		} else {
			process.env[key] = value;
		}
	}
	t.after(() => {
		for (const [key, value] of saved) {
			if (value === undefined) {
				delete process.env[key];
			} else {
				process.env[key] = value;
			}
		}
	});
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
						registryId: EXPECTED_ACCOUNT_ID,
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

test("describeRepositoryTagPolicy refuses a repository outside the approved registry", async () => {
	const client = {
		send: async (command: unknown) => {
			assert.ok(command instanceof DescribeRepositoriesCommand);
			return {
				repositories: [
					{
						registryId: "111111111111",
						repositoryName: ADMIN_REPOSITORY_NAME,
						imageTagMutability: "MUTABLE",
					},
				],
			};
		},
	} as unknown as ECRClient;
	await assert.rejects(
		describeRepositoryTagPolicy(client, ADMIN_REPOSITORY_NAME),
		/approved registry/,
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

test("assertExpectedCallerIdentity proves the caller through STS", async (t) => {
	const { client } = registryClient(ADMIN_PRIOR_POLICY);
	const send = approveCaller(t);
	await assertExpectedCallerIdentity(client);
	assert.equal(send.mock.callCount(), 1);
	assert.ok(
		send.mock.calls[0].arguments[0] instanceof GetCallerIdentityCommand,
	);
});

test("assertExpectedCallerIdentity rejects a caller outside the approved account", async (t) => {
	const { client } = registryClient(ADMIN_PRIOR_POLICY);
	stubCallerIdentity(t, async () => ({
		Account: "111111111111",
		$metadata: {},
	}));
	await assert.rejects(
		assertExpectedCallerIdentity(client),
		/approved account/,
	);
});

test("assertExpectedCallerIdentity rejects a client outside the approved region before STS", async (t) => {
	const { client } = registryClient(ADMIN_PRIOR_POLICY, {
		region: "us-east-1",
	});
	const send = approveCaller(t);
	await assert.rejects(
		assertExpectedCallerIdentity(client),
		/il-central-1/,
	);
	assert.equal(send.mock.callCount(), 0);
});

test("assertExpectedCallerIdentity consults STS even when AWS_ACCOUNT_ID is set", async (t) => {
	// The env hint claims the approved account while the real caller is not:
	// only the STS answer may decide, so this must fail closed.
	stubEnvironment(t, {
		AWS_REGION: EXPECTED_REGION,
		AWS_ACCOUNT_ID: EXPECTED_ACCOUNT_ID,
		AWS_ACCESS_KEY_ID: "test-access-key",
		AWS_SECRET_ACCESS_KEY: "test-secret-key",
		CI: "true",
	});
	const config = await getECRConfig();
	const client = createECRClient(config);
	stubCallerIdentity(t, async () => ({
		Account: "111111111111",
		$metadata: {},
	}));
	await assert.rejects(
		assertExpectedCallerIdentity(client),
		/approved account/,
	);
});

test("assertExpectedCallerIdentity ignores an AWS_ACCOUNT_ID that disagrees with STS", async (t) => {
	// The env hint names another account, but the credentials really resolve
	// to the approved caller: the env value is never consulted for targeting.
	stubEnvironment(t, {
		AWS_REGION: EXPECTED_REGION,
		AWS_ACCOUNT_ID: "111111111111",
		AWS_ACCESS_KEY_ID: "test-access-key",
		AWS_SECRET_ACCESS_KEY: "test-secret-key",
		CI: "true",
	});
	const config = await getECRConfig();
	const client = createECRClient(config);
	approveCaller(t);
	await assertExpectedCallerIdentity(client);
});

test("repair writes the publisher contract to the admin repository only", async (t) => {
	approveCaller(t);
	const { client, calls } = registryClient(ADMIN_PRIOR_POLICY);
	const result = await repairAdminRepositoryPolicy(client);
	assert.equal(result.action, "applied");
	assert.deepEqual(result.policy, ADMIN_TARGET_POLICY);
	assert.equal(calls.length, 1);
	assert.deepEqual(calls[0], {
		registryId: EXPECTED_ACCOUNT_ID,
		repositoryName: "bible-on-site-admin",
		imageTagMutability: "IMMUTABLE_WITH_EXCLUSION",
		imageTagMutabilityExclusionFilters: [
			{ filterType: "WILDCARD", filter: "latest" },
		],
	});
});

test("repair is a no-op once the target is already live", async (t) => {
	approveCaller(t);
	const registry = registryClient(ADMIN_TARGET_POLICY);
	const result = await repairAdminRepositoryPolicy(registry.client);
	assert.equal(result.action, "converged");
	assert.deepEqual(result.policy, ADMIN_TARGET_POLICY);
	assert.equal(registry.calls.length, 0);
	// Initial describe, plus the publisher-guard re-verification.
	assert.ok(registry.describes >= 2);
});

test("repair refuses an unexpected live policy without writing", async (t) => {
	approveCaller(t);
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

test("repair propagates a denied policy write", async (t) => {
	approveCaller(t);
	const { client, calls } = registryClient(ADMIN_PRIOR_POLICY, {
		putFails: true,
	});
	await assert.rejects(repairAdminRepositoryPolicy(client), /Access denied/);
	assert.equal(calls.length, 1);
});

test("repair fails when the live read-back does not match the target", async (t) => {
	approveCaller(t);
	const { client } = registryClient(ADMIN_PRIOR_POLICY, {
		postPutPolicy: ADMIN_PRIOR_POLICY,
	});
	await assert.rejects(
		repairAdminRepositoryPolicy(client),
		/Post-change verification failed/,
	);
});

test("repair distrusts a receipt naming another repository", async (t) => {
	approveCaller(t);
	const { client } = registryClient(ADMIN_PRIOR_POLICY, {
		receiptRepositoryName: "bible-on-site-api",
	});
	await assert.rejects(
		repairAdminRepositoryPolicy(client),
		/receipt does not match/,
	);
});

test("repair performs zero ECR calls for a caller outside the approved account", async (t) => {
	const registry = registryClient(ADMIN_PRIOR_POLICY);
	stubCallerIdentity(t, async () => ({
		Account: "111111111111",
		$metadata: {},
	}));
	await assert.rejects(
		repairAdminRepositoryPolicy(registry.client),
		/approved account/,
	);
	assert.equal(registry.calls.length, 0);
	assert.equal(registry.describes, 0);
});

test("repair performs zero ECR calls for a client outside the approved region", async (t) => {
	const registry = registryClient(ADMIN_PRIOR_POLICY, {
		region: "us-east-1",
	});
	const send = approveCaller(t);
	await assert.rejects(
		repairAdminRepositoryPolicy(registry.client),
		/il-central-1/,
	);
	assert.equal(send.mock.callCount(), 0);
	assert.equal(registry.calls.length, 0);
	assert.equal(registry.describes, 0);
});

test("repair performs zero ECR calls when STS identity cannot be proven", async (t) => {
	const registry = registryClient(ADMIN_PRIOR_POLICY);
	stubCallerIdentity(t, async () => {
		throw new Error("SSO token expired");
	});
	await assert.rejects(
		repairAdminRepositoryPolicy(registry.client),
		/SSO token expired/,
	);
	assert.equal(registry.calls.length, 0);
	assert.equal(registry.describes, 0);
});

test("rollback restores the recorded prior policy", async (t) => {
	approveCaller(t);
	const { client, calls } = registryClient(ADMIN_TARGET_POLICY);
	const result = await rollbackAdminRepositoryPolicy(client);
	assert.equal(result.action, "applied");
	assert.deepEqual(result.policy, ADMIN_PRIOR_POLICY);
	assert.equal(calls.length, 1);
	assert.equal(calls[0].registryId, EXPECTED_ACCOUNT_ID);
	assert.equal(calls[0].repositoryName, "bible-on-site-admin");
	assert.equal(calls[0].imageTagMutability, "MUTABLE");
	// A MUTABLE repository must not carry exclusion filters.
	assert.equal(
		"imageTagMutabilityExclusionFilters" in calls[0],
		false,
	);
});

test("rollback is a no-op from the recorded prior policy", async (t) => {
	approveCaller(t);
	const { client, calls } = registryClient(ADMIN_PRIOR_POLICY);
	const result = await rollbackAdminRepositoryPolicy(client);
	assert.equal(result.action, "converged");
	assert.equal(calls.length, 0);
});

test("rollback refuses an unexpected live policy without writing", async (t) => {
	approveCaller(t);
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

test("rollback performs zero ECR calls for a caller outside the approved account", async (t) => {
	const registry = registryClient(ADMIN_TARGET_POLICY);
	stubCallerIdentity(t, async () => ({
		Account: "111111111111",
		$metadata: {},
	}));
	await assert.rejects(
		rollbackAdminRepositoryPolicy(registry.client),
		/approved account/,
	);
	assert.equal(registry.calls.length, 0);
	assert.equal(registry.describes, 0);
});

test("rollback performs zero ECR calls for a client outside the approved region", async (t) => {
	const registry = registryClient(ADMIN_TARGET_POLICY, {
		region: "us-east-1",
	});
	const send = approveCaller(t);
	await assert.rejects(
		rollbackAdminRepositoryPolicy(registry.client),
		/il-central-1/,
	);
	assert.equal(send.mock.callCount(), 0);
	assert.equal(registry.calls.length, 0);
	assert.equal(registry.describes, 0);
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
