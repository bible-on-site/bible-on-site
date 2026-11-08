import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// #2391: the app's offline decoder pins (this manifest) and the website's
// runtime decoder dependencies (web/bible-on-site/package.json) are deliberate
// duplicates that must stay equal: the browser player and the shipped
// recitation-mpeg.min.js must decode recordings to the same PCM samples or
// approved word/verse ranges drift. Bump both manifests together and
// regenerate the asset; decoder fixes must land in both places.
const decoderDependencies = ["mpg123-decoder", "ogg-opus-decoder"];

function appManifest() {
	return JSON.parse(
		readFileSync(resolve(import.meta.dirname, "package.json"), "utf8"),
	);
}

export function assertDecoderPinsAligned() {
	const app = appManifest();
	const website = JSON.parse(
		readFileSync(
			resolve(
				import.meta.dirname,
				"../../../web/bible-on-site/package.json",
			),
			"utf8",
		),
	);
	for (const dependency of decoderDependencies) {
		assert.equal(
			website.dependencies?.[dependency],
			app.dependencies?.[dependency],
			`${dependency} must match ${dependency} in web/bible-on-site/package.json`,
		);
	}
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
	assertDecoderPinsAligned();
	const manifest = appManifest();
	console.log(
		decoderDependencies
			.map((dependency) => `${dependency}@${manifest.dependencies[dependency]}`)
			.join(" ") + " aligned with web/bible-on-site/package.json",
	);
}
