import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import stableStringify from "fast-json-stable-stringify";
import { APIRolloutAWS, createAWSCaller } from "./api-rollout-aws.mjs";
import {
	definition,
	fixture,
	service,
	sha,
	task,
} from "./api-rollout-fixtures.test.mjs";
import {
	ARN,
	IMAGE_URI,
	privateIP,
	SERVICE_ARN,
} from "./api-rollout-state.mjs";
import { API_ACCOUNT, API_REGION } from "./api-task-protection.mjs";

function completionFixture() {
	const base = definition(),
		images = fixture().backend.newImages;
	const image = { root: images.root, child: images.children.amd64 };
	const next = task(base, image.root, "b");
	next.startedBy = "ecs-svc/22";
	const current = service(base),
		epoch = Date.parse("2026-11-01T00:00:00Z");
	current.deployments = [
		{
			id: "ecs-svc/22",
			status: "PRIMARY",
			createdAt: new Date(epoch),
			taskDefinition: base.taskDefinitionArn,
			rolloutState: "IN_PROGRESS",
			failedTasks: 0,
		},
	];
	const state = {
		service: current,
		tasks: [next],
		active: [next.taskArn],
		instances: [
			{
				id: next.taskArn.split("/").at(-1),
				ip: privateIP(next),
				health: "HEALTHY",
			},
		],
	};
	const revisionArn =
		ARN + "service-revision/bible-on-site-cluster/bible-on-site-api/22";
	const deploymentArn =
		ARN + "service-deployment/bible-on-site-cluster/bible-on-site-api/owned";
	const deployment = {
		serviceDeploymentArn: deploymentArn,
		serviceArn: SERVICE_ARN,
		clusterArn: ARN + "cluster/bible-on-site-cluster",
		status: "SUCCESSFUL",
		startedAt: new Date(epoch),
		finishedAt: new Date(epoch + 115000),
		deploymentConfiguration: structuredClone(current.deploymentConfiguration),
		deploymentCircuitBreaker: {
			status: "MONITORING_COMPLETE",
			failureCount: 0,
		},
		targetServiceRevision: {
			arn: revisionArn,
			requestedTaskCount: 1,
			runningTaskCount: 1,
			pendingTaskCount: 0,
		},
		sourceServiceRevisions: [
			{
				arn: revisionArn.replace(/22$/, "11"),
				requestedTaskCount: 0,
				runningTaskCount: 0,
				pendingTaskCount: 0,
			},
		],
	};
	const revision = {
		serviceRevisionArn: revisionArn,
		serviceArn: SERVICE_ARN,
		clusterArn: ARN + "cluster/bible-on-site-cluster",
		taskDefinition: base.taskDefinitionArn,
		containerImages: [{ containerName: "api", imageDigest: image.root }],
	};
	const responses = {
		ListServiceDeployments: {
			serviceDeployments: [{ serviceDeploymentArn: deploymentArn }],
		},
		DescribeServiceDeployments: {
			serviceDeployments: [deployment],
			failures: [],
			$clock: { serverDate: new Date(epoch + 116000).toUTCString() },
		},
		DescribeServiceRevisions: { serviceRevisions: [revision], failures: [] },
	};
	const calls = [],
		records = [];
	const aws = new APIRolloutAWS({
		call: async (name, input) => {
			calls.push({ name, input });
			return structuredClone(responses[name]);
		},
		record: (name, value) => records.push({ name, value }),
	});
	return {
		aws,
		state,
		next,
		image,
		deployment,
		revision,
		responses,
		calls,
		records,
		epoch,
	};
}

test("completion binds successful history to the current task, native image and retired source", async () => {
	const f = completionFixture();
	assert.equal(await f.aws.completion(f.state, f.next, f.image), true);
	assert.equal(await f.aws.completion(f.state, f.next, f.image), true);
	assert.equal(f.records.length, 1);
	assert.equal(f.records[0].name, "deployment-completed-proof");
	assert.equal(f.state.service.deployments[0].rolloutState, "IN_PROGRESS");
	f.revision.containerImages[0].imageDigest = f.image.child;
	assert.equal(await f.aws.completion(f.state, f.next, f.image), true);
	f.state.service.deployments = service().deployments;
	f.calls.length = 0;
	assert.equal(await f.aws.completion(f.state, f.next, f.image), true);
	assert.deepEqual(f.calls, []);
});

