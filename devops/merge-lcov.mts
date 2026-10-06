/**
 * Concatenate lcov.info files into a single report.
 *
 * Usage:
 *   node --import tsx merge-lcov.mts --out <file> --prefix <dir> [--require <file>]... [--optional <file>]... [--rm-input-dirs]
 *
 * --require   input must exist; a missing one fails the merge (exit 1)
 * --optional  input is skipped with a warning when missing
 * --prefix    module dir relative to repo root (e.g. web/admin/) — rewrites
 *             bare `SF:src/...` records so Codecov flag paths match
 * --rm-input-dirs  delete the parent directory of every consumed input afterwards
 *
 * Paths are resolved against the caller's working directory.
 */
import { createWriteStream } from "node:fs";
import { existsSync, mkdirSync } from "node:fs";
import { readFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

const argv = await yargs(hideBin(process.argv))
	.option("out", { type: "string", demandOption: true, describe: "merged lcov output path" })
	.option("require", { type: "array", string: true, default: [], describe: "input lcov paths that must exist" })
	.option("optional", { type: "array", string: true, default: [], describe: "input lcov paths included when present" })
	.option("prefix", { type: "string", describe: "repo-root-relative dir prepended to bare SF:src/ records (e.g. web/admin/)" })
	.option("rm-input-dirs", { type: "boolean", default: false, describe: "remove each consumed input's parent directory" })
	.strict()
	.parse();

const outPath = resolve(argv.out);
mkdirSync(dirname(outPath), { recursive: true });

const missing = (argv.require as string[]).filter((p) => !existsSync(resolve(p)));
if (missing.length > 0) {
	console.error(`✗ Required coverage input(s) missing:\n  ${missing.join("\n  ")}`);
	process.exit(1);
}

const inputs = [...(argv.require as string[]), ...(argv.optional as string[])];
const consumedDirs = new Set<string>();
let hasContent = false;

const stream = createWriteStream(outPath);
for (const input of inputs) {
	const inputPath = resolve(input);
	if (!existsSync(inputPath)) {
		console.log(`⚠ Coverage input not found, skipping: ${inputPath}`);
		continue;
	}
	let content = readFileSync(inputPath, "utf8");
	if (argv.prefix) {
		const prefix = argv.prefix as string;
		content = content
			.replace(/^SF:src\//gm, `SF:${prefix}src/`)
			.replace(/^SF:src\\/gm, `SF:${prefix}src/`);
	}
	stream.write(content);
	hasContent = true;
	consumedDirs.add(dirname(inputPath));
	console.log(`✓ Added coverage from ${inputPath}`);
}
stream.end();

if (argv["rm-input-dirs"]) {
	for (const dir of consumedDirs) {
		rmSync(dir, { recursive: true, force: true });
		console.log(`✓ Removed ${dir}`);
	}
}

if (hasContent) {
	console.log(`\n✓ Merged coverage written to ${outPath}`);
} else {
	console.log("\n⚠ No coverage files found to merge");
}
