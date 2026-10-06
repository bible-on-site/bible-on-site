/**
 * Merge lcov.info files into a single report.
 *
 * Unlike naive concatenation, records for the same file are merged: a line or
 * branch counts as covered if it was hit in ANY input. Concatenating leaves
 * duplicate SF blocks that Codecov resolves last-wins, letting a thin e2e
 * record overwrite a rich unit record and silently dropping coverage.
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
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

const required = flags.get("require") ?? [];
const missing = required.filter((p) => !existsSync(resolve(p)));
if (missing.length > 0) {
	console.error(`✗ Required coverage input(s) missing:\n  ${missing.join("\n  ")}`);
	process.exit(1);
}

const inputs = [...required, ...(flags.get("optional") ?? [])];
const prefix = flags.get("prefix")?.[0];
const rmInputDirs = flags.has("rm-input-dirs");

interface FileRecord {
	da: Map<number, number>; // line -> hit count
	brda: Map<string, number>; // "line,block,branch" -> hits
	fnda: Map<string, number>; // function name -> hits
	fn: Set<string>; // function definitions "line,name"
}

const files = new Map<string, FileRecord>();

function recordFor(path: string): FileRecord {
	let rec = files.get(path);
	if (!rec) {
		rec = { da: new Map(), brda: new Map(), fnda: new Map(), fn: new Set() };
		files.set(path, rec);
	}
	return rec;
}

function ingest(content: string): void {
	let rec: FileRecord | null = null;
	for (const raw of content.split(/\r?\n/)) {
		const line = raw.trimEnd();
		if (line.startsWith("SF:")) {
			let p = line.slice(3).replace(/\\/g, "/");
			const prefixIdx = prefix ? p.indexOf(`${prefix}src/`) : -1;
			if (prefixIdx > 0) {
				p = p.slice(prefixIdx);
			} else if (prefix && p.startsWith("src/")) {
				p = `${prefix}${p}`;
			}
			rec = recordFor(p);
			continue;
		}
		if (!rec || line === "end_of_record") {
			rec = line === "end_of_record" ? null : rec;
			continue;
		}
		if (line.startsWith("DA:")) {
			const [ln, hits] = line.slice(3).split(",");
			const n = Number(ln);
			rec.da.set(n, Math.max(rec.da.get(n) ?? 0, Number(hits)));
		} else if (line.startsWith("BRDA:")) {
			const [ln, block, branch, hits] = line.slice(5).split(",");
			const key = `${ln},${block},${branch}`;
			rec.brda.set(key, Math.max(rec.brda.get(key) ?? 0, Number(hits) || 0));
		} else if (line.startsWith("FNDA:")) {
			const comma = line.indexOf(",", 5);
			const hits = Number(line.slice(5, comma));
			const name = line.slice(comma + 1);
			rec.fnda.set(name, Math.max(rec.fnda.get(name) ?? 0, hits));
		} else if (line.startsWith("FN:")) {
			rec.fn.add(line.slice(3));
		}
	}
}

const consumedDirs = new Set<string>();
let hasContent = false;
for (const input of inputs) {
	const inputPath = resolve(input);
	if (!existsSync(inputPath)) {
		console.log(`⚠ Coverage input not found, skipping: ${inputPath}`);
		continue;
	}
	ingest(readFileSync(inputPath, "utf8"));
	hasContent = true;
	consumedDirs.add(dirname(inputPath));
	console.log(`✓ Added coverage from ${inputPath}`);
}

const chunks: string[] = [];
for (const [path, rec] of [...files.entries()].sort()) {
	const lines: string[] = [`TN:`, `SF:${path}`];
	for (const fn of [...rec.fn].sort()) lines.push(`FN:${fn}`);
	for (const [name, hits] of [...rec.fnda.entries()].sort()) lines.push(`FNDA:${hits},${name}`);
	for (const [ln, hits] of [...rec.da.entries()].sort((a, b) => a[0] - b[0])) {
		lines.push(`DA:${ln},${hits}`);
	}
	for (const [key, hits] of [...rec.brda.entries()].sort()) lines.push(`BRDA:${key},${hits}`);
	const lh = [...rec.da.values()].filter((h) => h > 0).length;
	const brh = [...rec.brda.values()].filter((h) => h > 0).length;
	lines.push(`FNF:${rec.fn.size}`, `FNH:${[...rec.fnda.values()].filter((h) => h > 0).length}`);
	lines.push(`BRF:${rec.brda.size}`, `BRH:${brh}`);
	lines.push(`LF:${rec.da.size}`, `LH:${lh}`, "end_of_record");
	chunks.push(lines.join("\n"));
}

const outPath = resolve(out);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, chunks.join("\n") + (chunks.length ? "\n" : ""));

if (rmInputDirs) {
	for (const dir of consumedDirs) {
		rmSync(dir, { recursive: true, force: true });
		console.log(`✓ Removed ${dir}`);
	}
}

if (hasContent) {
	console.log(`\n✓ Merged coverage written to ${outPath} (${files.size} files)`);
} else {
	console.log("\n⚠ No coverage files found to merge");
}
