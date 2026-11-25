import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
	REPO_ROOT,
	RENOVATE_CONFIG_PATHS,
	validateRenovateConfig,
} from "./renovate-config.mjs";

test("the repository Renovate configuration passes the structural validation", () => {
	assert.deepEqual(validateRenovateConfig(REPO_ROOT), []);
});

test("the CLI entrypoint validates the repo regardless of cwd", () => {
	const cwd = mkdtempSync(join(tmpdir(), "renovate-config-"));
	try {
		const output = execFileSync(
			process.execPath,
			[fileURLToPath(new URL("./renovate-config.mjs", import.meta.url))],
			{ cwd, encoding: "utf8" },
		);
		assert.match(output, /passes the structural validation/);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

function fixture(config) {
	const root = mkdtempSync(join(tmpdir(), "renovate-config-"));
	writeFileSync(
		join(root, "renovate.json"),
		typeof config === "string" ? config : JSON.stringify(config),
	);
	return root;
}

function findingsOf(config) {
	const root = fixture(config);
	try {
		return validateRenovateConfig(root);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

test("missing and unparsable configs fail closed", () => {
	const empty = mkdtempSync(join(tmpdir(), "renovate-config-"));
	try {
		assert.match(validateRenovateConfig(empty)[0], /missing/);
	} finally {
		rmSync(empty, { recursive: true, force: true });
	}
	assert.match(findingsOf("{ not json")[0], /not valid JSON/);
	assert.match(findingsOf("[1]")[0], /must be a JSON object/);
});

test("alternate config locations are validated by file name", () => {
	for (const name of RENOVATE_CONFIG_PATHS.filter((n) => n !== "renovate.json")) {
		const root = mkdtempSync(join(tmpdir(), "renovate-config-"));
		try {
			mkdirSync(dirname(join(root, name)), { recursive: true });
			writeFileSync(
				join(root, name),
				JSON.stringify({ packageRules: [{ matchPackageNames: ["/(broken/"] }] }),
			);
			const findings = validateRenovateConfig(root);
			assert.match(
				findings[0],
				Reflect.construct(RegExp, [`^${name.replace(/\./g, "\\.")}\\.`]),
				name,
			);
			assert.match(findings[0], /does not compile/);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	}
});

test("a broken match-field regex is reported", () => {
	const findings = findingsOf({
		packageRules: [{ matchPackageNames: ["/(broken/"] }],
	});
	assert.equal(findings.length, 1);
	assert.match(findings[0], /does not compile/);
});

test("glob and literal match entries are not treated as regex", () => {
	assert.deepEqual(
		findingsOf({
			packageRules: [
				{ matchPackageNames: ["*", "@aws-sdk/*", "cargo-make"] },
				{ allowedVersions: "<26" },
			],
		}),
		[],
	);
});

test("regex custom managers must compile and capture currentValue", () => {
	assert.match(
		findingsOf({
			customManagers: [
				{
					customType: "regex",
					managerFilePatterns: ["/^x$/"],
					matchStrings: ["dep@(?<version>[0-9]+)"],
				},
			],
		})[0],
		/currentValue/,
	);
	assert.match(
		findingsOf({
			customManagers: [
				{
					customType: "regex",
					managerFilePatterns: ["/^x$/"],
					matchStrings: ["dep@([0-9]+"],
				},
			],
		})[0],
		/does not compile/,
	);
});

test("regex custom managers must declare nonempty managerFilePatterns", () => {
	const manager = (extra) => ({
		customManagers: [
			{
				customType: "regex",
				matchStrings: ["dep@(?<currentValue>[0-9]+)"],
				...extra,
			},
		],
	});
	for (const extra of [
		{},
		{ managerFilePatterns: [] },
		{ managerFilePatterns: "x" },
		{ managerFilePatterns: ["glob/*"] },
	]) {
		assert.match(
			findingsOf(manager(extra))[0],
			/managerFilePatterns/,
			JSON.stringify(extra),
		);
	}
});

test("container fields keep their expected shapes", () => {
	for (const [config, expected] of [
		[{ extends: "config:recommended" }, /extends must be a list/],
		[{ packageRules: { automerge: true } }, /packageRules must be a list/],
		[{ packageRules: [42] }, /must be an object/],
		[{ customManagers: [{ customType: "npm" }] }, /customType must be "regex"/],
		[{ vulnerabilityAlerts: true }, /vulnerabilityAlerts must be an object/],
	]) {
		assert.match(findingsOf(config)[0], expected, JSON.stringify(config));
	}
});
