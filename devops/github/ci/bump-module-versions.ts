#!/usr/bin/env npx tsx

import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import semver from "semver";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import {
	type ModuleConfig,
	type ModuleName,
	resolveModule,
} from "../../get-module-version.ts";
import { getReleasedVersion } from "../release/get-version.ts";

export type ReleaseNeeds = Record<
	string,
	{ result?: string; outputs?: Record<string, string> }
>;

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
	mode: "released" | "retry" | "all",
): ModuleName[] {
	const outputName = mode === "released" ? "released" : "needs_bump";
	return moduleNames.filter(
		(name) =>
			needs[`release_${name}`]?.result === "success" &&
			(needs[`release_${name}`]?.outputs?.[outputName] === "true" ||
				(mode === "all" &&
					needs[`release_${name}`]?.outputs?.released === "true")),
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

function read(relativePath: string, cwd: string): string {
	return readFileSync(path.join(cwd, relativePath), "utf8");
}

function write(relativePath: string, text: string, cwd: string): void {
	writeFileSync(path.join(cwd, relativePath), text);
}

function writeVersion(
	module: ModuleConfig,
	currentVersion: string,
	nextVersion: string,
	cwd: string,
): void {
	function writePackage(): void {
		const lockFile = `${module.path}/package-lock.json`;
		const updated = rewritePackageVersions(
			read(module.versionFile, cwd),
			read(lockFile, cwd),
			nextVersion,
		);
		write(module.versionFile, updated.packageText, cwd);
		write(lockFile, updated.lockText, cwd);
	}
	function writeCargo(): void {
		const lockFile = `${module.path}/Cargo.lock`;
		const updated = rewriteCargoVersions(
			read(module.versionFile, cwd),
			read(lockFile, cwd),
			currentVersion,
			nextVersion,
		);
		write(module.versionFile, updated.tomlText, cwd);
		write(lockFile, updated.lockText, cwd);
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
				rewriteAppVersions(read(module.versionFile, cwd), nextVersion),
				cwd,
			);
			break;
	}
}

export function bumpModuleVersions(
	needs: ReleaseNeeds,
	mode: "released" | "retry" | "all",
	cwd = repoRoot,
	sourceSha?: string,
): string {
	const summary: string[] = [];
	for (const name of modulesToBump(needs, mode)) {
		const module = resolveModule(name);
		const currentVersion = module.extractFromFile?.(
			read(module.versionFile, cwd),
		);
		if (!currentVersion) throw new Error(`Missing ${name} version`);
		const releasedVersion = getReleasedVersion(name, cwd);
		const retry =
			mode === "retry" ||
			(mode === "all" &&
				needs[`release_${name}`]?.outputs?.needs_bump === "true");
		if (retry && sourceSha && releasedVersion) {
			const result = spawnSync(
				"git",
				[
					"merge-base",
					"--is-ancestor",
					sourceSha,
					`${module.tagPrefix}${releasedVersion}`,
				],
				{ cwd },
			);
			if (result.status === 0) {
				console.log(`${name}: latest release already contains ${sourceSha}`);
				continue;
			}
			if (result.status !== 1)
				throw new Error(
					`Cannot compare ${name} release ancestry: ${result.stderr}`,
				);
		}
		// A prior queued collision already scheduled CI for this source and version.
		// Keep the failed run visible for recovery instead of creating duplicate builds.
		if (
			retry &&
			sourceSha &&
			releasedVersion &&
			semver.gt(currentVersion, releasedVersion)
		) {
			const [commit, subject] = execFileSync(
				"git",
				["log", "-1", "--format=%H%n%s", "--", module.versionFile],
				{ cwd, encoding: "utf8" },
			)
				.trim()
				.split("\n");
			if (
				subject?.startsWith("chore(release): Bump versions to release (") &&
				subject.includes(`${name} to ${currentVersion}`)
			) {
				const covered = spawnSync(
					"git",
					["merge-base", "--is-ancestor", sourceSha, commit],
					{ cwd },
				);
				if (covered.status === 0) {
					console.log(`${name}: retry CI already scheduled by ${commit}`);
					continue;
				}
				if (covered.status !== 1)
					throw new Error(
						`Cannot compare pending retry ancestry: ${covered.stderr}`,
					);
			}
		}
		const nextVersion = nextReleaseVersion(
			currentVersion,
			releasedVersion,
			retry,
		);
		if (!nextVersion) continue;
		writeVersion(module, currentVersion, nextVersion, cwd);
		summary.push(`${name} to ${nextVersion}`);
		console.log(`Bumped ${name} ${currentVersion} -> ${nextVersion}`);
	}
	return summary.join(", ");
}

/** Recompute after a competing master push; never rebase stale version edits. */
export function publishVersionBumps(
	needs: ReleaseNeeds,
	mode: "released" | "retry" | "all",
	cwd = repoRoot,
	sourceSha?: string,
	beforePush?: (attempt: number) => void,
): void {
	const git = (...args: string[]) =>
		execFileSync("git", args, { cwd, encoding: "utf8" });
	if (git("status", "--porcelain").trim())
		throw new Error("Version publisher requires a clean checkout");
	for (let attempt = 1; attempt <= 5; attempt++) {
		git(
			"fetch",
			"--tags",
			"origin",
			"+refs/heads/master:refs/remotes/origin/master",
		);
		git("reset", "--hard", "origin/master");
		const base = git("rev-parse", "HEAD").trim();
		const summary = bumpModuleVersions(needs, mode, cwd, sourceSha);
		if (!summary) return;
		const message =
			mode === "released" ||
			(mode === "all" &&
				!modulesToBump(needs, "retry").some((name) =>
					summary.includes(`${name} to `),
				))
				? `chore(release): Bump versions (${summary}) [skip ci]`
				: `chore(release): Bump versions to release (${summary})`;
		git("commit", "-n", "-am", message);
		beforePush?.(attempt);
		const pushed = spawnSync("git", ["push", "origin", "HEAD:master"], {
			cwd,
			encoding: "utf8",
		});
		if (pushed.status === 0) return;
		const remote = git("ls-remote", "origin", "refs/heads/master").split(
			/\s/,
		)[0];
		if (remote === base)
			throw new Error(`Version push failed: ${pushed.stderr}`);
		console.log(
			"Master advanced during the bump; recalculating from its new head",
		);
	}
	throw new Error("Master advanced during all five version bump attempts");
}

/** Older in-flight bump jobs check out master but still use two CLI steps. */
export function executeVersionBumps(
	needs: ReleaseNeeds,
	mode: "released" | "retry" | "all",
	publish: boolean,
	cwd = repoRoot,
	environment = process.env,
): string | undefined {
	const legacyPublisher =
		!publish &&
		environment.GITHUB_ACTIONS === "true" &&
		environment.GITHUB_EVENT_NAME === "push" &&
		environment.GITHUB_REF === "refs/heads/master" &&
		environment.GITHUB_JOB === "bump_versions";
	if (publish || legacyPublisher) {
		if (environment.GITHUB_ACTIONS !== "true")
			throw new Error(
				"Publishing requires a disposable GitHub Actions checkout",
			);
		publishVersionBumps(
			needs,
			legacyPublisher ? "all" : mode,
			cwd,
			environment.GITHUB_SHA,
		);
		// No summary: the older workflow must skip its unsafe commit/rebase/push steps.
		return undefined;
	}
	return bumpModuleVersions(needs, mode, cwd);
}

async function main(): Promise<void> {
	const { mode, publish } = await yargs(hideBin(process.argv))
		.option("mode", {
			type: "string",
			choices: ["released", "retry", "all"] as const,
			demandOption: true,
		})
		.option("publish", { type: "boolean", default: false })
		.strict()
		.parse();
	const needsJson = process.env.NEEDS_JSON;
	if (!needsJson) throw new Error("NEEDS_JSON is required");
	const needs = JSON.parse(needsJson) as ReleaseNeeds;
	const summary = executeVersionBumps(needs, mode, publish);
	if (summary !== undefined && process.env.GITHUB_OUTPUT)
		appendFileSync(process.env.GITHUB_OUTPUT, `summary=${summary}\n`);
}

if (
	process.argv[1] &&
	path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	main();
}
