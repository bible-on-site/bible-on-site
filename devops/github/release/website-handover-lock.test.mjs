import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
	HOLD_BUDGET_MS,
	holdWebsiteDeployment,
	main,
} from "./website-handover-lock.mjs";

const sourceRef = "a".repeat(40),
	nonce = "b".repeat(32);
const payload = {
	purpose: "website-arm64-migration",
	nonce,
	sourceRef,
	account: "250598594267",
	region: "il-central-1",
	service: "bible-on-site-website",
};
const record = () => ({
	sha: sourceRef,
	environment: "website-arm64-migration",
	task: "deploy:website-arm64-migration",
	payload: { ...payload },
});
const held = {
	id: 100,
	state: "in_progress",
	description: `website-arm64-lock:${nonce}`,
	log_url: "https://github.com/bible-on-site/bible-on-site/actions/runs/456",
};
function fixture(overrides = {}, initialStatuses = []) {
	let tick = 0,
		reads = 0;
	const writes = [];
	const options = {
		repo: "bible-on-site/bible-on-site",
		deploymentId: "123",
		runId: "456",
		nonce,
		sourceRef,
		now: () => tick,
		sleep: async (ms) => {
			tick += ms;
		},
		api: (endpoint, body) => {
			if (body) {
				writes.push({ endpoint, body });
				return { ...held };
			}
			if (endpoint.endsWith("/deployments/123")) return record();
			assert.ok(endpoint.endsWith("/statuses?per_page=1"));
			return ++reads === 1
				? [{ ...held }]
				: [
						{
							id: 101,
							state: "success",
							description: `website-arm64-complete:${nonce}`,
						},
					];
		},
		...overrides,
	};
	const call = options.api;
	let posted = false;
	options.api = (endpoint, body) => {
		if (!body && endpoint.endsWith("/statuses?per_page=1") && !posted)
			return initialStatuses;
		if (body) posted = true;
		return call(endpoint, body);
	};
	return { options, writes };
}
test("the shared website queue is held until the exact operator completion marker", async () => {
	const { options, writes } = fixture();
	assert.deepEqual(await holdWebsiteDeployment(options), {
		released: true,
		deploymentId: "123",
		runId: "456",
	});
	assert.equal(writes.length, 1);
	assert.deepEqual(writes[0].body, {
		state: "in_progress",
		description: `website-arm64-lock:${nonce}`,
		auto_inactive: false,
		log_url: "https://github.com/bible-on-site/bible-on-site/actions/runs/456",
	});
});

test("a repeated dispatch cannot reopen a completed handover", async () => {
	const { options, writes } = fixture({}, [
		{
			id: 101,
			state: "success",
			description: `website-arm64-complete:${nonce}`,
		},
	]);
	assert.deepEqual(await holdWebsiteDeployment(options), {
		released: true,
		alreadyCompleted: true,
		deploymentId: "123",
		runId: "456",
	});
	assert.deepEqual(writes, []);
});
for (const status of [
	{ ...held },
	{ id: 101, state: "failure" },
	{ id: 101, state: "success", description: "foreign" },
]) {
	test(`an existing owner or ended record requires a fresh nonce: ${JSON.stringify(status)}`, async () => {
		const { options, writes } = fixture({}, [status]);
		await assert.rejects(
			holdWebsiteDeployment(options),
			/already has an owner or failed attempt/,
		);
		assert.deepEqual(writes, []);
	});
}
test("malformed previous-status metadata never starts a lock", async () => {
	const { options, writes } = fixture({}, {});
	await assert.rejects(
		holdWebsiteDeployment(options),
		/Invalid previous migration statuses/,
	);
	assert.deepEqual(writes, []);
});
for (const change of [
	{ sha: "c".repeat(40) },
	{ environment: "website" },
	{ task: "deploy:release" },
	{ payload: { ...payload, account: "999999999999" } },
	{ payload: { ...payload, service: "bible-on-site-api" } },
	{ payload: { ...payload, nonce: "d".repeat(32) } },
])
	test(`foreign deployment record is rejected before a marker write: ${JSON.stringify(change)}`, async () => {
		const { options } = fixture({
			api: (_endpoint, body) => {
				assert.equal(body, undefined);
				return { ...record(), ...change };
			},
		});
		await assert.rejects(holdWebsiteDeployment(options));
	});
