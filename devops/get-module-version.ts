/**
 * Module version extraction utilities.
 * Uses each module's native tooling when available, with fallback to direct file parsing.
 */

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Full module paths as used in the repository */
export type ModulePath = "web/bible-on-site" | "web/api" | "web/bulletin" | "app";

/** Short module names for CLI and tags */
export type ModuleName = "website" | "api" | "bulletin" | "app";

export interface ModuleConfig {
	/** Full path in the repository */
	path: ModulePath;
	/** Short name for CLI and display */
	name: ModuleName;
	tagPrefix: string;
	versionFile: string;
	/** Native command to get version (run from repo root) */
	nativeCommand: string;
	/** Working directory for the native command (relative to repo root) */
	workingDir: string;
	/** Fallback extraction from file content (null = no fallback, must use native) */
	extractFromFile: ((content: string) => string | null) | null;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");

export const MODULES: Record<ModulePath, ModuleConfig> = {
	"web/bible-on-site": {
		path: "web/bible-on-site",
		name: "website",
		tagPrefix: "website-v",
		versionFile: "web/bible-on-site/package.json",
		nativeCommand: "npm run version --silent",
		workingDir: "web/bible-on-site",
		extractFromFile: (content: string) => {
			const parsed = JSON.parse(content);
			return parsed.version ?? null;
		},
	},
	"web/api": {
		path: "web/api",
		name: "api",
		tagPrefix: "api-v",
		versionFile: "web/api/Cargo.toml",
		nativeCommand: "cargo make version",
		workingDir: "web/api",
		extractFromFile: (content: string) => {
			const match = content.match(/^version\s*=\s*"([^"]+)"/m);
			return match?.[1] ?? null;
		},
	},
	"web/bulletin": {
		path: "web/bulletin",
		name: "bulletin",
		tagPrefix: "bulletin-v",
		versionFile: "web/bulletin/Cargo.toml",
		nativeCommand: "cargo make version",
		workingDir: "web/bulletin",
		extractFromFile: (content: string) => {
			const match = content.match(/^version\s*=\s*"([^"]+)"/m);
			return match?.[1] ?? null;
		},
	},
	app: {
		path: "app",
		name: "app",
		tagPrefix: "app-v",
		versionFile: "app/BibleOnSite/BibleOnSite.csproj",
		nativeCommand: "dotnet run --project devops -- Version",
		workingDir: "app",
		extractFromFile: (content: string) => {
			const match = content.match(
				/<ApplicationDisplayVersion>([^<]+)<\/ApplicationDisplayVersion>/,
			);
			return match?.[1] ?? null;
		},
	},
};

/** Map short names to full paths for CLI convenience */
const NAME_TO_PATH: Record<ModuleName, ModulePath> = {
	website: "web/bible-on-site",
	api: "web/api",
	bulletin: "web/bulletin",
	app: "app",
};

/**
 * Resolve a module identifier (path or name) to a ModuleConfig.
 */
export function resolveModule(
	identifier: ModulePath | ModuleName,
): ModuleConfig {
	// Try as path first
	if (identifier in MODULES) {
		return MODULES[identifier as ModulePath];
	}
	// Try as short name
	if (identifier in NAME_TO_PATH) {
		return MODULES[NAME_TO_PATH[identifier as ModuleName]];
	}
	throw new Error(`Unknown module: ${identifier}`);
}

/**
 * Get all module paths.
 */
export function getAllModulePaths(): ModulePath[] {
	return Object.keys(MODULES) as ModulePath[];
}

/**
 * Try to get version using native tooling.
 * Returns null if the tool is not available or fails.
 */
function tryNativeCommand(module: ModuleConfig): string | null {
	try {
		const cwd = join(REPO_ROOT, module.workingDir);
		const result = execSync(module.nativeCommand, {
			encoding: "utf-8",
			cwd,
			stdio: ["pipe", "pipe", "pipe"],
		});
		// Clean up output: remove cargo-make noise, ANSI codes, and get the version
		// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape codes need control char matching
		const ansiRegex = /\x1b\[[0-9;]*m/g;
		const lines = result
			.split("\n")
			.map((line) => line.replace(ansiRegex, "").trim())
			.filter(
				(line) =>
					line &&
					!line.includes("[cargo-make]") &&
					!line.includes("INFO") &&
					!line.startsWith(">"),
			);

		// For dotnet, look for ApplicationDisplayVersion line and extract just the version
		for (const line of lines) {
			if (line.includes("ApplicationDisplayVersion")) {
				// Match version pattern like "4.0.16" at the end of the line
				const match = line.match(/(\d+\.\d+\.\d+)\s*$/);
				if (match) {
					return match[1];
				}
			}
		}

		// Otherwise return the last non-empty line (typical for npm/cargo)
		return lines[lines.length - 1] ?? null;
	} catch {
		return null;
	}
}

/**
 * Get version by parsing the source file directly.
 */
function getVersionFromFile(module: ModuleConfig): string | null {
	if (!module.extractFromFile) {
		return null;
	}
	try {
		const filePath = join(REPO_ROOT, module.versionFile);
		const content = readFileSync(filePath, "utf-8");
		return module.extractFromFile(content);
	} catch {
		return null;
	}
}

/**
 * Get the current version of a module.
 * Uses native tooling first, falls back to file parsing if available.
 * @param identifier - Module path (e.g., "web/api") or short name (e.g., "api")
 */
export function getModuleVersion(identifier: ModulePath | ModuleName): string {
	const module = resolveModule(identifier);

	// Try native command first
	const nativeVersion = tryNativeCommand(module);
	if (nativeVersion) {
		return nativeVersion;
	}

	// Fall back to file parsing if available
	if (module.extractFromFile) {
		const fileVersion = getVersionFromFile(module);
		if (fileVersion) {
			return fileVersion;
		}
	}

	throw new Error(
		`Failed to get version for module ${module.path}. ` +
			`Native command '${module.nativeCommand}' failed and ` +
			(module.extractFromFile
				? `fallback parsing of ${module.versionFile} also failed.`
				: `no fallback is configured.`),
	);
}

/**
 * Get the tag prefix for a module.
 */
export function getTagPrefix(identifier: ModulePath | ModuleName): string {
	return resolveModule(identifier).tagPrefix;
}

/**
 * Get the version file path for a module.
 */
export function getVersionFile(identifier: ModulePath | ModuleName): string {
	return resolveModule(identifier).versionFile;
}

/**
 * Get the short name for a module.
 */
export function getModuleName(identifier: ModulePath | ModuleName): ModuleName {
	return resolveModule(identifier).name;
}
