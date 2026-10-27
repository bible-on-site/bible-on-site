/**
 * Merge lcov.info files into a single report.
 *
 * Unlike naive concatenation, records for the same file are merged: a line or
 * branch counts as covered if it was hit in ANY input. Concatenating leaves
 * duplicate SF blocks that Codecov resolves last-wins, letting a thin e2e
 * record overwrite a rich unit record and silently dropping coverage.
 *
 * Usage:
 *   node merge-lcov.mts --out <file> --prefix <dir> [--require <file>]... [--hits-only <file>]... [--hits-only-branches <file>]... [--optional <file>]... [--rm-input-dirs] [--relocate <needle>]...
 *
 * --require   input must exist; a missing one fails the merge (exit 1)
 * --hits-only like --require, but the input's instrumented universe is
 *             untrusted: it may only confirm hits on coordinates the other
 *             layers already enumerate — file, DA line, and a function
 *             declared at the same FN line in both builds. Use for inputs
 *             built by a different instrumented compilation (e.g. a
 *             separately built e2e app), whose sequence-point set is not
 *             comparable: its unhit lines never enter the report, its hits
 *             on unknown coordinates are dropped — a foreign hit without
 *             its unhit siblings would fake a fully covered file — and
 *             foreign BRDA arms never merge, since the same tuple can name
 *             a different branch in another build. File blocks the input
 *             enumerates that no canonical layer knows are dropped whole
 *             and listed in the summary so instrumentation drift stays
 *             visible instead of silently shrinking coverage.
 * --hits-only-branches
 *             like --hits-only, for an input produced by the SAME
 *             instrumenter as the canonical layers (e.g. the same swc
 *             coverage plugin in a dev-server build, #2670): the arm
 *             universe is still untrusted — foreign BRDA tuples never
 *             enter the report — but a BRDA hit on a "line,block,branch"
 *             tuple the canonical layer also enumerated provably names
 *             the same arm, so the hit confirms it. Use this whenever the
 *             untrusted layer shares the instrumenter; dropping its
 *             aligned branch hits would lose real coverage.
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
 * Diagnostics the merge collects for untrusted inputs when the caller asks.
 * `foreignFiles` — file blocks the untrusted input enumerated that no
 *   canonical layer declares; their hits dropped whole.
 * `emptyCanonicalFiles` — files a canonical layer knows but declares no
 *   coordinates for (e.g. monocart's `all` enumeration emits an empty
 *   record for a file no test loaded); the untrusted block's hits can
 *   confirm nothing and drop. Listed so an unexpectedly
 *   covered-but-unmeasurable file stays visible instead of silently
 *   vanishing from the report.
 */
export interface MergeDiagnostics {
	foreignFiles?: Set<string>;
	emptyCanonicalFiles?: Set<string>;
}

/**
 * Merge lcov contents into a single report body, one SF block per file.
 * `hitsOnly` (indexed like `contents`) marks inputs from an untrusted
 * instrumented universe — a build that enumerates sequence points the
 * canonical layers do not know. Such an input can only CONFIRM coverage on
 * coordinates both builds provably share: its DA hits merge onto an
 * existing file's existing line, its FNDA hits merge only when the block
 * declared the function at the canonical FN "line,name", and its BRDA
 * arms never merge — block/branch indices are per-instrumenter and equal
 * tuples can denote different arms. The merged SF set and LF/BRF/FNF
 * denominators stay exactly the canonical layers' — an untrusted input
 * can raise DA/FNDA hit counts, never extend the universe. Canonical
 * inputs merge first regardless of CLI order, so the universe is always
 * complete before untrusted hits apply.
 *
 * `hitsOnlyBranches` is the same-instrumenter variant (#2670): the
 * untrusted layer shares the canonical layers' instrumenter (e.g. both
 * unit and e2e compile with swc-plugin-coverage-instrument), so an
 * identical "line,block,branch" tuple provably names the same arm and
 * foreign BRDA hits confirm canonical arms on exact tuples. Foreign
 * tuples still never enter the report — a dev server's on-demand
 * compilation enumerates a nondeterministic arm set.
 *
 * When `diagnostics` is given its optional sets are filled with the
 * normalized SF paths of dropped untrusted blocks (see MergeDiagnostics).
 */
