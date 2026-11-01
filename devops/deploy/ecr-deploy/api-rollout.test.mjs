import assert from "node:assert/strict";
import test from "node:test";
import { runAPIRollout } from "./api-rollout.mjs";
import { IMAGE_URI, LIMITS } from "./api-rollout-state.mjs";
import {
	NEW_INSTANCE,
	definitionArn,
	fixture,
	ownedTags,
	taskArn,
} from "./api-rollout-fixtures.test.mjs";

test("protected latest handover waits for both public aliases and the unchanged cache window", async () => {
	const f = fixture(),
		result = await runAPIRollout(f);
	assert.equal(result.changed, true);
	assert.equal(result.instance, NEW_INSTANCE);
	assert.equal(result.task, taskArn("b"));
	assert.equal(result.protectionReleased, true);
	assert.ok(result.elapsedMs < LIMITS.overall);
	const visible = f.backend.records.find(
		(row) => row.name === "replacement-visible",
	);
	assert.ok(visible.value.observedMs >= 20000);
	const release = f.backend.calls.find(
		(row) =>
			row.name === "UpdateTaskProtection" && !row.input.protectionEnabled,
	);
	assert.ok(release.at >= 62000);
	assert.equal(f.backend.old.lastStatus, "STOPPED");
	assert.equal(f.backend.protected, false);
	assert.deepEqual(ownedTags(f.backend), []);
	assert.equal(f.backend.updates, 1);
	assert.equal(f.monitor.baselines, 1);
	assert.equal(
		f.backend.state().deploymentConfiguration.deploymentCircuitBreaker
			.resetOnHealthyTask,
		true,
	);
	assert.deepEqual(
		f.backend.state().deploymentConfiguration.deploymentCircuitBreaker
			.thresholdConfiguration,
		{ type: "BOUNDED_PERCENT", value: 50 },
	);
	assert.equal(
		JSON.stringify(f.backend.records).includes("must-not-appear-in-journal"),
		false,
	);
});

test("ARM pinned and normal latest use actual native descriptors without changing service resources", async () => {
	const f = fixture();
	const result = await runAPIRollout({
		...f,
		architecture: "ARM64",
		imageMode: "pinned",
	});
	assert.equal(result.image.child, f.backend.newImages.children.arm64);
	assert.equal(f.backend.current.runtimePlatform.cpuArchitecture, "ARM64");
	assert.equal(
		f.backend.current.containerDefinitions[0].image,
		IMAGE_URI + "@" + result.image.child,
	);
	assert.equal(f.backend.current.cpu, "256");
	assert.equal(f.backend.current.memory, "512");
	assert.equal(f.backend.state().desiredCount, 1);
});

test("an already-current registry/runtime releases only its own lease without deploying", async () => {
	const f = fixture();
	f.backend.newImages = f.backend.oldImages;
	const result = await runAPIRollout({ ...f, version: "0.1.100" });
	assert.equal(result.changed, false);
	assert.equal(f.backend.updates, 0);
	assert.equal(f.backend.protected, false);
	assert.deepEqual(ownedTags(f.backend), []);
	assert.ok(
		[...f.backend.otherLeases.values()].every(
			(lease) => !lease.protected && Object.keys(lease.tags).length === 0,
		),
	);
});

test("a publisher failure releases the old task without a service mutation", async () => {
	const f = fixture();
	await assert.rejects(
		runAPIRollout({
			...f,
			publish: async () => {
				throw new Error("archive admission failed");
			},
		}),
		/archive admission/,
	);
	assert.equal(f.backend.updates, 0);
	assert.equal(f.backend.protected, false);
	assert.deepEqual(ownedTags(f.backend), []);
	assert.equal(f.monitor.running, false);
});

test("a public 502 triggers control-plane rollback before any fresh public baseline", async () => {
	const f = fixture();
	f.monitor.failPublic = true;
	f.monitor.legacy = true;
	await assert.rejects(runAPIRollout(f), /sample failed/);
	assert.ok(
		f.backend.calls.some((row) => row.name === "StopServiceDeployment"),
	);
	assert.equal(f.monitor.baselines, 1);
	assert.equal(f.backend.current.taskDefinitionArn, definitionArn(9));
	assert.equal(f.backend.old.lastStatus, "RUNNING");
	assert.equal(f.backend.protected, false);
	assert.deepEqual(ownedTags(f.backend), []);
	assert.ok(f.monitor.rows.some((row) => !row.passed));
	assert.ok(f.backend.records.some((row) => row.name === "recovery-completed"));
});

test("30s readiness failure restores the already-running source with the existing budgets", async () => {
	const f = fixture();
	f.backend.neverReady = true;
	await assert.rejects(runAPIRollout(f), /readiness exceeded 30s/);
	assert.ok(f.backend.records.some((row) => row.name === "recovery-completed"));
	assert.equal(f.backend.old.lastStatus, "RUNNING");
	assert.equal(f.backend.protected, false);
});

