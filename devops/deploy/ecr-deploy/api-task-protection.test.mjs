import assert from "node:assert/strict";
import test from "node:test";
import {
	APITaskProtection,
	API_CLUSTER,
	LEASE_PREFIX,
	expirySecond,
	sameTask,
} from "./api-task-protection.mjs";

const TASK =
	"arn:aws:ecs:il-central-1:250598594267:task/bible-on-site-cluster/" +
	"a".repeat(32);
const NONCE = "1".repeat(32);
const NOW = Date.parse("2026-11-01T00:00:00Z");
class FakeAWS {
	constructor() {
		this.tags = { existing: "preserve" };
		this.protected = false;
		this.expiry = null;
		this.calls = [];
		this.legacy = true;
		this.now = NOW;
		this.events = [];
	}
	row(read = false) {
		return {
			taskArn:
				read || !this.legacy
					? TASK
					: TASK.replace("task/bible-on-site-cluster/", "task/"),
			protectionEnabled: this.protected,
			...(this.expiry
				? {
						expirationDate: new Date(
							read ? Math.floor(this.expiry / 1000) * 1000 : this.expiry,
						),
					}
				: {}),
		};
	}
	async call(name, input) {
		this.calls.push({ name, input: structuredClone(input) });
		const clock = { serverDate: new Date(this.now).toUTCString() };
		if (name === "ListTagsForResource") {
			assert.equal(input.resourceArn, TASK);
			const tags = Object.entries(this.tags).map(([key, value]) => ({
				key,
				value,
			}));
			return { tags: this.duplicateTags ? [...tags, ...tags] : tags };
		}
		if (name === "GetTaskProtection") {
			assert.deepEqual(input, { cluster: API_CLUSTER, tasks: [TASK] });
			return { failures: [], protectedTasks: [this.row(true)], $clock: clock };
		}
		if (name === "TagResource") {
			assert.equal(input.resourceArn, TASK);
			for (const { key, value } of input.tags) this.tags[key] = value;
			if (this.concurrentTag) this.tags.concurrent = "leave unchanged";
			return {};
		}
		if (name === "UntagResource") {
			assert.equal(input.resourceArn, TASK);
			assert.deepEqual(input.tagKeys, [LEASE_PREFIX + NONCE]);
			for (const key of input.tagKeys) delete this.tags[key];
			return {};
		}
		assert.equal(name, "UpdateTaskProtection");
		assert.equal(input.cluster, API_CLUSTER);
		assert.deepEqual(input.tasks, [TASK]);
		if (input.protectionEnabled) {
			assert.equal(input.expiresInMinutes, 15);
			if (this.denied)
				throw Object.assign(new Error("canary must not be printed"), {
					name: "AccessDeniedException",
				});
			this.protected = true;
			this.expiry = this.now + 900000 + 134;
			if (this.loseGrant)
				throw Object.assign(new Error("lost grant"), { name: "TimeoutError" });
		} else {
			assert.ok(!("expiresInMinutes" in input));
			this.protected = false;
			this.expiry = null;
			if (this.loseRelease)
				throw Object.assign(new Error("lost release"), {
					name: "TimeoutError",
				});
		}
		const row = this.row();
		if (this.wrongReceipt) row.taskArn = TASK.replace(/a$/, "b");
		return { failures: [], protectedTasks: [row], $clock: clock };
	}
}
function fixture() {
	const aws = new FakeAWS();
	const lease = new APITaskProtection({
		call: aws.call.bind(aws),
		task: TASK,
		nonce: NONCE,
		record: (name, value) => aws.events.push({ name, value }),
	});
	return { aws, lease };
}
const writes = (aws) =>
	aws.calls.filter(({ name }) =>
		["TagResource", "UntagResource", "UpdateTaskProtection"].includes(name),
	);

