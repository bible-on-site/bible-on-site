import { readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";

// Rasterize the original vector outlines directly; never enlarge the old WebP.
const source = new URL(
	"../source-assets/logos/header-logo.svg",
	import.meta.url,
);
const output = new URL(
	"../public/images/logos/logo-white-letters-69.webp",
	import.meta.url,
);
const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== "--check")) {
	throw new Error("Usage: node scripts/render-header-logo.mjs [--check]");
}

// Intrinsic SVG dimensions fix the rasterization size independently of DPI.
const vector = await readFile(source);
const rendered = await sharp(vector, { density: 72 })
	.webp({ lossless: true, effort: 6 })
	.toBuffer();
const { width, height } = await sharp(rendered).metadata();
if (width !== 276 || height !== 200) {
	throw new Error("Header logo vector must render at exactly 276 x 200 pixels");
}

if (args[0] === "--check") {
	if (!(await readFile(output)).equals(rendered)) {
		throw new Error(
			"Header logo is stale; run node scripts/render-header-logo.mjs",
		);
	}
	console.log("Header logo matches its vector source (276 x 200).");
} else {
	await writeFile(output, rendered);
	console.log(
		`Rendered header logo from vector (276 x 200, ${rendered.length} bytes).`,
	);
}
