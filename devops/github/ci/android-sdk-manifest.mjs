// Android SDK cache-key resolver for app-mobile-e2e.yml. The emulator runner
// action always asks sdkmanager for the newest stable emulator and system
// image, so a cache only avoids the ~2.3 GB download when its key tracks the
// versions Google's manifests currently serve. This script resolves those
// revisions and archive checksums into explicit key fragments; when the
// manifests cannot be resolved it emits `unresolved`, which never matches a
// saved cache and is never saved back (the save steps gate on `resolved`).
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPOSITORY_URL =
	"https://dl.google.com/android/repository/repository2-3.xml";
const sysImgUrl = (target) =>
	`https://dl.google.com/android/repository/sys-img/${target}/sys-img2-3.xml`;
const FETCH_TIMEOUT_MS = 20000;

export function parseRemotePackages(xml) {
	const packages = [];
	for (const match of xml.matchAll(
		/<remotePackage path="([^"]+)">([\s\S]*?)<\/remotePackage>/g,
	)) {
		const [, path, body] = match;
		const channel = body.match(/<channelRef ref="([^"]+)"\/>/)?.[1];
		// Only the package's own <revision> counts: <dependencies> can nest a
		// <min-revision> whose parts would otherwise leak into the version.
		const revisionBody =
			body.match(/<revision>([\s\S]*?)<\/revision>/)?.[1] ?? "";
		const revision = {};
		for (const match of revisionBody.matchAll(/<(\w+)>([^<]*)<\/\1>/g)) {
			if (["major", "minor", "micro", "preview"].includes(match[1])) {
				revision[match[1]] = match[2];
			}
		}
		const archives = [];
		for (const archiveMatch of body.matchAll(
			/<archive>([\s\S]*?)<\/archive>/g,
		)) {
			const complete = archiveMatch[1].match(
				/<complete>([\s\S]*?)<\/complete>/,
			)?.[1];
			if (!complete) continue;
			archives.push({
				url: complete.match(/<url>([^<]+)<\/url>/)?.[1],
				checksum: complete.match(
					/<checksum type="[^"]*">([0-9a-fA-F]+)<\/checksum>/,
				)?.[1],
				size: Number(complete.match(/<size>(\d+)<\/size>/)?.[1]),
				hostOs: archiveMatch[1].match(/<host-os>([^<]+)<\/host-os>/)?.[1],
				hostArch: archiveMatch[1].match(
					/<host-arch>([^<]+)<\/host-arch>/,
				)?.[1],
			});
		}
		packages.push({ path, channel, revision, archives });
	}
	return packages;
}

export function revisionString(revision) {
	return [revision.major, revision.minor, revision.micro]
		.filter((part) => part !== undefined)
		.join(".");
}

export function selectPackage(packages, path, channel) {
	const found = packages.find(
		(pkg) => pkg.path === path && pkg.channel === channel,
	);
	if (!found) {
		throw new Error(
			`No ${channel} package "${path}" in the Android SDK manifest.`,
		);
	}
	return found;
}

export function pickArchive(pkg, hostOs) {
	const archive = pkg.archives.find(
		(candidate) =>
			(hostOs === undefined || candidate.hostOs === hostOs) &&
			candidate.url !== undefined &&
			candidate.checksum !== undefined,
	);
	if (!archive) {
		throw new Error(
			`No downloadable ${hostOs ?? "generic"} archive for "${pkg.path}".`,
		);
	}
	return archive;
}

// Short, stable identity for a package: revision plus the archive checksum's
// first eight hex digits, so content updates invalidate keys too.
const fragment = (pkg, archive, prefix) =>
	`${prefix}${revisionString(pkg.revision)}-${archive.checksum.slice(0, 8)}`;

// The emulator binary version alone does not identify the snapshot payload:
// the zip's build id does. `emulator-linux_x64-16428233.zip` → `16428233`.
const buildId = (archive) =>
	archive.url.match(/-(\d+)\.zip$/)?.[1] ?? archive.checksum.slice(0, 8);

