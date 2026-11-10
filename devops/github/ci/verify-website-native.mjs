// Runs against the website Dockerfile's deps stage, before any DB-backed SSG.
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire("/app/package.json");
const arch = process.argv.at(-1);
const expectedArch = arch === "amd64" ? "x64" : arch;
assert.equal(process.platform, "linux");
assert.equal(process.arch, expectedArch);

// Fail if Next silently falls back to WASM: this check is native ARM evidence.
const swc = require("next/dist/build/swc");
const bindings = await swc.loadBindings();
assert.equal(bindings.isWasm, false, "Next must load its native SWC binding");
const compiled = await bindings.transform("export const answer: number = 42;", {
	filename: "native-smoke.ts",
	jsc: { parser: { syntax: "typescript" }, target: "es2022" },
	module: { type: "commonjs" },
});
const module = { exports: {} };
new Function("module", "exports", compiled.code)(module, module.exports);
assert.equal(module.exports.answer, 42);

// Execute libvips, including JPEG encode/decode and a real resize, rather than
// merely resolving the optional package from the lockfile.
const sharp = require("sharp");
const input = await sharp({
	create: {
		width: 12,
		height: 8,
		channels: 3,
		background: { r: 220, g: 30, b: 10 },
	},
}).jpeg().toBuffer();
const output = await sharp(input).resize({ width: 6 }).jpeg().toBuffer();
const metadata = await sharp(output).metadata();
assert.equal(metadata.format, "jpeg");
assert.equal(metadata.width, 6);
assert.equal(metadata.height, 4);
const { data, info } = await sharp(output).raw().toBuffer({ resolveWithObject: true });
assert.equal(info.channels, 3);
assert.ok(data[0] > 200 && data[1] < 50 && data[2] < 30, "transcode must preserve the source color");
console.log(JSON.stringify({
	arch: process.arch,
	swc: bindings.getTargetTriple(),
	sharp: sharp.versions.sharp,
	libvips: sharp.versions.vips,
	jpeg: { width: metadata.width, height: metadata.height, bytes: output.length },
}));
