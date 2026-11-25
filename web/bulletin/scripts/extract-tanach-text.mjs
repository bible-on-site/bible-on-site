#!/usr/bin/env node
/**
 * Extract minimal Tanach text from the pinned Sefaria dump.
 *
 * Output: `data/tanach-text.json` — `{ corpus, perakim }` where `perakim`
 * maps perekId (1-929) → { seferName, perekInSefer, header, pesukim } and
 * `corpus` is the shared dump version the website JSON and the bundled
 * native SQLite are named after (#3709).
 *
 * Generated — never committed. build.rs runs this whenever the canonical
 * corpus is on disk; the Lambda Dockerfile regenerates it in a Node stage.
 *
 * Run from repo root or web/bulletin/:
 *   node scripts/extract-tanach-text.mjs [--out PATH]
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const bulletinDir = resolve(__dirname, "..");
const dbDir = resolve(bulletinDir, "../bible-on-site/src/data/db");
const outIndex = process.argv.indexOf("--out");
const outputJson =
	outIndex < 0
		? resolve(bulletinDir, "data", "tanach-text.json")
		: resolve(process.argv[outIndex + 1]);

// The corpus filename carries the dump version (`sefaria-dump-5784-sivan-4`),
// which is also the native SQLite's name stem — resolve it by glob so the
// stamp always follows the canonical input.
const corpusFiles = readdirSync(dbDir).filter(
	(name) =>
		name.startsWith("sefaria-dump-") && name.endsWith(".tanah_view.json"),
);
if (corpusFiles.length !== 1) {
	throw new Error(
		`Expected exactly one sefaria-dump-*.tanah_view.json under ${dbDir}, found ${corpusFiles.length}`,
	);
}
const corpus = corpusFiles[0].replace(/\.tanah_view\.json$/, "");
const sourceJson = resolve(dbDir, corpusFiles[0]);

// Where a sefer's final pasuk ends on a harsh note, tradition repeats the
// penultimate pasuk aloud — איכה ה repeats השיבנו and קהלת יב repeats סוף דבר.
// The notes ship unpointed and bracketed, as printed editions show them; the
// previous hand-edited file wrapped them in <small> markup that every renderer
// escaped into literal text.
const REPEAT_VERSES = new Map([
	[807, "השיבנו יהוה אליך ונשובה חדש ימינו כקדם"],
	[819, "סוף דבר הכל נשמע את־האלהים ירא ואת־מצותיו שמור כי־זה כל־האדם"],
]);

function segmentsToText(segments) {
	const filtered = segments.filter((s) => s.type === "qri" || s.type === "ktiv");
	let result = "";
	for (let i = 0; i < filtered.length; i++) {
		if (i > 0 && !result.endsWith("־")) {
			// Biblical maqaf — no word break.
			result += " ";
		}
		result += filtered[i].value;
	}
	return result;
}

const sefarim = JSON.parse(readFileSync(sourceJson, "utf-8"));
const result = { corpus, perakim: {} };

for (const sefer of sefarim) {
	const hasAdditionals = "additionals" in sefer;
	const groups = hasAdditionals ? sefer.additionals : [sefer];

	for (const group of groups) {
		const seferName = hasAdditionals ? `${sefer.name} ${group.letter}` : sefer.name;
		const perakim = group.perakim || [];

		for (let i = 0; i < perakim.length; i++) {
			const perek = perakim[i];
			const perekId = group.perekFrom + i;
			const perekInSefer = i + 1;

			const pesukim = (perek.pesukim || []).map((pasuk) =>
				segmentsToText(pasuk.segments),
			);
			const repeat = REPEAT_VERSES.get(perekId);
			if (repeat) {
				pesukim[pesukim.length - 1] += ` [${repeat}]`;
			}

			result.perakim[perekId] = {
				seferName,
				perekInSefer,
				header: perek.header || "",
				pesukim,
			};
		}
	}
}

const totalPerakim = Object.keys(result.perakim).length;
const json = JSON.stringify(result);

if (existsSync(outputJson) && readFileSync(outputJson, "utf-8") === json) {
	console.log(
		`tanach-text.json is current (${corpus}, ${totalPerakim} perakim)`,
	);
} else {
	mkdirSync(dirname(outputJson), { recursive: true });
	writeFileSync(outputJson, json, "utf-8");
	const sizeMB = (Buffer.byteLength(json, "utf-8") / (1024 * 1024)).toFixed(2);
	console.log(
		`Extracted ${totalPerakim} perakim (${corpus}) → ${outputJson} (${sizeMB} MB)`,
	);
}
