import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { checkDeployment } from "./check-deployment.mjs";
import {
	assertRecoveryCurrentMaster,
	assertRecoveryReleaseEligibility,
	buildRecoveryReceipt,
	parseRecoveryRequest,
	readRecoveryAsset,
	validateRecoveryProof,
	validateRecoveryReceipt,
	verifyRecoveryDeployment,
	verifyRecoveryMaster,
	verifyRecoveryPackageFile,
	writeRecoveryReceipt,
} from "./recovery-request.mjs";
import { releasePayload } from "./release-provenance.mjs";

const repo = "test/repo";
const sha = "a".repeat(40);
const digest = (bytes) =>
	`sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const normal = {
	runId: 10,
	runAttempt: 1,
	workflowId: 7,
	workflowPath: ".github/workflows/ci.yml",
	sha,
};
const requestInput = {
	eventName: "workflow_dispatch",
	ref: "refs/heads/master",
	sha,
};
function input(moduleName = "admin") {
	return {
		repo,
		sha,
		requestedModules: ["admin", "bulletin"],
		moduleName,
		moduleDirectory: moduleName === "admin" ? "web/admin" : "web/bulletin",
		moduleVersion: "1.0.10",
		ci: { runId: 20, runAttempt: 1, workflowId: 7 },
		normalMasterCi: { ...normal },
		artifact: {
			id: 100,
			name: `${moduleName}-archive`,
			digest: `sha256:${"b".repeat(64)}`,
		},
		releaseFile: {
			name:
				moduleName === "admin"
					? "bible-on-site-admin-v1.0.10.tar.gz"
					: "bulletin-lambda-v1.0.10.zip",
			size: 4,
			digest: digest("file"),
		},
	};
}
function run(event = "push", overrides = {}) {
	return {
		id: event === "push" ? 10 : 20,
		name: "Continuous Integration",
		event,
		head_branch: "master",
		head_sha: sha,
		workflow_id: 7,
		run_attempt: 1,
		status: "completed",
		conclusion: "success",
		...overrides,
	};
}
function job(name, overrides = {}) {
	return { id: 1, name, run_attempt: 1, conclusion: "success", ...overrides };
}
function fixture(overrides = {}) {
	const source = run("workflow_dispatch", overrides.source);
	const receipt = buildRecoveryReceipt(input(overrides.moduleName));
	if (overrides.mutateReceipt) overrides.mutateReceipt(receipt);
	const bytes = Buffer.from(JSON.stringify(receipt));
	const proof = {
		schemaVersion: 1,
		receipt: {
			name: `release-recovery-${receipt.moduleName}.json`,
			size: bytes.length,
			digest: digest(bytes),
		},
		artifact: { ...receipt.artifact },
	};
	const provenance = {
		ref: sha,
		module_name: receipt.moduleName,
		module_directory: receipt.moduleDirectory,
		module_version: "1.0.10",
		ci_run_id: 20,
		ci_run_attempt: 1,
		released_artifact_name: receipt.artifact.name,
		recovery: proof,
	};
	const release = {
		tag_name: `${receipt.moduleName}-v1.0.10`,
		draft: false,
		prerelease: false,
		body: `<!-- release-delivery:${JSON.stringify(provenance)} -->`,
		assets: [
			{
				id: 300,
				state: "uploaded",
				...proof.receipt,
				browser_download_url: "https://untrusted.example/ignored",
			},
			{ id: 301, state: "uploaded", ...receipt.releaseFile },
		],
	};
	if (overrides.mutateRelease) overrides.mutateRelease(release);
	const calls = [];
	const request = (endpoint) => {
		calls.push(endpoint);
		if (endpoint.endsWith("/branches/master"))
			return overrides.branch ?? { protected: true, commit: { sha } };
		if (endpoint.endsWith("/actions/workflows/ci.yml"))
			return overrides.workflow ?? { id: 7, path: ".github/workflows/ci.yml" };
		if (endpoint.includes("/actions/workflows/7/runs?"))
			return { workflow_runs: overrides.masterRuns ?? [run()] };
		if (endpoint.endsWith("/actions/runs/10"))
			return overrides.normalRun ?? run();
		if (endpoint.endsWith("/actions/runs/10/attempts/1"))
			return overrides.normalAttempt ?? run();
		if (endpoint.includes("/runs/10/jobs?"))
			return { jobs: overrides.normalJobs ?? [job("Cross Module CI")] };
		if (endpoint.includes("/runs/20/jobs?"))
			return {
				jobs: overrides.manualJobs ?? [
					job("Cross Module CI"),
					job("Package Admin"),
					job("Package Bulletin"),
				],
			};
		throw new Error(`Unexpected fixture API endpoint: ${endpoint}`);
	};
	const reads = [];
	const readAsset = (repository, id) => {
		reads.push([repository, id]);
		return overrides.bytes ?? bytes;
	};
	const argumentsValue = {
		repo,
		source,
		runAttempt: 1,
		moduleName: receipt.moduleName,
		moduleDirectory: receipt.moduleDirectory,
		version: "1.0.10",
		release,
		provenance,
	};
	return {
		...argumentsValue,
		argumentsValue,
		proof,
		receipt,
		bytes,
		request,
		readAsset,
		reads,
		calls,
	};
}

for (const [requested, expected] of [
	[undefined, []],
	["none", []],
	["admin", ["admin"]],
	["bulletin", ["bulletin"]],
	["admin-and-bulletin", ["admin", "bulletin"]],
]) {
	test(`explicit recovery selection ${requested} is bounded`, () => {
		assert.deepEqual(
			parseRecoveryRequest({ ...requestInput, requested }),
			expected,
		);
	});
}
test("ordinary push/PR/default dispatch do not acquire recovery release intent", () => {
	for (const eventName of [
		"push",
		"pull_request",
		"merge_group",
		"workflow_dispatch",
	])
		assert.deepEqual(parseRecoveryRequest({ eventName }), []);
	for (const requested of [
		"website",
		"data",
		"all",
		"admin,bulletin",
		true,
		{},
		null,
	])
		assert.throws(
			() => parseRecoveryRequest({ ...requestInput, requested }),
			/Unknown/,
		);
	for (const change of [
		{ eventName: "push" },
		{ eventName: "pull_request" },
		{ ref: "refs/heads/feature" },
		{ ref: "refs/tags/v1" },
		{ sha: "master" },
	])
		assert.throws(
			() =>
				parseRecoveryRequest({
					...requestInput,
					requested: "admin",
					...change,
				}),
			/explicit master/,
		);
});
test("reusable publication permits push unchanged and only the explicitly selected recovery modules", () => {
	assert.doesNotThrow(() =>
		assertRecoveryReleaseEligibility({
			eventName: "push",
			moduleName: "website",
			requestedModules: [],
		}),
	);
	assert.doesNotThrow(() =>
		assertRecoveryReleaseEligibility({
			eventName: "workflow_dispatch",
			moduleName: "admin",
			requestedModules: ["admin", "bulletin"],
		}),
	);
	for (const item of [
		{
			eventName: "workflow_dispatch",
			moduleName: "website",
			requestedModules: ["admin"],
		},
		{
			eventName: "workflow_dispatch",
			moduleName: "admin",
			requestedModules: [],
		},
		{
			eventName: "workflow_dispatch",
			moduleName: "admin",
			requestedModules: ["bulletin"],
		},
		{
			eventName: "pull_request",
			moduleName: "admin",
			requestedModules: ["admin"],
		},
	])
		assert.throws(
			() => assertRecoveryReleaseEligibility(item),
			/explicitly selected/,
		);
});
test("master preflight requires current protected source and latest normal push CI green", () => {
	const f = fixture();
	assert.deepEqual(verifyRecoveryMaster({ repo, sha }, f.request), normal);
	assert.equal(
		f.calls.filter((call) => call.endsWith("/branches/master")).length,
		2,
	);
});
for (const [name, overrides] of [
	[
		"stale master",
		{ branch: { protected: true, commit: { sha: "b".repeat(40) } } },
	],
	["unprotected master", { branch: { protected: false, commit: { sha } } }],
	[
		"wrong workflow path",
		{ workflow: { id: 7, path: ".github/workflows/other.yml" } },
	],
	["no normal CI", { masterRuns: [] }],
	[
		"failed normal CI",
		{ masterRuns: [run("push", { conclusion: "failure" })] },
	],
	[
		"running normal CI",
		{ masterRuns: [run("push", { status: "in_progress", conclusion: null })] },
	],
	[
		"later failed normal run",
		{ masterRuns: [run(), run("push", { id: 11, conclusion: "failure" })] },
	],
	[
		"skipped quality gate",
		{ normalJobs: [job("Cross Module CI", { conclusion: "skipped" })] },
	],
	[
		"cancelled quality gate",
		{ normalJobs: [job("Cross Module CI", { conclusion: "cancelled" })] },
	],
])
	test(`preflight rejects ${name}`, () => {
		const f = fixture(overrides);
		assert.throws(() => verifyRecoveryMaster({ repo, sha }, f.request));
	});

test("master preflight is an exact SHA check, not ancestor or a mutable ref", () => {
	assert.throws(
		() =>
			assertRecoveryCurrentMaster({ repo, sha: "master" }, () => {
				throw new Error("No API expected");
			}),
		/immutable/,
	);
	assert.throws(
		() => assertRecoveryCurrentMaster({ repo: "../repo", sha }, () => {}),
		/repository/,
	);
});
test("receipt writer hashes the actual contained release file, not its Actions ZIP digest", async (t) => {
	const folder = mkdtempSync(join(tmpdir(), "release-recovery-"));
	t.after(() => {
		assert.ok(folder.startsWith(join(tmpdir(), "release-recovery-")));
		rmSync(folder, { recursive: true, force: true });
	});
	const filePath = join(folder, "bible-on-site-admin-v1.0.10.tar.gz");
	writeFileSync(filePath, "exact package");
	const value = input();
	value.releaseFile = {
		name: "bible-on-site-admin-v1.0.10.tar.gz",
		path: filePath,
	};
	const receiptPath = join(folder, "release-recovery-admin.json");
	const proof = await writeRecoveryReceipt(value, receiptPath);
	const bytes = readFileSync(receiptPath);
	const receipt = JSON.parse(bytes);
	assert.deepEqual(receipt.releaseFile, {
		name: "bible-on-site-admin-v1.0.10.tar.gz",
		size: 13,
		digest: digest("exact package"),
	});
	assert.equal(proof.receipt.digest, digest(bytes));
	assert.equal(proof.receipt.size, bytes.length);
	assert.equal(Object.hasOwn(receipt.releaseFile, "path"), false);
	assert.notEqual(receipt.artifact.digest, receipt.releaseFile.digest);
	await verifyRecoveryPackageFile({
		filename: filePath,
		moduleName: "admin",
		version: "1.0.10",
		expected: receipt.releaseFile,
	});
	writeFileSync(filePath, "other package");
	await assert.rejects(
		verifyRecoveryPackageFile({
			filename: filePath,
			moduleName: "admin",
			version: "1.0.10",
			expected: receipt.releaseFile,
		}),
		/bytes/,
	);
	await assert.rejects(
		writeRecoveryReceipt(value, join(folder, "arbitrary.json")),
		/output name/,
	);
	await assert.rejects(
		writeRecoveryReceipt(
			{ ...value, releaseFile: { name: "different.tar.gz", path: filePath } },
			receiptPath,
		),
		/package path/,
	);
});
for (const [name, change] of [
	[
		"unsupported module",
		(v) => {
			v.moduleName = "website";
		},
	],
	[
		"wrong directory",
		(v) => {
			v.moduleDirectory = "web/bible-on-site";
		},
	],
	[
		"wrong source",
		(v) => {
			v.sha = "master";
		},
	],
	[
		"unselected module",
		(v) => {
			v.requestedModules = ["bulletin"];
		},
	],
	[
		"duplicate selection",
		(v) => {
			v.requestedModules = ["admin", "admin"];
		},
	],
	[
		"normal different SHA",
		(v) => {
			v.normalMasterCi.sha = "b".repeat(40);
		},
	],
	[
		"normal future run",
		(v) => {
			v.normalMasterCi.runId = 21;
		},
	],
	[
		"wrong normal workflow",
		(v) => {
			v.normalMasterCi.workflowId = 8;
		},
	],
	[
		"nonpositive attempt",
		(v) => {
			v.ci.runAttempt = 0;
		},
	],
	[
		"archive missing digest",
		(v) => {
			delete v.artifact.digest;
		},
	],
	[
		"archive arbitrary URL",
		(v) => {
			v.artifact.url = "https://untrusted.example/";
		},
	],
	[
		"wrong asset type",
		(v) => {
			v.releaseFile.name = "file.zip";
		},
	],
	[
		"release file missing digest",
		(v) => {
			delete v.releaseFile.digest;
		},
	],
])
	test(`receipt construction rejects ${name}`, () => {
		const v = input();
		change(v);
		assert.throws(() => buildRecoveryReceipt(v));
	});

for (const moduleName of ["admin", "bulletin"])
	test(`CD verifies ${moduleName} manual recovery only through fixed release-asset API`, () => {
		const f = fixture({ moduleName });
		assert.deepEqual(
			verifyRecoveryDeployment(f.argumentsValue, f.request, f.readAsset),
			{ receipt: f.receipt, file: { id: 301, ...f.receipt.releaseFile } },
		);
		assert.deepEqual(f.reads, [[repo, 300]]);
		assert.equal(
			f.calls.some((call) => call.includes("/branches/")),
			false,
			"normal post-release version bump must not invalidate CD",
		);
		assert.deepEqual(releasePayload(f.release).recovery, f.proof);
	});
test("default receipt reader uses fixed repo asset ID endpoint and bounds bytes", () => {
	let called;
	const bytes = readRecoveryAsset(repo, 300, (command, args, options) => {
		called = { command, args, options };
		return Buffer.from("{}");
	});
	assert.equal(bytes.toString(), "{}");
	assert.equal(called.command, "gh");
	assert.deepEqual(called.args, [
		"api",
		"repos/test/repo/releases/assets/300",
		"-H",
		"Accept: application/octet-stream",
	]);
	assert.equal(called.options.maxBuffer, 65_536);
	assert.throws(
		() => readRecoveryAsset(repo, "https://untrusted.example/", () => {}),
		/asset ID/,
	);
});
for (const [name, overrides] of [
	[
		"failed package",
		{
			manualJobs: [
				job("Cross Module CI"),
				job("Package Admin", { conclusion: "failure" }),
				job("Package Bulletin"),
			],
		},
	],
	[
		"skipped selected package",
		{
			manualJobs: [
				job("Cross Module CI"),
				job("Package Admin"),
				job("Package Bulletin", { conclusion: "skipped" }),
			],
		},
	],
	[
		"manual gate failed",
		{
			manualJobs: [
				job("Cross Module CI", { conclusion: "failure" }),
				job("Package Admin"),
				job("Package Bulletin"),
			],
		},
	],
	["wrong workflow ID", { source: { workflow_id: 9 } }],
	["wrong event", { source: { event: "push" } }],
	["wrong branch", { source: { head_branch: "feature" } }],
	["normal failure", { normalRun: run("push", { conclusion: "failure" }) }],
	[
		"recorded normal attempt failed",
		{
			normalRun: run("push", { run_attempt: 2 }),
			normalAttempt: run("push", { conclusion: "failure" }),
		},
	],
	[
		"normal source mismatch",
		{ normalRun: run("push", { head_sha: "b".repeat(40) }) },
	],
	["receipt bytes changed", { bytes: Buffer.from("corrupted") }],
	[
		"missing receipt asset",
		{
			mutateRelease: (r) => {
				r.assets.shift();
			},
		},
	],
	[
		"package bytes digest changed",
		{
			mutateRelease: (r) => {
				r.assets[1].digest = `sha256:${"c".repeat(64)}`;
			},
		},
	],
	[
		"duplicate receipt asset",
		{
			mutateRelease: (r) => {
				r.assets.push({ ...r.assets[0], id: 999 });
			},
		},
	],
	[
		"extra candidate ZIP",
		{
			moduleName: "bulletin",
			mutateRelease: (r) => {
				r.assets.push({
					id: 500,
					name: "extra.zip",
					state: "uploaded",
					size: 4,
					digest: digest("file"),
				});
			},
		},
	],
	[
		"receipt repo mismatch",
		{
			mutateReceipt: (r) => {
				r.repo = "other/repo";
			},
		},
	],
	[
		"receipt manual attempt mismatch",
		{
			mutateReceipt: (r) => {
				r.ci.runAttempt = 2;
			},
		},
	],
	[
		"receipt SHA mismatch",
		{
			mutateReceipt: (r) => {
				r.sha = "b".repeat(40);
			},
		},
	],
	[
		"receipt source workflow path",
		{
			mutateReceipt: (r) => {
				r.ci.workflowPath = ".github/workflows/other.yml";
			},
		},
	],
])
	test(`CD rejects ${name}`, () => {
		const f = fixture(overrides);
		assert.throws(() =>
			verifyRecoveryDeployment(f.argumentsValue, f.request, f.readAsset),
		);
	});
test("original passing attempts remain valid after later reruns, without accepting their new artifacts", () => {
	const f = fixture({
		source: { run_attempt: 2, conclusion: "failure" },
		normalRun: run("push", { run_attempt: 2, conclusion: "failure" }),
		normalJobs: [
			job("Cross Module CI"),
			job("Cross Module CI", { id: 2, run_attempt: 2, conclusion: "failure" }),
		],
		manualJobs: [
			job("Cross Module CI"),
			job("Package Admin"),
			job("Package Bulletin"),
			job("Cross Module CI", { id: 9, run_attempt: 2, conclusion: "failure" }),
		],
	});
	assert.deepEqual(
		verifyRecoveryDeployment(f.argumentsValue, f.request, f.readAsset),
		{ receipt: f.receipt, file: { id: 301, ...f.receipt.releaseFile } },
	);
	const expected = {
		repo,
		sha,
		moduleName: "admin",
		moduleDirectory: "web/admin",
		moduleVersion: "1.0.10",
		runId: 20,
		runAttempt: 1,
		workflowId: 7,
		artifact: { ...f.proof.artifact, id: 999 },
	};
	assert.throws(() => validateRecoveryReceipt(f.receipt, expected), /differs/);
});
test("an incoming dispatch marker is not proof and unsupported release provenance fails", () => {
	const f = fixture();
	assert.throws(
		() =>
			verifyRecoveryDeployment(
				{
					...f.argumentsValue,
					provenance: { ...f.provenance, recovery: undefined },
				},
				f.request,
				f.readAsset,
			),
		/provenance/,
	);
	assert.throws(
		() =>
			validateRecoveryProof(
				{ ...f.proof, url: "https://untrusted.example" },
				"admin",
			),
		/provenance/,
	);
	assert.throws(() => validateRecoveryProof(f.proof, "app"), /provenance/);
});

test("manual deployment guard returns only the verified canonical download proof", () => {
	const f = fixture();
	const request = (endpoint) => {
		if (endpoint.endsWith("/actions/runs/20")) return f.source;
		if (endpoint.includes("/compare/")) return { status: "identical" };
		if (endpoint.includes("/releases?")) return [f.release];
		return f.request(endpoint);
	};
	assert.deepEqual(
		checkDeployment(
			{
				repo,
				runId: 20,
				ref: sha,
				moduleName: "admin",
				moduleDirectory: "web/admin",
				version: "1.0.10",
			},
			request,
			f.readAsset,
		),
		{
			deploy: true,
			ref: sha,
			version: "1.0.10",
			runAttempt: 1,
			recoveryFile: { id: 301, ...f.receipt.releaseFile },
		},
	);
	const superseded = (endpoint) =>
		endpoint.includes("/releases?")
			? [f.release, { tag_name: "admin-v1.0.11" }]
			: request(endpoint);
	assert.equal(
		checkDeployment(
			{
				repo,
				runId: 20,
				ref: sha,
				moduleName: "admin",
				moduleDirectory: "web/admin",
				version: "1.0.10",
			},
			superseded,
			() => {
				throw new Error("Superseded release must not download");
			},
		).deploy,
		false,
	);
	const noProof = { ...f.provenance };
	delete noProof.recovery;
	f.release.body = `<!-- release-delivery:${JSON.stringify(noProof)} -->`;
	assert.throws(
		() =>
			checkDeployment(
				{
					repo,
					runId: 20,
					ref: sha,
					moduleName: "admin",
					moduleDirectory: "web/admin",
					version: "1.0.10",
					recovery: f.proof,
				},
				request,
				f.readAsset,
			),
		/provenance/,
	);
});

test("the publisher's final standalone metadata wins over a marker in a PR title", () => {
	const f = fixture();
	const trusted = JSON.stringify(f.provenance);
	const body = `Release notes\n- PR title <!-- release-delivery:{"ref":"poison"} -->\n\n<!-- release-delivery:${trusted} -->\r\n\n`;
	assert.deepEqual(releasePayload({ ...f.release, body }), f.provenance);
	assert.throws(
		() =>
			releasePayload({
				...f.release,
				body: `Notes <!-- release-delivery:${trusted} -->`,
			}),
		/final standalone/,
	);
	assert.throws(
		() =>
			releasePayload({
				...f.release,
				body: `<!-- release-delivery:${trusted} -->\nUnexpected trailing text`,
			}),
		/final standalone/,
	);
	assert.equal(
		releasePayload({
			...f.release,
			body: "Legacy release without delivery metadata",
		}),
		undefined,
	);
});

test("recovery CD workflows download a pinned numeric asset and verify its bytes before deployment", () => {
	for (const file of ["cd-aws.yml", "cd-bulletin.yml"]) {
		const workflow = readFileSync(
			new URL(`../../../.github/workflows/${file}`, import.meta.url),
			"utf8",
		);
		assert.match(
			workflow,
			/RECOVERY_FILE_ID: \$\{\{ steps\.guard\.outputs\.recovery_file_id \}\}/,
		);
		assert.match(
			workflow,
			/gh api "repos\/\$GITHUB_REPOSITORY\/releases\/assets\/\$RECOVERY_FILE_ID"/,
		);
		assert.match(workflow, /recovery-request\.mjs --verify-file --file/);
		assert.ok(
			workflow.indexOf("--verify-file") <
				workflow.indexOf(
					file === "cd-aws.yml"
						? "- name: Deploy to ECR"
						: "- name: Deploy to Lambda",
				),
		);
		assert.match(workflow, /else\n\s+gh release download/);
	}
	const bulletin = readFileSync(
		new URL("../../../.github/workflows/cd-bulletin.yml", import.meta.url),
		"utf8",
	);
	assert.match(
		bulletin,
		/LAMBDA_ZIP="\$LAMBDA_ZIP_OUTPUT_DIR\/\$RECOVERY_FILE_NAME"/,
	);
});
