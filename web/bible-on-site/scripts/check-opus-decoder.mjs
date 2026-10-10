import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInThisContext } from "node:vm";
import { gunzipSync } from "node:zlib";
import { nativeRecitationDecoder } from "./build-native-recitation-decoder.mjs";

const root = resolve(import.meta.dirname, "../../..");
const shipped = readFileSync(
	resolve(root, "app/BibleOnSite/Resources/Raw/recitation-mpeg.min.js"),
	"utf8",
);
assert.equal(shipped, nativeRecitationDecoder());
// Native WebViews have Worker globally, although this bridge uses no workers.
globalThis.Worker = class {
	constructor() {
		throw new Error("Unexpected worker in offline bridge");
	}
};
runInThisContext(shipped);
const html = readFileSync(
	resolve(root, "app/BibleOnSite/Resources/Raw/recitation-audio.html"),
	"utf8",
);
runInThisContext(html.match(/<script>([\s\S]*?)<\/script>/)[1]);
const reference = gunzipSync(
	readFileSync(resolve(root, "data/recitation/fixtures/seek-opus.pcm.gz")),
);
recitation.load(
	readFileSync(resolve(root, "data/recitation/fixtures/seek.ogg")).toString(
		"base64",
	),
);
for (
	let attempt = 0;
	recitation.status().state === "loading" && attempt < 200;
	attempt++
)
	await new Promise((resolve) => setTimeout(resolve, 10));
assert.equal(
	recitation.status().state,
	"ready",
	JSON.stringify(recitation.status()),
);
assert.equal(recitation.status().sampleRate, 48000);
assert.equal(recitation.status().frames, 96000);
for (const ranges of [
	[{ start: 0, end: 2000 }],
	[{ start: 101, end: 599 }],
	[
		{ start: 0, end: 200 },
		{ start: 1800, end: 2000 },
	],
]) {
	const { length } = recitation.clip(ranges);
	const chunks = [];
	for (let offset = 0; offset < length; offset += 49152)
		chunks.push(Buffer.from(recitation.chunk(offset, 49152).data, "base64"));
	const actual = Buffer.concat(chunks).subarray(44);
	const expected = Buffer.concat(
		ranges.map(({ start, end }) =>
			reference.subarray(Math.round(start * 48) * 2, Math.round(end * 48) * 2),
		),
	);
	assert.equal(actual.length, expected.length);
	let maximum = 0;
	for (let offset = 0; offset < actual.length; offset += 2)
		maximum = Math.max(
			maximum,
			Math.abs(actual.readInt16LE(offset) - expected.readInt16LE(offset)),
		);
	assert.ok(maximum <= 2, `Opus PCM diverged from FFmpeg: ${maximum}`);
}
console.log(
	"96000 frames; exact range lengths; PCM matches FFmpeg within 2 quantization units",
);
