import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { dedupePrerenderRsc } from "./dedupe-prerender-rsc.mjs";

test("dedupePrerenderRsc links byte-identical full segment payloads", () => {
	const fixture = mkdtempSync(path.join(tmpdir(), "dedupe-rsc-"));
	try {
		const routeDir = path.join(fixture, "929", "1");
		mkdirSync(path.join(routeDir, "comment.segments"), { recursive: true });
		const sourcePath = path.join(routeDir, "comment.rsc");
		const duplicatePath = path.join(
			routeDir,
			"comment.segments",
			"_full.segment.rsc",
		);
		const payload = Buffer.from("same serialized payload".repeat(100));
		writeFileSync(sourcePath, payload);
		writeFileSync(duplicatePath, payload);

		const result = dedupePrerenderRsc(fixture);

		assert.equal(result.checked, 1);
		assert.equal(result.deduped, 1);
		assert.equal(result.bytes, payload.length);
		assert.deepEqual(readFileSync(duplicatePath), payload);
		assert.equal(statSync(duplicatePath).ino, statSync(sourcePath).ino);
	} finally {
		rmSync(fixture, { recursive: true, force: true });
	}
});

test("dedupePrerenderRsc keeps differing full segment payloads as files", () => {
	const fixture = mkdtempSync(path.join(tmpdir(), "dedupe-rsc-"));
	try {
		const routeDir = path.join(fixture, "929", "1");
		mkdirSync(path.join(routeDir, "comment.segments"), { recursive: true });
		const sourcePath = path.join(routeDir, "comment.rsc");
		const differentPath = path.join(
			routeDir,
			"comment.segments",
			"_full.segment.rsc",
		);
		writeFileSync(sourcePath, "source payload");
		writeFileSync(differentPath, "different payload");

		const result = dedupePrerenderRsc(fixture);

		assert.equal(result.checked, 1);
		assert.equal(result.deduped, 0);
		assert.equal(readFileSync(differentPath, "utf8"), "different payload");
	} finally {
		rmSync(fixture, { recursive: true, force: true });
	}
});
