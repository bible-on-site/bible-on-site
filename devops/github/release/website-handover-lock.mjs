import assert from "node:assert/strict";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { ghApi } from "./gh-api.mjs";

export const HOLD_BUDGET_MS = 30 * 60 * 1000;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Serialize a separately approved manual migration with ordinary website CD. */
export async function holdWebsiteDeployment({
	repo,
	deploymentId,
	nonce,
	sourceRef,
	runId,
	api = ghApi,
	now = () => performance.now(),
	sleep = pause,
}) {
	assert.equal(repo, "bible-on-site/bible-on-site");
	assert.match(String(deploymentId), /^[1-9]\d*$/);
	assert.match(String(runId), /^[1-9]\d*$/);
	assert.match(nonce, /^[a-f0-9]{32}$/);
	assert.match(sourceRef, /^[a-f0-9]{40}$/);
	const endpoint = `repos/${repo}/deployments/${deploymentId}`;
	const deployment = api(endpoint);
	assert.equal(deployment.sha, sourceRef);
	assert.equal(deployment.environment, "website-arm64-migration");
	assert.equal(deployment.task, "deploy:website-arm64-migration");
	assert.deepEqual(deployment.payload, {
		purpose: "website-arm64-migration",
		nonce,
		sourceRef,
		account: "250598594267",
		region: "il-central-1",
		service: "bible-on-site-website",
	});
	const statuses = `${endpoint}/statuses`;
	const marker = `website-arm64-lock:${nonce}`;
	const completion = `website-arm64-complete:${nonce}`;
	const previous = api(`${statuses}?per_page=1`);
	assert.ok(Array.isArray(previous), "Invalid previous migration statuses");
	if (
		previous[0]?.state === "success" &&
		previous[0].description === completion
	)
		return {
			released: true,
			alreadyCompleted: true,
			deploymentId: String(deploymentId),
			runId: String(runId),
		};
	assert.equal(
		previous.length,
		0,
		"Migration record already has an owner or failed attempt; reconcile it and use a fresh record",
	);
	const held = api(statuses, {
		state: "in_progress",
		description: marker,
		auto_inactive: false,
		log_url: `https://github.com/${repo}/actions/runs/${runId}`,
	});
	assert.ok(
		Number.isSafeInteger(held.id) && held.id > 0,
		"Missing lock status receipt",
	);
	assert.equal(held.state, "in_progress");
	assert.equal(held.description, marker);
	assert.equal(
		held.log_url,
		`https://github.com/${repo}/actions/runs/${runId}`,
	);
	const deadline = now() + HOLD_BUDGET_MS;
	while (now() < deadline) {
		const [status] = api(`${statuses}?per_page=1`);
		assert.ok(
			now() < deadline,
			"Website migration lock expired during a status read",
		);
		if (!status) {
			await sleep(5000);
			continue;
		}
		assert.ok(
			Number.isSafeInteger(status.id) && status.id > 0,
			"Invalid migration status ID",
		);
		if (status.id < held.id) {
			await sleep(5000);
			continue;
		}
		if (status.state === "success") {
			assert.ok(
				status.id > held.id,
				"Completion must follow the owned lock receipt",
			);
			assert.equal(status.description, completion);
			return {
				released: true,
				deploymentId: String(deploymentId),
				runId: String(runId),
			};
		}
		assert.equal(
			status.state,
			"in_progress",
			"Operator ended or failed the migration",
		);
		assert.equal(
			status.description,
			marker,
			"A different owner changed the migration marker",
		);
		assert.equal(
			status.log_url,
			held.log_url,
			"A different run changed the migration marker",
		);
		await sleep(5000);
	}
	throw new Error(
		"Website migration lock expired; reconcile the protected rollout before retrying",
	);
}

export async function main(env = process.env, dependencies = {}) {
	return holdWebsiteDeployment({
		repo: env.GITHUB_REPOSITORY,
		deploymentId: env.DEPLOYMENT_ID,
		nonce: env.MIGRATION_NONCE,
		sourceRef: env.SOURCE_REF,
		runId: env.GITHUB_RUN_ID,
		...dependencies,
	});
}

if (
	process.argv[1] &&
	path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
	console.log(JSON.stringify(await main()));
