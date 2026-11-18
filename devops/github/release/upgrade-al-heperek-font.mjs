import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ghApi, withApiRetries } from "./gh-api.mjs";

const repository = "bible-on-site/al-heperek-font";
const sourceRepository = `https://github.com/${repository}`;
const root = fileURLToPath(new URL("../../../", import.meta.url));
const fontManifest = join(root, "docs/branding/font-manifest.json");
const logoManifest = join(root, "docs/branding/logo-manifest.json");
const canonicalLogos = "web/bible-on-site/source-assets/logos";
const stableTag = /^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;
const sha256Pattern = /^[a-f0-9]{64}$/;
const commitSha = /^[a-f0-9]{40}$/;
const weights = { Regular: 400, SemiBold: 600, Bold: 700 };
const fontDestinations = {
	ttf: [
		"app/BibleOnSite/Resources/Fonts",
		"web/bible-on-site/src/lib/download/fonts",
		"web/bulletin/fonts",
	],
	woff2: ["web/bible-on-site/public/fonts", "web/admin/public/fonts"],
};

const archiveName = (tag) => `AlHeperekFont-${tag}.zip`;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
const writeJson = (file, data) =>
	writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);

function download(directory) {
	const release = ghApi(`repos/${repository}/releases/latest`);
	const tag = release.tag_name;
	const installed = readJson(fontManifest).tag;
	if (
		!stableTag.test(tag) ||
		!stableTag.test(installed) ||
		release.draft ||
		release.prerelease
	) {
		throw new Error("Expected stable release tags (vMAJOR.MINOR.PATCH)");
	}
	if (tag.localeCompare(installed, "en", { numeric: true }) <= 0) {
		console.log(`Al Heperek Font ${installed} is current (upstream ${tag}).`);
		return;
	}
	const name = archiveName(tag);
	const digest = release.assets.find((asset) => asset.name === name)?.digest;
	const hash = digest?.replace(/^sha256:/, "");
	if (!digest?.startsWith("sha256:") || !sha256Pattern.test(hash)) {
		throw new Error(`Missing GitHub SHA-256 digest for ${name}`);
	}
	const revision = ghApi(`repos/${repository}/commits/tags/${tag}`).sha;
	if (!commitSha.test(revision))
		throw new Error(`Missing source commit for ${tag}`);
	withApiRetries(() =>
		execFileSync("gh", [
			"release",
			"download",
			tag,
			"--repo",
			repository,
			"--pattern",
			name,
			"--dir",
			directory,
			"--clobber",
		]),
	);
	appendFileSync(
		process.env.GITHUB_OUTPUT,
		`tag=${tag}\nsha256=${hash}\nrevision=${revision}\n`,
	);
}

function importRelease(directory, tag, hash, revision) {
	if (
		!stableTag.test(tag) ||
		!sha256Pattern.test(hash) ||
		!commitSha.test(revision)
	) {
		throw new Error(
			"Expected a stable tag, an archive SHA-256 and a source commit SHA",
		);
	}
	const file = archiveName(tag);
	const archive = join(directory, file);
	if (sha256(readFileSync(archive)) !== hash) {
		throw new Error(`Release archive SHA-256 mismatch: ${file}`);
	}
	// Read only expected archive members. ZIP paths are never used as destinations.
	const read = (name) => execFileSync("unzip", ["-p", archive, name]);
	const manifest = JSON.parse(read("manifest.json"));
	const installedFont = readJson(fontManifest);
	const installedLogos = readJson(logoManifest);
	const version = tag.slice(1);
	if (
		manifest.tag !== tag ||
		manifest.version !== version ||
		manifest.sourceRepository !== repository ||
		manifest.family !== installedFont.family ||
		manifest.defaultHebrewCut !== installedFont.defaultHebrewCut ||
		manifest.cantillation !== false ||
		!manifest.choices ||
		typeof manifest.finalTsadiFrom !== "string"
	) {
		throw new Error(
			"Release manifest does not match the expected font contract",
		);
	}

	const writes = [];
	function copy(name, destinations, weight) {
		const entries = manifest.files.filter((entry) => entry.file === name);
		const [entry] = entries;
		if (
			entries.length !== 1 ||
			!sha256Pattern.test(entry.sha256) ||
			(weight && entry.weight !== weight)
		) {
			throw new Error(`Missing or invalid release manifest entry: ${name}`);
		}
		const bytes = read(name);
		if (sha256(bytes) !== entry.sha256)
			throw new Error(`SHA-256 mismatch: ${name}`);
		for (const destination of destinations) writes.push([destination, bytes]);
		return { bytes, sha256: entry.sha256 };
	}

	const files = [];
	for (const [style, weight] of Object.entries(weights)) {
		for (const [format, directories] of Object.entries(fontDestinations)) {
			const name = `AlHeperekUI-${style}.${format}`;
			const { sha256 } = copy(
				`fonts/${format}/${name}`,
				directories.map((path) => `${path}/${name}`),
				weight,
			);
			files.push({ file: name, weight, sha256 });
		}
	}
	const licenseCopies = Object.values(fontDestinations)
		.flat()
		.map((path) => `${path}/AlHeperek-license.txt`);
	licenseCopies.push("web/bible-on-site/public/font-license.txt");
	copy("LICENSE.txt", licenseCopies);

	let logoFontHash;
	const canonicalAssets = installedLogos.canonicalAssets.map(({ file }) => {
		const name = basename(file);
		const { bytes, sha256 } = copy(`logos/${name}`, [
			`${canonicalLogos}/${name}`,
		]);
		const metadata = JSON.parse(
			/<metadata>(.*?)<\/metadata>/s.exec(bytes.toString())?.[1] ?? "null",
		);
		if (
			metadata?.fontVersion !== version ||
			metadata.sourceRepository !== sourceRepository ||
			metadata.feature !== installedLogos.feature ||
			metadata.weight !== installedLogos.weight ||
			metadata.generatedBy !== installedLogos.generatedBy ||
			!sha256Pattern.test(metadata.fontSha256) ||
			(logoFontHash && metadata.fontSha256 !== logoFontHash)
		) {
			throw new Error(`Inconsistent logo provenance: ${name}`);
		}
		logoFontHash = metadata.fontSha256;
		return { file: `${canonicalLogos}/${name}`, sha256 };
	});

	const upstreamRelease = `${sourceRepository}/releases/tag/${tag}`;
	for (const [path, bytes] of writes) writeFileSync(join(root, path), bytes);
	writeJson(fontManifest, {
		...installedFont,
		version,
		tag,
		choices: manifest.choices,
		finalTsadiFrom: manifest.finalTsadiFrom,
		sourceRepository,
		upstreamRelease,
		sourceRevision: revision,
		archive: { file, sha256: hash },
		files,
	});
	writeJson(logoManifest, {
		...installedLogos,
		sourceRepository,
		upstreamRelease,
		fontVersion: version,
		fontSha256: logoFontHash,
		fontSourceCommit: revision,
		canonicalAssets,
	});
	console.log(`Verified and imported Al Heperek Font ${tag}.`);
}

const [command, directory, tag, hash, revision] = process.argv.slice(2);
if (command === "download" && directory) download(directory);
else if (command === "import" && directory)
	importRelease(directory, tag, hash, revision);
else
	throw new Error(
		"Usage: upgrade-al-heperek-font.mjs download DIR | import DIR TAG SHA256 COMMIT",
	);
