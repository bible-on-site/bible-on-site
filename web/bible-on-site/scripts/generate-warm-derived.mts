/**
 * Precomputes the deterministic warm-up data behind GET /api/health/ready
 * (issue #2997): the perek/pasuk search indexes and the recitation track
 * metadata are pure functions of the bundled canonical corpus, but building
 * them costs ~2.5 s of synchronous CPU on every cold start — several times
 * more on the 0.5 vCPU task. This script runs the SAME production functions
 * at build time (every validation — word timing order, canonical text hash,
 * recording manifest — now fails the build rather than a deployment) and
 * writes `warm-derived.generated.json.br` next to the compressed corpus.
 * The server verifies the artifact's `corpusSha256` against the shipped
 * corpus bytes before trusting it, and falls back to live computation on any
 * miss or mismatch, so the artifact is an optimization, never a gate.
 *
 * Runs in `prebuild` after compress-canonical-data.mjs produced the corpus
 * .br; cwd must be the website package so src modules resolve data the same
 * way the standalone server does.
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, constants } from "node:zlib";
import {
	WARM_DERIVED_ARTIFACT_PATH,
	WARM_DERIVED_CORPUS_PATH,
} from "../src/data/db/warm-derived";

// Canonical production path: sefarim.ts reads the .br corpus only under
// NODE_ENV=production, so generation and the server consume identical bytes.
process.env.NODE_ENV = "production";
// Recitation URLs are stripped before storage and re-derived at runtime from
// live storage settings; the placeholder only needs to pass URL validation.
process.env.ASSETS_BASE_URL = "https://warm-derived.invalid";
// Never let a previously generated artifact seed this run's "live" compute.
process.env.WARM_DERIVED_DISABLE = "1";

const website = fileURLToPath(new URL("..", import.meta.url));
const corpusBr = readFileSync(`${website}/${WARM_DERIVED_CORPUS_PATH}`);

const { getPerekIndex, getPasukIndex } = await import(
	"../src/lib/search/corpus"
);
const { recitationPackage } = await import("../src/lib/recitation-package");

const artifact = {
	corpusSha256: createHash("sha256").update(corpusBr).digest("hex"),
	perakim: getPerekIndex(),
	pesukim: getPasukIndex(),
	recitations: recitationPackage().tracks.map(
		({ audioUrl: _stripped, ...track }) => track,
	),
};

// Sanity bounds, not a schema: absurd sizes mean the corpus or a helper
// regressed — fail the build before a bad artifact ships.
if (
	artifact.perakim.length !== 929 ||
	artifact.pesukim.length < 20_000 ||
	artifact.recitations.length === 0
)
	throw new Error(
		`Warm-derived data looks wrong: ${artifact.perakim.length} perakim, ${artifact.pesukim.length} pesukim, ${artifact.recitations.length} recitations`,
	);

const json = Buffer.from(JSON.stringify(artifact));
writeFileSync(
	`${website}/${WARM_DERIVED_ARTIFACT_PATH}`,
	brotliCompressSync(json, {
		params: {
			[constants.BROTLI_PARAM_QUALITY]: 9,
			[constants.BROTLI_PARAM_SIZE_HINT]: json.length,
		},
	}),
);
console.log(
	`Wrote ${WARM_DERIVED_ARTIFACT_PATH}: ${artifact.pesukim.length} pesukim, ${artifact.recitations.length} recitations`,
);
