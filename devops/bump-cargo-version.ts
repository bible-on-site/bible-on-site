/**
 * Bump the patch version of a Cargo-based module.
 * Replaces the bash `bump_version.sh` scripts with a TypeScript implementation.
 *
 * Usage: node --import tsx ./bump-cargo-version.ts --module <module-name-or-path>
 * Example: node --import tsx ./bump-cargo-version.ts --module bulletin
 */

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import semver from "semver";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { resolveModule, type ModulePath, type ModuleName } from "./get-module-version.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");

const argv = await yargs(hideBin(process.argv))
	.option("module", {
		type: "string",
		demandOption: true,
		describe: "Module name or path (e.g. 'bulletin' or 'web/bulletin')",
		choices: ["api", "bulletin", "web/api", "web/bulletin"],
	})
	.strict()
	.parse();

const moduleConfig = resolveModule(argv.module as ModulePath | ModuleName);
const cargoTomlPath = join(REPO_ROOT, moduleConfig.versionFile);

const cargoContent = readFileSync(cargoTomlPath, "utf-8");
const versionMatch = cargoContent.match(/^version\s*=\s*"([^"]+)"/m);
if (!versionMatch) {
	console.error(`Failed to find version in ${cargoTomlPath}`);
	process.exit(1);
}

const currentVersion = versionMatch[1];
const bumpedVersion = semver.inc(currentVersion, "patch");
if (!bumpedVersion) {
	console.error(`Failed to bump version from ${currentVersion}`);
	process.exit(1);
}

console.log(`Bumping ${moduleConfig.name} from ${currentVersion} to ${bumpedVersion}`);

const updatedContent = cargoContent.replace(
	/^(version\s*=\s*")([^"]+)(")/m,
	`$1${bumpedVersion}$3`,
);
writeFileSync(cargoTomlPath, updatedContent, "utf-8");

const moduleDir = join(REPO_ROOT, moduleConfig.path);
console.log("Updating Cargo.lock...");
execSync("cargo generate-lockfile", { cwd: moduleDir, stdio: "inherit" });

console.log(`Successfully bumped ${moduleConfig.name} to ${bumpedVersion}`);
