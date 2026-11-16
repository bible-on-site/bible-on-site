import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const website = fileURLToPath(new URL("..", import.meta.url));
const repository = resolve(website, "../..");
const logos = resolve(website, "source-assets/logos");
const output = resolve(website, "public/images/logos");
const read = (file) => readFile(resolve(logos, file));
const header = await read("header-logo.svg");
const reversed = await readFile(resolve(output, "header-logo-reversed.svg"));
// The operating system applies the launcher mask. An opaque square also
// satisfies the iOS app-icon alpha requirement.
const appIcon = (await read("app-icon.svg"))
	.toString()
	.replace('rx="208"', 'rx="0"');
// Android adaptive launchers magnify the foreground before applying their mask.
// Separate transparent artwork from the full-bleed tile so the safe-zone scale
// never introduces an inner square or crops the lettering and book.
const artStart = appIcon.indexOf('<g transform="translate(512 512)');
const defsStart = appIcon.indexOf("<defs>");
if (artStart < 0 || defsStart < 0)
	throw new Error("Unexpected brand icon structure");
for (const [name, svg] of [
	["appicon.svg", appIcon.slice(0, artStart).concat("</svg>\n")],
	["appiconfg.svg", appIcon.slice(0, defsStart) + appIcon.slice(artStart)],
	["appicon_full.svg", appIcon],
]) {
	await writeFile(
		resolve(repository, "app/BibleOnSite/Resources/AppIcon", name),
		svg,
	);
}
await sharp(Buffer.from(appIcon))
	.resize(192, 192)
	.webp({ lossless: true })
	.toFile(resolve(output, "logo192.webp"));
await sharp(Buffer.from(appIcon))
	.resize(180, 180)
	.png()
	.toFile(resolve(website, "public/apple-touch-icon.png"));
await sharp(reversed)
	.resize({ width: 360 })
	.webp({ lossless: true })
	.toFile(resolve(output, "logo-white-letters-69.webp"));
const jpeg = await sharp(header)
	.resize({ width: 1040 })
	.flatten({ background: "white" })
	.jpeg({ quality: 95 })
	.toBuffer();
for (const path of [
	"app/BibleOnSite/Resources/Images/logo_header.jpg",
	"web/bible-on-site/src/lib/download/logo_header.jpg",
	"web/bible-on-site/public/images/logos/header-logo.jpg",
]) {
	await writeFile(resolve(repository, path), jpeg);
}
console.log(
	"Generated the native icon, touch icon, legacy web images and PDF logo.",
);
