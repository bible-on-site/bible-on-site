#!/usr/bin/env node
/**
 * Validates `cache:` inputs on actions/setup-node steps across
 * .github/workflows/ and .github/actions/. The action's action.yml documents
 * the enum "Supported values: npm, yarn, pnpm" and rejects anything else at
 * runtime — `cache: bun` broke master website packaging inside a master-only
 * job that PR runs never execute, and actionlint does not know the enum
 * (#2643). Bun's install store is cached explicitly via actions/cache on
 * ~/.bun/install/cache instead.
 *
 * Runs standalone (pre-commit feeds it staged workflow/action files as argv;
 * no argv scans both gated directories) and is imported by
 * setup-node-cache.test.mjs so the same findings gate `bun run test:version`
 * in Cross Module CI. Exits 1 when any finding is reported.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const WORKFLOWS_DIR = fileURLToPath(
	new URL("../../../.github/workflows/", import.meta.url),
);

// setup-node also runs inside local composite actions (e.g. setup-js) — the
// gate covers them too since #2643.
export const ACTIONS_DIR = fileURLToPath(
	new URL("../../../.github/actions/", import.meta.url),
);

/**
 * Every YAML file the gate covers: flat *.yml under .github/workflows/ and
 * one level of action manifests under .github/actions/<name>/action.yml.
 */
export function gatedFiles() {
	const files = readdirSync(WORKFLOWS_DIR)
		.filter((name) => /\.ya?ml$/.test(name))
		.map((name) => path.join(WORKFLOWS_DIR, name));
	if (!existsSync(ACTIONS_DIR)) return files;
	for (const entry of readdirSync(ACTIONS_DIR, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		for (const name of readdirSync(path.join(ACTIONS_DIR, entry.name))) {
			if (/\.ya?ml$/.test(name))
				files.push(path.join(ACTIONS_DIR, entry.name, name));
		}
	}
	return files;
}

// https://github.com/actions/setup-node/blob/v7/action.yml — "cache" input.
export const SETUP_NODE_SUPPORTED_CACHES = new Set(["npm", "yarn", "pnpm"]);

const indentOf = (line) => line.length - line.trimStart().length;

/** Strip YAML scalar decoration: single/double quotes and trailing comments. */
function scalarValue(raw) {
	const quoted = /^(['"])(.*)\1\s*(#.*)?$/.exec(raw);
	if (quoted) return quoted[2];
	return raw.replace(/\s+#.*$/, "").trim();
}

/**
 * Find unsupported `cache:` inputs on setup-node steps in one workflow file.
 * A step's `with:` block is bounded by indentation, so `cache:` keys of other
 * actions or literal text inside `run:` scripts are never attributed to it.
 * Returns [{ line, detail }] — line is 1-based.
 */
export function setupNodeCacheFindings(text) {
	const lines = text.split("\n");
	const findings = [];
	for (let i = 0; i < lines.length; i++) {
		const uses = /^(\s*)(-\s+)?uses:\s*actions\/setup-node@/.exec(lines[i]);
		if (!uses) continue;
		// Step keys sit at the `uses:` indent, or two past a `- uses:` list
		// marker. The step ends at the next line shallower than its keys.
		const keyIndent = indentOf(lines[i]) + (uses[2] ? 2 : 0);
		const inputs = new Map();
		let insideWith = false;
		for (let j = i + 1; j < lines.length; j++) {
			const line = lines[j];
			if (!line.trim() || line.trimStart().startsWith("#")) continue;
			if (indentOf(line) < keyIndent) break;
			if (indentOf(line) === keyIndent) {
				const key = line.trim();
				insideWith = /^with:\s*$/.test(key);
				// Flow style `with: { cache: bun }` keeps inputs on one line.
				const flow = /^with:\s*\{(.*)\}\s*$/.exec(key);
				if (flow) {
					for (const pair of flow[1].split(",")) {
						const input =
							/^\s*(cache|cache-dependency-path|package-manager-cache)\s*:\s*(.*?)\s*$/.exec(
								pair,
							);
						if (input)
							inputs.set(input[1], {
								value: scalarValue(input[2]),
								line: j + 1,
							});
					}
				}
				continue;
			}
			if (!insideWith) continue;
			const input =
				/^(cache|cache-dependency-path|package-manager-cache)\s*:\s*(.*)$/.exec(
					line.trim(),
				);
			if (input)
				inputs.set(input[1], { value: scalarValue(input[2]), line: j + 1 });
		}
		const cache = inputs.get("cache");
		if (cache && !SETUP_NODE_SUPPORTED_CACHES.has(cache.value)) {
			findings.push({
				line: cache.line,
				detail: `actions/setup-node does not support cache: ${cache.value || "<empty>"} (supported: npm, yarn, pnpm)`,
			});
		}
		// Left behind by the npm->bun migration, the input silently does
		// nothing once `cache` is gone (auto-caching needs package-manager-cache).
		if (
			inputs.has("cache-dependency-path") &&
			!cache &&
			!inputs.has("package-manager-cache")
		) {
			findings.push({
				line: inputs.get("cache-dependency-path").line,
				detail:
					"cache-dependency-path without cache or package-manager-cache is ignored — remove it",
			});
		}
	}
	return findings;
}

function main() {
	const args = process.argv.slice(2);
	const files = args.length ? args : gatedFiles();
	let failed = false;
	for (const file of files) {
		let text;
		try {
			text = readFileSync(file, "utf8");
		} catch {
			continue; // staged file removed between hook launch and read
		}
		for (const finding of setupNodeCacheFindings(text)) {
			console.error(
				`setup-node-cache: ${file.replace(/\\/g, "/")}:${finding.line}: ${finding.detail}`,
			);
			failed = true;
		}
	}
	if (failed) process.exit(1);
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
	main();
}
