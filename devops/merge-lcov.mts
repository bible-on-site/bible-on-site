/**
 * Merge lcov.info files into a single report.
 *
 * Unlike naive concatenation, records for the same file are merged: a line or
 * branch counts as covered if it was hit in ANY input. Concatenating leaves
 * duplicate SF blocks that Codecov resolves last-wins, letting a thin e2e
 * record overwrite a rich unit record and silently dropping coverage.
 *
 * Usage:
 *   node --import tsx merge-lcov.mts --out <file> --prefix <dir> [--require <file>]... [--hits-only <file>]... [--optional <file>]... [--rm-input-dirs] [--relocate <needle>]...
 *
 * --require   input must exist; a missing one fails the merge (exit 1)
 * --hits-only like --require, but only covered records merge: a line, branch,
 *             or function the input did not hit contributes nothing. Use for
 *             inputs whose instrumented-line universe is not comparable with
 *             the other layers (e.g. a separately built e2e app), so their
 *             zero-hit enumeration cannot inflate the merged denominator.
 * --optional  input is skipped with a warning when missing
 * --prefix    module dir relative to repo root (e.g. web/admin/) — rewrites
 *             bare `SF:src/...` records so Codecov flag paths match
 * --relocate  canonicalize SF paths by cutting everything before the given
 *             needle (e.g. --relocate app/ rewrites
 *             /home/runner/work/repo/repo/app/X.cs and
 *             /Users/runner/work/repo/repo/app/X.cs to app/X.cs, so reports
 *             collected on different runners deduplicate correctly)
 * --rm-input-dirs  delete the parent directory of every consumed input afterwards
 *
 * Paths are resolved against the caller's working directory.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface FileRecord {
	da: Map<number, number>; // line -> hit count
	brda: Map<string, number>; // "line,block,branch" -> hits
	fnda: Map<string, number>; // function name -> hits
	fn: Set<string>; // function definitions "line,name"
}

/**
 * Merge lcov contents into a single report body, one SF block per file.
 * `hitsOnly` (indexed like `contents`) marks inputs that contribute only
 * covered records: their zero-hit DA/BRDA/FNDA entries and the FN definitions
 * of unhit functions are dropped, so a foreign build's instrumented-line
 * enumeration cannot inflate the merged denominator. Hits still union in.
 */
export function mergeLcovTexts(
	contents: string[],
	prefix?: string,
	relocates: string[] = [],
	hitsOnly: ReadonlySet<number> = new Set(),
): string {
	const files = new Map<string, FileRecord>();
	const recordFor = (path: string): FileRecord => {
		let rec = files.get(path);
		if (!rec) {
			rec = { da: new Map(), brda: new Map(), fnda: new Map(), fn: new Set() };
			files.set(path, rec);
		}
		return rec;
	};

	for (const [index, content] of contents.entries()) {
		const coveredOnly = hitsOnly.has(index);
		let rec: FileRecord | null = null;
		// FN definitions precede their FNDA hits in a record, so a covered-only
		// input parks them until end_of_record reveals which functions ran.
		// Zero-hit branches drop unconditionally: a foreign build's BRDA
		// block/branch indices need not match the canonical build's, so an
		// unhit arm is enumeration, not partial coverage.
		const pendingFn = new Map<string, string>();
		const hitFn = new Set<string>();
		for (const raw of content.split(/\r?\n/)) {
			const line = raw.trimEnd();
			if (line.startsWith("SF:")) {
				let p = line.slice(3).replace(/\\/g, "/");
				for (const needle of relocates) {
					const idx = p.indexOf(needle);
					if (idx > 0) {
						p = p.slice(idx);
						break;
					}
				}
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
				if (line === "end_of_record" && rec) {
					for (const [name, fn] of pendingFn) {
						if (hitFn.has(name)) rec.fn.add(fn);
					}
					pendingFn.clear();
					hitFn.clear();
				}
				rec = line === "end_of_record" ? null : rec;
				continue;
			}
			if (line.startsWith("DA:")) {
				const [ln, hits] = line.slice(3).split(",");
				const n = Number(ln);
				const h = Number(hits);
				if (coveredOnly && !(h > 0)) continue;
				rec.da.set(n, Math.max(rec.da.get(n) ?? 0, h));
			} else if (line.startsWith("BRDA:")) {
				const [ln, block, branch, hits] = line.slice(5).split(",");
				const h = Number(hits) || 0;
				if (coveredOnly && h <= 0) continue;
				const key = `${ln},${block},${branch}`;
				rec.brda.set(key, Math.max(rec.brda.get(key) ?? 0, h));
			} else if (line.startsWith("FNDA:")) {
				const comma = line.indexOf(",", 5);
				const hits = Number(line.slice(5, comma));
				const name = line.slice(comma + 1);
				if (coveredOnly && !(hits > 0)) continue;
				rec.fnda.set(name, Math.max(rec.fnda.get(name) ?? 0, hits));
				hitFn.add(name);
			} else if (line.startsWith("FN:")) {
				const fn = line.slice(3);
				if (coveredOnly) {
					pendingFn.set(fn.slice(fn.indexOf(",") + 1), fn);
				} else {
					rec.fn.add(fn);
				}
			}
		}
	}

	const chunks: string[] = [];
	for (const [path, rec] of [...files.entries()].sort()) {
		// A hits-only input can leave a file record empty when it covered
		// nothing there; such a file has nothing to merge.
		if (!rec.da.size && !rec.brda.size && !rec.fnda.size && !rec.fn.size) continue;
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
	return chunks.join("\n") + (chunks.length ? "\n" : "");
}

function main(): void {
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

	const required = [...(flags.get("require") ?? []), ...(flags.get("hits-only") ?? [])];
	const missing = required.filter((p) => !existsSync(resolve(p)));
	if (missing.length > 0) {
		console.error(`✗ Required coverage input(s) missing:\n  ${missing.join("\n  ")}`);
		process.exit(1);
	}

	const hitsOnlySet = new Set(flags.get("hits-only") ?? []);
	const inputs = [...required, ...(flags.get("optional") ?? [])];
	const prefix = flags.get("prefix")?.[0];
	const relocates = flags.get("relocate") ?? [];
	const rmInputDirs = flags.has("rm-input-dirs");

	const consumedDirs = new Set<string>();
	const contents: string[] = [];
	const hitsOnly = new Set<number>();
	for (const input of inputs) {
		const inputPath = resolve(input);
		if (!existsSync(inputPath)) {
			console.log(`⚠ Coverage input not found, skipping: ${inputPath}`);
			continue;
		}
		contents.push(readFileSync(inputPath, "utf8"));
		if (hitsOnlySet.has(input)) hitsOnly.add(contents.length - 1);
		consumedDirs.add(dirname(inputPath));
		console.log(`✓ Added coverage from ${inputPath}`);
	}

	const merged = mergeLcovTexts(contents, prefix, relocates, hitsOnly);
	const outPath = resolve(out);
	mkdirSync(dirname(outPath), { recursive: true });
	writeFileSync(outPath, merged);

	if (rmInputDirs) {
		for (const dir of consumedDirs) {
			rmSync(dir, { recursive: true, force: true });
			console.log(`✓ Removed ${dir}`);
		}
	}

	if (contents.length > 0) {
		const files = merged.match(/^SF:/gm)?.length ?? 0;
		console.log(`\n✓ Merged coverage written to ${outPath} (${files} files)`);
	} else {
		console.log("\n⚠ No coverage files found to merge");
	}
}

if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	main();
}
