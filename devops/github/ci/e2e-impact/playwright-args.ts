/**
 * Enforce-mode Playwright argument resolution (#2085).
 *
 * The selection manifest is suite- and repo-relative; this module renders
 * the concrete `playwright test` arguments an enforce step invokes:
 * `playwright test <files...> --grep '<titles alternation>'`.
 *
 * - `files` are package-dir-relative spec paths: every file carrying a
 *   selected test plus every `dynamicTestFiles` entry (dynamic files run
 *   wholesale — static discovery could not enumerate their titles).
 * - `grep` is an anchored alternation of every selected title plus — when a
 *   `discovered.json` is provided — every title enumerated inside dynamic
 *   files. Without discovery for a dynamic file, the runner cannot filter
 *   inside it, so the args degrade to `selectAll` rather than guess.
 *
 * Shadow mode never calls this; the output is deterministic given the same
 * manifest and discovery input.
 */
import { readFileSync } from "node:fs";

import type { SelectionManifest } from "./select.ts";

export const PLAYWRIGHT_ARGS_KIND = "e2e-impact-playwright-args";
export const PLAYWRIGHT_ARGS_SCHEMA_VERSION = 1;

export interface PlaywrightArgs {
	kind: typeof PLAYWRIGHT_ARGS_KIND;
	schemaVersion: typeof PLAYWRIGHT_ARGS_SCHEMA_VERSION;
	/** True → run the suite unfiltered (manifest fell back or input gaps). */
	selectAll: boolean;
	/** Package-dir-relative spec paths for the positional `playwright test` args. */
	files: string[];
	/** Anchored `--grep` alternation; null when no title filter is needed. */
	grep: string | null;
}

/** Runtime shape of `discovered.json` entries written by the e2e-impact reporter. */
interface DiscoveredEntry {
	file: string;
	titlePath: string[];
}

const REGEX_META = /[.*+?^${}()|[\]\\]/g;

const escapeTitle = (title: string): string => title.replace(REGEX_META, "\\$&");

const stripPrefix = (path: string, prefix: string): string =>
	path.startsWith(`${prefix}/`) ? path.slice(prefix.length + 1) : path;

/**
 * Renders Playwright CLI selection args from a selection manifest.
 *
 * `packageDir`/`testDir` are repo-relative (`web/bible-on-site`,
 * `web/bible-on-site/tests`) so manifest files map onto the cwd-relative
 * paths the runner passes (`playwright test` runs from the package dir),
 * and `discovered` (the reporter's `discovered.json`) supplies titles
 * inside dynamic files when present.
 */
export function playwrightArgs(
	manifest: SelectionManifest,
	options: {
		packageDir: string;
		testDir: string;
		discovered?: DiscoveredEntry[];
	},
): PlaywrightArgs {
	const base = {
		kind: PLAYWRIGHT_ARGS_KIND,
		schemaVersion: PLAYWRIGHT_ARGS_SCHEMA_VERSION,
	};
	if (manifest.selectAll || manifest.filter.playwright === null) {
		return { ...base, selectAll: true, files: [], grep: null };
	}
	const dynamic = manifest.dynamicTestFiles ?? [];
	if (dynamic.length > 0 && options.discovered === undefined) {
		// Dynamic files carry no manifest titles; without runtime discovery the
		// runner could not run them wholesale alongside a title filter.
		return { ...base, selectAll: true, files: [], grep: null };
	}
	const files = new Set<string>();
	const titles = new Set<string>();
	for (const entry of manifest.filter.playwright) {
		files.add(stripPrefix(entry.file, options.packageDir));
		for (const title of entry.titles) titles.add(title);
	}
	const dynamicTestDirRel = new Set(
		dynamic.map((file) => stripPrefix(file, options.testDir)),
	);
	for (const file of dynamic) files.add(stripPrefix(file, options.packageDir));
	if (options.discovered !== undefined) {
		for (const test of options.discovered) {
			if (dynamicTestDirRel.has(test.file)) titles.add(test.titlePath.join(" "));
		}
	}
	const alternation = [...titles].sort().map(escapeTitle).join("|");
	return {
		...base,
		selectAll: false,
		files: [...files].sort(),
		grep: titles.size > 0 ? `^(?:${alternation})$` : null,
	};
}

/** Loads the reporter's `discovered.json`; a malformed file fails loudly. */
export function loadDiscovered(path: string): DiscoveredEntry[] {
	const parsed = JSON.parse(readFileSync(path, "utf8")) as {
		tests?: DiscoveredEntry[];
	};
	return (parsed.tests ?? []).filter(
		(test) =>
			typeof test.file === "string" && Array.isArray(test.titlePath),
	);
}
