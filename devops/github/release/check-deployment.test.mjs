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
		if (endpoint.includes("/compare/"))
			return { status: overrides.status ?? "identical" };
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
	assert.deepEqual(result, { deploy: true, ref: sha, version: "5.0.118" });
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
				].includes(name)
			)
				continue;
			assert.match(block, /if:.*steps.guard.outputs.deploy == 'true'/, name);
		}
	});
}
