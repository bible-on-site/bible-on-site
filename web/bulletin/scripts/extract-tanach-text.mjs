#!/usr/bin/env node
/**
 * Extract minimal Tanach text from the full Sefaria dump.
 * Output: a JSON file keyed by perekId (1-929) with just what the PDF needs:
 *   { seferName, perekInSefer, header, pesukim: string[] }
 *
 * Run from repo root or web/bulletin/:
 *   node scripts/extract-tanach-text.mjs
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const bulletinDir = resolve(__dirname, "..");
const sourceJson = resolve(
	bulletinDir,
	"../bible-on-site/src/data/db/sefaria-dump-5784-sivan-4.tanah_view.json",
);
const outputJson = resolve(bulletinDir, "data", "tanach-text.json");

const TAAMIM_REGEX = /[\u0591-\u05AF]/g;

function stripTaamim(text) {
	return text.replace(TAAMIM_REGEX, "");
}

function segmentsToText(segments) {
	return segments
		.filter((s) => s.type === "qri" || s.type === "ktiv")
		.map((s) => s.value)
		.join(" ");
}

const sefarim = JSON.parse(readFileSync(sourceJson, "utf-8"));
const result = {};

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
				stripTaamim(segmentsToText(pasuk.segments)),
			);

			result[perekId] = {
				seferName,
				perekInSefer,
				header: perek.header || "",
				pesukim,
			};
		}
	}
}

const totalPerakim = Object.keys(result).length;
const json = JSON.stringify(result);

import { mkdirSync } from "node:fs";
mkdirSync(resolve(bulletinDir, "data"), { recursive: true });
writeFileSync(outputJson, json, "utf-8");

const sizeMB = (Buffer.byteLength(json, "utf-8") / (1024 * 1024)).toFixed(2);
console.log(`Extracted ${totalPerakim} perakim → ${outputJson} (${sizeMB} MB)`);
