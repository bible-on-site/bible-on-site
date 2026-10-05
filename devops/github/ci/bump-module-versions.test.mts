import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	modulesToBump,
	nextReleaseVersion,
	type ReleaseNeeds,
	rewriteAppVersions,
	rewriteCargoVersions,
	rewritePackageVersions,
} from "./bump-module-versions.ts";

describe("modulesToBump", () => {
	it("selects released modules and ignores missing or skipped jobs", () => {
		const skipped = { result: "skipped", outputs: {} };
		const needs: ReleaseNeeds = {
			release_website: { outputs: { released: "true" } },
			release_api: { outputs: {} },
			release_app: { outputs: { released: "true" } },
			release_admin: skipped,
		};
		assert.deepEqual(modulesToBump(needs, "released"), ["website", "app"]);
	});

	it("selects only modules that need a retry bump", () => {
		const skipped = { result: "skipped", outputs: {} };
		const needs: ReleaseNeeds = {
			release_website: { outputs: { needs_bump: "true" } },
			release_api: skipped,
			release_app: { outputs: { released: "true" } },
			release_admin: { outputs: { needs_bump: "true" } },
		};
		assert.deepEqual(modulesToBump(needs, "retry"), ["website", "admin"]);
	});
});

describe("nextReleaseVersion", () => {
	it("does not bump a current version above the latest release", () => {
		assert.equal(nextReleaseVersion("5.0.118", "5.0.117", false), null);
	});

	it("bumps when the current version equals the latest release", () => {
		assert.equal(nextReleaseVersion("5.0.117", "5.0.117", false), "5.0.118");
	});

	it("does not bump without a release unless forced", () => {
		assert.equal(nextReleaseVersion("1.0.0", null, false), null);
	});

	it("force-bumps above the greater current and released version", () => {
		assert.equal(nextReleaseVersion("5.0.119", "5.0.118", true), "5.0.120");
	});

	it("force-bumps above a newer released version", () => {
		assert.equal(nextReleaseVersion("5.0.117", "5.0.118", true), "5.0.119");
	});

	it("force-bumps when no release exists", () => {
		assert.equal(nextReleaseVersion("0.1.0", null, true), "0.1.1");
	});
});

describe("rewritePackageVersions", () => {
	it("updates the package version and the lockfile root versions", () => {
		const packageText = '{"name":"package","version":"0.1.25"}';
		const lockText =
			'{"name":"package","version":"0.1.25","packages":{"":{"version":"0.1.25"},"node_modules/other":{"version":"0.1.25"}}}';
		const updated = rewritePackageVersions(packageText, lockText, "0.1.26");
		assert.equal(updated.packageText, '{"name":"package","version":"0.1.26"}');
		assert.equal(
			updated.lockText,
			'{"name":"package","version":"0.1.26","packages":{"":{"version":"0.1.26"},"node_modules/other":{"version":"0.1.25"}}}',
		);
	});
});

describe("rewriteCargoVersions", () => {
	it("bumps the manifest and the package's own lock entry", () => {
		const updated = rewriteCargoVersions(
			'[package]\nname = "crate"\nversion = "0.1.25"\n\n[dependencies]\nserde = { version = "1" }\n',
			'[[package]]\nname = "crate"\nversion = "0.1.25"\n\n[[package]]\nname = "other"\nversion = "0.1.25"\n',
			"0.1.25",
			"0.1.26",
		);
		assert.match(updated.tomlText, /^version = "0\.1\.26"$/m);
		assert.match(updated.tomlText, /serde = \{ version = "1" \}/);
		assert.match(updated.lockText, /name = "crate"\nversion = "0\.1\.26"/);
		assert.match(updated.lockText, /name = "other"\nversion = "0\.1\.25"/);
	});
});

describe("rewriteAppVersions", () => {
	it("keeps platform build numbers aligned with the display version", () => {
		const csproj = [
			"<ApplicationDisplayVersion>5.0.111</ApplicationDisplayVersion>",
			`<ApplicationVersion Condition="$(X) == 'android'">50000111</ApplicationVersion>`,
			`<ApplicationVersion Condition="$(X) != 'android'">111</ApplicationVersion>`,
		].join("\n");
		assert.equal(
			rewriteAppVersions(csproj, "5.1.112"),
			[
				"<ApplicationDisplayVersion>5.1.112</ApplicationDisplayVersion>",
				`<ApplicationVersion Condition="$(X) == 'android'">50100112</ApplicationVersion>`,
				`<ApplicationVersion Condition="$(X) != 'android'">112</ApplicationVersion>`,
			].join("\n"),
		);
	});
});
