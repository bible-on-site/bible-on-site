import { cpSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const standalone = path.join(root, ".next", "standalone");

for (const relative of ["public", ".next/static", "node_modules/@img"]) {
	cpSync(path.join(root, relative), path.join(standalone, relative), {
		recursive: true,
	});
}
