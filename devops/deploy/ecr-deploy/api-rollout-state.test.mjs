import assert from "node:assert/strict";
import test from "node:test";
import { isDeepStrictEqual } from "node:util";
import {
	IMAGE_URI,
	LIMITS,
	ageUpperMs,
	assertDefinition,
	assertService,
	assertTask,
	completed,
	definitionArn as validateArn,
	digest,
	discoveryMatches,
	fingerprint,
	healthy,
	privateIP,
	registration,
	registrationHash,
} from "./api-rollout-state.mjs";
import {
	NOW,
	definition,
	makeImages,
	service,
	task,
} from "./api-rollout-fixtures.test.mjs";

test("registration preserves every existing field, role, environment, log, volume and tag", () => {
	const base = definition(),
		tags = [{ key: "existing", value: "preserve" }],
		copy = structuredClone(base);
	const request = registration(
		base,
		tags,
		"ARM64",
		IMAGE_URI + "@" + "sha256:" + "a".repeat(64),
	);
	assert.equal(request.runtimePlatform.cpuArchitecture, "ARM64");
	assert.deepEqual(request.tags, tags);
	assert.deepEqual(
		request.containerDefinitions[0].environment,
		base.containerDefinitions[0].environment,
	);
	assert.equal(request.taskRoleArn, base.taskRoleArn);
	assert.equal(request.executionRoleArn, base.executionRoleArn);
	for (const key of [
		"volumes",
		"placementConstraints",
		"cpu",
		"memory",
		"requiresCompatibilities",
	])
		assert.deepEqual(request[key], base[key]);
	assert.deepEqual(base, copy);
	assert.ok(!("registeredAt" in request));
	assert.match(registrationHash(request), /^[a-f0-9]{64}$/);
	const unknown = { ...base, futureCriticalSetting: { preserve: true } };
	assert.throws(
		() => registration(unknown, tags, "ARM64", IMAGE_URI + ":latest"),
		/Unknown task-definition field/,
	);
});

test("only the exact API resources, current size, readiness check and Linux architectures qualify", () => {
	assertDefinition(definition());
	assertService(service(), true);
	for (const change of [
		(d) => {
			d.cpu = "512";
		},
		(d) => {
			d.memory = "1024";
		},
		(d) => {
			d.family = "other";
		},
		(d) => {
			d.containerDefinitions.push(d.containerDefinitions[0]);
		},
		(d) => {
			d.containerDefinitions[0].healthCheck.timeout = 30;
		},
		(d) => {
			d.runtimePlatform.operatingSystemFamily = "WINDOWS_SERVER_2022_CORE";
		},
		(d) => {
			d.containerDefinitions[0].image = IMAGE_URI + ":v0.1.100";
		},
	]) {
		const value = definition();
		change(value);
		assert.throws(() => assertDefinition(value));
	}
	for (const value of [
		"other",
		definition().taskDefinitionArn.replace("250598594267", "111111111111"),
	])
		assert.throws(() => validateArn(value));
	assert.throws(() => digest("not-a-digest"));
	assert.throws(() =>
		registration(definition(), [], "OTHER", IMAGE_URI + ":latest"),
	);
	const old = definition();
	delete old.runtimePlatform;
	assertDefinition(old);
	assert.equal(LIMITS.overall, 300000);
	assert.equal(LIMITS.readiness, 30000);
	assert.equal(LIMITS.completion, 180000);
	assert.equal(LIMITS.cache, 20000);
});

test("service drift, resource resizing and incomplete deployments cannot pass as stable", () => {
	const initial = service();
	assert.equal(completed(initial), true);
	for (const change of [
		(s) => {
			s.desiredCount = 2;
		},
		(s) => {
			s.deploymentConfiguration.maximumPercent = 300;
		},
		(s) => {
			s.deploymentConfiguration.deploymentCircuitBreaker.rollback = false;
		},
		(s) => {
			s.serviceRegistries = [];
		},
		(s) => {
			s.pendingCount = 1;
		},
	]) {
		const value = service();
		change(value);
		assert.throws(() => assertService(value, true));
	}
	const drifted = service();
	drifted.networkConfiguration.awsvpcConfiguration.securityGroups.push(
		"sg-other",
	);
	assert.equal(
		isDeepStrictEqual(fingerprint(initial), fingerprint(drifted)),
		false,
	);
	drifted.events = [{ message: "new event" }];
	const same = service();
	same.events = [];
	assert.deepEqual(fingerprint(same), fingerprint(initial));
});

test("runtime admission binds actual CPU, digest, private interface and definition", () => {
	const d = definition(),
		images = makeImages("runtime"),
		proof = {
			root: images.root,
			child: images.children.amd64,
			architecture: "X86_64",
		};
	const t = task(d, images.root);
	assertTask(t, d, proof);
	assert.equal(healthy(t), true);
	assert.equal(privateIP(t), "172.31.0.1");
	for (const change of [
		(value) => {
			value.cpu = "512";
		},
		(value) => {
			value.attributes[0].value = "arm64";
		},
		(value) => {
			value.containers[0].imageDigest = "sha256:" + "b".repeat(64);
		},
		(value) => {
			value.attachments = [];
		},
		(value) => {
			value.group = "service:another";
		},
	]) {
		const value = structuredClone(t);
		change(value);
		assert.throws(() => assertTask(value, d, proof));
	}
	const pinned = definition(10, IMAGE_URI + "@" + images.children.amd64);
	assertTask(task(pinned, images.children.amd64), pinned, proof);
	assert.throws(
		() => assertTask(task(pinned, images.root), pinned, proof),
		/immutable child/,
	);
	const instances = [{ ip: "172.31.0.1", health: "HEALTHY" }];
	assert.equal(discoveryMatches(instances, [t]), true);
	assert.equal(
		discoveryMatches([{ ...instances[0], health: "UNKNOWN" }], [t]),
		false,
	);
	assert.equal(discoveryMatches([], [t]), false);
});

test("readiness uses bounded AWS date precision rather than the workstation clock", () => {
	const t = { startedAt: new Date(NOW + 134) },
		clock = { serverDate: new Date(NOW + 2000).toUTCString(), elapsedMs: 24 };
	assert.equal(ageUpperMs(t, clock), 2890);
	assert.throws(() => ageUpperMs(t, {}), /AWS response clock/);
	assert.throws(
		() => ageUpperMs({ startedAt: new Date(NOW + 10000) }, clock),
		/beyond/,
	);
	assert.throws(() => ageUpperMs({ startedAt: "not-a-Date" }, clock));
});
