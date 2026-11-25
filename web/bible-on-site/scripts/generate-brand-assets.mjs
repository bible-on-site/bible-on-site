import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--check")) {
	throw new Error("Usage: generate-brand-assets.mjs [--check]");
}
const check = args.includes("--check");
const website = fileURLToPath(new URL("..", import.meta.url));
const repository = resolve(website, "../..");
const branding = resolve(repository, "web/shared/branding");
const logos = resolve(branding, "logos");
// One canonical derived set staged by every consumer (#3708). The website
// copies these into public/ at build time, admin copies its subset through
// vite.config.ts, the native project references them directly and the
// bulletin embeds the header JPEG — so generated copies must never drift.
const derived = resolve(branding, "derived");
const read = (file) => readFile(resolve(logos, file));
const outputs = [];
const add = (path, bytes) => outputs.push({ path, bytes: Buffer.from(bytes) });
const header = await read("header-logo.svg");
const reversed = await read("header-logo-reversed.svg");

add(resolve(derived, "splash.svg"), reversed);

const sourceIcon = (await read("app-icon.svg")).toString();
// The canonical artwork group is shared by the composite and the transparent
// Android foreground. Definitions remain available to either layer.
const artwork =
	/<g\b[^>]*\btransform="translate\(512[ ,]+512\)[^"]*"[^>]*>/.exec(sourceIcon);
const root = /<svg\b[^>]*>/.exec(sourceIcon);
if (!artwork || !root || artwork.index <= root.index) {
	throw new Error("Expected the canonical centered brand artwork group");
}
const prefix = sourceIcon.slice(0, artwork.index);
const tiles = prefix.match(/<rect\b[^>]*>/g);
if (
	tiles?.length !== 1 ||
	!/\bwidth="1024"/.test(tiles[0]) ||
	!/\bheight="1024"/.test(tiles[0])
) {
	throw new Error("Expected one full-size background tile before the artwork");
}
// Native launchers apply their own mask. Keep the background full bleed and
// avoid placing a smaller framed tile inside the scaled Android foreground.
const squareTile = tiles[0]
	.replace(/\brx="[^"]*"/, 'rx="0"')
	.replace(/\bry="[^"]*"/, 'ry="0"');
const squarePrefix = prefix.replace(tiles[0], squareTile);
const artworkAndClose = sourceIcon.slice(artwork.index);
const appIcon = squarePrefix + artworkAndClose;
const definitions = prefix.match(/<defs\b[^>]*>[\s\S]*?<\/defs>/)?.[0] ?? "";
const metadata =
	prefix.match(/<metadata\b[^>]*>[\s\S]*?<\/metadata>/)?.[0] ?? "";
const foreground =
	sourceIcon.slice(0, root.index + root[0].length) +
	metadata +
	definitions +
	artworkAndClose;
const background = Buffer.concat([
	Buffer.from(squarePrefix),
	Buffer.from("</svg>\n"),
]);
for (const [name, svg] of [
	["appicon.svg", background],
	["appiconfg.svg", foreground],
	["appicon_full.svg", appIcon],
]) {
	add(resolve(derived, name), svg);
}

add(
	resolve(derived, "logo192.webp"),
	await sharp(Buffer.from(appIcon))
		.resize(192, 192)
		.webp({ lossless: true })
		.toBuffer(),
);
add(
	resolve(derived, "apple-touch-icon.png"),
	await sharp(Buffer.from(appIcon)).resize(180, 180).png().toBuffer(),
);
add(
	resolve(derived, "logo-white-letters-69.webp"),
	await sharp(reversed)
		.resize({ width: 360 })
		.webp({ lossless: true })
		.toBuffer(),
);
add(
	resolve(derived, "logo_header.jpg"),
	await sharp(header)
		.resize({ width: 1040 })
		.flatten({ background: "white" })
		.jpeg({ quality: 95 })
		.toBuffer(),
);

const faviconSizes = [16, 24, 32, 48];
const faviconImages = [];
for (const size of faviconSizes) {
	const png = await sharp(await read(`favicon-${size}.svg`))
		.resize(size, size)
		.png()
		.toBuffer();
	add(resolve(derived, `favicon-${size}.png`), png);
	faviconImages.push(png);
}
// ICO supports PNG image payloads. Package the exact individually fitted
// raster images rather than resampling the largest icon into smaller slots.
const directory = Buffer.alloc(6 + 16 * faviconSizes.length);
directory.writeUInt16LE(1, 2);
directory.writeUInt16LE(faviconSizes.length, 4);
let imageOffset = directory.length;
for (const [index, size] of faviconSizes.entries()) {
	const entry = 6 + index * 16;
	directory.writeUInt8(size, entry);
	directory.writeUInt8(size, entry + 1);
	directory.writeUInt16LE(1, entry + 4);
	directory.writeUInt16LE(32, entry + 6);
	directory.writeUInt32LE(faviconImages[index].length, entry + 8);
	directory.writeUInt32LE(imageOffset, entry + 12);
	imageOffset += faviconImages[index].length;
}
const favicon = Buffer.concat([directory, ...faviconImages]);
add(resolve(derived, "favicon.ico"), favicon);

for (const { path, bytes } of outputs) {
	if (check) {
		const existing = await readFile(path);
		if (!existing.equals(bytes)) {
			throw new Error(`Brand asset differs from its canonical source: ${path}`);
		}
	} else {
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, bytes);
	}
}
console.log(
	`${check ? "Verified" : "Generated"} ${outputs.length} shared brand assets, including all favicon resolutions and native layers.`,
);
