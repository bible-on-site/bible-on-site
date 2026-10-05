#!/usr/bin/env npx tsx

import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import semver from "semver";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import {
	getModuleVersion,
	type ModuleConfig,
	type ModuleName,
	resolveModule,
} from "../../get-module-version.ts";
import { getReleasedVersion } from "../release/get-version.ts";

export type ReleaseNeeds = Record<string, { outputs?: Record<string, string> }>;

const moduleNames: ModuleName[] = [
	"website",
	"api",
	"app",
	"admin",
	"bulletin",
];

const repoRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../../..",
);

export function modulesToBump(
	needs: ReleaseNeeds,
	mode: "released" | "retry",
): ModuleName[] {
	const outputName = mode === "released" ? "released" : "needs_bump";
	return moduleNames.filter(
		(name) => needs[`release_${name}`]?.outputs?.[outputName] === "true",
	);
}

export function nextReleaseVersion(
	current: string,
	released: string | null,
	force: boolean,
): string | null {
	if (!semver.valid(current)) throw new Error(`Invalid version: ${current}`);
	if (released !== null && !semver.valid(released)) {
		throw new Error(`Invalid released version: ${released}`);
	}
	if (!force && (released === null || semver.gt(current, released))) {
		return null;
	}
	const baseline =
		released !== null && semver.gt(released, current) ? released : current;
	const nextVersion = semver.inc(baseline, "patch");
	if (!nextVersion) throw new Error(`Could not bump version: ${baseline}`);
	return nextVersion;
}

export function rewritePackageVersions(
	packageText: string,
	lockText: string,
	nextVersion: string,
): { packageText: string; lockText: string } {
	const packageData = JSON.parse(packageText) as { version?: string };
	const lockData = JSON.parse(lockText) as {
		version?: string;
		packages?: { ""?: { version?: string } };
	};
	if (
		!packageData.version ||
		lockData.version !== packageData.version ||
		lockData.packages?.[""]?.version !== packageData.version
	) {
		throw new Error("Package and lockfile versions differ");
	}

	const versionField = /("version"\s*:\s*")([^"]+)(")/g;
	let packageCount = 0;
	const updatedPackage = packageText.replace(
		versionField,
		(match, before, value, after) => {
			if (packageCount++ > 0) return match;
			if (value !== packageData.version)
				throw new Error("Unexpected package version field");
			return `${before}${nextVersion}${after}`;
		},
	);
	let lockCount = 0;
	const updatedLock = lockText.replace(
		versionField,
		(match, before, value, after) => {
			if (lockCount++ > 1) return match;
			if (value !== packageData.version)
				throw new Error("Unexpected lockfile version field");
			return `${before}${nextVersion}${after}`;
		},
	);
	if (packageCount < 1 || lockCount < 2) {
		throw new Error("Missing package or lockfile version field");
	}
	return { packageText: updatedPackage, lockText: updatedLock };
}

/** `search` must be a global regex literal. */
function replaceOnce(
	text: string,
	search: RegExp,
	replacement: string,
): string {
	if (text.match(search)?.length !== 1) {
		throw new Error(`Expected exactly one match for ${search}`);
	}
	return text.replace(search, replacement);
}

export function rewriteCargoVersions(
	tomlText: string,
	lockText: string,
	currentVersion: string,
	nextVersion: string,
): { tomlText: string; lockText: string } {
	const name = tomlText.match(/^name\s*=\s*"([^"]+)"/m)?.[1];
	if (!name) throw new Error("Missing Cargo package name");
	const toml = tomlText.replace(
		/^version\s*=\s*"[^"]+"/m,
		`version = "${nextVersion}"`,
	);
	const lockEntry = `name = "${name}"\nversion = "${currentVersion}"`;
	if (lockText.split(lockEntry).length !== 2) {
		throw new Error(
			`Expected exactly one ${name} ${currentVersion} lock entry`,
		);
	}
	const lock = lockText.replace(
		lockEntry,
		`name = "${name}"\nversion = "${nextVersion}"`,
	);
	return { tomlText: toml, lockText: lock };
}

/** Same numbering devops/check-app-version.py enforces. */
export function rewriteAppVersions(
	csprojText: string,
	nextVersion: string,
): string {
	const [major, minor, patch] = nextVersion.split(".").map(Number);
	let text = replaceOnce(
		csprojText,
		/(<ApplicationDisplayVersion>)[^<]+(<\/ApplicationDisplayVersion>)/g,
		`$1${nextVersion}$2`,
	);
	text = replaceOnce(
		text,
		/(<ApplicationVersion Condition="[^"]*== 'android'">)\d+(<\/ApplicationVersion>)/g,
		`$1${major * 10_000_000 + minor * 100_000 + patch}$2`,
	);
	return replaceOnce(
		text,
		/(<ApplicationVersion Condition="[^"]*!= 'android'">)\d+(<\/ApplicationVersion>)/g,
		`$1${patch}$2`,
	);
}

function read(relativePath: string): string {
	return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function write(relativePath: string, text: string): void {
	writeFileSync(path.join(repoRoot, relativePath), text);
}

function writeVersion(
	module: ModuleConfig,
	currentVersion: string,
	nextVersion: string,
): void {
	function writePackage(): void {
		const lockFile = `${module.path}/package-lock.json`;
		const updated = rewritePackageVersions(
			read(module.versionFile),
			read(lockFile),
			nextVersion,
		);
		write(module.versionFile, updated.packageText);
		write(lockFile, updated.lockText);
	}
	function writeCargo(): void {
		const lockFile = `${module.path}/Cargo.lock`;
		const updated = rewriteCargoVersions(
			read(module.versionFile),
			read(lockFile),
			currentVersion,
			nextVersion,
		);
		write(module.versionFile, updated.tomlText);
		write(lockFile, updated.lockText);
	}
	switch (module.name) {
		case "website":
		case "admin":
			writePackage();
			break;
		case "api":
		case "bulletin":
			writeCargo();
			break;
		case "app":
			write(
				module.versionFile,
				rewriteAppVersions(read(module.versionFile), nextVersion),
			);
			break;
	}
}

async function main(): Promise<void> {
	const { mode } = await yargs(hideBin(process.argv))
		.option("mode", {
			type: "string",
			choices: ["released", "retry"] as const,
			demandOption: true,
		})
		.strict()
		.parse();
	const needsJson = process.env.NEEDS_JSON;
	if (!needsJson) throw new Error("NEEDS_JSON is required");
	const needs = JSON.parse(needsJson) as ReleaseNeeds;
	const selected = new Set(modulesToBump(needs, mode));
	const summary: string[] = [];

	for (const name of moduleNames) {
		if (!selected.has(name)) {
			console.log(`Skipping ${name}: no matching release output`);
			continue;
		}
		const currentVersion = getModuleVersion(name);
		const releasedVersion = getReleasedVersion(name);
		const nextVersion = nextReleaseVersion(
			currentVersion,
			releasedVersion,
			mode === "retry",
		);
		if (!nextVersion) {
			console.log(`${name} ${currentVersion} is already ahead`);
			continue;
		}
		writeVersion(resolveModule(name), currentVersion, nextVersion);
		summary.push(`${name} to ${nextVersion}`);
		console.log(`Bumped ${name} ${currentVersion} → ${nextVersion}`);
	}

	if (process.env.GITHUB_OUTPUT) {
		appendFileSync(
			process.env.GITHUB_OUTPUT,
			`summary=${summary.join(", ")}\n`,
		);
	}
}

if (
	process.argv[1] &&
	path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	main();
}
