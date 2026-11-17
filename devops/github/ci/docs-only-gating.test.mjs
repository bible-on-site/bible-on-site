// Docs-only routing contract (#3621): a change confined to the repository-root
// docs/ tree must not run heavy validation, yet every required check must still
// resolve. These tests parse the real workflow YAML and walk the job graph so a
// router that wrongly reports docs_only cannot hide behind an unconditional job.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseDocument } from "yaml";

const workflowDir = new URL("../../../.github/workflows/", import.meta.url);
const load = (name) => {
	const document = parseDocument(
		readFileSync(new URL(name, workflowDir), "utf8"),
	);
	assert.deepEqual(document.errors, [], `${name} must parse as YAML`);
	return document.toJS();
};

const ci = load("ci.yml");
const jobs = ci.jobs;

// The router output every gate consumes.
test("determine_changes publishes the docs_only output", () => {
	assert.equal(
		jobs.determine_changes.outputs.docs_only,
		"${{ steps.determine.outputs.docs_only }}",
	);
});

// Jobs allowed to evaluate to a run while docs_only is true: the router, the
// detection tier that feeds recovery triggers and module outputs, and the
// required status-resolution aggregator (which restores the trusted master
// baselines and republishes real coverage so codecov/* and Cross Module CI
// contexts arrive honestly). Detection is not validation: a missing baseline
// must still trigger the module recovery run even on docs-only changes.
// Every other job must carry a gate that can only be true when module flags,
// baselines or a non-docs gate say so.
const EXEMPT = new Set([
	"determine_changes",
	"setup_env",
	"determine_baseline_availability",
	"determine_docker_image_availability",
	"cross_module_ci",
]);
const DOCS_PROOF =
	/docs_only|_module_changed|_ci_changed|_deploy_changed|_schema_only_changed|is_master_branch|_available|result != 'skipped'/;

test("every non-exempt job is proof-gated off docs-only work", () => {
	for (const [name, job] of Object.entries(jobs)) {
		if (EXEMPT.has(name)) continue;
		assert.ok(
			typeof job.if === "string" && job.if.length > 0,
			`${name} runs unconditionally and would execute on a docs-only change`,
		);
		assert.match(
			job.if,
			DOCS_PROOF,
			`${name} lacks a gate that excludes docs-only runs: ${job.if}`,
		);
	}
});

test("preamble and independent validation jobs skip through the shared gate", () => {
	for (const name of [
		"workflow_timeouts",
		"root_evidence_guard",
		"database_backups",
		"transcription_ci",
		"perushim_data",
	]) {
		assert.ok(jobs[name], `missing job ${name}`);
		assert.ok(
			job_if_includes(name, "docs_only != 'true'"),
			`${name} must skip docs-only runs`,
		);
	}
});

test("the detection tier never skips: baseline gaps must still recover", () => {
	for (const name of [
		"setup_env",
		"determine_baseline_availability",
		"determine_docker_image_availability",
	]) {
		assert.ok(jobs[name], `missing job ${name}`);
		assert.ok(
			!job_if_includes(name, "docs_only"),
			`${name} must run on docs-only changes so a missing baseline ` +
				"can trigger the module recovery run that republishes it",
		);
	}
	// The consolidated flag re-enables the aggregator gate and lets
	// perushim_data heal its own baselines on docs-only runs.
	assert.equal(
		jobs.determine_baseline_availability.outputs.baseline_recovery_required,
		"${{ steps.check_master_coverage_artifacts.outputs.baseline_recovery_required }}",
	);
	assert.ok(
		job_if_includes("perushim_data", "baseline_recovery_required == 'true'"),
		"perushim_data must heal missing perushim baselines on docs-only runs",
	);
});

function job_if_includes(name, needle) {
	const value = String(jobs[name].if ?? "");
	return value.includes(needle);
}