export function mergeLcovTexts(
	contents: string[],
	prefix?: string,
	relocates: string[] = [],
	hitsOnly: ReadonlySet<number> = new Set(),
	hitsOnlyBranches: ReadonlySet<number> = new Set(),
	diagnostics?: MergeDiagnostics,
): string {
	const files = new Map<string, FileRecord>();
	const newRecord = (): FileRecord => ({
		da: new Map(),
		brda: new Map(),
		fnda: new Map(),
		fn: new Set(),
	});
	const recordFor = (path: string): FileRecord => {
		let rec = files.get(path);
		if (!rec) {
			rec = newRecord();
			files.set(path, rec);
		}
		return rec;
	};

	const untrusted = (index: number) =>
		hitsOnly.has(index) || hitsOnlyBranches.has(index);
	const order = [...contents.keys()].sort(
		(a, b) => Number(untrusted(a)) - Number(untrusted(b)),
	);
	for (const index of order) {
		const coveredOnly = untrusted(index);
		const confirmBranches = hitsOnlyBranches.has(index);
		let rec: FileRecord | null = null;
		// Untrusted file blocks parse into their own record first — foreign
		// coordinates may only confirm canonical ones, so nothing merges
		// until the whole block (FN defs included) has been inspected.
		let foreign: FileRecord | null = null;
		let foreignPath: string | null = null;
		let canonicalEmpty = false;
		const flushForeign = () => {
			if (!foreign) return;
			// Alias keeps the narrowed non-null type inside nested closures
			// (rec is reassigned between blocks).
			const canonical = rec;
			if (canonical) {
				for (const [n, h] of foreign.da) {
					if (canonical.da.has(n)) {
						canonical.da.set(n, Math.max(canonical.da.get(n) ?? 0, h));
					}
				}
				// Same-instrumenter inputs share BRDA coordinates: an
				// identical tuple provably names the same arm, so its hit
				// confirms. Tuples the canonical layer never enumerated
				// still drop — the arm set a dev server compiles is
				// run-dependent (#2670). For cross-instrumenter inputs
				// (hitsOnly) equal tuples can name different arms, so no
				// foreign BRDA arm merges at all.
				if (confirmBranches) {
					for (const [key, h] of foreign.brda) {
						if (canonical.brda.has(key)) {
							canonical.brda.set(
								key,
								Math.max(canonical.brda.get(key) ?? 0, h),
							);
						}
					}
				}
				for (const [name, h] of foreign.fnda) {
					// A function is provably the same only when the untrusted
					// block declared it at the exact FN "line,name" the
					// canonical build declared.
					const proven = [...foreign.fn].some(
						(def) => def.endsWith(`,${name}`) && canonical.fn.has(def),
					);
					if (proven) {
						canonical.fnda.set(name, Math.max(canonical.fnda.get(name) ?? 0, h));
					}
				}
			}
			if (
				canonicalEmpty &&
				foreignPath &&
				(foreign.da.size > 0 ||
					foreign.brda.size > 0 ||
					foreign.fnda.size > 0)
			) {
				// The canonical layer knows the file but declares no
				// coordinates, so nothing the block reports can confirm —
				// surface it instead of dropping coverage silently.
				diagnostics?.emptyCanonicalFiles?.add(foreignPath);
			}
			foreign = null;
		};
		for (const raw of contents[index].split(/\r?\n/)) {
			const line = raw.trimEnd();
			if (line.startsWith("SF:")) {
				flushForeign();
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
				// An untrusted file is foreign code: the whole block drops,
				// hits included — reporting them without their unhit siblings
				// would fake a fully covered file.
				const canonicalRec = coveredOnly ? (files.get(p) ?? null) : null;
				if (coveredOnly && !canonicalRec) {
					diagnostics?.foreignFiles?.add(p);
				}
				rec = coveredOnly ? canonicalRec : recordFor(p);
				foreign = coveredOnly && rec ? newRecord() : null;
				foreignPath = foreign ? p : null;
				// Canonical inputs all parse before untrusted ones, so an
				// empty record here stays empty through this input's pass —
				// foreign data against it can never confirm.
				canonicalEmpty =
					!!rec &&
					!rec.da.size &&
					!rec.brda.size &&
					!rec.fn.size &&
					!rec.fnda.size;
				continue;
			}
			if (line === "end_of_record") {
				flushForeign();
				rec = null;
				continue;
			}
			const target = coveredOnly ? foreign : rec;
			if (!target) continue;
			if (line.startsWith("DA:")) {
				const [ln, hits] = line.slice(3).split(",");
				target.da.set(Number(ln), Math.max(target.da.get(Number(ln)) ?? 0, Number(hits)));
			} else if (line.startsWith("BRDA:")) {
				const [ln, block, branch, hits] = line.slice(5).split(",");
				const key = `${ln},${block},${branch}`;
				target.brda.set(key, Math.max(target.brda.get(key) ?? 0, Number(hits) || 0));
			} else if (line.startsWith("FNDA:")) {
				const comma = line.indexOf(",", 5);
				const hits = Number(line.slice(5, comma));
				const name = line.slice(comma + 1);
				target.fnda.set(name, Math.max(target.fnda.get(name) ?? 0, hits));
			} else if (line.startsWith("FN:")) {
				target.fn.add(line.slice(3));
			}
		}
		flushForeign();
	}

	const chunks: string[] = [];
	for (const [path, rec] of [...files.entries()].sort()) {
		// A file block with no records at all has nothing to report.
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

	const required = [
		...(flags.get("require") ?? []),
		...(flags.get("hits-only") ?? []),
		...(flags.get("hits-only-branches") ?? []),
	];
	const missing = required.filter((p) => !existsSync(resolve(p)));
	if (missing.length > 0) {
		console.error(`✗ Required coverage input(s) missing:\n  ${missing.join("\n  ")}`);
		process.exit(1);
	}

	const hitsOnlySet = new Set(flags.get("hits-only") ?? []);
	const hitsOnlyBranchesSet = new Set(flags.get("hits-only-branches") ?? []);
	const inputs = [...required, ...(flags.get("optional") ?? [])];
	const prefix = flags.get("prefix")?.[0];
	const relocates = flags.get("relocate") ?? [];
	const rmInputDirs = flags.has("rm-input-dirs");

	const consumedDirs = new Set<string>();
	const contents: string[] = [];
	const hitsOnly = new Set<number>();
	const hitsOnlyBranches = new Set<number>();
	for (const input of inputs) {
		const inputPath = resolve(input);
		if (!existsSync(inputPath)) {
			console.log(`⚠ Coverage input not found, skipping: ${inputPath}`);
			continue;
		}
		contents.push(readFileSync(inputPath, "utf8"));
		if (hitsOnlySet.has(input)) hitsOnly.add(contents.length - 1);
		if (hitsOnlyBranchesSet.has(input)) hitsOnlyBranches.add(contents.length - 1);
		consumedDirs.add(dirname(inputPath));
		console.log(`✓ Added coverage from ${inputPath}`);
	}

	const diagnostics: MergeDiagnostics = {
		foreignFiles: new Set(),
		emptyCanonicalFiles: new Set(),
	};
	const merged = mergeLcovTexts(
		contents,
		prefix,
		relocates,
		hitsOnly,
		hitsOnlyBranches,
		diagnostics,
	);
	const outPath = resolve(out);
	mkdirSync(dirname(outPath), { recursive: true });
	writeFileSync(outPath, merged);

	if (diagnostics.foreignFiles?.size) {
		const shown = [...diagnostics.foreignFiles].slice(0, 15);
		const rest = diagnostics.foreignFiles.size - shown.length;
		console.log(
			`⚠ Untrusted input file(s) outside the canonical universe — ` +
				`dropped hits included (${diagnostics.foreignFiles.size}):\n  ` +
				shown.join("\n  ") +
				(rest > 0 ? `\n  …and ${rest} more` : ""),
		);
	}

	if (diagnostics.emptyCanonicalFiles?.size) {
		const shown = [...diagnostics.emptyCanonicalFiles].slice(0, 15);
		const rest = diagnostics.emptyCanonicalFiles.size - shown.length;
		console.log(
			`⚠ Canonical universe declares no coordinates for file(s) the ` +
				`untrusted input covers — its data cannot confirm and dropped ` +
				`(${diagnostics.emptyCanonicalFiles.size}):\n  ` +
				shown.join("\n  ") +
				(rest > 0 ? `\n  …and ${rest} more` : ""),
		);
	}

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
