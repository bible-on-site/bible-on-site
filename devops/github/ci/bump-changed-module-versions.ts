#!/usr/bin/env npx tsx

/**
 * Bump every module a branch changes above both its latest release and the base ref.
 * Used on Renovate branches, whose dependency updates touch modules without bumping them.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	getAllModulePaths,
	type ModuleConfig,
	type ModuleName,
	type ModulePath,
	resolveModule,
} from "../../get-module-version.ts";
import { getReleasedVersion } from "../release/get-version.ts";
import {
	nextModuleVersion,
	rewritePackageVersions,
} from "./auto-bump-website-version.ts";

const repoRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../../..",
);

export function changedModules(files: string[]): ModulePath[] {
	return getAllModulePaths().filter((modulePath) =>
		files.some((file) => file.startsWith(`${modulePath}/`)),
	);
}

function replaceOnce(
	text: string,
	search: RegExp,
	replacement: string,
): string {
	const matches = text.match(new RegExp(search.source, `${search.flags}g`));
	if (matches?.length !== 1) {
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
	const lock = replaceOnce(
		lockText,
		new RegExp(
			`^name = "${name}"\\nversion = "${currentVersion.replaceAll(".", "\\.")}"$`,
			"m",
		),
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
		/<ApplicationDisplayVersion>[^<]+<\/ApplicationDisplayVersion>/,
		`<ApplicationDisplayVersion>${nextVersion}</ApplicationDisplayVersion>`,
	);
	text = replaceOnce(
		text,
		/(<ApplicationVersion Condition="[^"]*== 'android'">)\d+(<\/ApplicationVersion>)/,
		`$1${major * 10_000_000 + minor * 100_000 + patch}$2`,
	);
	return replaceOnce(
		text,
		/(<ApplicationVersion Condition="[^"]*!= 'android'">)\d+(<\/ApplicationVersion>)/,
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
	const writers: Record<ModuleName, () => void> = {
		website: writePackage,
		admin: writePackage,
		api: writeCargo,
		bulletin: writeCargo,
		app: () =>
			write(
				module.versionFile,
				rewriteAppVersions(read(module.versionFile), nextVersion),
			),
	};
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
	writers[module.name]();
}

function git(...args: string[]): string {
	return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" });
}

function run(): void {
	const ref = process.argv[2] ?? "origin/master";
	const files = git("diff", "--name-only", `${ref}...HEAD`).split("\n");
	for (const modulePath of changedModules(files)) {
		const module = resolveModule(modulePath);
		const extract = (text: string): string => {
			const version = module.extractFromFile?.(text);
			if (!version) throw new Error(`No ${module.name} version found`);
			return version;
		};
		const currentVersion = extract(read(module.versionFile));
		const baseVersion = extract(git("show", `${ref}:${module.versionFile}`));
		const nextVersion = nextModuleVersion(
			currentVersion,
			baseVersion,
			getReleasedVersion(modulePath),
		);
		if (!nextVersion) {
			console.log(`${module.name} ${currentVersion} is already ahead`);
			continue;
		}
		writeVersion(module, currentVersion, nextVersion);
		console.log(`Bumped ${module.name} ${currentVersion} → ${nextVersion}`);
	}
}

if (
	process.argv[1] &&
	path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	run();
}
