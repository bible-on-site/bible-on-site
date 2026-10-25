import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, test } from "node:test";

const WORKFLOWS_DIR = new URL("../../../.github/workflows/", import.meta.url);

// actions/setup-node rejects cache values outside this set at runtime — a
// `cache: bun` input broke website packaging on master (#2643). Bun's store
// is cached explicitly via actions/cache on ~/.bun/install/cache instead.
const SUPPORTED_SETUP_NODE_CACHES = new Set(["npm", "yarn", "pnpm"]);

function setupNodeCacheValues(workflowText) {
	const lines = workflowText.split("\n");
	const values = [];
	for (let i = 0; i < lines.length; i++) {
		if (!/uses:\s*actions\/setup-node@/.test(lines[i])) {
			continue;
		}
		// `cache:` only exists as a setup-node input; the next `uses:` line
		// marks where this step's with-block ends at the latest.
		for (let j = i + 1; j < lines.length && !/uses:\s*\S+/.test(lines[j]); j++) {
			const match = /^\s*cache\s*:\s*['"]?([\w-]+)['"]?\s*$/.exec(lines[j]);
			if (match) {
				values.push(match[1]);
			}
		}
	}
	return values;
}

describe("workflow setup-node cache inputs", () => {
	const files = readdirSync(WORKFLOWS_DIR)
		.filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"));

	test("workflow files exist", () => {
		assert.ok(files.length > 0);
	});

	for (const name of files) {
		test(`${name} only uses supported setup-node caches`, () => {
			const values = setupNodeCacheValues(readFileSync(new URL(name, WORKFLOWS_DIR), "utf8"));
			for (const value of values) {
				assert.ok(
					SUPPORTED_SETUP_NODE_CACHES.has(value),
					`${name}: actions/setup-node does not support cache: ${value}`,
				);
			}
		});
	}
});
