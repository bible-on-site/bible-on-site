import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildSync } from "esbuild";

// Use the identical locked ESM implementation in browsers and the offline app.
// Compressed WASM template strings must remain byte-for-byte unchanged.
// The native bridge evaluates the UTF-8 asset directly, without HTML parsing.
export function nativeRecitationDecoder() {
	return buildSync({
		stdin: {
			contents:
				'import { MPEGDecoder } from "mpg123-decoder"; globalThis.recitationMpeg = { MPEGDecoder };',
			resolveDir: resolve(import.meta.dirname, ".."),
		},
		bundle: true,
		write: false,
		minify: true,
		format: "iife",
		charset: "ascii",
		banner: {
			js: "// Generated from mpg123-decoder 1.0.3 by scripts/build-native-recitation-decoder.mjs. See recitation-decoder-notices.txt.",
		},
	}).outputFiles[0].text;
}

if (process.argv.includes("--write")) {
	writeFileSync(
		resolve(
			import.meta.dirname,
			"../../../app/BibleOnSite/Resources/Raw/recitation-mpeg.min.js",
		),
		nativeRecitationDecoder(),
	);
}
if (process.argv.includes("--stdout"))
	process.stdout.write(nativeRecitationDecoder());