export function resolveCacheCoordinates({
	repositoryXml,
	sysImgXml,
	apiLevel,
	target,
	abi,
	buildTools,
	channel = "channel-0",
	hostOs = "linux",
}) {
	const repository = parseRemotePackages(repositoryXml);
	const sysImg = parseRemotePackages(sysImgXml);
	const emulator = selectPackage(repository, "emulator", channel);
	const emulatorArchive = pickArchive(emulator, hostOs);
	const systemImage = selectPackage(
		sysImg,
		`system-images;android-${apiLevel};${target};${abi}`,
		channel,
	);
	const systemImageArchive = pickArchive(systemImage);
	const platform = selectPackage(
		repository,
		`platforms;android-${apiLevel}`,
		channel,
	);
	const platformArchive = pickArchive(platform);
	const tools = selectPackage(repository, `build-tools;${buildTools}`, channel);
	const toolsArchive = pickArchive(tools, hostOs);
	const platformTools = selectPackage(repository, "platform-tools", channel);
	const platformToolsArchive = pickArchive(platformTools, hostOs);
	return {
		emulatorKey: `${revisionString(emulator.revision)}-${buildId(emulatorArchive)}-${emulatorArchive.checksum.slice(0, 8)}`,
		sdkKey: [
			fragment(emulator, emulatorArchive, "emu"),
			fragment(systemImage, systemImageArchive, `img${apiLevel}r`),
			fragment(platform, platformArchive, "pl"),
			fragment(tools, toolsArchive, "bt"),
			fragment(platformTools, platformToolsArchive, "pt"),
		].join("-"),
		downloads: {
			emulator: `${emulatorArchive.url} (${(emulatorArchive.size / 1e6).toFixed(0)} MB, sha1 ${emulatorArchive.checksum})`,
			systemImage: `${systemImageArchive.url} (${(systemImageArchive.size / 1e6).toFixed(0)} MB, sha1 ${systemImageArchive.checksum})`,
		},
	};
}

async function fetchText(url) {
	let lastError;
	for (let attempt = 1; attempt <= 2; attempt++) {
		try {
			const response = await fetch(url, {
				signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
			});
			if (!response.ok) {
				throw new Error(`${url} returned ${response.status}`);
			}
			return await response.text();
		} catch (error) {
			lastError = error;
		}
	}
	throw lastError;
}

function output(name, value) {
	appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

if (resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const env = process.env;
	const required = {
		apiLevel: env.ANDROID_API_LEVEL,
		target: env.ANDROID_TARGET,
		abi: env.ANDROID_ABI,
		buildTools: env.ANDROID_BUILD_TOOLS,
	};
	output("sdk-home", env.ANDROID_HOME ?? "");
	output("avd-home", `${env.HOME}/.android/avd`);
	// ImageOS (e.g. ubuntu24) pins snapshots to a runner OS generation; plain
	// RUNNER_OS is the fallback for runners without it.
	output("os-tag", `${env.RUNNER_OS ?? "unknown"}-${env.ImageOS ?? "generic"}`);
	try {
		const missing = Object.entries(required)
			.filter(([, value]) => !value)
			.map(([name]) => name);
		if (missing.length) {
			throw new Error(`Missing env: ${missing.join(", ")}`);
		}
		const [repositoryXml, sysImgXml] = await Promise.all([
			fetchText(REPOSITORY_URL),
			fetchText(sysImgUrl(required.target)),
		]);
		const coordinates = resolveCacheCoordinates({
			repositoryXml,
			sysImgXml,
			...required,
		});
		output("resolved", "true");
		output("sdk-key", coordinates.sdkKey);
		output("emulator-key", coordinates.emulatorKey);
		console.log(`::group::Resolved Android SDK cache coordinates`);
		console.log(`sdk-key: ${coordinates.sdkKey}`);
		console.log(`emulator-key: ${coordinates.emulatorKey}`);
		for (const [name, detail] of Object.entries(coordinates.downloads)) {
			console.log(`${name}: ${detail}`);
		}
		console.log(`::endgroup::`);
	} catch (error) {
		// An unresolved key never matches a saved cache and is never saved back:
		// the job falls back to the bounded sdkmanager downloads instead.
		output("resolved", "false");
		output("sdk-key", "unresolved");
		output("emulator-key", "unresolved");
		console.log(
			`::warning::Could not resolve Android SDK cache coordinates; downloading normally. ${error}`,
		);
	}
}
