import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { createAWSCaller } from "./api-rollout-aws.mjs";
import {
	API_ACCOUNT,
	API_CLUSTER,
	API_REGION,
	API_SERVICE,
	APITaskProtection,
	expirySecond,
	LEASE_PREFIX,
	sameTask,
} from "./api-task-protection.mjs";

const TASK =
	"arn:aws:ecs:il-central-1:250598594267:task/bible-on-site-cluster/" +
	"a".repeat(32);
const NONCE = "1".repeat(32);
const NOW = Date.parse("2026-11-01T00:00:00Z");
const VALID_TAG_TEXT = /^[\p{L}\p{Z}\p{N}_.:/=+\-@]*$/u;
class FakeAWS {
	constructor(nonce = NONCE) {
		this.nonce = nonce;
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
			for (const { key, value } of input.tags) {
				assert.match(key, VALID_TAG_TEXT);
				assert.match(value, VALID_TAG_TEXT);
				this.tags[key] = value;
			}
			if (this.concurrentTag) this.tags.concurrent = "leave unchanged";
			return {};
		}
		if (name === "UntagResource") {
			assert.equal(input.resourceArn, TASK);
			assert.deepEqual(input.tagKeys, [LEASE_PREFIX + this.nonce]);
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

for (const nonce of [NONCE, "11111111-1111-4111-8111-111111111111"]) {
	test(`actual SDK protection lifecycle uses ECS-valid tags for ${nonce.includes("-") ? "UUID" : "hex"} ownership`, async () => {
		const aws = new FakeAWS(nonce);
		const caller = createAWSCaller(
			{ accountId: API_ACCOUNT, region: API_REGION },
			{
				credentials: {
					accessKeyId: "TESTACCESSKEY",
					secretAccessKey: "test-secret",
				},
				requestHandler: {
					async handle(request) {
						const operation = request.headers["x-amz-target"].split(".").at(-1);
						const input = JSON.parse(
							typeof request.body === "string"
								? request.body
								: new TextDecoder().decode(request.body),
						);
						// ECS rejected the old JSON marker in the live TagResource call.
						const invalid =
							operation === "TagResource" &&
							input.tags.some(
								({ key, value }) =>
									!VALID_TAG_TEXT.test(key) ||
									!VALID_TAG_TEXT.test(value) ||
									key.length > 128 ||
									value.length > 256,
							);
						const result = invalid
							? {
									__type: "InvalidParameterException",
									message: "Some tags contain invalid characters.",
								}
							: await aws.call(operation, input);
						return {
							response: {
								statusCode: invalid ? 400 : 200,
								headers: {
									date: new Date(aws.now).toUTCString(),
									"content-type": "application/x-amz-json-1.1",
								},
								body: Readable.from([
									JSON.stringify(result, (key, value) =>
										key === "$clock"
											? undefined
											: key === "expirationDate"
												? Date.parse(value) / 1000
												: value,
									),
								]),
							},
						};
					},
				},
			},
		);
		try {
			const lease = new APITaskProtection({
				call: caller.call,
				task: TASK,
				nonce,
			});
			await lease.grant();
			await lease.assertActive(600);
			assert.equal(lease.value, `${API_SERVICE}:${nonce}`);
			await lease.release();
			assert.equal(lease.released, true);
			assert.equal(aws.protected, false);
			assert.deepEqual(aws.tags, { existing: "preserve" });
			const grants = aws.calls.filter(
				(c) => c.name === "UpdateTaskProtection" && c.input.protectionEnabled,
			);
			assert.equal(grants.length, 1);
			assert.equal(grants[0].input.expiresInMinutes, 15);
			assert.equal(
				aws.calls.filter((c) => c.name === "UntagResource").length,
				1,
			);
		} finally {
			caller.close();
		}
	});
}

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
	aws.tags[`${LEASE_PREFIX}foreign`] = "other";
	await assert.rejects(lease.grant(), /existing task protection marker/);
	assert.equal(writes(aws).length, 0);
	assert.equal(aws.tags[`${LEASE_PREFIX}foreign`], "other");
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
			aws.tags[`${LEASE_PREFIX}other`] = "other";
		},
	],
	[
		"protection expires",
		(aws) => {
			aws.protected = false;
		},
	],
]) {
	test(`${name} prevents clearing a foreign or changed protection`, async () => {
		const { aws, lease } = fixture();
		await lease.grant();
		change(aws, lease);
		const count = writes(aws).length;
		await assert.rejects(lease.release());
		assert.equal(writes(aws).length, count);
	});
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

const stoppedTask = () => ({
	taskArn: TASK,
	clusterArn: `arn:aws:ecs:${API_REGION}:${API_ACCOUNT}:cluster/${API_CLUSTER}`,
	group: `service:${API_SERVICE}`,
	lastStatus: "STOPPED",
	desiredStatus: "STOPPED",
});

function retiredTaskFixture(
	stage = "read",
	describe = () => ({ tasks: [stoppedTask()], failures: [] }),
) {
	const { aws, lease } = fixture();
	const calls = [];
	lease.call = async (operation, input) => {
		calls.push({ operation, input: structuredClone(input) });
		if (operation === "DescribeTasks") return describe();
		if (
			lease.clearConfirmed &&
			((stage === "read" && operation === "ListTagsForResource") ||
				(stage === "write" && operation === "UntagResource") ||
				(stage === "verify" &&
					operation === "ListTagsForResource" &&
					!(lease.key in aws.tags)))
		) {
			throw Object.assign(new Error("The specified task is stopped"), {
				name: "InvalidParameterException",
			});
		}
		return aws.call(operation, input);
	};
	return { aws, lease, calls };
}

for (const stage of ["read", "write", "verify"]) {
	test(`an acknowledged clear accepts verified task retirement during marker ${stage}`, async () => {
		const { aws, lease, calls } = retiredTaskFixture(stage);
		await lease.grant();
		await lease.release();
		assert.equal(lease.clearConfirmed, true);
		assert.equal(lease.released, true);
		assert.equal(aws.protected, false);
		assert.deepEqual(
			calls.filter((row) => row.operation === "DescribeTasks"),
			[
				{
					operation: "DescribeTasks",
					input: { cluster: API_CLUSTER, tasks: [TASK] },
				},
			],
		);
		assert.equal(
			aws.calls.filter(
				(row) =>
					row.name === "UpdateTaskProtection" && !row.input.protectionEnabled,
			).length,
			1,
		);
		assert.ok(
			aws.events.some((row) => row.name === "protection-marker-retired"),
		);
		const before = calls.length;
		await lease.release();
		assert.equal(calls.length, before);
	});
}

for (const [name, describe] of [
	[
		"running task",
		() => ({
			tasks: [{ ...stoppedTask(), lastStatus: "RUNNING" }],
			failures: [],
		}),
	],
	[
		"stopping task",
		() => ({
			tasks: [{ ...stoppedTask(), lastStatus: "STOPPING" }],
			failures: [],
		}),
	],
	[
		"unexpected desired status",
		() => ({
			tasks: [{ ...stoppedTask(), desiredStatus: "RUNNING" }],
			failures: [],
		}),
	],
	[
		"different task",
		() => ({
			tasks: [{ ...stoppedTask(), taskArn: TASK.replace(/a$/, "b") }],
			failures: [],
		}),
	],
	[
		"different cluster",
		() => ({
			tasks: [{ ...stoppedTask(), clusterArn: "another-cluster" }],
			failures: [],
		}),
	],
	[
		"different service",
		() => ({
			tasks: [{ ...stoppedTask(), group: "service:another-service" }],
			failures: [],
		}),
	],
	["missing task", () => ({ tasks: [], failures: [] })],
	[
		"ambiguous tasks",
		() => ({ tasks: [stoppedTask(), stoppedTask()], failures: [] }),
	],
	[
		"failed task lookup",
		() => ({ tasks: [stoppedTask()], failures: [{ reason: "MISSING" }] }),
	],
	[
		"task lookup error",
		() => {
			throw new Error("cannot inspect task");
		},
	],
]) {
	test(`marker cleanup still fails closed for ${name}`, async () => {
		const { lease } = retiredTaskFixture("read", describe);
		await lease.grant();
		await assert.rejects(lease.release());
		assert.equal(lease.clearConfirmed, true);
		assert.equal(lease.released, false);
	});
}

test("a stopped-task tag error before clearing protection cannot adopt retirement", async () => {
	const { aws, lease, calls } = retiredTaskFixture();
	await lease.grant();
	const call = lease.call;
	lease.call = async (operation, input) => {
		if (operation === "ListTagsForResource") {
			throw Object.assign(new Error("task is stopped"), {
				name: "InvalidParameterException",
			});
		}
		return call(operation, input);
	};
	await assert.rejects(lease.release(), { name: "InvalidParameterException" });
	assert.equal(lease.clearConfirmed, false);
	assert.equal(lease.released, false);
	assert.equal(aws.protected, true);
	assert.equal(
		calls.some((row) => row.operation === "DescribeTasks"),
		false,
	);
});

test("running-task errors and an invalid clear receipt never adopt a retired marker", async () => {
	for (const name of ["AccessDeniedException", "TimeoutError"]) {
		const { lease } = fixture();
		await lease.grant();
		const call = lease.call;
		let described = false;
		lease.call = async (operation, input) => {
			if (operation === "DescribeTasks") {
				described = true;
				return { tasks: [stoppedTask()], failures: [] };
			}
			if (operation === "ListTagsForResource" && lease.clearConfirmed)
				throw Object.assign(new Error("cannot read marker"), { name });
			return call(operation, input);
		};
		await assert.rejects(lease.release(), { name });
		assert.equal(described, false);
		assert.equal(lease.released, false);
	}
	const { aws, lease, calls } = retiredTaskFixture();
	await lease.grant();
	aws.wrongReceipt = true;
	await assert.rejects(lease.release(), /release receipt/);
	assert.equal(lease.clearConfirmed, false);
	assert.equal(lease.released, false);
	assert.equal(
		calls.some((row) => row.operation === "DescribeTasks"),
		false,
	);
});
