import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { APIRolloutAWS, createAWSCaller } from "./api-rollout-aws.mjs";
import { API_ACCOUNT, API_REGION } from "./api-task-protection.mjs";
import { IMAGE_URI } from "./api-rollout-state.mjs";
import { definition, fixture, sha } from "./api-rollout-fixtures.test.mjs";

test("actual SDK registration omits empty tags and accepts untagged AWS readbacks", async () => {
	for (const architecture of ["X86_64", "ARM64"]) {
		for (const returnedTags of [undefined, []]) {
			const base = definition(),
				requests = [];
			let registered;
			const caller = createAWSCaller(
				{ accountId: API_ACCOUNT, region: API_REGION },
				{
					credentials: {
						accessKeyId: "TESTACCESSKEY",
						secretAccessKey: "test-secret",
					},
					requestHandler: {
						async handle(request) {
							const input = JSON.parse(request.body);
							const registering = request.headers["x-amz-target"].endsWith(
								".RegisterTaskDefinition",
							);
							requests.push({ registering, input });
							// The live ECS API rejected this exact wire payload before
							// publication: ClientException, "Tags can not be empty."
							const invalid =
								registering &&
								Array.isArray(input.tags) &&
								input.tags.length === 0;
							if (registering && !invalid)
								registered = {
									...input,
									taskDefinitionArn: base.taskDefinitionArn.replace(
										/:\d+$/,
										":99",
									),
								};
							return {
								response: {
									statusCode: invalid ? 400 : 200,
									headers: { "content-type": "application/x-amz-json-1.1" },
									body: Readable.from([
										JSON.stringify(
											invalid
												? {
														__type: "ClientException",
														message: "Tags can not be empty.",
													}
												: {
														taskDefinition: registered,
														...(returnedTags === undefined
															? {}
															: { tags: returnedTags }),
													},
										),
									]),
								},
							};
						},
					},
				},
			);
			try {
				const aws = new APIRolloutAWS({ call: caller.call });
				const result = await aws.register(
					base,
					[],
					architecture,
					IMAGE_URI + ":latest",
				);
				assert.equal(requests.length, 2);
				assert.equal(Object.hasOwn(requests[0].input, "tags"), false);
				assert.deepEqual(
					result.containerDefinitions[0].environment,
					base.containerDefinitions[0].environment,
				);
				assert.equal(result.runtimePlatform.cpuArchitecture, architecture);
				assert.equal(result.cpu, "256");
				assert.equal(result.memory, "512");
			} finally {
				caller.close();
			}
		}
	}
});

test("actual SDK transport captures the AWS HTTP clock and makes one signed request", async () => {
	const requests = [],
		date = "Sun, 01 Nov 2026 00:00:00 GMT";
	const caller = createAWSCaller(
		{ accountId: API_ACCOUNT, region: API_REGION },
		{
			credentials: {
				accessKeyId: "TESTACCESSKEY",
				secretAccessKey: "test-secret",
			},
			requestHandler: {
				async handle(request) {
					requests.push(request);
					return {
						response: {
							statusCode: 200,
							headers: { date, "content-type": "application/x-amz-json-1.1" },
							body: Readable.from([
								JSON.stringify({ services: [], failures: [] }),
							]),
						},
					};
				},
			},
		},
	);
	const result = await caller.call("DescribeServices", {
		cluster: "bible-on-site-cluster",
		services: ["bible-on-site-api"],
	});
	assert.equal(result.$clock.serverDate, date);
	assert.ok(result.$clock.elapsedMs >= 0);
	assert.equal(requests.length, 1);
	assert.equal(requests[0].hostname, "ecs.il-central-1.amazonaws.com");
	assert.equal(JSON.stringify(result).includes("$clock"), false);
	await assert.rejects(
		caller.call("UnknownOperation", {}),
		/Unknown API rollout operation/,
	);
	caller.close();
});

test("SDK failures expose no task payload, response body or chained credential details", async () => {
	let calls = 0;
	const caller = createAWSCaller(
		{
			accountId: API_ACCOUNT,
			region: API_REGION,
			useEnvCredentials: true,
		},
		{
			credentials: {
				accessKeyId: "TESTACCESSKEY",
				secretAccessKey: "test-secret",
			},
			requestHandler: {
				async handle() {
					calls++;
					return {
						response: {
							statusCode: 403,
							headers: { "content-type": "application/x-amz-json-1.1" },
							body: Readable.from([
								JSON.stringify({
									__type: "AccessDeniedException",
									message: "private-response-canary",
								}),
							]),
						},
					};
				},
			},
		},
	);
	await assert.rejects(
		caller.call("DescribeServices", {
			cluster: "bible-on-site-cluster",
			services: ["bible-on-site-api"],
		}),
		(error) => {
			assert.equal(error.name, "AccessDeniedException");
			assert.equal(error.message.includes("private-response-canary"), false);
			assert.equal(error.cause, undefined);
			return true;
		},
	);
	assert.equal(calls, 1);
	caller.close();
	assert.throws(() =>
		createAWSCaller({ accountId: "other", region: API_REGION }),
	);
	assert.throws(() =>
		createAWSCaller({ accountId: API_ACCOUNT, region: "us-east-1" }),
	);
});

