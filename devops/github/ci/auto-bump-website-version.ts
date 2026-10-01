#!/usr/bin/env npx tsx

/** Keep a website commit's version ahead of both the latest release and origin/master. */
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import semver from "semver";
import { getReleasedVersion } from "../release/get-version.ts";

const repoRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../../..",
);
const packageRelativePath = "web/bible-on-site/package.json";
const lockRelativePath = "web/bible-on-site/package-lock.json";

export function nextWebsiteVersion(
	currentVersion: string,
	masterVersion: string,
	releasedVersion: string | null,
): string | null {
	const versions = [currentVersion, masterVersion, releasedVersion].filter(
		(version): version is string => version !== null,
	);
	for (const version of versions) {
		if (!semver.valid(version)) throw new Error(`Invalid version: ${version}`);
	}
	const baseline =
		releasedVersion && semver.gt(releasedVersion, masterVersion)
			? releasedVersion
			: masterVersion;
	if (semver.gt(currentVersion, baseline)) return null;
	const next = semver.inc(baseline, "patch");
	if (!next) throw new Error(`Could not bump version: ${baseline}`);
	return next;
}

export function rewriteWebsiteVersions(
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
		throw new Error("Website package and lockfile versions differ");
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
		throw new Error("Missing website package or lockfile version field");
	}
	return { packageText: updatedPackage, lockText: updatedLock };
}

function run(): void {
	const ref = process.argv[2] ?? "origin/master";
	if (ref === "origin/master") {
		execFileSync(
			"git",
			[
				"fetch",
				"--quiet",
				"--tags",
				"origin",
				"+refs/heads/master:refs/remotes/origin/master",
			],
			{ cwd: repoRoot, stdio: "inherit" },
		);
	}
	const packagePath = path.join(repoRoot, packageRelativePath);
	const lockPath = path.join(repoRoot, lockRelativePath);
	const packageText = readFileSync(packagePath, "utf8");
	const lockText = readFileSync(lockPath, "utf8");
	const currentVersion = (JSON.parse(packageText) as { version: string })
		.version;
	const masterText = execFileSync(
		"git",
		["show", `${ref}:${packageRelativePath}`],
		{ cwd: repoRoot, encoding: "utf8" },
	);
	const masterVersion = (JSON.parse(masterText) as { version: string }).version;
	const releasedVersion = getReleasedVersion("website");
	const nextVersion = nextWebsiteVersion(
		currentVersion,
		masterVersion,
		releasedVersion,
	);
	if (!nextVersion) return;

	for (const file of [packageRelativePath, lockRelativePath]) {
		const result = spawnSync("git", ["diff", "--quiet", "--", file], {
			cwd: repoRoot,
		});
		if (result.status !== 0) {
			throw new Error(
				`Unstaged changes in ${file}; stage or save them before committing`,
			);
		}
	}

	const updated = rewriteWebsiteVersions(packageText, lockText, nextVersion);
	writeFileSync(packagePath, updated.packageText);
	writeFileSync(lockPath, updated.lockText);
	execFileSync("git", ["add", "--", packageRelativePath, lockRelativePath], {
		cwd: repoRoot,
		stdio: "inherit",
	});
	console.log(
		`Bumped website version ${currentVersion} → ${nextVersion} (ahead of ${ref} ${masterVersion})`,
	);
}

if (
	process.argv[1] &&
	path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	run();
}