test("owned grant/release accepts actual legacy ARN and fractional write/whole-second read", async () => {
	const { aws, lease } = fixture();
	await lease.grant();
	assert.equal(lease.confirmed, true);
	assert.equal(aws.protected, true);
	assert.equal(lease.expiration, NOW / 1000 + 900);
	await lease.release();
	assert.equal(aws.protected, false);
	assert.deepEqual(aws.tags, { existing: "preserve" });
	assert.equal(lease.released, true);
	const count = writes(aws).length;
	await lease.release();
	assert.equal(writes(aws).length, count);
});
test("long-form grant/release receipts bind to the same exact task", async () => {
	const { aws, lease } = fixture();
	aws.legacy = false;
	await lease.grant();
	await lease.release();
	assert.equal(lease.released, true);
});
test("an existing protection is neither renewed nor cleared", async () => {
	const { aws, lease } = fixture();
	aws.protected = true;
	await assert.rejects(lease.grant(), /existing task protection/);
	assert.equal(writes(aws).length, 0);
});
test("another protection marker remains untouched", async () => {
	const { aws, lease } = fixture();
	aws.tags[LEASE_PREFIX + "foreign"] = "other";
	await assert.rejects(lease.grant(), /existing task protection marker/);
	assert.equal(writes(aws).length, 0);
	assert.equal(aws.tags[LEASE_PREFIX + "foreign"], "other");
});
test("a lost grant acknowledgement is reconciled without another grant", async () => {
	const { aws, lease } = fixture();
	aws.loseGrant = true;
	await lease.grant();
	assert.equal(lease.confirmed, true);
	assert.equal(
		aws.calls.filter((x) => x.name === "UpdateTaskProtection").length,
		1,
	);
	assert.equal(
		aws.events.find((x) => x.name === "protection-reconciled").value.renewed,
		false,
	);
	aws.loseGrant = false;
	await lease.release();
	assert.equal(aws.protected, false);
});
test("a lost release acknowledgement is verified before removing only the owned marker", async () => {
	const { aws, lease } = fixture();
	await lease.grant();
	aws.loseRelease = true;
	await lease.release();
	assert.equal(lease.released, true);
	assert.deepEqual(aws.tags, { existing: "preserve" });
	assert.equal(
		aws.calls.filter(
			(x) => x.name === "UpdateTaskProtection" && !x.input.protectionEnabled,
		).length,
		1,
	);
});
test("definitive authorization failure does not adopt an unrelated grant", async () => {
	const { aws, lease } = fixture();
	aws.denied = true;
	await assert.rejects(lease.grant(), /canary/);
	assert.equal(lease.confirmed, false);
	assert.equal(aws.protected, false);
	await lease.removeUngrantedMarker();
	assert.deepEqual(aws.tags, { existing: "preserve" });
});
for (const [name, change] of [
	[
		"expiration changes by a whole second",
		(aws) => {
			aws.expiry += 1000;
		},
	],
	[
		"owned marker disappears",
		(aws, lease) => {
			delete aws.tags[lease.key];
		},
	],
	[
		"owned marker value changes",
		(aws, lease) => {
			aws.tags[lease.key] = "other";
		},
	],
	[
		"another lease appears",
		(aws) => {
			aws.tags[LEASE_PREFIX + "other"] = "other";
		},
	],
	[
		"protection expires",
		(aws) => {
			aws.protected = false;
		},
	],
]) {
	test(
		name + " prevents clearing a foreign or changed protection",
		async () => {
			const { aws, lease } = fixture();
			await lease.grant();
			change(aws, lease);
			const count = writes(aws).length;
			await assert.rejects(lease.release());
			assert.equal(writes(aws).length, count);
		},
	);
}
test("concurrent unrelated tags are preserved after an ungranted marker is removed", async () => {
	const { aws, lease } = fixture();
	aws.concurrentTag = true;
	await assert.rejects(lease.grant(), /tags changed/);
	assert.equal(aws.protected, false);
	await lease.removeUngrantedMarker();
	assert.deepEqual(aws.tags, {
		existing: "preserve",
		concurrent: "leave unchanged",
	});
});
test("uncertain protection ownership preserves the flag and marker", async () => {
	const { aws, lease } = fixture();
	aws.wrongReceipt = true;
	await assert.rejects(lease.grant(), /Unexpected task protection/);
	const count = writes(aws).length;
	await assert.rejects(lease.removeUngrantedMarker(), /Uncertain protection/);
	assert.equal(writes(aws).length, count);
	assert.equal(aws.protected, true);
});
test("an absent ungranted marker is a no-op", async () => {
	const { aws, lease } = fixture();
	await lease.removeUngrantedMarker();
	assert.equal(writes(aws).length, 0);
});
test("duplicate task tags fail before a protection write", async () => {
	const { aws, lease } = fixture();
	aws.duplicateTags = true;
	await assert.rejects(lease.grant(), /Ambiguous task tags/);
	assert.equal(writes(aws).length, 0);
});
test("task identifiers never normalize across task, account, region or cluster", () => {
	assert.equal(sameTask(TASK, TASK), true);
	assert.equal(
		sameTask(TASK.replace("task/bible-on-site-cluster/", "task/"), TASK),
		true,
	);
	for (const value of [
		TASK.replace("250598594267", "111111111111"),
		TASK.replace("il-central-1", "us-east-1"),
		TASK.replace("bible-on-site-cluster", "another"),
		TASK.replace(/a$/, "b"),
		"a".repeat(32),
	])
		assert.equal(sameTask(value, TASK), false);
	assert.throws(
		() => new APITaskProtection({ call() {}, task: "other", nonce: NONCE }),
	);
	assert.throws(
		() => new APITaskProtection({ call() {}, task: TASK, nonce: "unbound" }),
	);
});
test("expiration comparison keeps the API's exact whole-second precision", () => {
	assert.equal(expirySecond(new Date(NOW + 134)), expirySecond(new Date(NOW)));
	assert.equal(
		expirySecond(new Date(NOW + 1134)),
		expirySecond(new Date(NOW)) + 1,
	);
	assert.equal(expirySecond("2026-11-01T00:00:00.134Z"), NOW / 1000);
	for (const value of [undefined, null, 123, "invalid", "2026-11-01"])
		assert.throws(() => expirySecond(value));
});

test("an acknowledged clear can finish tag cleanup after a transient verification failure", async () => {
	const { aws, lease } = fixture();
	await lease.grant();
	const original = lease.call;
	let failed = false;
	lease.call = async (operation, input) => {
		if (operation === "GetTaskProtection" && lease.clearConfirmed && !failed) {
			failed = true;
			throw Object.assign(new Error("lost read"), { name: "TimeoutError" });
		}
		return original(operation, input);
	};
	await assert.rejects(lease.release(), /lost read/);
	assert.equal(aws.protected, false);
	await lease.release();
	assert.equal(lease.released, true);
	assert.deepEqual(aws.tags, { existing: "preserve" });
	assert.equal(
		aws.calls.filter(
			(row) =>
				row.name === "UpdateTaskProtection" && !row.input.protectionEnabled,
		).length,
		1,
	);
});

test("publication cannot begin a rollout too close to the owned grant's expiry", async () => {
	const { aws, lease } = fixture();
	await lease.grant();
	aws.now = NOW + 600000;
	await assert.rejects(lease.assertActive(300), /too close to expiration/);
	await lease.release();
	assert.equal(lease.released, true);
	assert.throws(
		() =>
			new APITaskProtection({ call() {}, task: TASK, nonce: "-".repeat(32) }),
	);
});
