import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { checkDeployment, newerVersion } from "./check-deployment.mjs";

const sha = "a".repeat(40);
const source = {
	id: 10,
	name: "Continuous Integration",
	event: "push",
	head_branch: "master",
	head_sha: sha,
	workflow_id: 5,
	run_attempt: 1,
};
const input = {
	repo: "test/repo",
	runId: "10",
	ref: sha,
	moduleName: "website",
	moduleDirectory: "web/bible-on-site",
	version: "1.0.10",
};
const published = {
	tag_name: "website-v1.0.10",
	draft: false,
	prerelease: false,
};
function request(overrides = {}) {
	return (endpoint) => {
		if (endpoint.endsWith("/actions/runs/10"))
			return overrides.source ?? source;
		if (endpoint.includes("/runs/10/jobs?"))
			return { jobs: [{ name: "Cross Module CI", conclusion: "success" }] };
		if (endpoint.includes("/compare/"))
			return { status: overrides.status ?? "identical" };
		if (endpoint.includes("/deployments?")) return [];
		if (endpoint.includes("/runs/10/artifacts?"))
			return {
				artifacts: [
					{
						id: 90,
						name: "perushim-data-sql",
						expired: false,
						digest: `sha256:${"a".repeat(64)}`,
						workflow_run: { id: 10, head_sha: sha },
					},
				],
			};
		if (endpoint.includes("/releases?"))
			return overrides.releases ?? [published];
		throw new Error(`Unexpected API call: ${endpoint}`);
	};
}

test("version ordering is numeric", () => {
	assert.equal(newerVersion("1.0.10", "1.0.9"), true);
	assert.equal(newerVersion("1.0.9", "1.0.10"), false);
	assert.equal(newerVersion("1.0.10", "1.0.10"), false);
});
test("latest release deploys from the artifact's exact commit", () => {
	assert.deepEqual(checkDeployment(input, request()), {
		deploy: true,
		ref: sha,
		version: "1.0.10",
		runAttempt: 1,
	});
});
test("a late older dispatch cannot replace a newer release", () => {
	const result = checkDeployment(
		input,
		request({ releases: [published, { tag_name: "website-v1.0.11" }] }),
	);
	assert.equal(result.deploy, false);
});
test("drafts and other modules do not supersede a deployment", () => {
	assert.equal(
		checkDeployment(
			input,
			request({
				releases: [
					published,
					{ tag_name: "website-v2.0.0", draft: true },
					{ tag_name: "app-v9.0.0" },
				],
			}),
		).deploy,
		true,
	);
});
test("mismatched artifacts, unreleased tags and PR sources fail visibly", () => {
	assert.throws(
		() => checkDeployment({ ...input, ref: "master" }, request()),
		/does not match/,
	);
	assert.throws(
		() => checkDeployment(input, request({ status: "ahead" })),
		/commit differ/,
	);
	assert.throws(
		() => checkDeployment(input, request({ releases: [] })),
		/No published release/,
	);
	assert.throws(
		() =>
			checkDeployment(
				input,
				request({ source: { ...source, event: "pull_request" } }),
			),
		/master push CI/,
	);
});
test("manual iOS upload resolves its version and SHA from its source run", () => {
	const result = checkDeployment(
		{
			...input,
			ref: undefined,
			moduleName: "app",
			moduleDirectory: "app",
			version: undefined,
			artifactName: "app-ios-v5.0.118",
		},
		request({ releases: [{ tag_name: "app-v5.0.118" }] }),
	);
	assert.deepEqual(result, {
		deploy: true,
		ref: sha,
		version: "5.0.118",
		runAttempt: 1,
	});
});
test("release pagination finds a superseding release on later pages", () => {
	const mock = request();
	const result = checkDeployment(input, (endpoint) => {
		if (endpoint.includes("/releases?"))
			return endpoint.endsWith("page=1")
				? Array(100).fill(published)
				: [{ tag_name: "website-v2.0.0" }];
		return mock(endpoint);
	});
	assert.equal(result.deploy, false);
});
test("newer data dispatches supersede old SQL only after Release Data succeeds", () => {
	for (const conclusion of ["success", "failure", "skipped", null]) {
		const mock = request();
		const result = checkDeployment(
			{ ...input, moduleName: "data" },
			(endpoint) => {
				if (endpoint.includes("/actions/runs?"))
					return {
						workflow_runs: [
							{ ...source, id: 11, head_sha: "b".repeat(40) },
							source,
						],
					};
				if (endpoint.includes("/runs/11/jobs?"))
					return { jobs: [{ name: "Release Data", conclusion }] };
				if (endpoint.includes("/compare/")) return { status: "ahead" };
				return mock(endpoint);
			},
		);
		assert.equal(result.deploy, conclusion !== "success");
	}
});
test("API failures are never interpreted as permission to deploy", () => {
	assert.throws(
		() =>
			checkDeployment(input, () => {
				throw new Error("API unavailable");
			}),
		/API unavailable/,
	);
});