test("missing public replacement visibility reaches the 180s completion cap without clearing early", async () => {
	const f = fixture();
	f.monitor.publicAt = Infinity;
	await assert.rejects(runAPIRollout(f), /completion exceeded 180s/);
	const stop = f.backend.calls.find(
		(row) => row.name === "StopServiceDeployment",
	);
	const releases = f.backend.calls.filter(
		(row) =>
			row.name === "UpdateTaskProtection" && !row.input.protectionEnabled,
	);
	assert.equal(releases.length, 1);
	assert.ok(releases[0].at > stop.at);
});

test("a lost update acknowledgement still starts rollback and leaves evidence", async () => {
	const f = fixture(),
		original = f.backend.call.bind(f.backend);
	let failed = false;
	f.aws.call = async (name, input) => {
		const result = await original(name, input);
		if (name === "UpdateService" && !failed) {
			failed = true;
			throw Object.assign(new Error("lost"), { name: "TimeoutError" });
		}
		return result;
	};
	await assert.rejects(runAPIRollout(f), /lost/);
	assert.ok(f.backend.records.some((row) => row.name === "recovery-completed"));
	assert.equal(f.backend.protected, false);
});

test("a completed rollout with changed public contracts restores the immutable old native pin", async () => {
	const f = fixture();
	f.monitor.failFinalContracts = true;
	await assert.rejects(runAPIRollout(f), /changed contract/);
	assert.equal(f.backend.updates, 2);
	assert.equal(
		f.backend.current.containerDefinitions[0].image,
		IMAGE_URI + "@" + f.backend.oldImages.children.amd64,
	);
	assert.ok(f.backend.records.some((row) => row.name === "recovery-completed"));
	assert.equal(f.backend.protected, false);
	assert.deepEqual(ownedTags(f.backend), []);
});

test("another owner's protection is preserved and publication never starts", async () => {
	const f = fixture();
	f.backend.protected = true;
	await assert.rejects(runAPIRollout(f), /existing task protection/);
	assert.equal(f.backend.published, false);
	assert.equal(f.backend.protected, true);
	assert.equal(f.backend.updates, 0);
});

test("ambiguous recovery preserves owned protection and records the exact bounded lease", async () => {
	const f = fixture();
	f.monitor.failPublic = true;
	f.backend.hook = async (name) => {
		if (name === "DescribeServiceRevisions")
			return { serviceRevisions: [], failures: [{ reason: "MISSING" }] };
	};
	await assert.rejects(runAPIRollout(f), /rollout and recovery failed/);
	assert.equal(f.backend.protected, true);
	assert.equal(ownedTags(f.backend).length, 1);
	const failed = f.backend.records.find(
		(row) => row.name === "recovery-failed",
	);
	assert.equal(failed.value.protectedTask, taskArn("a"));
	assert.ok(Number.isFinite(failed.value.expiration));
	assert.equal(f.monitor.running, false);
});

test("invalid deployment mode or architecture fails without publishing", async () => {
	const f = fixture();
	await assert.rejects(
		runAPIRollout({ ...f, imageMode: "floating-other-tag" }),
	);
	await assert.rejects(runAPIRollout({ ...f, architecture: "OTHER" }));
	assert.equal(f.backend.published, false);
});

test("a definitively rejected update reuses the unchanged healthy source without deploying a fallback", async () => {
	const f = fixture();
	f.backend.hook = async (name) => {
		if (name === "UpdateService")
			throw Object.assign(new Error("denied update"), {
				name: "AccessDeniedException",
			});
	};
	await assert.rejects(runAPIRollout(f), /denied update/);
	assert.equal(f.backend.updates, 0);
	assert.equal(f.backend.protected, false);
	assert.equal(
		f.backend.calls.filter((row) => row.name === "StopServiceDeployment")
			.length,
		0,
	);
	assert.ok(f.backend.records.some((row) => row.name === "recovery-completed"));
});

test("post-completion recovery protects the replacement before restoring the old image", async () => {
	const f = fixture();
	f.monitor.failFinalContracts = true;
	await assert.rejects(runAPIRollout(f), /changed contract/);
	const writes = f.backend.calls.filter((row) =>
		["UpdateTaskProtection", "UpdateService"].includes(row.name),
	);
	const restore = writes.findIndex(
		(row, i) =>
			row.name === "UpdateService" &&
			writes.slice(0, i).some((prior) => prior.name === "UpdateService"),
	);
	const protection = writes.findIndex(
		(row) =>
			row.name === "UpdateTaskProtection" &&
			row.input.tasks[0] === taskArn("b") &&
			row.input.protectionEnabled,
	);
	assert.ok(protection > 0 && protection < restore);
	assert.ok(
		[...f.backend.otherLeases.values()].every(
			(lease) => !lease.protected && Object.keys(lease.tags).length === 0,
		),
	);
});
