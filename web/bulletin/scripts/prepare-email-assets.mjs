import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const bulletinRoot = fileURLToPath(new URL("../", import.meta.url));
const repositoryRoot = resolve(bulletinRoot, "../..");
const outputDirectory = resolve(bulletinRoot, "assets/email");
const keyPrefix = "branding/daily-bulletin";
const cdnOrigin = "https://bible-on-site-assets.s3.il-central-1.amazonaws.com";
const args = process.argv.slice(2);
const check = args.includes("--check");
const moduleFlag = args.indexOf("--sharp-module");
const modulePath = moduleFlag < 0 ? undefined : args[moduleFlag + 1];
const acceptedArguments =
	moduleFlag < 0
		? args
		: args.filter(
				(_, index) => index !== moduleFlag && index !== moduleFlag + 1,
			);
if (
	(moduleFlag >= 0 && (!modulePath || modulePath.startsWith("--"))) ||
	acceptedArguments.some((arg) => arg !== "--check")
) {
	throw new Error(
		"Usage: prepare-email-assets.mjs [--check] [--sharp-module PATH]",
	);
}

async function loadSharp() {
	const candidates = modulePath
		? [modulePath]
		: [
				process.env.BULLETIN_SHARP_MODULE,
				resolve(
					homedir(),
					".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp",
				),
				resolve(repositoryRoot, "web/bible-on-site/node_modules/sharp"),
			];
	for (const candidate of candidates) {
		if (!candidate) continue;
		try {
			const directory = await realpath(resolve(candidate));
			if (!(await stat(directory)).isDirectory()) continue;
			const packageFile = resolve(directory, "package.json");
			const metadata = JSON.parse(await readFile(packageFile, "utf8"));
			if (metadata.name !== "sharp") continue;
			const require = createRequire(packageFile);
			const entrypoint = await realpath(require.resolve("sharp"));
			const entryRelative = relative(directory, entrypoint);
			if (
				isAbsolute(entryRelative) ||
				entryRelative === ".." ||
				entryRelative.startsWith(`..${sep}`)
			)
				continue;
			return require("sharp");
		} catch {
			// Try the next existing developer-tool installation; never install a dependency.
		}
	}
	throw new Error(
		"Sharp is unavailable. Pass an existing installation with --sharp-module PATH.",
	);
}

function sha256(bytes) {
	return createHash("sha256").update(bytes).digest("hex");
}

const sharp = await loadSharp();
const outputs = [];
const assets = [];

async function addAsset(id, sourcePath, extension, render, attribution) {
	const source = await readFile(resolve(repositoryRoot, sourcePath));
	const bytes = await render(source);
	const metadata = await sharp(bytes).metadata();
	const hash = sha256(bytes);
	const file = `${id}-${hash.slice(0, 12)}.${extension}`;
	const s3Key = `${keyPrefix}/${file}`;
	assets.push({
		id,
		sourcePath,
		sourceSha256: sha256(source),
		sha256: hash,
		file,
		s3Key,
		url: `${cdnOrigin}/${s3Key}`,
		contentType: extension === "jpg" ? "image/jpeg" : "image/png",
		width: metadata.width,
		height: metadata.height,
		bytes: bytes.length,
		attribution,
	});
	outputs.push({ file, bytes });
}

await addAsset(
	"logo-header",
	"app/BibleOnSite/Resources/Images/logo_header.jpg",
	"jpg",
	async (source) => {
		if (
			sha256(source) !==
			"bfaa157e34c287706db40a446baee13c793fd223fa8758911403f0a5d4f4e4e7"
		) {
			throw new Error(
				"The selected original logo changed. Review the source before updating this asset.",
			);
		}
		return source;
	},
	"Existing Bible On Site native-app and PDF-header brand artwork; copied without alteration.",
);

const sources = {
	envelope: "https://www.svgrepo.com/svg/502645/envelope",
	phone: "https://www.svgrepo.com/svg/525375/phone-calling",
	whatsapp: "https://www.svgrepo.com/svg/450391/whatsapp",
	telegram:
		"Font Awesome Free 6.7.2 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2025 Fonticons, Inc.",
	globe: "Project-authored globe icon for the Bible On Site email footer.",
};
for (const [id, attribution] of Object.entries(sources)) {
	await addAsset(
		id,
		id === "globe"
			? "web/bulletin/assets/email/source/globe.svg"
			: `web/bible-on-site/public/icons/${id}.svg`,
		"png",
		(source) =>
			sharp(source, { density: 72 })
				.resize(36, 36, {
					fit: "contain",
					background: { r: 0, g: 0, b: 0, alpha: 0 },
				})
				.ensureAlpha()
				.png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
				.toBuffer(),
		attribution,
	);
}

const manifest = {
	schemaVersion: 1,
	generatedBy: "web/bulletin/scripts/prepare-email-assets.mjs",
	renderer: {
		sharp: sharp.versions.sharp,
		vips: sharp.versions.vips,
		rsvg: sharp.versions.rsvg,
	},
	assets,
};
outputs.push({
	file: "manifest.json",
	bytes: Buffer.from(`${JSON.stringify(manifest, null, "\t")}\n`),
});

if (check) {
	for (const { file, bytes } of outputs) {
		const current = await readFile(resolve(outputDirectory, file));
		if (!current.equals(bytes))
			throw new Error(`Email asset differs from its source: ${file}`);
	}
	console.log(`Verified ${assets.length} email assets and their manifest.`);
} else {
	await mkdir(outputDirectory, { recursive: true });
	for (const { file, bytes } of outputs) {
		await writeFile(resolve(outputDirectory, file), bytes);
	}
	console.log(
		`Prepared ${assets.length} email assets and their manifest. No assets were uploaded.`,
	);
}
