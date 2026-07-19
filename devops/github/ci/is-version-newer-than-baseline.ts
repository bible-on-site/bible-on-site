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

import { execFileSync } from "node:child_process";
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

function getVersionAtRef(
	identifier: ModulePath | ModuleName,
	ref: string,
): string | null {
	const module = resolveModule(identifier);
	if (!module.extractFromFile) {
		return null;
	}

	try {
		const content = execFileSync("git", [
			"show",
			`${ref}:${module.versionFile}`,
		], {
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
		});
		return module.extractFromFile(content);
	} catch {
		return null;
	}
}

function isGreaterThanBaseline(
	modulePath: string,
	currentVersion: string,
	baselineVersion: string,
	baselineLabel: string,
): boolean {
	const current = semver.parse(currentVersion);
	const baseline = semver.parse(baselineVersion);

	if (!current) {
		console.error(
			`   ❌ ERROR: Invalid current version format: ${currentVersion}`,
		);
		return false;
	}
	if (!baseline) {
		console.error(
			`   ❌ ERROR: Invalid ${baselineLabel} version format: ${baselineVersion}`,
		);
		return false;
	}

	if (semver.gt(current, baseline)) {
		console.log(
			`   ✅ ${modulePath} version ${currentVersion} is greater than ${baselineLabel} version ${baselineVersion}`,
		);
		return true;
	}

	return false;
}

function verifyModule(
	identifier: ModulePath | ModuleName,
	againstRef?: string,
): boolean {
	const module = resolveModule(identifier);
	console.log(`\n📦 Verifying ${module.path} version...`);

	const currentVersion = getModuleVersion(identifier);
	console.log(`   Current version: ${currentVersion}`);

	const releasedVersion = getReleasedVersion(identifier);
	if (!releasedVersion) {
		console.log("   ✅ No previous release found - version check passed");
	} else {
		console.log(`   Released version: ${releasedVersion}`);

		if (
			!isGreaterThanBaseline(
				module.path,
				currentVersion,
				releasedVersion,
				"released",
			)
		) {
			const versionFile = getVersionFile(identifier);
			console.error(
				`   ❌ ERROR: ${module.path} version ${currentVersion} is NOT greater than released version ${releasedVersion}`,
			);
			console.error(
				`   Please bump the version in ${versionFile} before merging.`,
			);
			return false;
		}
	}

	if (againstRef) {
		const refVersion = getVersionAtRef(identifier, againstRef);
		if (!refVersion) {
			console.error(
				`   ❌ ERROR: Could not read ${module.path} version from ${againstRef}:${module.versionFile}`,
			);
			console.error(
				`   Fetch ${againstRef} or verify that ${module.versionFile} exists at that ref.`,
			);
			return false;
		}
		console.log(`   ${againstRef} version: ${refVersion}`);

		if (
			!isGreaterThanBaseline(
				module.path,
				currentVersion,
				refVersion,
				againstRef,
			)
		) {
			const versionFile = getVersionFile(identifier);
			console.error(
				`   ❌ ERROR: ${module.path} version ${currentVersion} is NOT greater than ${againstRef} version ${refVersion}`,
			);
			console.error(
				`   Please bump the version in ${versionFile} above both the latest release and ${againstRef}.`,
			);
			return false;
		}
	}

	return true;
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
		.option("against-ref", {
			type: "string",
			description:
				"Optional git ref whose module version must also be lower than the current version (prevents stale branch/version-gate collisions).",
		})
		.help().argv;

	const modulePaths = argv.module
		? [argv.module as ModulePath | ModuleName]
		: getAllModulePaths();

	console.log("🔍 Version Verification");
	console.log("========================");

	let allPassed = true;
	for (const modulePath of modulePaths) {
		if (!verifyModule(modulePath, argv.againstRef)) {
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