test("the required aggregator always evaluates and gates recovered work", () => {
	assert.equal(jobs.cross_module_ci.if, "${{ always() && !cancelled() }}");
	const check = jobs.cross_module_ci.steps.find(
		(step) => step.id === "check_prerequisites",
	);
	assert.ok(check, "cross_module_ci lost its prerequisite gate step");
	// A docs-only run skips the gate entirely unless a baseline gap triggered
	// module recovery — that recovery must then pass the gate like real work.
	assert.ok(String(check.if).includes("docs_only != 'true'"));
	assert.ok(String(check.if).includes("baseline_recovery_required == 'true'"));
	assert.ok(
		String(check.run).includes("docs_only"),
		"docs-only runs must not demand results from docs-gated suites",
	);
	// The coverage tail must stay ungated: master-baseline restore plus the
	// real codecov uploads are what resolve the required codecov contexts.
	const publish = jobs.cross_module_ci.steps.filter(
		(step) => step.uses === "codecov/codecov-action@v7",
	);
	assert.ok(publish.length >= 6, "every module flag must republish coverage");
	for (const step of publish)
		assert.equal(step.if, undefined, `${step.name} must not skip docs-only`);
});

test("releases and version bumps stay tied to module changes on master", () => {
	for (const name of [
		"release_website",
		"release_api",
		"release_app",
		"release_bulletin",
		"release_admin",
	]) {
		assert.match(
			String(jobs[name].if),
			/_module_changed == 'true'/,
			`${name} must require a module change`,
		);
		assert.match(
			String(jobs[name].if),
			/is_master_branch == 'true'/,
			`${name} must require the master branch`,
		);
	}
	assert.match(
		String(jobs.release_data.if),
		/module_changed == 'true'|data_deploy_changed == 'true'/,
	);
	assert.match(String(jobs.bump_versions.if), /is_master_branch == 'true'/);
	// Pending-release reconciliation must not revive on a docs-only push.
	const pending = jobs.determine_changes.steps.find(
		(step) => step.id === "pending-api",
	);
	assert.ok(pending, "determine_changes lost its pending-API step");
	assert.ok(String(pending.if).includes("docs_only != 'true'"));
});

test("auxiliary workflows gate merge-group work through the shared router", () => {
	for (const [file, downstream] of [
		["ci-data-deploy.yml", ["test"]],
		["perek-images.yml", ["prepare-images"]],
		["dependency-submission.yml", ["submit-snapshots"]],
		["dependency-review.yml", ["nuget-snapshots", "dependency-review"]],
	]) {
		const workflow = load(file);
		const detect = workflow.jobs.detect_docs;
		assert.ok(detect, `${file} needs the shared docs-only detector`);
		assert.equal(
			detect.outputs.docs_only,
			"${{ steps.detect.outputs.docs_only }}",
		);
		assert.ok(
			detect.steps.some(
				(step) => step.run === "node devops/github/ci/determine-changes.ts",
			),
			`${file} must reuse the shared router, not a copy`,
		);
		for (const name of downstream) {
			const job = workflow.jobs[name];
			assert.ok(job, `${file} missing job ${name}`);
			assert.ok(
				String(job.needs).includes("detect_docs"),
				`${file}:${name} must need detect_docs`,
			);
			assert.ok(
				String(job.if).includes(
					"needs.detect_docs.outputs.docs_only != 'true'",
				),
				`${file}:${name} must skip docs-only runs`,
			);
		}
	}
});

test("required status checks still resolve on docs-only merges", () => {
	// submit-nuget is a required check: an always-evaluating resolver keeps it
	// green while the real submission work is gated.
	for (const file of [
		"dependency-submission.yml",
		"dependency-review.yml",
	]) {
		const job = load(file).jobs["submit-nuget"];
		assert.ok(job, `${file} missing submit-nuget`);
		assert.equal(job.if, "${{ always() && !cancelled() }}");
		const verify = job.steps.find((step) =>
			String(step.run ?? "").includes("DOCS_ONLY"),
		);
		assert.ok(verify, `${file}: submit-nuget lost its docs-only resolution`);
	}
	// CodeQL must keep scanning: the code-scanning ruleset requires real
	// results for the updated commit, so a docs-only change cannot skip it.
	const analyze = load("codeql.yml").jobs.analyze;
	assert.equal(
		analyze.if,
		undefined,
		"CodeQL analyze must run on docs-only changes — a skipped analysis " +
			"leaves the required code-scanning check pending forever",
	);
});
