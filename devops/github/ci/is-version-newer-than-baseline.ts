#!/usr/bin/env npx tsx
/**
 * CI version verification script.
 * Compares current version against the latest released git tag.
 * Exits with error if current version is not greater than released version.
 *
 * Usage: npx tsx is-version-newer-than-baseline.ts [--module <app|web/api|web/bible-on-site>]
 *        Also accepts short names: app, api, website
 *        If no module specified, verifies all modules.
 */

import * as semver from "semver";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import {
	getAllModulePaths,
	getModuleVersion,
	getVersionFile,
	type ModuleName,
	type ModulePath,
	resolveModule,
} from "../../get-module-version.ts";
import { getReleasedVersion } from "../release/get-version.ts";

function verifyModule(identifier: ModulePath | ModuleName): boolean {
	const module = resolveModule(identifier);
	console.log(`\n📦 Verifying ${module.path} version...`);

	const currentVersion = getModuleVersion(identifier);
	console.log(`   Current version: ${currentVersion}`);

	const releasedVersion = getReleasedVersion(identifier);
	if (!releasedVersion) {
		console.log("   ✅ No previous release found - version check passed");
		return true;
	}
	console.log(`   Released version: ${releasedVersion}`);

	const current = semver.parse(currentVersion);
	const released = semver.parse(releasedVersion);

	if (!current) {
		console.error(
			`   ❌ ERROR: Invalid current version format: ${currentVersion}`,
		);
		return false;
	}
	if (!released) {
		console.error(
			`   ❌ ERROR: Invalid released version format: ${releasedVersion}`,
		);
		return false;
	}

	if (semver.gt(current, released)) {
		console.log(
			`   ✅ ${module.path} version ${currentVersion} is greater than released version ${releasedVersion}`,
		);
		return true;
	}

	const versionFile = getVersionFile(identifier);
	console.error(
		`   ❌ ERROR: ${module.path} version ${currentVersion} is NOT greater than released version ${releasedVersion}`,
	);
	console.error(`   Please bump the version in ${versionFile} before merging.`);
	return false;
}

async function main() {
	const argv = await yargs(hideBin(process.argv))
		.option("module", {
			alias: "m",
			type: "string",
			description: "Module path or name. If not specified, verifies all.",
		choices: [
			"app",
			"web/admin",
			"web/api",
			"web/bible-on-site",
			"web/bulletin",
			"admin",
			"api",
			"website",
			"bulletin",
		] as const,
		})
		.help().argv;

	const modulePaths = argv.module
		? [argv.module as ModulePath | ModuleName]
		: getAllModulePaths();

	console.log("🔍 Version Verification");
	console.log("========================");

	let allPassed = true;
	for (const modulePath of modulePaths) {
		if (!verifyModule(modulePath)) {
			allPassed = false;
		}
	}

	console.log("\n========================");
	if (allPassed) {
		console.log("✅ All version checks passed!");
		process.exit(0);
	} else {
		console.log("❌ Some version checks failed!");
		process.exit(1);
	}
}

main();
