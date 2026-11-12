import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MIRROR_LIST = "/etc/apt/apt-mirrors.txt";
const replacedArchive =
	/^https?:\/\/(?:azure\.archive\.ubuntu\.com|mirrors\.kernel\.org)\/ubuntu\/?$/;
const mirror = "https://archive.ubuntu.com/ubuntu/";
const address = (line) => line.trimStart().split(/\s+/)[0];

/** Prefer the canonical archive over Azure and the unreachable custom mirror. */
export function preferUbuntuArchive(contents) {
	return contents
		.split(/(?<=\n)/)
		.map((line) => {
			const uri = address(line);
			return replacedArchive.test(uri) ? line.replace(uri, mirror) : line;
		})
		.join("");
}

export async function configureUbuntuAptMirrors(file = MIRROR_LIST) {
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
	const next = preferUbuntuArchive(contents);
	if (next === contents) return false;
	await writeFile(file, next);
	console.log("Runner APT now prefers the canonical Ubuntu archive");
	return true;
}

if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	await configureUbuntuAptMirrors(process.argv[2]);
}
