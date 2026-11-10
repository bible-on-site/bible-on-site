import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { flattenStandaloneApp } from "./standalone-layout.mjs";

test("a traced shared root preserves the existing runnable standalone layout", (t) => {
	const directory = mkdtempSync(path.join(os.tmpdir(), "upload-standalone-"));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	const nested = path.join(directory, "bible-on-site");
	for (const relative of [
		".next/server",
		"src/data",
		"node_modules/runtime-dependency",
	])
		mkdirSync(path.join(nested, relative), { recursive: true });
	mkdirSync(path.join(directory, "node_modules/root-dependency"), {
		recursive: true,
	});
	writeFileSync(
		path.join(directory, "node_modules/root-dependency/index.js"),
		"module.exports = 'root'",
	);
	writeFileSync(
		path.join(nested, "node_modules/runtime-dependency/index.js"),
		"module.exports = 'app'",
	);
	const bytes = Buffer.from([0, 1, 128, 255]);
	writeFileSync(path.join(nested, "src/data/canonical.br"), bytes);
	writeFileSync(
		path.join(nested, ".next/server/route.js"),
		"module.exports = 'route'",
	);
	writeFileSync(
		path.join(nested, "server.js"),
		`
		const assert = require('node:assert/strict');
		assert.equal(require('runtime-dependency'), 'app');
		assert.equal(require('root-dependency'), 'root');
		assert.equal(require('./.next/server/route.js'), 'route');
		console.log('standalone runtime works');
	`,
	);
	flattenStandaloneApp(directory);
	flattenStandaloneApp(directory); // Re-running postbuild preserves a flat build.
	assert.equal(existsSync(nested), false);
	assert.deepEqual(
		readFileSync(path.join(directory, "src/data/canonical.br")),
		bytes,
	);
	assert.match(
		execFileSync(process.execPath, ["server.js"], {
			cwd: directory,
			encoding: "utf8",
		}),
		/standalone runtime works/,
	);
});
