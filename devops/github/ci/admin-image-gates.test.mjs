import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const workflow = readFileSync(
	new URL("../../../.github/workflows/ci.yml", import.meta.url),
	"utf8",
);
const crossModule = workflow.indexOf("\n  cross_module_ci:");
assert.notEqual(crossModule, -1, "Cross-module quality checks must exist");
const adminSettings = workflow.indexOf(
	"ADMIN_MASTER_COVERAGE_AVAILABLE=",
	crossModule,
);
assert.notEqual(adminSettings, -1, "Admin coverage selection must exist");
const start = workflow.indexOf('          if { [ "', adminSettings);
assert.notEqual(start, -1, "Admin image quality gate must exist");
const dataSettings = workflow.indexOf("DATA_MODULE_CHANGED=", start);
assert.notEqual(
	dataSettings,
	-1,
	"Admin image quality gate must end before data checks",
);
// Assignments may be inline in an if statement; exclude the entire next line.
const end = workflow.lastIndexOf("\n", dataSettings);
assert.ok(end > start, "Admin architecture checks must precede data selection");
const script = workflow.slice(start, end);
const shell =
	process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash";

function check(overrides = {}) {
	const values = {
		"github.event_name": "pull_request",
		"needs.setup_env.outputs.is_master_branch": "false",
		"needs.package_admin.result": "success",
		"needs.package_admin_arm64.result": "success",
		"needs.package_admin.outputs.module_version": "0.1.96",
		"needs.package_admin_arm64.outputs.module_version": "0.1.96",
		...overrides,
	};
	const compiled = script.replace(/\$\{\{ ([^}]+) \}\}/g, (_, key) => {
		assert.ok(Object.hasOwn(values, key), `Unknown gate input: ${key}`);
		return values[key];
	});
	const result = spawnSync(
		shell,
		["--noprofile", "--norc", "-e", "-c", compiled],
		{
			encoding: "utf8",
			env: {
				...process.env,
				ADMIN_MODULE_CHANGED: "true",
				ADMIN_CI_CHANGED: "false",
				...overrides.env,
			},
		},
	);
	assert.ifError(result.error);
	return result;
}

for (const result of ["failure", "skipped", "cancelled"]) {
	for (const job of ["package_admin", "package_admin_arm64"]) {
		test(`${job} ${result} blocks a selected admin change`, () => {
			const actual = check({ [`needs.${job}.result`]: result });
			assert.equal(actual.status, 1, actual.stderr);
			assert.match(actual.stdout, /must pass or the build did not run/);
		});
	}
}
for (const [amd64, arm64] of [
	["0.1.96", "0.1.95"],
	["", ""],
	["", "0.1.96"],
	["0.1.96", ""],
]) {
	test(`version pair ${JSON.stringify([amd64, arm64])} blocks publication`, () => {
		const actual = check({
			"needs.package_admin.outputs.module_version": amd64,
			"needs.package_admin_arm64.outputs.module_version": arm64,
		});
		assert.equal(actual.status, 1, actual.stderr);
		assert.match(actual.stdout, /same nonempty release version/);
	});
}
test("matching successful builds pass for PR and master admin changes", () => {
	assert.equal(check().status, 0);
	assert.equal(
		check({
			"github.event_name": "push",
			"needs.setup_env.outputs.is_master_branch": "true",
		}).status,
		0,
	);
});
test("a PR selecting only admin CI still requires both architecture builds", () => {
	assert.equal(
		check({
			env: { ADMIN_MODULE_CHANGED: "false", ADMIN_CI_CHANGED: "true" },
			"needs.package_admin_arm64.result": "skipped",
		}).status,
		1,
	);
});
test("a skipped arm64 build also blocks a selected master push", () => {
	assert.equal(
		check({
			"github.event_name": "push",
			"needs.setup_env.outputs.is_master_branch": "true",
			"needs.package_admin_arm64.result": "skipped",
		}).status,
		1,
	);
});
test("unselected or non-master pushes may skip both build jobs", () => {
	const skipped = {
		"needs.package_admin.result": "skipped",
		"needs.package_admin_arm64.result": "skipped",
	};
	assert.equal(
		check({
			...skipped,
			env: { ADMIN_MODULE_CHANGED: "false", ADMIN_CI_CHANGED: "false" },
		}).status,
		0,
	);
	assert.equal(check({ ...skipped, "github.event_name": "push" }).status, 0);
	assert.equal(
		check({
			...skipped,
			"github.event_name": "push",
			"needs.setup_env.outputs.is_master_branch": "true",
			env: { ADMIN_MODULE_CHANGED: "false", ADMIN_CI_CHANGED: "true" },
		}).status,
		0,
	);
});
