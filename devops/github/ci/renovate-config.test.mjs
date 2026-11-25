import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { validateRenovateConfig } from "./renovate-config.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");

test("the repository renovate.json passes the structural validation", () => {
	assert.deepEqual(validateRenovateConfig(repoRoot), []);
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
