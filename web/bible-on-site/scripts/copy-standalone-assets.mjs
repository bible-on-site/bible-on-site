import { cpSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { standaloneAppDir } from "./standalone-app-dir.mjs";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// turbopack.root spans `web/` so `src` can import the shared contract
// modules (#3710); the traced app nests under `standalone/<package-dir>/`.
const appDir = standaloneAppDir(root);

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
