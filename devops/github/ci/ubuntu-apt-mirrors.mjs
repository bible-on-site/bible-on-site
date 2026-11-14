import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MIRROR_LIST = "/etc/apt/apt-mirrors.txt";
const managedArchive =
	/^https?:\/\/(?:azure\.archive\.ubuntu\.com|mirrors\.kernel\.org)\/ubuntu\/?$/;
const candidates = [
	"https://archive.ubuntu.com/ubuntu/",
	"https://mirrors.kernel.org/ubuntu/",
];
const address = (line) => line.trimStart().split(/\s+/)[0];
const managedPrimary = (line) =>
	managedArchive.test(address(line)) &&
	line.trim().split(/\s+/).slice(1).includes("priority:1");

/** Preserve signed APT sources and fallback priorities; replace only our primary. */
export function preferUbuntuArchive(contents, mirror) {
	return contents
		.split(/(?<=\n)/)
		.map((line) => {
			const uri = address(line);
			return managedPrimary(line) ? line.replace(uri, mirror) : line;
		})
		.join("");
}

/** Probe every suite once in parallel before committing a primary mirror. */
export async function selectUbuntuArchive(codename, fetchMetadata = fetch) {
	if (typeof codename !== "string" || !/^[a-z][a-z0-9]*$/.test(codename)) {
		throw new Error("Cannot determine the runner's Ubuntu codename");
	}
	const signal = AbortSignal.timeout(5_000);
	const healthy = await Promise.all(
		candidates.map(async (mirror) => {
			const suites = [
				codename,
				`${codename}-updates`,
				`${codename}-backports`,
				`${codename}-security`,
			];
			const results = await Promise.allSettled(
				suites.map(async (suite) => {
					const response = await fetchMetadata(
						`${mirror}dists/${suite}/InRelease`,
						{ signal },
					);
					const metadata = await response.text();
					if (
						!response.ok ||
						!metadata.startsWith("-----BEGIN PGP SIGNED MESSAGE-----")
					) {
						throw new Error("Mirror did not return signed release metadata");
					}
				}),
			);
			return results.every((result) => result.status === "fulfilled")
				? mirror
				: null;
		}),
	);
	const mirror = healthy.find(Boolean);
	if (!mirror) {
		throw new Error(
			"No Ubuntu primary mirror served all signed release metadata within five seconds",
		);
	}
	return mirror;
}

export async function configureUbuntuAptMirrors(
	file = MIRROR_LIST,
	options = {},
) {
	let contents;
	try {
		contents = await readFile(file, "utf8");
	} catch (error) {
		if (error.code !== "ENOENT") {
			console.error("Failed to read runner APT mirror list");
			throw error;
		}
		console.warn(
			"Runner APT mirror list is absent; keeping existing package sources",
		);
		return false;
	}
	if (!contents.split(/\r?\n/).some(managedPrimary)) return false;
	const osRelease = options.codename
		? null
		: await readFile("/etc/os-release", "utf8");
	const codename =
		options.codename ??
		osRelease.match(/^VERSION_CODENAME=["']?([a-z0-9]+)["']?$/m)?.[1];
	const mirror = await selectUbuntuArchive(codename, options.fetchMetadata);
	const next = preferUbuntuArchive(contents, mirror);
	if (next === contents) return false;
	await writeFile(file, next);
	console.log(`Runner APT primary verified: ${mirror}`);
	return true;
}

if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	await configureUbuntuAptMirrors(process.argv[2]);
}