for (const status of [
	undefined,
	{ state: "failure" },
	{ state: "in_progress", description: "foreign" },
	{ state: "success", description: "foreign" },
]) {
	test(`missing, failed or foreign status cannot release successfully: ${JSON.stringify(status)}`, async () => {
		const { options } = fixture({
			api: (endpoint, body) =>
				body
					? { ...held }
					: endpoint.endsWith("/deployments/123")
						? record()
						: status
							? [{ id: 101, ...status }]
							: [],
		});
		await assert.rejects(holdWebsiteDeployment(options));
	});
}
test("an unchanged marker expires at the original bounded hold, without extending it", async () => {
	let tick = 0;
	const { options } = fixture({
		now: () => tick,
		sleep: async () => {
			tick += HOLD_BUDGET_MS;
		},
		api: (endpoint, body) =>
			body
				? { ...held }
				: endpoint.endsWith("/deployments/123")
					? record()
					: [{ ...held }],
	});
	await assert.rejects(holdWebsiteDeployment(options), /lock expired/);
	assert.equal(tick, HOLD_BUDGET_MS);
});

test("a stale completion from before this lock receipt cannot release the queue", async () => {
	let reads = 0;
	const { options } = fixture({
		api: (endpoint, body) =>
			body
				? { ...held }
				: endpoint.endsWith("/deployments/123")
					? record()
					: [
							{
								id: ++reads === 1 ? 99 : 101,
								state: "success",
								description: `website-arm64-complete:${nonce}`,
							},
						],
	});
	assert.equal((await holdWebsiteDeployment(options)).released, true);
	assert.equal(reads, 2);
});
test("a completion that arrives after the fixed deadline still fails", async () => {
	let tick = 0;
	const { options } = fixture({
		now: () => tick,
		api: (endpoint, body) => {
			if (body) return { ...held };
			if (endpoint.endsWith("/deployments/123")) return record();
			tick = HOLD_BUDGET_MS;
			return [
				{
					id: 101,
					state: "success",
					description: `website-arm64-complete:${nonce}`,
				},
			];
		},
	});
	await assert.rejects(
		holdWebsiteDeployment(options),
		/expired during a status read/,
	);
});

test("a mutated copy of the held status cannot masquerade as a later completion", async () => {
	const { options } = fixture({
		api: (endpoint, body) =>
			body
				? { ...held }
				: endpoint.endsWith("/deployments/123")
					? record()
					: [
							{
								id: held.id,
								state: "success",
								description: `website-arm64-complete:${nonce}`,
							},
						],
	});
	await assert.rejects(
		holdWebsiteDeployment(options),
		/must follow the owned lock receipt/,
	);
});
test("the workflow environment binds the same record, owner, source and run", async () => {
	const { options } = fixture();
	assert.equal(
		(
			await main(
				{
					GITHUB_REPOSITORY: options.repo,
					DEPLOYMENT_ID: options.deploymentId,
					MIGRATION_NONCE: options.nonce,
					SOURCE_REF: options.sourceRef,
					GITHUB_RUN_ID: options.runId,
				},
				{ api: options.api, now: options.now, sleep: options.sleep },
			)
		).released,
		true,
	);
});
for (const change of [
	{ repo: "other/repo" },
	{ deploymentId: "1/2" },
	{ runId: "-1" },
	{ nonce: "bad" },
	{ sourceRef: "master" },
]) {
	test(`invalid lock inputs never reach GitHub: ${JSON.stringify(change)}`, async () => {
		const { options } = fixture({
			...change,
			api: () => assert.fail("Invalid input must not reach GitHub"),
		});
		await assert.rejects(holdWebsiteDeployment(options));
	});
}
test("the handover and ordinary website deployments use the same queue without AWS credentials", () => {
	const ordinary = readFileSync(
		new URL("../../../.github/workflows/cd-aws.yml", import.meta.url),
		"utf8",
	);
	const lock = readFileSync(
		new URL(
			"../../../.github/workflows/website-handover-lock.yml",
			import.meta.url,
		),
		"utf8",
	);
	const group = ordinary
		.match(/ {2}group: (.+)/)[1]
		.replace(
			/\$\{\{ github\.event\.client_payload\.module_name \}\}/,
			"website",
		);
	assert.equal(lock.match(/ {2}group: (.+)/)[1], group);
	assert.ok(lock.includes("  cancel-in-progress: false"));
	assert.ok(!lock.includes("id-token:") && !lock.includes("aws-actions/"));
});