for (const file of [
	"cd-aws.yml",
	"cd-app.yml",
	"cd-bulletin.yml",
	"cd-data.yml",
]) {
	test(`${file} queues dispatches and gates every production step`, () => {
		const workflow = readFileSync(
			new URL(`../../../.github/workflows/${file}`, import.meta.url),
			"utf8",
		).replace(/\r/g, "");
		assert.match(workflow, /cancel-in-progress: false\n {2}queue: max/);
		for (const block of workflow.split("      - name: ").slice(1)) {
			const name = block.split("\n")[0];
			if (
				[
					"Checkout deployment automation",
					"Check deployment source and freshness",
					"Record deployment result",
				].includes(name)
			)
				continue;
			assert.match(block, /if:.*steps.guard.outputs.deploy == 'true'/, name);
		}
	});
}

test("unverified source CI cannot write to production", () => {
	const mock = request();
	assert.throws(
		() =>
			checkDeployment(input, (endpoint) =>
				endpoint.includes("/runs/10/jobs?")
					? { jobs: [{ name: "Cross Module CI", conclusion: "failure" }] }
					: mock(endpoint),
			),
		/has not passed/,
	);
});

for (const file of ["cd-aws.yml", "cd-bulletin.yml", "cd-app.yml"]) {
	test(`${file} deploys published binaries instead of mutable rerun artifacts`, () => {
		const workflow = readFileSync(
			new URL(`../../../.github/workflows/${file}`, import.meta.url),
			"utf8",
		);
		assert.match(workflow, /gh release download/);
		assert.doesNotMatch(workflow, /actions\/download-artifact/);
		assert.match(workflow, /deployments: write/);
		assert.match(workflow, /DEPLOYMENT_RESULT: \$\{\{ job.status \}\}/);
	});
}

test("successful newer data stays protected after its CI rerun fails", () => {
	const mock = request();
	for (const newerSha of [sha, "b".repeat(40)]) {
		const result = checkDeployment(
			{ ...input, moduleName: "data" },
			(endpoint) => {
				if (endpoint.includes("/deployments?"))
					return [{ id: 22, sha: newerSha, payload: { ci_run_id: "20" } }];
				if (endpoint.includes("/deployments/22/statuses"))
					return [{ state: "success" }];
				if (endpoint.includes("/compare/")) return { status: "ahead" };
				return mock(endpoint);
			},
		);
		assert.equal(result.deploy, false);
	}
});

test("an unfinished newer data attempt does not block recovery", () => {
	const mock = request();
	const result = checkDeployment(
		{ ...input, moduleName: "data" },
		(endpoint) => {
			if (endpoint.includes("/deployments?"))
				return [{ id: 22, sha: "b".repeat(40), payload: { ci_run_id: "20" } }];
			if (endpoint.includes("/deployments/22/statuses"))
				return [{ state: "failure" }];
			if (endpoint.includes("/compare/")) return { status: "ahead" };
			if (endpoint.includes("/actions/runs?")) return { workflow_runs: [] };
			return mock(endpoint);
		},
	);
	assert.equal(result.deploy, true);
});

const metadata = (attempt = 1, extra = {}) => ({
	...published,
	body: `<!-- release-delivery:${JSON.stringify({ ref: sha, ci_run_id: "10", ci_run_attempt: attempt, module_name: "website", module_version: "1.0.10", ...extra })} -->`,
});

function historyRequest(jobs, attempt = 2, release = metadata()) {
	const mock = request({
		source: { ...source, run_attempt: attempt },
		releases: [release],
	});
	return (url) => (url.includes("/runs/10/jobs?") ? { jobs } : mock(url));
}

