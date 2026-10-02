import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
	mkdtemp,
	readdir,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import sharp from "sharp";
import { prepareImage } from "./prepare.mjs";

const run = promisify(execFile);
const cli = join(dirname(fileURLToPath(import.meta.url)), "prepare.mjs");
const hash = (data) => createHash("sha256").update(data).digest("hex");

async function workspace(t) {
	const directory = await mkdtemp(join(tmpdir(), "perek-images-test-"));
	t.after(() => rm(directory, { recursive: true, force: true }));
	return directory;
}

test("the CLI encodes six valid assets with accurate, immutable upload metadata", async (t) => {
	const directory = await workspace(t);
	const input = join(directory, "master with spaces.png");
	const output = join(directory, "output with spaces");
	const source = await sharp(
		Buffer.from(`<svg width="1600" height="1000">
		<rect width="1600" height="1000" fill="#cc3333"/>
		<rect width="1600" height="100" fill="#33cc33"/>
		<rect y="900" width="1600" height="100" fill="#3333cc"/>
	</svg>`),
	)
		.png()
		.withMetadata()
		.toBuffer();
	await writeFile(input, source);
	await run(process.execPath, [cli, input, "--perek", "1", "--output", output]);
	const manifest = JSON.parse(
		await readFile(join(output, "manifest.json"), "utf8"),
	);
	assert.equal(manifest.perek_id, 1);
	assert.deepEqual(manifest.warnings, []);
	assert.deepEqual(
		manifest.variants.map(({ format, width }) => [format, width]),
		[
			["avif", 640],
			["avif", 960],
			["avif", 1280],
			["avif", 1600],
			["webp", 1600],
			["jpeg", 1600],
		],
	);
	for (const variant of manifest.variants) {
		const data = await readFile(join(output, variant.file));
		const metadata = await sharp(data).metadata();
		assert.equal(
			metadata.format,
			variant.format === "avif" ? "heif" : variant.format,
		);
		assert.equal(metadata.width, variant.width);
		assert.equal(metadata.height, variant.height);
		assert.equal(variant.width * 9, variant.height * 16);
		assert.equal(variant.bytes, (await stat(join(output, variant.file))).size);
		assert.equal(variant.sha256, hash(data));
		assert.equal(variant.content_type, `image/${variant.format}`);
		assert.equal(variant.cache_control, "public,max-age=31536000,immutable");
		assert.match(variant.s3_key, /^perakim\/1\/[a-f0-9]{16}\//);
		assert.ok(variant.file.includes(variant.sha256.slice(0, 16)));
		assert.equal(metadata.space, "srgb");
		assert.equal(metadata.exif, undefined);
		assert.equal(metadata.icc, undefined);
		assert.equal(metadata.orientation, undefined);
		assert.equal(metadata.hasAlpha, false);
		// Both edge bands remain in every centre crop and every delivery format.
		const { data: pixels, info } = await sharp(data)
			.removeAlpha()
			.raw()
			.toBuffer({ resolveWithObject: true });
		const pixel = (x, y) =>
			pixels.subarray(
				(y * info.width + x) * info.channels,
				(y * info.width + x) * info.channels + 3,
			);
		const top = pixel(
			Math.floor(info.width / 2),
			Math.floor(info.height * 0.025),
		);
		const bottom = pixel(
			Math.floor(info.width / 2),
			Math.floor(info.height * 0.975),
		);
		assert.ok(top[1] > top[0] * 2);
		assert.ok(bottom[2] > bottom[0] * 2);
	}
	assert.deepEqual(await readFile(input), source);
	// A changed crop gets new keys even with the same source and destination.
	const changed = await prepareImage({
		input,
		output,
		perek: 1,
		position: "north",
	});
	for (let i = 0; i < manifest.variants.length; i++) {
		assert.notEqual(
			changed.manifest.variants[i].s3_key,
			manifest.variants[i].s3_key,
		);
		assert.ok(await stat(join(output, manifest.variants[i].file)));
	}
	const social = changed.manifest.variants.find(
		({ role }) => role === "social",
	);
	const { data: pixel } = await sharp(join(output, social.file))
		.extract({ left: 800, top: 875, width: 1, height: 1 })
		.raw()
		.toBuffer({ resolveWithObject: true });
	assert.ok(pixel[0] > pixel[2] * 2);
});

test("small masters retain native resolution and warn about search preview size", async (t) => {
	const directory = await workspace(t);
	const input = join(directory, "small.png");
	await sharp({
		create: { width: 1024, height: 768, channels: 4, background: "#3399cc80" },
	})
		.png()
		.toFile(input);
	const { manifest } = await prepareImage({
		input,
		output: join(directory, "out"),
	});
	assert.deepEqual(
		manifest.variants.map(({ width }) => width),
		[640, 960, 1024, 1024, 1024],
	);
	assert.equal(manifest.master.height, 576);
	assert.equal(manifest.perek_id, null);
	assert.match(manifest.warnings.join(" "), /avoid upscaling.*below 1200/);
	for (const variant of manifest.variants) assert.ok(variant.width <= 1024);
});

test("EXIF rotation is applied before measuring and cropping", async (t) => {
	const directory = await workspace(t);
	const input = join(directory, "rotated.jpg");
	await sharp({
		create: { width: 900, height: 1600, channels: 3, background: "#3399cc" },
	})
		.withMetadata({ orientation: 6 })
		.jpeg()
		.toFile(input);
	const { manifest } = await prepareImage({
		input,
		output: join(directory, "out"),
	});
	assert.deepEqual(manifest.source, {
		sha256: hash(await readFile(input)),
		width: 1600,
		height: 900,
	});
	assert.equal(manifest.master.width, 1600);
	assert.equal(manifest.master.height, 900);
	assert.equal(manifest.variants.length, 6);
});

test("invalid inputs fail without creating partial assets", async (t) => {
	const directory = await workspace(t);
	const input = join(directory, "too-small.png");
	const output = join(directory, "out");
	await sharp({
		create: { width: 320, height: 180, channels: 3, background: "white" },
	})
		.png()
		.toFile(input);
	await assert.rejects(
		prepareImage({ input, output }),
		/at least a 640x360 crop/,
	);
	for (const perek of [0, 930, 1.5, NaN]) {
		await assert.rejects(
			prepareImage({ input, output, perek }),
			/integer from 1 to 929/,
		);
	}
	await assert.rejects(
		prepareImage({ input, output, position: "unknown" }),
		/Crop position/,
	);
	await writeFile(input, "This is not an image.");
	await assert.rejects(
		prepareImage({ input, output }),
		/unsupported image format/,
	);
	const frame = await sharp({
		create: { width: 640, height: 360, channels: 3, background: "white" },
	})
		.png()
		.toBuffer();
	const secondFrame = await sharp(frame).negate().png().toBuffer();
	await sharp([frame, secondFrame], { join: { animated: true } })
		.webp()
		.toFile(input);
	await assert.rejects(prepareImage({ input, output }), /single still image/);
	assert.deepEqual((await readdir(directory)).sort(), ["too-small.png"]);
	const manifestInput = join(directory, "manifest.json");
	await writeFile(manifestInput, frame);
	await assert.rejects(
		prepareImage({ input: manifestInput, output: directory }),
		/must not overwrite the source/,
	);
	assert.deepEqual(await readFile(manifestInput), frame);
});

test("CLI help and invalid arguments do not process images", async () => {
	const { stdout } = await run(process.execPath, [cli, "--help"]);
	assert.match(stdout, /One image is enough/);
	for (const args of [[], ["one.png", "two.png"], ["--unknown"]]) {
		await assert.rejects(
			run(process.execPath, [cli, ...args]),
			(error) => error.code === 1,
		);
	}
});
