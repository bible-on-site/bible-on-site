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
	it("ignores outputs from a failed release/dispatch", () => {
		const needs: ReleaseNeeds = {
			release_website: {
				result: "failure",
				outputs: { released: "true", needs_bump: "true" },
			},
		};
		assert.deepEqual(modulesToBump(needs, "released"), []);
		assert.deepEqual(modulesToBump(needs, "retry"), []);
	});
	it("selects released modules and ignores missing or skipped jobs", () => {
		const skipped = { result: "skipped", outputs: {} };
		const needs: ReleaseNeeds = {
			release_website: { result: "success", outputs: { released: "true" } },
			release_api: { result: "success", outputs: {} },
			release_app: { result: "success", outputs: { released: "true" } },
			release_admin: skipped,
		};
		assert.deepEqual(modulesToBump(needs, "released"), ["website", "app"]);
	});

	it("selects only modules that need a retry bump", () => {
		const skipped = { result: "skipped", outputs: {} };
		const needs: ReleaseNeeds = {
			release_website: { result: "success", outputs: { needs_bump: "true" } },
			release_api: skipped,
			release_app: { result: "success", outputs: { released: "true" } },
			release_admin: { result: "success", outputs: { needs_bump: "true" } },
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
	it("bumps the manifest version and leaves the bun lockfile untouched", () => {
		const packageText = '{"name":"package","version":"0.1.25"}';
		const lockText =
			'{\n  "lockfileVersion": 3,\n  "configVersion": 1,\n  "workspaces": {}\n}\n';
		const updated = rewritePackageVersions(packageText, lockText, "0.1.26");
		assert.equal(updated.packageText, '{"name":"package","version":"0.1.26"}');
		assert.equal(updated.lockText, lockText);
	});

	it("rejects an npm-format lockfile", () => {
		assert.throws(
			() =>
				rewritePackageVersions(
					'{"name":"package","version":"0.1.25"}',
					'{"name":"package","version":"0.1.25","packages":{"":{"version":"0.1.25"}}}',
					"0.1.26",
				),
			/Expected bun\.lock content/,
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
	const csproj = (display: string, shared: number, windows: number) =>
		[
			`<ApplicationDisplayVersion>${display}</ApplicationDisplayVersion>`,
			`<ApplicationVersion Condition="$(X) != 'windows'">${shared}</ApplicationVersion>`,
			`<ApplicationVersion Condition="$(X) == 'windows'">${windows}</ApplicationVersion>`,
		].join("\n");

	it("keeps platform build numbers aligned with the display version", () => {
		assert.equal(
			rewriteAppVersions(csproj("5.0.111", 50000111, 0), "5.1.112"),
			csproj("5.1.112", 50100112, 0),
		);
	});

	it("advances the shared build number when a minor bump resets the patch", () => {
		assert.equal(
			rewriteAppVersions(csproj("5.0.224", 50000224, 0), "5.1.0"),
			csproj("5.1.0", 50100000, 0),
		);
	});

	it("advances the shared build number on the first patch after a minor bump", () => {
		assert.equal(
			rewriteAppVersions(csproj("5.1.0", 50100000, 0), "5.1.1"),
			csproj("5.1.1", 50100001, 0),
		);
	});
});