test("published assets retain original passing CI despite a later failed full rerun", () => {
	const result = checkDeployment(
		input,
		historyRequest([
			{ name: "Cross Module CI", run_attempt: 2, conclusion: "failure" },
			{ name: "Cross Module CI", run_attempt: 1, conclusion: "success" },
		]),
	);
	assert.equal(result.deploy, true);
	assert.equal(result.runAttempt, 1);
});

test("a failed-jobs-only release rerun can reuse its unchanged successful quality gate", () => {
	const result = checkDeployment(
		input,
		historyRequest(
			[{ name: "Cross Module CI", run_attempt: 1, conclusion: "success" }],
			2,
			metadata(2),
		),
	);
	assert.equal(result.deploy, true);
	assert.equal(result.runAttempt, 2);
});

test("a failed newer quality gate cannot inherit an older passing result", () => {
	assert.throws(
		() =>
			checkDeployment(
				input,
				historyRequest(
					[
						{ name: "Cross Module CI", run_attempt: 1, conclusion: "success" },
						{ name: "Cross Module CI", run_attempt: 2, conclusion: "failure" },
					],
					2,
					metadata(2),
				),
			),
		/has not passed/,
	);
});

test("original quality evidence can occur on later job-history pages", () => {
	const mock = historyRequest([], 2);
	const result = checkDeployment(input, (url) => {
		if (!url.includes("/runs/10/jobs?")) return mock(url);
		assert.match(url, /filter=all/);
		return {
			jobs: url.endsWith("page=1")
				? Array(100).fill({ name: "Other" })
				: [{ name: "Cross Module CI", run_attempt: 1, conclusion: "success" }],
		};
	});
	assert.equal(result.deploy, true);
});

test("published provenance must match the deployment source CI", () => {
	for (const extra of [
		{ ci_run_id: "11" },
		{ ref: "b".repeat(40) },
		{ ci_run_attempt: 3 },
	]) {
		assert.throws(
			() => checkDeployment(input, historyRequest([], 2, metadata(1, extra))),
			/source|exceeds/,
		);
	}
});

test("legacy SQL dispatch refuses to select replacement data after a rerun", () => {
	const mock = request({ source: { ...source, run_attempt: 2 } });
	assert.throws(
		() =>
			checkDeployment({ ...input, moduleName: "data" }, (url) =>
				url.includes("/actions/runs?") ? { workflow_runs: [] } : mock(url),
			),
		/Legacy SQL dispatch/,
	);
});

test("legacy SQL binding detects a CI rerun during artifact resolution", () => {
	const mock = request();
	let reads = 0;
	assert.throws(
		() =>
			checkDeployment({ ...input, moduleName: "data" }, (url) => {
				if (url.endsWith("/actions/runs/10"))
					return { ...source, run_attempt: ++reads };
				if (url.includes("/actions/runs?")) return { workflow_runs: [] };
				return mock(url);
			}),
		/CI changed/,
	);
});

test("a successful later SQL attempt stays protected after its CI fails", () => {
	const mock = request({ source: { ...source, run_attempt: 3 } });
	const result = checkDeployment(
		{ ...input, moduleName: "data", runAttempt: 1 },
		(url) => {
			if (url.includes("/deployments?"))
				return [
					{ id: 22, sha, payload: { ci_run_id: "10", ci_run_attempt: "2" } },
				];
			if (url.includes("/deployments/22/statuses"))
				return [{ state: "success" }];
			return mock(url);
		},
	);
	assert.equal(result.deploy, false);
});

test("pinned SQL keeps its original passing attempt when a later rebuild fails", () => {
	const mock = historyRequest([
		{ name: "Cross Module CI", run_attempt: 1, conclusion: "success" },
		{ name: "Cross Module CI", run_attempt: 2, conclusion: "failure" },
	]);
	const result = checkDeployment(
		{
			...input,
			moduleName: "data",
			runAttempt: 1,
			artifactId: "90",
			artifactDigest: `sha256:${"a".repeat(64)}`,
		},
		(url) => {
			if (url.includes("/actions/runs?")) return { workflow_runs: [] };
			if (url.endsWith("/artifacts/90"))
				return {
					id: 90,
					name: "perushim-data-sql",
					expired: false,
					digest: `sha256:${"a".repeat(64)}`,
					workflow_run: { id: 10, head_sha: sha },
				};
			return mock(url);
		},
	);
	assert.equal(result.deploy, true);
	assert.equal(result.artifactId, "90");
	assert.equal(result.runAttempt, 1);
});
