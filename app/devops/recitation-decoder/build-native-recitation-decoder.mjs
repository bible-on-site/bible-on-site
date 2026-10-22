import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildSync } from "esbuild";

// App-owned copy of the native decoder build (#2391). Its decoder versions must
// stay identical to the website's runtime pins in web/bible-on-site/package.json
// (checked by check-decoder-pins.mjs); the website plays the same recordings
// through the same decoders in src/lib/recitation-audio.ts, and PCM sample
// alignment is a correctness requirement for approved word/verse ranges.
// Use the identical locked ESM implementation in browsers and the offline app.
// Compressed WASM template strings must remain byte-for-byte unchanged.
// The native bridge evaluates the UTF-8 asset directly, without HTML parsing.
export function nativeRecitationDecoder() {
	return buildSync({
		stdin: {
			contents:
				'import { MPEGDecoder } from "mpg123-decoder"; import { OggOpusDecoder } from "ogg-opus-decoder"; globalThis.recitationMpeg = { MPEGDecoder, OggOpusDecoder };',
			resolveDir: import.meta.dirname,
		},
		bundle: true,
		write: false,
		minify: true,
		format: "iife",
		charset: "ascii",
		// The player does not enable ML speech enhancement. Exclude its optional
		// 4 MB payload from the offline bridge; ordinary libopus stays unchanged.
		alias: {
			"@wasm-audio-decoders/opus-ml": resolve(
				import.meta.dirname,
				"disabled-opus-ml.mjs",
			),
		},
		banner: {
			js: "// Generated from mpg123-decoder 1.0.3 and ogg-opus-decoder 1.7.5 by app/devops/recitation-decoder/build-native-recitation-decoder.mjs. See recitation-decoder-notices.txt.",
		},
	}).outputFiles[0].text;
}

if (process.argv.includes("--write")) {
	writeFileSync(
		resolve(
			import.meta.dirname,
			"../../BibleOnSite/Resources/Raw/recitation-mpeg.min.js",
		),
		nativeRecitationDecoder(),
	);
}
if (process.argv.includes("--stdout"))
	process.stdout.write(nativeRecitationDecoder());
