import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import sharp from "sharp";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const cacheControl = "public,max-age=31536000,immutable";
const positions = new Set([
	"centre",
	"north",
	"northeast",
	"east",
	"southeast",
	"south",
	"southwest",
	"west",
	"northwest",
]);
const hash = (data) => createHash("sha256").update(data).digest("hex");

/** Convert one approved master into local assets and variant metadata. */
export async function prepareImage({
	input,
	output,
	perek,
	position = "centre",
}) {
	if (
		perek !== undefined &&
		(!Number.isInteger(perek) || perek < 1 || perek > 929)
	) {
		throw new Error("Perek must be an integer from 1 to 929.");
	}
	if (!positions.has(position)) {
		throw new Error(
			`Crop position must be one of: ${[...positions].join(", ")}.`,
		);
	}
	const source = await readFile(resolve(input));
	const metadata = await sharp(source, {
		limitInputPixels: 40_000_000,
	}).metadata();
	if (!["png", "jpeg", "webp", "heif"].includes(metadata.format)) {
		throw new Error("Use a PNG, JPEG, WebP, or AVIF master image.");
	}
	if ((metadata.pages ?? 1) > 1) {
		throw new Error(
			"Use a single still image, not an animation or multipage file.",
		);
	}
	const { width: sourceWidth, height: sourceHeight } = metadata.autoOrient;
	// Keep standard exports aligned when a master is just one pixel short.
	const useFullSize = sourceWidth >= 1599 && sourceHeight >= 899;
	const width = useFullSize
		? 1600
		: Math.floor(Math.min(1600, sourceWidth, (sourceHeight * 16) / 9) / 16) *
			16;
	const height = (width * 9) / 16;
	if (width < 640) {
		throw new Error(
			"The source must contain at least a 640x360 crop. Prefer 1600x900 or larger.",
		);
	}
	const warnings = [];
	if (width < 1600) {
		warnings.push(
			`The native 16:9 crop is ${width}x${height}; larger variants were omitted to avoid upscaling.`,
		);
	}
	if (width < 1200) {
		warnings.push(
			"The social image is below 1200 pixels wide. Use a larger master for large search previews.",
		);
	}
	const sourceHash = hash(source);
	const outputDirectory = resolve(
		output ??
			join(projectRoot, ".outputs/perek-images", sourceHash.slice(0, 16)),
	);
	const manifestPath = join(outputDirectory, "manifest.json");
	const sourcePath = resolve(input);
	const pathsMatch = (left, right) =>
		process.platform === "win32"
			? left.toLowerCase() === right.toLowerCase()
			: left === right;
	if (pathsMatch(manifestPath, sourcePath)) {
		throw new Error("The output manifest must not overwrite the source image.");
	}
	const keyPrefix = `perakim/${perek === undefined ? "" : `${perek}/`}${sourceHash.slice(0, 16)}`;
	// Orient and crop once, then use identical pixels for every delivery format.
	const master = await sharp(source, { limitInputPixels: 40_000_000 })
		.autoOrient()
		.toColourspace("srgb")
		.flatten({ background: "#ffffff" })
		.resize(width, height, {
			fit: "cover",
			position,
			withoutEnlargement: !useFullSize,
		})
		.png()
		.toBuffer();
	const avifWidths = [
		...new Set([640, 960, 1280, width].filter((size) => size <= width)),
	].sort((a, b) => a - b);
	const specs = [
		...avifWidths.map((size) => ({
			role: "display",
			format: "avif",
			width: size,
			quality: 55,
		})),
		{ role: "display", format: "webp", width, quality: 82 },
		{ role: "social", format: "jpeg", width, quality: 85 },
	];
	const assets = [];
	for (const spec of specs) {
		const pipeline = sharp(master).resize(spec.width, (spec.width * 9) / 16);
		if (spec.format === "avif")
			pipeline.avif({
				quality: spec.quality,
				effort: 6,
				chromaSubsampling: "4:2:0",
			});
		if (spec.format === "webp")
			pipeline.webp({ quality: spec.quality, effort: 6 });
		if (spec.format === "jpeg")
			pipeline.jpeg({ quality: spec.quality, mozjpeg: true });
		const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
		const digest = hash(data);
		const extension = spec.format === "jpeg" ? "jpg" : spec.format;
		const file = `${spec.role}-${info.width}-${digest.slice(0, 16)}.${extension}`;
		if (pathsMatch(resolve(outputDirectory, file), sourcePath)) {
			throw new Error("The output must not overwrite the source image.");
		}
		assets.push({
			data,
			variant: {
				...spec,
				width: info.width,
				height: info.height,
				bytes: data.length,
				s3_key: `${keyPrefix}/${file}`,
				file,
				content_type: `image/${spec.format}`,
				cache_control: cacheControl,
				sha256: digest,
			},
		});
	}
	const manifest = {
		schema_version: 1,
		perek_id: perek ?? null,
		source: { sha256: sourceHash, width: sourceWidth, height: sourceHeight },
		master: { width, height, colourspace: "srgb", crop_position: position },
		warnings,
		variants: assets.map(({ variant }) => variant),
	};
	await mkdir(outputDirectory, { recursive: true });
	for (const { data, variant } of assets)
		await writeFile(join(outputDirectory, variant.file), data);
	await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
	return { outputDirectory, manifest };
}

const usage = `Usage: npm run images:prepare -- <master.png> [--perek 1] [--output <directory>] [--position centre]

One image is enough. Prefer a 1600x900 or larger PNG; other aspect ratios are cropped.
Creates responsive AVIF, WebP fallback, social JPEG, and manifest.json locally.
Masters one pixel short are aligned to 1600x900; smaller sources are not upscaled.
No AWS or database credentials are needed.`;

async function main() {
	const { values, positionals } = parseArgs({
		allowPositionals: true,
		options: {
			perek: { type: "string" },
			output: { type: "string" },
			position: { type: "string" },
			help: { type: "boolean", short: "h" },
		},
	});
	if (values.help) return console.log(usage);
	if (positionals.length !== 1) throw new Error(usage);
	const { outputDirectory, manifest } = await prepareImage({
		input: positionals[0],
		output: values.output,
		perek: values.perek === undefined ? undefined : Number(values.perek),
		position: values.position,
	});
	for (const warning of manifest.warnings) console.warn(warning);
	console.table(
		manifest.variants.map(({ role, format, width, height, bytes }) => ({
			role,
			format,
			dimensions: `${width}x${height}`,
			KB: Math.round(bytes / 1000),
		})),
	);
	console.log(`Assets and manifest: ${outputDirectory}`);
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
	main().catch((error) => {
		console.error(error.message);
		process.exitCode = 1;
	});
}
