import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Sefarim } from "./tanah-view-types";

const canonicalCache = Symbol.for("bible-on-site.canonical-sefarim");
const server = globalThis as typeof globalThis & {
	[canonicalCache]?: Sefarim;
};

function canonicalSefarim(): Sefarim {
	if (server[canonicalCache]) return server[canonicalCache];
	// Read the original number literals directly. Embedding this 77 MB text in
	// route JavaScript adds compilation work and separate runtime copies at startup.
	const data = JSON.parse(
		readFileSync(
			resolve(process.cwd(), "src/data/db/sefaria-dump-5784-sivan-4.tanah_view.json"),
			"utf8",
		),
	) as Sefarim;
	server[canonicalCache] = data;
	return data;
}

function sourceSefarim(): Sefarim {
	if (process.env.IS_TEST_ENV) {
		// Keep Jest's fixture-module replacement separate from the production file.
		// biome-ignore lint/security/noGlobalEval: fixed local module, only in the test environment
		return eval("require('./sefaria-dump-5784-sivan-4.tanah_view.json')") as Sefarim;
	}
	if (process.env.NODE_ENV === "production") return canonicalSefarim();
	// The development dependency remains in the module graph so edits trigger HMR.
	const data = require("./sefaria-dump-5784-sivan-4.tanah_view.json") as
		| string
		| Sefarim;
	return typeof data === "string" ? (JSON.parse(data) as Sefarim) : data;
}

const sefarim: Sefarim = Array.from(sourceSefarim());

export { sefarim };