test("actual SDK completion serializes the bounded history lookup and deserializes its timestamps", async () => {
	const f = completionFixture(),
		operations = [];
	const caller = createAWSCaller(
		{ accountId: API_ACCOUNT, region: API_REGION },
		{
			credentials: {
				accessKeyId: "TESTACCESSKEY",
				secretAccessKey: "test-secret",
			},
			requestHandler: {
				async handle(request) {
					const name = request.headers["x-amz-target"].split(".").at(-1),
						input = JSON.parse(
							typeof request.body === "string"
								? request.body
								: new TextDecoder().decode(request.body),
						);
					operations.push(name);
					if (name === "ListServiceDeployments")
						assert.deepEqual(input, {
							cluster: "bible-on-site-cluster",
							service: "bible-on-site-api",
							maxResults: 100,
							createdAt: { after: (f.epoch - 1000) / 1000 },
						});
					const payload = structuredClone(f.responses[name]);
					delete payload.$clock;
					for (const row of payload.serviceDeployments ?? [])
						for (const key of ["startedAt", "finishedAt"])
							if (row[key] instanceof Date)
								row[key] = row[key].getTime() / 1000;
					return {
						response: {
							statusCode: 200,
							headers: {
								"content-type": "application/x-amz-json-1.1",
								date: f.responses.DescribeServiceDeployments.$clock.serverDate,
							},
							body: Readable.from([stableStringify(payload)]),
						},
					};
				},
			},
		},
	);
	try {
		const aws = new APIRolloutAWS({ call: caller.call });
		assert.equal(await aws.completion(f.state, f.next, f.image), true);
		assert.deepEqual(operations, [
			"ListServiceDeployments",
			"DescribeServiceDeployments",
			"DescribeServiceRevisions",
		]);
	} finally {
		caller.close();
	}
});

for (const [label, mutate] of [
	[
		"running source",
		(f) => {
			f.state.service.runningCount = 2;
		},
	],
	[
		"pending target",
		(f) => {
			f.state.service.pendingCount = 1;
		},
	],
	[
		"another active task",
		(f) => {
			f.state.active.push("another");
		},
	],
	[
		"unhealthy target",
		(f) => {
			f.next.healthStatus = "UNHEALTHY";
		},
	],
	[
		"old DNS membership",
		(f) => {
			f.state.instances.push({ ...f.state.instances[0], id: "old" });
		},
	],
	[
		"history not visible",
		(f) => {
			f.responses.ListServiceDeployments.serviceDeployments = [];
		},
	],
	[
		"pending history",
		(f) => {
			f.deployment.status = "PENDING";
		},
	],
	[
		"running history",
		(f) => {
			f.deployment.status = "IN_PROGRESS";
		},
	],
	[
		"lagging live definition",
		(f) => {
			f.next.taskDefinitionArn = f.next.taskDefinitionArn.replace(/9$/, "8");
		},
	],
	[
		"lagging primary revision",
		(f) => {
			f.next.startedBy = "ecs-svc/33";
		},
	],
	[
		"lagging primary definition",
		(f) => {
			f.state.service.deployments[0].taskDefinition += "1";
		},
	],
])
	test(`completion waits for ${label}`, async () => {
		const f = completionFixture();
		mutate(f);
		assert.equal(await f.aws.completion(f.state, f.next, f.image), false);
	});

