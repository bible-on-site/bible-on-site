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
	"testflight-distribution.yml",
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
					"Setup Node",
					"Check deployment source and freshness",
					"Record deployment result",
					"Record distribution result",
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

test("AWS release replays retain current automation and isolate immutable artifact source", () => {
	const workflow = readFileSync(
		new URL("../../../.github/workflows/cd-aws.yml", import.meta.url),
		"utf8",
	).replace(/\r/g, "");
	const steps = workflow.split("      - name: ").slice(1);
	const automation = steps.find((block) =>
		block.startsWith("Checkout deployment automation\n"),
	);
	const artifact = steps.find((block) =>
		block.startsWith("Checkout artifact source\n"),
	);
	assert.match(automation, /ref: \$\{\{ github.sha \}\}/);
	assert.doesNotMatch(automation, /path:/);
	assert.match(
		artifact,
		/ref: \$\{\{ steps.guard.outputs.ref \}\}\n +path: release-source/,
	);
	const verify = steps.find((block) =>
		block.startsWith("Verify website recitation after ECS rollout\n"),
	);
	assert.match(verify, /working-directory: release-source/);
	assert.match(verify, /NODE_PATH="\$GITHUB_WORKSPACE\/devops\/node_modules"/);
	assert.match(
		workflow,
		/import\('\$GITHUB_WORKSPACE\/release-source\/web\/bible-on-site\/scripts\/verify-public-content.mjs'\)/,
	);
	const deploy = steps.find((block) => block.startsWith("Deploy to ECR\n"));
	assert.match(deploy, /working-directory: \$\{\{ env.DEVOPS_DIRECTORY \}\}/);
	assert.match(deploy, /--source-ref "\$API_RELEASE_SOURCE"/);
	assert.match(
		workflow,
		/run-name: Deploy \$\{\{ github.event.client_payload.module_name \}\}/,
	);
	assert.match(
		workflow,
		/name: api-handover-\$\{\{ github.run_id \}\}-\$\{\{ github.run_attempt \}\}/,
	);
});

test("only the API EventBridge trigger is disabled for coordinated publication", () => {
	const template = readFileSync(
		new URL(
			"../../../docs/aws/cloudformation/ecr-ecs-auto-deploy.yaml",
			import.meta.url,
		),
		"utf8",
	);
	for (const [resource, state] of [
		["Api", "DISABLED"],
		["Website", "ENABLED"],
		["Admin", "ENABLED"],
	]) {
		const block = template
			.split(`  ECRPushRule${resource}:`)[1]
			.split(/^ {2}[A-Za-z]/m)[0];
		assert.ok(block.includes(`State: ${state}`));
	}
});

