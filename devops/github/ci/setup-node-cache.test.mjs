import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import {
	gatedFiles,
	SETUP_NODE_SUPPORTED_CACHES,
	setupNodeCacheFindings,
} from "./setup-node-cache.mjs";

describe("setupNodeCacheFindings", () => {
	test("flags the cache: bun regression from #2643", () => {
		const workflow = [
			"      - name: Setup Node.js",
			"        uses: actions/setup-node@v7",
			"        with:",
			"          node-version-file: ${{ env.MODULE_DIRECTORY }}/package.json",
			"          cache-dependency-path: ${{ env.MODULE_DIRECTORY }}/bun.lock",
			"          cache: bun",
		].join("\n");
		const findings = setupNodeCacheFindings(workflow);
		assert.equal(findings.length, 1);
		assert.equal(findings[0].line, 6);
		assert.match(findings[0].detail, /does not support cache: bun/);
	});

	test("accepts the documented enum, quoted values, and a missing cache input", () => {
		for (const cache of ["npm", "yarn", "pnpm", `'npm'`, `"pnpm"`]) {
			const workflow = [
				"      - uses: actions/setup-node@v7",
				"        with:",
				`          cache: ${cache}`,
				"          cache-dependency-path: package-lock.json",
			].join("\n");
			assert.deepEqual(setupNodeCacheFindings(workflow), [], cache);
		}
		const noCache = [
			"      - uses: actions/setup-node@v7",
			"        with:",
			"          node-version-file: devops/package.json",
		].join("\n");
		assert.deepEqual(setupNodeCacheFindings(noCache), []);
	});

	test("flags a non-literal cache expression it cannot verify statically", () => {
		const workflow = [
			"      - uses: actions/setup-node@v7",
			"        with:",
			"          cache: ${{ matrix.pm }}",
		].join("\n");
		assert.equal(setupNodeCacheFindings(workflow).length, 1);
	});

	test("does not attribute another action's cache input to setup-node", () => {
		const workflow = [
			"      - uses: actions/setup-node@v7",
			"        with:",
			"          node-version-file: devops/package.json",
			"      - uses: actions/setup-go@v6",
			"        with:",
			"          cache: true",
		].join("\n");
		assert.deepEqual(setupNodeCacheFindings(workflow), []);
	});

	test("ignores cache text inside a following run-only step", () => {
		const workflow = [
			"      - uses: actions/setup-node@v7",
			"        with:",
			"          node-version-file: devops/package.json",
			"      - name: Document",
			"        run: |",
			"          cat > config <<EOF",
			"          cache: bun",
			"          EOF",
		].join("\n");
		assert.deepEqual(setupNodeCacheFindings(workflow), []);
	});

	test("flags flow-style with maps", () => {
		const workflow = [
			"      - uses: actions/setup-node@v7",
			'        with: { node-version-file: "devops/package.json", cache: bun }',
		].join("\n");
		assert.equal(setupNodeCacheFindings(workflow).length, 1);
	});

	test("flags a dangling cache-dependency-path left after removing cache", () => {
		const workflow = [
			"      - uses: actions/setup-node@v7",
			"        with:",
			"          node-version-file: devops/package.json",
			"          cache-dependency-path: devops/bun.lock",
		].join("\n");
		const findings = setupNodeCacheFindings(workflow);
		assert.equal(findings.length, 1);
		assert.match(findings[0].detail, /cache-dependency-path/);
	});
});

describe("workflow and action setup-node cache inputs", () => {
	const files = gatedFiles();

	test("gated files exist", () => {
		assert.ok(files.length > 0);
		assert.ok(SETUP_NODE_SUPPORTED_CACHES.has("npm"));
	});

	for (const file of files) {
		const name = file.replace(/\\/g, "/").split(".github/")[1];
		test(`${name} only uses supported setup-node caches`, () => {
			const findings = setupNodeCacheFindings(readFileSync(file, "utf8"));
			assert.deepEqual(
				findings.map((f) => `${name}:${f.line} ${f.detail}`),
				[],
			);
		});
	}
});