for (const [label, mutate] of [
	[
		"foreign service",
		(f) => {
			f.state.service.serviceArn += "-foreign";
		},
	],
	[
		"wrong live image",
		(f) => {
			f.next.containers[0].imageDigest = sha("foreign");
		},
	],
	[
		"missing primary",
		(f) => {
			f.state.service.deployments[0].status = "ACTIVE";
		},
	],
	[
		"missing creation clock",
		(f) => {
			delete f.state.service.deployments[0].createdAt;
		},
	],
	[
		"paginated history",
		(f) => {
			f.responses.ListServiceDeployments.nextToken = "more";
		},
	],
	[
		"ambiguous history",
		(f) => {
			f.responses.ListServiceDeployments.serviceDeployments.push(
				f.responses.ListServiceDeployments.serviceDeployments[0],
			);
		},
	],
	[
		"foreign deployment ARN",
		(f) => {
			f.responses.ListServiceDeployments.serviceDeployments[0].serviceDeploymentArn +=
				"/foreign";
		},
	],
	[
		"failed describe",
		(f) => {
			f.responses.DescribeServiceDeployments.failures = [{}];
		},
	],
	[
		"wrong history ARN",
		(f) => {
			f.deployment.serviceDeploymentArn += "other";
		},
	],
	[
		"foreign history service",
		(f) => {
			f.deployment.serviceArn += "-foreign";
		},
	],
	[
		"foreign target revision",
		(f) => {
			f.deployment.targetServiceRevision.arn += "1";
		},
	],
	[
		"failed history",
		(f) => {
			f.deployment.status = "FAILED";
		},
	],
	[
		"rollback history",
		(f) => {
			f.deployment.status = "ROLLBACK_SUCCESSFUL";
		},
	],
	[
		"changed settings",
		(f) => {
			f.deployment.deploymentConfiguration.maximumPercent = 300;
		},
	],
	[
		"early success",
		(f) => {
			f.deployment.earlySuccessCriteria = { enabled: true };
		},
	],
	[
		"configured early success",
		(f) => {
			f.deployment.deploymentConfiguration.earlySuccessCriteria = {
				enabled: true,
			};
			f.state.service.deploymentConfiguration.earlySuccessCriteria = {
				enabled: true,
			};
		},
	],
	[
		"unfinished circuit breaker",
		(f) => {
			f.deployment.deploymentCircuitBreaker.status = "MONITORING";
		},
	],
	[
		"circuit breaker failure",
		(f) => {
			f.deployment.deploymentCircuitBreaker.failureCount = 1;
		},
	],
	[
		"future completion",
		(f) => {
			f.deployment.finishedAt = new Date(f.epoch + 200000);
		},
	],
	[
		"missing AWS clock",
		(f) => {
			delete f.responses.DescribeServiceDeployments.$clock;
		},
	],
	[
		"unfinished target",
		(f) => {
			f.deployment.targetServiceRevision.runningTaskCount = 0;
		},
	],
	[
		"source still running",
		(f) => {
			f.deployment.sourceServiceRevisions[0].runningTaskCount = 1;
		},
	],
	[
		"foreign source",
		(f) => {
			f.deployment.sourceServiceRevisions[0].arn += "/foreign";
		},
	],
	[
		"failed revision read",
		(f) => {
			f.responses.DescribeServiceRevisions.failures = [{}];
		},
	],
	[
		"stale revision",
		(f) => {
			f.revision.serviceRevisionArn += "1";
		},
	],
	[
		"foreign revision service",
		(f) => {
			f.revision.serviceArn += "-foreign";
		},
	],
	[
		"wrong revision definition",
		(f) => {
			f.revision.taskDefinition += "1";
		},
	],
	[
		"ambiguous containers",
		(f) => {
			f.revision.containerImages.push(f.revision.containerImages[0]);
		},
	],
	[
		"wrong container",
		(f) => {
			f.revision.containerImages[0].containerName = "other";
		},
	],
	[
		"wrong immutable image",
		(f) => {
			f.revision.containerImages[0].imageDigest = sha("foreign");
		},
	],
])
	test(`completion refuses ${label}`, async () => {
		const f = completionFixture();
		mutate(f);
		await assert.rejects(f.aws.completion(f.state, f.next, f.image));
	});

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
							const input = JSON.parse(
								typeof request.body === "string"
									? request.body
									: new TextDecoder().decode(request.body),
							);
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
