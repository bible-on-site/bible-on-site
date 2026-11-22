import { cpSync, existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const standalone = path.join(root, ".next", "standalone");

// turbopack.root spans `web/` so `src` can import the shared contract
// modules (#3710); the traced app therefore nests under
// `standalone/<package-dir>/` rather than the standalone root. Locate it
// by its entry point instead of hardcoding the directory name.
const appDir = [
	standalone,
	...readdirSync(standalone, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => path.join(standalone, entry.name)),
].find((dir) => existsSync(path.join(dir, "server.js")));
if (!appDir) {
	throw new Error(`no traced app dir with server.js under ${standalone}`);
}

for (const relative of ["public", ".next/static"]) {
	cpSync(path.join(root, relative), path.join(appDir, relative), {
		recursive: true,
	});
}

// sharp's native @img/* binaries sit beside the resolved sharp package —
// top-level node_modules under npm and bun's hoisted linker alike.
const sharpDir = path.dirname(
	path.dirname(require.resolve("sharp", { paths: [root] })),
);
cpSync(
	path.resolve(sharpDir, "..", "@img"),
	path.join(appDir, "node_modules", "@img"),
	{ recursive: true },
);
