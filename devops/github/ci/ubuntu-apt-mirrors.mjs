import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MIRROR_LIST = "/etc/apt/apt-mirrors.txt";
const azureArchive = /^https?:\/\/azure\.archive\.ubuntu\.com\/ubuntu\/?$/;
const mirror = "https://mirrors.kernel.org/ubuntu/";
const address = (line) => line.trimStart().split(/\s+/)[0];

/** Keep the runner's primary Ubuntu mirror independent of ubuntu.com DNS. */
export function preferUbuntuArchive(contents) {
	return contents
		.split(/(?<=\n)/)
		.map((line) => {
			const uri = address(line);
			return azureArchive.test(uri) ? line.replace(uri, mirror) : line;
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
	console.log("Runner APT now prefers the kernel.org Ubuntu mirror");
	return true;
}

if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	await configureUbuntuAptMirrors(process.argv[2]);
}