for (const [name, operation, result] of [
	["wrong account", "GetCallerIdentity", { Account: "111111111111" }],
	[
		"second rollout owner",
		"DescribeRule",
		{
			Arn: "arn:aws:events:il-central-1:250598594267:rule/ecr-push-bible-on-site-api",
			State: "ENABLED",
		},
	],
	[
		"changed DNS TTL",
		"GetService",
		{
			Service: {
				NamespaceId: "ns-pgizqmqykmvclsey",
				DnsConfig: { DnsRecords: [{ Type: "A", TTL: 60 }] },
			},
		},
	],
	["unexpected tasks", "ListTasks", { taskArns: ["a", "b", "c"] }],
	[
		"unknown discovery page",
		"ListInstances",
		{ Instances: [], NextToken: "more" },
	],
])
	test(name + " fails before publication or runtime writes", async () => {
		const f = fixture();
		f.backend.hook = async (op) => (op === operation ? result : undefined);
		await assert.rejects(f.aws.preflight());
		assert.equal(f.backend.updates, 0);
	});

test("ECR reads tag-selected metadata then verifies immutable bytes, native descriptor and size", async () => {
	const f = fixture();
	f.backend.published = true;
	const image = await f.aws.published("0.1.101", "ARM64");
	assert.equal(image.child, f.backend.newImages.children.arm64);
	assert.deepEqual(
		f.backend.calls
			.filter((row) => row.name === "BatchGetImage")
			.map((row) => row.input.imageIds[0]),
		[{ imageDigest: image.root }, { imageDigest: image.child }],
	);
	const bytes = f.backend.manifests.get(image.root);
	f.backend.manifests.set(image.root, bytes + " ");
	await assert.rejects(f.aws.image(image.root, "ARM64"), /Immutable ECR bytes/);
});

test("native ARM latest cannot silently consume the amd64 manifest; explicit old native pins remain valid", async () => {
	const f = fixture(),
		child = f.backend.oldImages.children.arm64;
	await assert.rejects(
		f.aws.image(child, "ARM64"),
		/requires a verified OCI index/,
	);
	assert.equal((await f.aws.image(child, "ARM64", true)).child, child);
});

test("ambiguous native descriptors and canonical/latest disagreement fail closed", async () => {
	const f = fixture();
	f.backend.published = true;
	const index = JSON.parse(f.backend.manifests.get(f.backend.newImages.root));
	index.manifests.push(index.manifests[1]);
	const bytes = JSON.stringify(index),
		root = sha(bytes);
	f.backend.manifests.set(root, bytes);
	await assert.rejects(
		f.aws.image(root, "ARM64"),
		/one native image descriptor/,
	);
	f.backend.hook = async (name, input) =>
		name === "DescribeImages" && input.imageIds[0].imageTag === "latest"
			? { imageDetails: [{ imageDigest: f.backend.oldImages.root }] }
			: undefined;
	await assert.rejects(
		f.aws.published("0.1.101", "X86_64"),
		/Canonical\/latest/,
	);
});

test("service drift prevents update and registering preserves secrets without logging them", async () => {
	const f = fixture(),
		baseline = await f.aws.preflight();
	const registered = await f.aws.register(
		baseline.definition,
		baseline.tags,
		"ARM64",
		IMAGE_URI + ":latest",
	);
	assert.equal(
		registered.containerDefinitions[0].environment[0].value,
		"must-not-appear-in-journal",
	);
	assert.equal(
		JSON.stringify(f.backend.records).includes("must-not-appear-in-journal"),
		false,
	);
	f.backend.mutateService = (service) => {
		service.networkConfiguration.awsvpcConfiguration.subnets = ["subnet-other"];
	};
	await assert.rejects(
		f.aws.update(registered, baseline.service),
		/settings changed/,
	);
	assert.equal(f.backend.updates, 0);
});

for (const field of ["architecture", "image"])
	test(`registration rejects an actual ${field} that differs from its request`, async () => {
		const f = fixture(),
			baseline = await f.aws.preflight();
		f.backend.hook = async (operation, input) => {
			if (
				operation === "DescribeTaskDefinition" &&
				input.taskDefinition !== baseline.definition.taskDefinitionArn
			) {
				const value = structuredClone(
					f.backend.definitions.get(input.taskDefinition),
				);
				if (field === "architecture")
					value.runtimePlatform.cpuArchitecture = "X86_64";
				else
					value.containerDefinitions[0].image =
						IMAGE_URI + "@" + f.backend.oldImages.children.arm64;
				return { taskDefinition: value, tags: baseline.tags };
			}
		};
		await assert.rejects(
			f.aws.register(
				baseline.definition,
				baseline.tags,
				"ARM64",
				IMAGE_URI + ":latest",
			),
			/differs from preserved request/,
		);
		assert.equal(f.backend.updates, 0);
	});

test("registration readback accepts reordered AWS tags while preserving every value", async () => {
	const f = fixture(),
		baseline = await f.aws.preflight();
	const tags = [
		{ key: "z", value: "last" },
		{ key: "a", value: "first" },
	];
	f.backend.hook = async (operation, input) => {
		if (
			operation === "DescribeTaskDefinition" &&
			input.taskDefinition !== baseline.definition.taskDefinitionArn
		)
			return {
				taskDefinition: structuredClone(
					f.backend.definitions.get(input.taskDefinition),
				),
				tags: [...tags],
			};
	};
	await f.aws.register(
		baseline.definition,
		tags,
		"ARM64",
		IMAGE_URI + ":latest",
	);
	assert.deepEqual(
		tags.map((tag) => tag.key),
		["z", "a"],
	);
	const request = f.backend.calls.find(
		(row) => row.name === "RegisterTaskDefinition",
	).input;
	assert.deepEqual(request.tags, [
		{ key: "a", value: "first" },
		{ key: "z", value: "last" },
	]);
});
