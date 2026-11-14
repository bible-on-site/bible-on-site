import assert from "node:assert/strict";
import test from "node:test";
import {
	contributionScopePlan,
	contributionReviewerPlan,
	configureContributions,
} from "./contribution-config.mjs";

const subject = "00000000-0000-4000-8000-000000000001";
const arn =
	"arn:aws:ecs:il-central-1:250598594267:task-definition/bible-on-site-admin:10";
const client = {
	UserPoolId: "pool",
	ClientId: "client",
	ClientName: "admin-service-m2m",
	ClientSecret: "fixture-secret",
	CreationDate: "date",
	LastModifiedDate: "date",
	AllowedOAuthFlows: ["client_credentials"],
	AllowedOAuthFlowsUserPoolClient: true,
	AllowedOAuthScopes: ["admin-api/service"],
	AccessTokenValidity: 7,
	TokenValidityUnits: { AccessToken: "minutes" },
	EnableTokenRevocation: true,
	PreventUserExistenceErrors: "ENABLED",
};
const clientSkeleton = Object.fromEntries(
	Object.keys(client)
		.filter(
			(key) =>
				!["ClientSecret", "CreationDate", "LastModifiedDate"].includes(key),
		)
		.map((key) => [key, null]),
);
const resource = {
	UserPoolId: "pool",
	Identifier: "admin-api",
	Name: "AdminAPI",
	Scopes: [
		{ ScopeName: "service", ScopeDescription: "Existing service scope" },
	],
};
const definition = {
	taskDefinitionArn: arn,
	family: "bible-on-site-admin",
	revision: 10,
	status: "ACTIVE",
	requiresAttributes: [],
	compatibilities: ["FARGATE"],
	registeredAt: "date",
	registeredBy: "principal",
	networkMode: "awsvpc",
	cpu: "256",
	memory: "512",
	taskRoleArn: "existing-role",
	executionRoleArn: "existing-execution-role",
	containerDefinitions: [
		{
			name: "admin",
			image: "registry/admin:latest",
			environment: [
				{ name: "EXISTING", value: "preserved" },
				{ name: "COGNITO_USER_POOL_ID", value: "pool" },
				{ name: "COGNITO_SERVICE_CLIENT_ID", value: "client" },
			],
			secrets: [{ name: "DB_URL", valueFrom: "existing-secret-arn" }],
			portMappings: [{ containerPort: 3000 }],
		},
	],
};
const taskSkeleton = Object.fromEntries(
	[
		"family",
		"networkMode",
		"cpu",
		"memory",
		"taskRoleArn",
		"executionRoleArn",
		"containerDefinitions",
		"tags",
	].map((key) => [key, null]),
);
const stable = {
	serviceName: "bible-on-site-admin",
	taskDefinition: arn,
	deployments: [{}],
	pendingCount: 0,
	runningCount: 1,
	desiredCount: 1,
};
function awsFixture(overrides = {}) {
	const calls = [];
	const call = async (args, payload) => {
		calls.push({ args, payload });
		if (overrides[args[1]])
			return typeof overrides[args[1]] === "function"
				? overrides[args[1]](args, payload)
				: overrides[args[1]];
		switch (args[1]) {
			case "get-caller-identity":
				return { Account: "250598594267" };
			case "describe-services":
				return { services: [structuredClone(stable)] };
			case "describe-task-definition":
				return { taskDefinition: structuredClone(definition), tags: [] };
			case "describe-user-pool":
				return {
					UserPool: {
						Name: "bible-on-site-admin",
						Arn: "arn:aws:cognito-idp:il-central-1:250598594267:userpool/pool",
					},
				};
			case "list-users":
				return {
					Users: [
						{ Enabled: true, Attributes: [{ Name: "sub", Value: subject }] },
					],
				};
			case "describe-user-pool-client":
				return { UserPoolClient: structuredClone(client) };
			case "describe-resource-server":
				return { ResourceServer: structuredClone(resource) };
			case "update-user-pool-client":
				return args.includes("--generate-cli-skeleton") ? clientSkeleton : {};
			case "register-task-definition":
				return args.includes("--generate-cli-skeleton")
					? taskSkeleton
					: {
							taskDefinition: { taskDefinitionArn: arn.replace(":10", ":11") },
						};
			case "list-tasks":
				return { taskArns: ["task"] };
			case "describe-tasks":
				return {
					tasks: [
						{
							taskDefinitionArn: arn,
							containers: [
								{
									name: "admin",
									image: "registry/admin:latest",
									imageDigest: `sha256:${"a".repeat(64)}`,
								},
							],
						},
					],
				};
			default:
				return {};
		}
	};
	return { call, calls };
}
const mutations = (calls) =>
	calls.filter((item) => item.payload || item.args[1] === "update-service");

