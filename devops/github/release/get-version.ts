#!/usr/bin/env npx tsx
/**
 * Get the latest released version of a module from git tags.
 *
 * Usage: npx tsx get-version.ts --module <app|web/api|web/bible-on-site>
 *        Also accepts short names: app, api, website
 */

import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import {
	getTagPrefix,
	type ModuleName,
	type ModulePath,
} from "../../get-module-version.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "../..");

/**
 * Get the latest released version from git tags for a module.
 * Returns null if no releases exist.
 * @param identifier - Module path (e.g., "web/api") or short name (e.g., "api")
 */
export function getReleasedVersion(
	identifier: ModulePath | ModuleName,
): string | null {
	const tagPrefix = getTagPrefix(identifier);
	try {
		const result = execSync(`git tag -l "${tagPrefix}*" --sort=-v:refname`, {
			encoding: "utf-8",
			cwd: REPO_ROOT,
			stdio: ["pipe", "pipe", "pipe"],
		});
		const tags = result.trim().split("\n").filter(Boolean);
		if (tags.length === 0) {
			return null;
		}
		return tags[0].replace(tagPrefix, "");
	} catch {
		return null;
	}
}

async function main() {
	const argv = await yargs(hideBin(process.argv))
		.option("module", {
			alias: "m",
			type: "string",
			description: "Module path or name",
			choices: [
				"app",
				"web/api",
				"web/bible-on-site",
				"api",
				"website",
			] as const,
			demandOption: true,
		})
		.help().argv;

	const version = getReleasedVersion(argv.module as ModulePath | ModuleName);
	if (version) {
		console.log(version);
	} else {
		console.error(`No released version found for ${argv.module}`);
		process.exit(1);
	}
}

// Run main if executed directly
if (import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}`) {
	main();
}
