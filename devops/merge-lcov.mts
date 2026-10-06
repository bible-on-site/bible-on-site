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
import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import { readFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";

// Zero-dependency arg parsing — this script runs from a module's cwd where
// devops/node_modules may not be installed (e.g. the Admin CI job).
const args = process.argv.slice(2);
const flags = new Map<string, string[]>();
for (let i = 0; i < args.length; i++) {
	const raw = args[i];
	if (!raw.startsWith("--")) {
		console.error(`✗ Unexpected argument: ${raw}`);
		process.exit(1);
	}
	const [name, inline] = raw.slice(2).split("=", 2);
	const value = inline ?? (name === "rm-input-dirs" ? "true" : args[++i]);
	if (value === undefined) {
		console.error(`✗ Missing value for --${name}`);
		process.exit(1);
	}
	const list = flags.get(name) ?? [];
	list.push(value);
	flags.set(name, list);
}

const out = flags.get("out")?.[0];
if (!out) {
	console.error("✗ --out <file> is required");
	process.exit(1);
}

const outPath = resolve(out);
mkdirSync(dirname(outPath), { recursive: true });

const required = flags.get("require") ?? [];
const missing = required.filter((p) => !existsSync(resolve(p)));
if (missing.length > 0) {
	console.error(`✗ Required coverage input(s) missing:\n  ${missing.join("\n  ")}`);
	process.exit(1);
}

const inputs = [...required, ...(flags.get("optional") ?? [])];
const prefix = flags.get("prefix")?.[0];
const rmInputDirs = flags.has("rm-input-dirs");
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
	if (prefix) {
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

if (rmInputDirs) {
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