test("only master API releases assume the dedicated role with API-only image access", () => {
	const template = readFileSync(
		new URL(
			"../../../docs/aws/cloudformation/github-oidc.yaml",
			import.meta.url,
		),
		"utf8",
	).replace(/\r/g, "");
	const resource = (name) =>
		template.split(`  ${name}:\n`)[1].split(/^ {2}(?:[A-Za-z]|#)/m)[0];
	assert.match(
		resource("GitHubActionsAPIDeployRole"),
		/DependsOn: GitHubOIDCProvider/,
	);
	const trust = JSON.parse(
		resource("GitHubActionsAPIDeployRole")
			.split("        Fn::Sub: |\n")[1]
			.split("      Tags:")[0]
			.trim(),
	);
	assert.deepEqual(trust.Statement, [
		{
			Effect: "Allow",
			Principal: {
				Federated:
					"arn:${AWS::Partition}:iam::${AWS::AccountId}:oidc-provider/token.actions.githubusercontent.com",
			},
			Action: "sts:AssumeRoleWithWebIdentity",
			Condition: {
				StringEquals: {
					"token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
					"token.actions.githubusercontent.com:sub":
						"repo:${GitHubOrg}/${GitHubRepo}:ref:refs/heads/master",
				},
			},
		},
	]);
	assert.doesNotMatch(
		resource("GitHubActionsAPIDeployRole"),
		/ManagedPolicyArns/,
	);
	const publishBlock = resource("GitHubActionsAPIPublishPolicy"),
		publish = JSON.parse(publishBlock.split("        Fn::Sub: |\n")[1].trim());
	assert.match(publishBlock, /Roles: \[!Ref GitHubActionsAPIDeployRole\]/);
	assert.equal(publish.Statement[0].Action, "ecr:GetAuthorizationToken");
	assert.equal(publish.Statement[0].Resource, "*");
	assert.equal(
		publish.Statement[1].Resource,
		"arn:${AWS::Partition}:ecr:${AWS::Region}:${AWS::AccountId}:repository/bible-on-site-api",
	);
	assert.ok(publish.Statement[1].Action.includes("ecr:PutImage"));
	assert.ok(
		publish.Statement.every(
			(row) =>
				row.Condition.StringEquals["aws:RequestedRegion"] === "il-central-1",
		),
	);
	assert.doesNotMatch(
		JSON.stringify(publish),
		/CreateRepository|Delete|ssm:|iam:|s3:|lambda:/,
	);
	const workflow = readFileSync(
		new URL("../../../.github/workflows/cd-aws.yml", import.meta.url),
		"utf8",
	);
	assert.match(
		workflow,
		/role-to-assume: \$\{\{ env\.MODULE_NAME == 'api' && format\('arn:aws:iam::\{0\}:role\/GitHubActionsAPIDeployRole', env\.AWS_ACCOUNT_ID\) \|\| secrets\.AWS_DEPLOY_ROLE_ARN \}\}/,
	);
});

test("the handover policy limits service writes, role passing, size and lease tags", () => {
	const template = readFileSync(
		new URL(
			"../../../docs/aws/cloudformation/github-oidc.yaml",
			import.meta.url,
		),
		"utf8",
	).replace(/\r/g, "");
	const block = template
		.split("  GitHubActionsAPIHandoverPolicy:\n")[1]
		.split("Outputs:\n")[0];
	const json = block.split("        Fn::Sub: |\n")[1].trim();
	const policy = JSON.parse(json),
		statements = Object.fromEntries(
			policy.Statement.map((row) => [row.Sid, row]),
		);
	assert.equal(
		statements.APIServiceUpdate.Resource.endsWith(
			"service/bible-on-site-cluster/bible-on-site-api",
		),
		true,
	);
	assert.equal(
		statements.APIRegisterExistingSize.Condition.NumericEquals["ecs:task-cpu"],
		"256",
	);
	assert.equal(
		statements.APIRegisterExistingSize.Condition.NumericEquals[
			"ecs:task-memory"
		],
		"512",
	);
	assert.deepEqual(
		statements.OwnedLeaseMarkersOnly.Condition["ForAllValues:StringLike"][
			"aws:TagKeys"
		],
		["tanahpedia:api-handover:*"],
	);
	assert.equal(
		statements.PassExistingExecutionRoleOnly.Resource.endsWith(
			"role/ecsTaskExecutionRole",
		),
		true,
	);
	assert.equal(statements.APIRuleStateRead.Action, "events:DescribeRule");
	assert.match(block, /Roles: \[!Ref GitHubActionsAPIDeployRole\]/);
	assert.doesNotMatch(json, /token\.actions\.githubusercontent\.com/);
	for (const statement of policy.Statement.filter(
		(row) => row.Action !== "iam:PassRole",
	))
		assert.equal(
			statement.Condition.StringEquals["aws:RequestedRegion"],
			"il-central-1",
		);
	assert.ok(
		policy.Statement.every(
			(row) =>
				!JSON.stringify(row.Action).includes("iam:Put") &&
				!JSON.stringify(row.Action).includes("servicediscovery:Update"),
		),
	);
});

for (const file of [
	"cd-aws.yml",
	"cd-bulletin.yml",
	"cd-app.yml",
	"testflight-distribution.yml",
]) {
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

test("legacy SQL dispatch binds the master branch ref to its validated CI commit", () => {
	const mock = request();
	const api = (url) =>
		url.includes("/actions/runs?") ? { workflow_runs: [] } : mock(url);
	const legacy = { ...input, moduleName: "data", ref: "refs/heads/master" };
	const result = checkDeployment(legacy, api);
	assert.equal(result.deploy, true);
	assert.equal(result.ref, sha);
	assert.equal(result.artifactId, "90");
	assert.throws(
		() => checkDeployment({ ...legacy, ref: "refs/heads/dev" }, api),
		/does not match/,
	);
	assert.throws(
		() => checkDeployment({ ...input, ref: "refs/heads/master" }, api),
		/does not match/,
	);
	assert.throws(
		() =>
			checkDeployment(
				legacy,
				request({ source: { ...source, head_branch: "dev" } }),
			),
		/master push CI/,
	);
	assert.throws(
		() =>
			checkDeployment(legacy, (url) =>
				url.endsWith("/actions/runs/10")
					? { ...source, run_attempt: 2 }
					: api(url),
			),
		/Legacy SQL dispatch/,
	);
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

const baselineSha = "d".repeat(40);
const baselineArtifact = {
	id: 80,
	name: "perushim-data-sql.master",
	expired: false,
	digest: `sha256:${"a".repeat(64)}`,
	workflow_run: {
		id: 7,
		head_sha: baselineSha,
		head_branch: "master",
		repository_id: 1,
		head_repository_id: 1,
	},
};
const producingRun = {
	name: "Continuous Integration",
	event: "push",
	head_branch: "master",
	head_sha: baselineSha,
};
const baselineInput = {
	...input,
	moduleName: "data",
	artifactId: "80",
	artifactDigest: `sha256:${"a".repeat(64)}`,
	sourceRunId: "7",
	sourceRef: baselineSha,
};
function baselineRequest(overrides = {}) {
	const mock = request();
	return (url) => {
		if (url.includes("/actions/runs?")) return { workflow_runs: [] };
		if (url.endsWith("/artifacts/80"))
			return overrides.artifact ?? baselineArtifact;
		if (url.endsWith("/actions/runs/7"))
			return overrides.producingRun ?? producingRun;
		if (url.includes("/contents/"))
			return (
				overrides.contents?.(url) ?? [
					{ name: "perushim-view", sha: "e".repeat(40) },
					{
						name: "sefaria-dump-5784-sivan-4.tanah_view.sqlite",
						sha: "e".repeat(40),
					},
				]
			);
		return mock(url);
	};
}

test("a reused master SQL baseline deploys with its producing run bound", () => {
	const result = checkDeployment(baselineInput, baselineRequest());
	assert.equal(result.deploy, true);
	assert.equal(result.artifactId, "80");
	assert.equal(result.artifactDigest, `sha256:${"a".repeat(64)}`);
});

test("a reused baseline keeps failing closed on source, trust and input drift", () => {
	// Declared source disagrees with the archive record.
	assert.throws(
		() =>
			checkDeployment(
				{ ...baselineInput, sourceRunId: "8" },
				baselineRequest(),
			),
		/not by run 8/,
	);
	// A producing run that is not master push CI cannot be trusted.
	assert.throws(
		() =>
			checkDeployment(
				baselineInput,
				baselineRequest({
					producingRun: { ...producingRun, event: "pull_request" },
				}),
			),
		/untrusted run/,
	);
	// SQL inputs changed between the producing and delivered revisions.
	assert.throws(
		() =>
			checkDeployment(
				baselineInput,
				baselineRequest({
					contents: (url) =>
						url.includes(`ref=${baselineSha}`)
							? [
									{ name: "perushim-view", sha: "f".repeat(40) },
									{
										name: "sefaria-dump-5784-sivan-4.tanah_view.sqlite",
										sha: "e".repeat(40),
									},
								]
							: [
									{ name: "perushim-view", sha: "e".repeat(40) },
									{
										name: "sefaria-dump-5784-sivan-4.tanah_view.sqlite",
										sha: "e".repeat(40),
									},
								],
				}),
			),
		/differs between/,
	);
});

test("a completed SQL dispatch is a no-op even after its archive expires", () => {
	const result = checkDeployment(
		{ ...input, moduleName: "data", artifactId: "90" },
		(url) => {
			if (url.endsWith("/actions/runs/10")) return source;
			if (url.includes("/deployments?"))
				return [
					{ id: 22, sha, payload: { ci_run_id: "10", sql_artifact_id: "90" } },
				];
			if (url.includes("/deployments/22/statuses"))
				return [{ state: "success" }];
			throw new Error(
				"An expired completed artifact must not be downloaded or checked again",
			);
		},
	);
	assert.equal(result.deploy, false);
	assert.match(result.reason, /already deployed/);
});

test("API platform selection comes from published provenance rather than dispatch flags", () => {
	const payload = {
		ref: sha,
		ci_run_id: 10,
		module_name: "api",
		module_version: "1.0.10",
		released_artifact_name: "bible-on-site-api-docker-10",
		released_arm64_artifact_name: "bible-on-site-api-docker-10-arm64",
	};
	const release = {
		...published,
		tag_name: "api-v1.0.10",
		body: `<!-- release-delivery:${JSON.stringify(payload)} -->`,
	};
	const api = { ...input, moduleName: "api", moduleDirectory: "web/api" };
	assert.equal(
		checkDeployment(api, request({ releases: [release] })).apiArm64,
		true,
	);
	const legacy = { ...release, body: "legacy single-platform release" };
	assert.equal(
		checkDeployment({ ...api, apiArm64: true }, request({ releases: [legacy] }))
			.apiArm64,
		undefined,
	);
	const wrong = {
		...release,
		body: `<!-- release-delivery:${JSON.stringify({ ...payload, released_arm64_artifact_name: "other-run" })} -->`,
	};
	assert.throws(
		() => checkDeployment(api, request({ releases: [wrong] })),
		/published CI provenance/,
	);
});

test("website platform selection requires its own immutable published artifact pair", () => {
	const payload = {
		ref: sha,
		ci_run_id: 10,
		module_name: "website",
		module_version: "1.0.10",
		released_artifact_name: "bible-on-site-docker-10",
		released_arm64_artifact_name: "bible-on-site-docker-10-arm64",
	};
	const release = {
		...published,
		body: `<!-- release-delivery:${JSON.stringify(payload)} -->`,
	};
	assert.equal(
		checkDeployment(input, request({ releases: [release] })).websiteArm64,
		true,
	);
	assert.equal(
		checkDeployment(input, request({ releases: [release] })).apiArm64,
		undefined,
	);
	assert.equal(
		checkDeployment({ ...input, websiteArm64: true }, request()).websiteArm64,
		undefined,
	);
	for (const changed of [
		{ released_arm64_artifact_name: "bible-on-site-api-docker-10-arm64" },
		{ released_artifact_name: "bible-on-site-docker-9" },
	]) {
		const wrong = {
			...release,
			body: `<!-- release-delivery:${JSON.stringify({ ...payload, ...changed })} -->`,
		};
		assert.throws(
			() => checkDeployment(input, request({ releases: [wrong] })),
			/published CI provenance/,
		);
	}
});
