import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { filesHash } from "./files-hash.mjs";

const withFiles = (files, fn) => {
	const root = mkdtempSync(join(tmpdir(), "files-hash-"));
	try {
		for (const [path, content] of Object.entries(files)) {
			writeFileSync(join(root, path), content);
		}
		return fn(root);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
};

test("identical content hashes identically regardless of arg order", () => {
	withFiles({ "a.txt": "one", "b.txt": "two" }, (root) => {
		assert.equal(
			filesHash(["a.txt", "b.txt"], root),
			filesHash(["b.txt", "a.txt"], root),
		);
	});
});

test("content changes change the hash", () => {
	const before = withFiles({ "a.txt": "one" }, (root) =>
		filesHash(["a.txt"], root),
	);
	const after = withFiles({ "a.txt": "two" }, (root) =>
		filesHash(["a.txt"], root),
	);
	assert.notEqual(before, after);
});

test("CRLF and LF checkouts produce the same key", () => {
	const lf = withFiles({ "lock.json": "{\n\tx: 1\n}" }, (root) =>
		filesHash(["lock.json"], root),
	);
	const crlf = withFiles({ "lock.json": "{\r\n\tx: 1\r\n}" }, (root) =>
		filesHash(["lock.json"], root),
	);
	assert.equal(lf, crlf);
});

test("the path participates in the hash", () => {
	const a = withFiles({ "a.txt": "same" }, (root) =>
		filesHash(["a.txt"], root),
	);
	const b = withFiles({ "b.txt": "same" }, (root) =>
		filesHash(["b.txt"], root),
	);
	assert.notEqual(a, b);
});

test("a missing file fails loudly instead of hashing emptiness", () => {
	withFiles({ "a.txt": "one" }, (root) => {
		assert.throws(() => filesHash(["missing.txt"], root));
	});
});
