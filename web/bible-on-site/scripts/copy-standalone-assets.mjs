import { cpSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const standalone = path.join(root, ".next", "standalone");

for (const relative of ["public", ".next/static"]) {
	cpSync(path.join(root, relative), path.join(standalone, relative), {
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
	path.join(standalone, "node_modules", "@img"),
	{ recursive: true },
);
