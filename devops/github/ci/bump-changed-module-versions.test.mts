import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nextModuleVersion } from "./auto-bump-website-version.ts";
import {
	changedModules,
	rewriteAppVersions,
	rewriteCargoVersions,
} from "./bump-changed-module-versions.ts";

describe("changedModules", () => {
	it("maps changed files to their modules only", () => {
		assert.deepEqual(
			changedModules([
				"app/devops/_build.csproj",
				"web/bulletin/Cargo.lock",
				"web/admin-other/x",
				"devops/package.json",
			]),
			["web/bulletin", "app"],
		);
	});
});

describe("nextModuleVersion", () => {
	it("bumps above the greater of base and release", () => {
		assert.equal(nextModuleVersion("0.1.25", "0.1.25", "0.1.24"), "0.1.26");
		assert.equal(nextModuleVersion("5.0.108", "5.0.108", "5.0.110"), "5.0.111");
		assert.equal(nextModuleVersion("0.1.101", "0.1.100", "0.1.99"), null);
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
