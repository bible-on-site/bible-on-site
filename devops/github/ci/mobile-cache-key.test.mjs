import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { directFileHash, mobileCacheKeys } from "./mobile-cache-key.mjs";

const INPUTS = {
	"devops/package-lock.json": "build dependencies",
	"app/mobile-e2e/package-lock.json": "test dependencies",
	"app/mobile-e2e/android-readiness.mjs": "readiness",
	"app/mobile-e2e/android-ready.mjs": "ready",
};

function withInputs(action) {
	const root = mkdtempSync(join(tmpdir(), "mobile-cache-key-"));
	try {
		for (const [path, content] of Object.entries(INPUTS)) {
			mkdirSync(join(root, path, ".."), { recursive: true });
			writeFileSync(join(root, path), content);
		}
		action(root);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

test("either lockfile rotates only the npm cache", () => {
	for (const path of ["devops/package-lock.json", "app/mobile-e2e/package-lock.json"]) {
		withInputs((root) => {
			const before = mobileCacheKeys(root);
			writeFileSync(join(root, path), "updated dependencies");
			const after = mobileCacheKeys(root);
			assert.notEqual(after.npm, before.npm);
			assert.equal(after.avd, before.avd);
		});
	}
});

test("either readiness script rotates only the AVD cache", () => {
	for (const path of ["app/mobile-e2e/android-readiness.mjs", "app/mobile-e2e/android-ready.mjs"]) {
		withInputs((root) => {
			const before = mobileCacheKeys(root);
			writeFileSync(join(root, path), "updated readiness");
			const after = mobileCacheKeys(root);
			assert.notEqual(after.avd, before.avd);
			assert.equal(after.npm, before.npm);
		});
	}
});

test("build outputs and unrelated files do not affect the keys", () => {
	withInputs((root) => {
		const before = mobileCacheKeys(root);
		mkdirSync(join(root, "node_modules/large-build"), { recursive: true });
		writeFileSync(join(root, "node_modules/large-build/package-lock.json"), "unrelated");
		assert.deepEqual(mobileCacheKeys(root), before);
	});
});

test("missing inputs fail instead of sharing an empty cache key", () => {
	withInputs((root) => {
		rmSync(join(root, "devops/package-lock.json"));
		assert.throws(() => mobileCacheKeys(root), { code: "ENOENT" });
	});
});

test("input identity and ordering keep hashes unambiguous", () => {
	withInputs((root) => {
		assert.equal(
			directFileHash(root, ["devops/package-lock.json", "app/mobile-e2e/package-lock.json"]),
			directFileHash(root, ["app/mobile-e2e/package-lock.json", "devops/package-lock.json"]),
		);
		writeFileSync(join(root, "devops/package-lock.json"), "same bytes");
		writeFileSync(join(root, "app/mobile-e2e/package-lock.json"), "same bytes");
		assert.notEqual(
			directFileHash(root, ["devops/package-lock.json"]),
			directFileHash(root, ["app/mobile-e2e/package-lock.json"]),
		);
	});
});