test("appends the worker scope without resetting existing Cognito settings or retaining a secret", () => {
	const original = structuredClone(client),
		plan = contributionScopePlan(client, resource, clientSkeleton);
	assert.deepEqual(client, original);
	assert.deepEqual(plan.clientAfter.AllowedOAuthScopes, [
		"admin-api/service",
		"admin-api/contributions",
	]);
	assert.equal(plan.clientAfter.AccessTokenValidity, 7);
	assert.equal(plan.clientAfter.EnableTokenRevocation, true);
	assert.deepEqual(plan.resourceAfter.Scopes[0], resource.Scopes[0]);
	assert.ok(!JSON.stringify(plan).includes("fixture-secret"));
	const repeated = contributionScopePlan(
		plan.clientAfter,
		plan.resourceAfter,
		clientSkeleton,
	);
	assert.equal(repeated.clientChanged, false);
	assert.equal(repeated.resourceChanged, false);
});
test("rejects unfamiliar client settings or authorization contracts rather than silently resetting them", () => {
	assert.throws(
		() =>
			contributionScopePlan(
				{ ...client, NewAwsSetting: true },
				resource,
				clientSkeleton,
			),
		/Unrecognized/,
	);
	assert.throws(
		() =>
			contributionScopePlan(
				{ ...client, AllowedOAuthFlows: ["code"] },
				resource,
				clientSkeleton,
			),
		/contract/,
	);
	assert.throws(
		() =>
			contributionScopePlan(
				client,
				{ ...resource, Identifier: "other" },
				clientSkeleton,
			),
		/contract/,
	);
});
test("binds only the reviewer environment variable while preserving task resources, secrets and tags", () => {
	const plan = contributionReviewerPlan(definition, taskSkeleton, subject, [
		{ key: "owner", value: "existing" },
		{ key: "aws:system", value: "computed" },
	]);
	const expected = structuredClone(plan.before);
	expected.containerDefinitions[0].environment.push({
		name: "TANAHPEDIA_DORADSOFT_SUB",
		value: subject,
	});
	assert.deepEqual(plan.after, expected);
	assert.deepEqual(plan.after.tags, [{ key: "owner", value: "existing" }]);
	assert.equal(plan.previousTaskDefinition, arn);
	assert.equal(
		Object.hasOwn(
			contributionReviewerPlan(definition, taskSkeleton, subject).after,
			"tags",
		),
		false,
	);
	assert.equal(
		contributionReviewerPlan(
			{ ...definition, containerDefinitions: plan.after.containerDefinitions },
			taskSkeleton,
			subject,
		).changed,
		false,
	);
	assert.throws(
		() =>
			contributionReviewerPlan(
				{ ...definition, newAwsSetting: true },
				taskSkeleton,
				subject,
			),
		/Unrecognized/,
	);
	assert.throws(
		() => contributionReviewerPlan(definition, taskSkeleton, "invalid"),
		/Unexpected/,
	);
	assert.throws(
		() =>
			contributionReviewerPlan(
				{ ...definition, containerDefinitions: [] },
				taskSkeleton,
				subject,
			),
		/container/,
	);
});
test("plans against verified live identities without mutating AWS", async () => {
	const fixture = awsFixture();
	let receipt;
	const result = await configureContributions({
		subject,
		...fixture,
		record: (value) => {
			receipt = value;
		},
	});
	assert.equal(result.mode, "plan");
	assert.equal(result.reviewerBindingChange, true);
	assert.equal(mutations(fixture.calls).length, 0);
	assert.match(receipt.images[0].digest, /^sha256:/);
	assert.ok(!JSON.stringify(receipt).includes("fixture-secret"));
});
test("records rollback before any write and applies scope before reviewer rollout", async () => {
	const fixture = awsFixture();
	let recorded = false;
	const call = async (args, payload) => {
		if (payload || args[1] === "update-service") assert.ok(recorded);
		return fixture.call(args, payload);
	};
	const result = await configureContributions({
		subject,
		apply: true,
		call,
		record: () => {
			recorded = true;
		},
	});
	assert.equal(result.rolloutStarted, true);
	assert.deepEqual(
		mutations(fixture.calls).map((item) => item.args[1]),
		[
			"update-resource-server",
			"update-user-pool-client",
			"register-task-definition",
			"update-service",
		],
	);
	await assert.rejects(
		configureContributions({ subject, apply: true, ...awsFixture() }),
		/receipt/,
	);
	const failedReceipt = awsFixture();
	await assert.rejects(
		configureContributions({
			subject,
			apply: true,
			...failedReceipt,
			record: () => {
				throw new Error("disk unavailable");
			},
		}),
		/disk unavailable/,
	);
	assert.equal(mutations(failedReceipt.calls).length, 0);
});
test("rejects wrong accounts, users, unstable deployments and missing rollback digests before writes", async () => {
	for (const overrides of [
		{ "get-caller-identity": { Account: "other" } },
		{ "list-users": { Users: [] } },
		{ "describe-user-pool": { UserPool: { Name: "other" } } },
		{
			"describe-services": { services: [{ ...stable, deployments: [{}, {}] }] },
		},
		{
			"describe-tasks": {
				tasks: [{ taskDefinitionArn: arn, containers: [{ name: "admin" }] }],
			},
		},
	]) {
		const fixture = awsFixture(overrides);
		await assert.rejects(
			configureContributions({
				subject,
				apply: true,
				...fixture,
				record: () => {},
			}),
		);
		assert.equal(mutations(fixture.calls).length, 0);
	}
});
test("does not overwrite a deployment that changes while configuration is being planned", async () => {
	let reads = 0;
	const fixture = awsFixture({
		"describe-services": () => ({
			services: [
				{
					...stable,
					taskDefinition: ++reads === 1 ? arn : arn.replace(":10", ":12"),
				},
			],
		}),
	});
	await assert.rejects(
		configureContributions({
			subject,
			apply: true,
			...fixture,
			record: () => {},
		}),
		/changed while planning/,
	);
	assert.equal(mutations(fixture.calls).length, 0);
});
