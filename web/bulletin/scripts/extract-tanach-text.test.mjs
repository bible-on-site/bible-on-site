/**
 * Contract checks for extract-tanach-text.mjs (#3709): the generated
 * bulletin text must stay version-locked with the canonical website corpus
 * and the bundled native SQLite, all three named after one Sefaria dump.
 * The heavy render assertions live in src/tanach.rs tests; these pin the
 * extraction premise and stamp at the Node layer.
 *
 * The artifact is gitignored, so the test regenerates it into a temp file —
 * self-contained on a cold checkout (CI runs this without a prior build).
 *
 * Run: bun test scripts/extract-tanach-text.test.mjs (or node --test)
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const bulletinDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(bulletinDir, "../..");
const dbDir = resolve(root, "web/bible-on-site/src/data/db");
const appRawDir = resolve(root, "app/BibleOnSite/Resources/Raw");

const corpusFiles = readdirSync(dbDir).filter(
	(name) =>
		name.startsWith("sefaria-dump-") && name.endsWith(".tanah_view.json"),
);

const tmpDir = mkdtempSync(join(tmpdir(), "tanach-text-"));
process.on("exit", () => rmSync(tmpDir, { recursive: true, force: true }));
const generatedJson = join(tmpDir, "tanach-text.json");
execFileSync(process.execPath, [
	resolve(bulletinDir, "scripts/extract-tanach-text.mjs"),
	"--out",
	generatedJson,
]);
const generated = JSON.parse(readFileSync(generatedJson, "utf-8"));

describe("extract-tanach-text", () => {
	it("finds exactly one canonical corpus — the guard's premise", () => {
		assert.equal(corpusFiles.length, 1);
	});

	it("stamps the generated text with the corpus and native SQLite stem", () => {
		const stem = corpusFiles[0].replace(/\.tanah_view\.json$/, "");
		assert.equal(generated.corpus, stem);

		const sqliteStems = readdirSync(appRawDir).filter(
			(name) =>
				name.startsWith("sefaria-dump-") &&
				name.endsWith(".tanah_view.sqlite"),
		);
		assert.equal(sqliteStems.length, 1);
		assert.equal(
			generated.corpus,
			sqliteStems[0].replace(/\.tanah_view\.sqlite$/, ""),
		);
	});

	it("keeps all 929 perakim and the bracketed repeat pesukim", () => {
		const { perakim } = generated;
		assert.equal(Object.keys(perakim).length, 929);
		assert.match(
			perakim["807"].pesukim.at(-1),
			/\[השיבנו יהוה אליך ונשובה חדש ימינו כקדם\]$/,
		);
		assert.match(
			perakim["819"].pesukim.at(-1),
			/\[סוף דבר הכל נשמע את־האלהים ירא ואת־מצותיו שמור כי־זה כל־האדם\]$/,
		);
		// The previous hand-edited file wrapped repeats in escaped <small>
		// markup that rendered literally — it must never return.
		assert.ok(
			!perakim["807"].pesukim.at(-1).includes("<small") &&
				!perakim["819"].pesukim.at(-1).includes("<small"),
		);
	});
});
