import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { isIP } from "node:net";
import stableStringify from "fast-json-stable-stringify";
import {
	API_ACCOUNT,
	API_CLUSTER,
	API_REGION,
	API_SERVICE,
	assertAPITaskArn,
} from "./api-task-protection.mjs";

export const ARN = `arn:aws:ecs:${API_REGION}:${API_ACCOUNT}:`;
export const SERVICE_ARN = ARN + `service/${API_CLUSTER}/${API_SERVICE}`;
export const IMAGE_URI = `${API_ACCOUNT}.dkr.ecr.${API_REGION}.amazonaws.com/${API_SERVICE}`;
export const DISCOVERY_ID = "srv-mgck3ttvkcu6xa72";
export const NAMESPACE_ID = "ns-pgizqmqykmvclsey";
export const API_RULE = "ecr-push-bible-on-site-api";
export const READY_CHECK = {
	command: [
		"CMD-SHELL",
		"wget -T 2 -qO- http://127.0.0.1:3003/health/ready >/dev/null",
	],
	interval: 5,
	timeout: 3,
	retries: 3,
	startPeriod: 30,
};
export const LIMITS = Object.freeze({
	overall: 300000,
	readiness: 30000,
	completion: 180000,
	cache: 20000,
	poll: 500,
});
const registrationFields = new Set([
	"family",
	"taskRoleArn",
	"executionRoleArn",
	"networkMode",
	"containerDefinitions",
	"volumes",
	"placementConstraints",
	"requiresCompatibilities",
	"cpu",
	"memory",
	"tags",
	"pidMode",
	"ipcMode",
	"proxyConfiguration",
	"inferenceAccelerators",
	"ephemeralStorage",
	"runtimePlatform",
	"enableFaultInjection",
]);
const definitionMetadata = new Set([
	"taskDefinitionArn",
	"revision",
	"status",
	"requiresAttributes",
	"compatibilities",
	"registeredAt",
	"deregisteredAt",
	"registeredBy",
]);
const serviceFields = [
	"serviceArn",
	"serviceName",
	"clusterArn",
	"desiredCount",
	"loadBalancers",
	"serviceRegistries",
	"roleArn",
	"placementConstraints",
	"placementStrategy",
	"launchType",
	"capacityProviderStrategy",
	"platformVersion",
	"platformFamily",
	"networkConfiguration",
	"healthCheckGracePeriodSeconds",
	"schedulingStrategy",
	"deploymentController",
	"deploymentConfiguration",
	"enableECSManagedTags",
	"propagateTags",
	"enableExecuteCommand",
	"availabilityZoneRebalancing",
	"serviceConnectConfiguration",
	"volumeConfigurations",
	"vpcLatticeConfigurations",
	"fargateEphemeralStorage",
];
export function fingerprint(service) {
	return structuredClone(
		Object.fromEntries(
			serviceFields
				.filter((key) => key in service)
				.map((key) => [key, service[key]]),
		),
	);
}
export function definitionArn(value) {
	assert.match(
		value,
		/^arn:aws:ecs:il-central-1:250598594267:task-definition\/bible-on-site-api:[1-9]\d*$/,
	);
	return value;
}
export function digest(value) {
	assert.match(value, /^sha256:[a-f0-9]{64}$/);
	return value;
}
export function assertDefinition(definition) {
	definitionArn(definition.taskDefinitionArn);
	assert.equal(definition.family, API_SERVICE);
	assert.equal(definition.cpu, "256");
	assert.equal(definition.memory, "512");
	assert.equal(definition.networkMode, "awsvpc");
	assert.deepEqual(definition.requiresCompatibilities, ["FARGATE"]);
	assert.equal(definition.containerDefinitions.length, 1);
	assert.equal(definition.containerDefinitions[0].name, "api");
	assert.deepEqual(definition.containerDefinitions[0].healthCheck, READY_CHECK);
	assert.ok(
		["X86_64", "ARM64"].includes(
			definition.runtimePlatform?.cpuArchitecture ?? "X86_64",
		),
	);
	assert.equal(
		definition.runtimePlatform?.operatingSystemFamily ?? "LINUX",
		"LINUX",
	);
	const image = definition.containerDefinitions[0].image;
	if (image !== IMAGE_URI + ":latest") {
		assert.ok(image.startsWith(IMAGE_URI + "@"));
		digest(image.slice(IMAGE_URI.length + 1));
	}
}
export function registration(definition, tags, architecture, image) {
	assertDefinition(definition);
	assert.ok(["X86_64", "ARM64"].includes(architecture));
	const request = {};
	for (const [key, value] of Object.entries(definition)) {
		assert.ok(
			registrationFields.has(key) || definitionMetadata.has(key),
			"Unknown task-definition field; preserve it explicitly before deployment",
		);
		if (registrationFields.has(key) && key !== "tags")
			request[key] = structuredClone(value);
	}
	assert.ok(Array.isArray(tags));
	// ECS rejects an explicit empty list even when the source is untagged.
	if (tags.length > 0)
		request.tags = structuredClone(tags).sort((left, right) =>
			left.key < right.key ? -1 : left.key > right.key ? 1 : 0,
		);
	request.runtimePlatform = {
		...request.runtimePlatform,
		cpuArchitecture: architecture,
		operatingSystemFamily: "LINUX",
	};
	request.containerDefinitions[0].image = image;
	assertDefinition({
		...request,
		taskDefinitionArn: definition.taskDefinitionArn,
	});
	return request;
}
export function registrationHash(request) {
	return createHash("sha256").update(stableStringify(request)).digest("hex");
}
export function assertService(service, stable = false) {
	assert.equal(service.serviceArn, SERVICE_ARN);
	assert.equal(service.serviceName, API_SERVICE);
	assert.equal(service.clusterArn, ARN + "cluster/" + API_CLUSTER);
	assert.equal(service.status, "ACTIVE");
	assert.equal(service.desiredCount, 1);
	assert.equal(service.schedulingStrategy, "REPLICA");
	assert.deepEqual(service.deploymentController ?? { type: "ECS" }, {
		type: "ECS",
	});
	assert.equal(service.deploymentConfiguration.minimumHealthyPercent, 100);
	assert.equal(service.deploymentConfiguration.maximumPercent, 200);
	assert.equal(
		service.deploymentConfiguration.deploymentCircuitBreaker.enable,
		true,
	);
	assert.equal(
		service.deploymentConfiguration.deploymentCircuitBreaker.rollback,
		true,
	);
	assert.equal(
		service.deploymentConfiguration.strategy ?? "ROLLING",
		"ROLLING",
	);
	assert.deepEqual(
		service.serviceRegistries.map((row) => row.registryArn),
		[
			`arn:aws:servicediscovery:${API_REGION}:${API_ACCOUNT}:service/${DISCOVERY_ID}`,
		],
	);
	definitionArn(service.taskDefinition);
	if (stable)
		assert.ok(
			completed(service),
			"API must have one completed healthy deployment before publication",
		);
}
export function completed(service) {
	return (
		service.runningCount === 1 &&
		service.pendingCount === 0 &&
		service.deployments.length === 1 &&
		service.deployments[0].rolloutState === "COMPLETED" &&
		service.deployments[0].taskDefinition === service.taskDefinition
	);
}
export function privateIP(task) {
	const ips = (task.attachments ?? [])
		.filter((row) => row.type === "ElasticNetworkInterface")
		.flatMap((row) =>
			row.details
				.filter((item) => item.name === "privateIPv4Address")
				.map((item) => item.value),
		);
	assert.equal(ips.length, 1);
	assert.equal(isIP(ips[0]), 4);
	assert.match(ips[0], /^172\.31\.\d{1,3}\.\d{1,3}$/);
	return ips[0];
}
export function healthy(task) {
	return (
		task.lastStatus === "RUNNING" &&
		task.healthStatus === "HEALTHY" &&
		task.containers[0].healthStatus === "HEALTHY"
	);
}
export function assertTask(task, definition, image) {
	assertAPITaskArn(task.taskArn);
	assert.equal(task.clusterArn, ARN + "cluster/" + API_CLUSTER);
	assert.equal(task.group, "service:" + API_SERVICE);
	assert.equal(task.taskDefinitionArn, definition.taskDefinitionArn);
	assert.equal(task.cpu, "256");
	assert.equal(task.memory, "512");
	assert.equal(task.launchType, "FARGATE");
	assert.equal(task.containers.length, 1);
	assert.equal(task.containers[0].name, "api");
	assert.equal(
		task.containers[0].image,
		definition.containerDefinitions[0].image,
	);
	assert.ok(
		[image.root, image.child].includes(task.containers[0].imageDigest),
		"Running task is not the verified image",
	);
	if (task.containers[0].image.startsWith(IMAGE_URI + "@"))
		assert.equal(
			task.containers[0].imageDigest,
			task.containers[0].image.slice(IMAGE_URI.length + 1),
			"Pinned task did not run its immutable child",
		);
	const architecture = definition.runtimePlatform?.cpuArchitecture ?? "X86_64";
	assert.deepEqual(
		task.attributes
			.filter((row) => row.name === "ecs.cpu-architecture")
			.map((row) => row.value),
		[architecture === "ARM64" ? "arm64" : "x86_64"],
	);
	assert.equal(image.architecture, architecture);
	privateIP(task);
	return {
		reportedDigest: task.containers[0].imageDigest,
		reportedDigestKind:
			image.root !== image.child &&
			task.containers[0].imageDigest === image.root
				? "index"
				: "native-child",
		derivedNativeChild: image.child,
		actualCPUArchitectures: task.attributes
			.filter((row) => row.name === "ecs.cpu-architecture")
			.map((row) => row.value),
		cpu: task.cpu,
		memory: task.memory,
	};
}
export function ageUpperMs(task, clock) {
	assert.ok(
		task.startedAt instanceof Date && Number.isFinite(task.startedAt.getTime()),
	);
	const server = Date.parse(clock?.serverDate);
	assert.ok(
		Number.isFinite(server) && Number.isFinite(clock?.elapsedMs),
		"Readiness needs the AWS response clock",
	);
	// HTTP Date is whole seconds; include its full uncertainty and RPC duration.
	const age = server + 1000 + clock.elapsedMs - task.startedAt.getTime();
	assert.ok(age >= 0, "Task started beyond the AWS response clock");
	return age;
}
export function discoveryMatches(instances, tasks) {
	const expected = tasks.map((task) => privateIP(task)).sort();
	return (
		instances.length === tasks.length &&
		instances.every((row) => row.health === "HEALTHY") &&
		JSON.stringify(instances.map((row) => row.ip).sort()) ===
			JSON.stringify(expected)
	);
}
