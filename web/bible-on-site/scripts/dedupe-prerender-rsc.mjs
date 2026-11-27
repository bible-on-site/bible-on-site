import {
	existsSync,
	linkSync,
	lstatSync,
	readFileSync,
	readdirSync,
	rmSync,
	symlinkSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { standaloneAppDir } from "./standalone-app-dir.mjs";

function sameBytes(leftPath, rightPath) {
	const left = readFileSync(leftPath);
	const right = readFileSync(rightPath);
	return left.length === right.length && left.equals(right);
}

function replaceWithLink(sourcePath, duplicatePath) {
	rmSync(duplicatePath);
	if (process.platform === "win32") {
		linkSync(sourcePath, duplicatePath);
		return;
	}
	symlinkSync(`../${path.basename(sourcePath)}`, duplicatePath);
}

export function dedupePrerenderRsc(serverAppDir) {
	const result = { checked: 0, deduped: 0, alreadyLinked: 0, bytes: 0 };
	const pending = [serverAppDir];

	while (pending.length > 0) {
		const dir = pending.pop();
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const entryPath = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				pending.push(entryPath);
				continue;
			}
			if (
				!entry.isFile() ||
				!entry.name.endsWith(".rsc") ||
				entry.name.endsWith(".segment.rsc")
			) {
				continue;
			}

			const fullSegmentPath = `${entryPath.slice(0, -".rsc".length)}.segments/_full.segment.rsc`;
			if (!existsSync(fullSegmentPath)) {
				continue;
			}
			result.checked += 1;
			const fullSegmentStat = lstatSync(fullSegmentPath);
			if (
				fullSegmentStat.isSymbolicLink() ||
				(process.platform === "win32" && !fullSegmentStat.isFile())
			) {
				result.alreadyLinked += 1;
				continue;
			}
			if (!sameBytes(entryPath, fullSegmentPath)) {
				continue;
			}
			result.bytes += fullSegmentStat.size;
			replaceWithLink(entryPath, fullSegmentPath);
			result.deduped += 1;
		}
	}
	return result;
}

export function dedupeBuildOutputs(packageRoot) {
	const roots = [path.join(packageRoot, ".next", "server", "app")];
	const appDir = standaloneAppDir(packageRoot);
	roots.push(path.join(appDir, ".next", "server", "app"));
	return roots
		.filter((root) => existsSync(root))
		.map((root) => ({ root, ...dedupePrerenderRsc(root) }));
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
	const packageRoot = path.resolve(
		path.dirname(fileURLToPath(import.meta.url)),
		"..",
	);
	for (const result of dedupeBuildOutputs(packageRoot)) {
		console.log(
			`dedupe-prerender-rsc: ${result.deduped}/${result.checked} duplicates linked in ${result.root}; saved ${result.bytes} bytes`,
		);
	}
}
