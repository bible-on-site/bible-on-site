#!/usr/bin/env node
/**
 * worktree-dedupe — reclaim duplicated bytes across a repo's worktrees.
 *
 * Every worktree re-materializes the same heavy payload: node_modules
 * packages, generated data dumps, downloadable assets. On an NTFS volume
 * identical copies can share one physical file via hardlinks — this tool
 * finds duplicates and links them to a single canonical inode.
 *
 *   node devops/worktree-dedupe.mts [--repo <path>]... [--yes]
 *     [--worktree <path>]... [--min-kb N=64] [--settle-min N=60]
 *     [--max-files N=400000]
 *
 * Default is a dry-run: prints what would be linked and bytes reclaimed.
 *
 * Safety model (fail-closed):
 *  - Only paths under whitelisted payload roots are eligible.
 *    `node_modules` is the sole default root: package content is
 *    versioned and written once at install time — later installs replace
 *    directories atomically rather than editing files in place.
 *    Generated dumps, codegen output and asset packs are deliberately
 *    excluded: their producers rewrite them in place (e.g. the website's
 *    compress-canonical-data prebuild), and an in-place write through a
 *    hardlink would silently corrupt every linked worktree's copy.
 *    Deleting them is safe (they regenerate); sharing them is not.
 *  - A file must be older than --settle-min so in-flight installs/builds
 *    cannot be linked mid-write.
 *  - Hashing is size-bucketed: only sizes seen more than once are hashed.
 *  - Replacement is atomic (link temp + rename over) and re-verified:
 *    size/mtime are rechecked immediately before replacing; a file that
 *    changed since the scan is skipped.
 *  - Same-device only (NTFS hardlinks cannot cross volumes), regular
 *    files only, never anything containing a `.git` path segment.
 */
import { createHash } from "node:crypto";
import {
	statSync,
	lstatSync,
	readdirSync,
	readFileSync,
	appendFileSync,
	unlinkSync,
	linkSync,
	renameSync,
} from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// ---------- tunables ----------

/** Directory segments whose whole subtree is write-once payload. Only
 *  node_modules qualifies: generated dumps and asset packs have in-place
 *  writers, which would corrupt every worktree sharing the inode. */
const DEDUPE_DIR_NAMES = new Set(["node_modules"]);

const SKIP_DIR_NAMES = new Set([".git"]);
const DEFAULT_MIN_BYTES = 64 * 1024;
const DEFAULT_SETTLE_MS = 60 * 60 * 1000;
const DEFAULT_MAX_FILES = 5_000_000;

// ---------- cli ----------

interface Cli {
	repos: string[];
	worktrees: string[];
	apply: boolean;
	minBytes: number;
	settleMs: number;
	maxFiles: number;
	log?: string;
}

export function parseDays(name: string, v: string | undefined): number {
	if (v === undefined || v.trim() === "" || !Number.isFinite(Number(v)))
		throw new Error(`${name}: expected a number, got "${v ?? ""}"`);
	return Number(v);
}

function parseCli(args: string[]): Cli {
	const cli: Cli = {
		repos: [],
		worktrees: [],
		apply: false,
		minBytes: DEFAULT_MIN_BYTES,
		settleMs: DEFAULT_SETTLE_MS,
		maxFiles: DEFAULT_MAX_FILES,
	};
	for (let i = 0; i < args.length; i++) {
		const a = args[i];
		if (a === "--repo") cli.repos.push(args[++i]);
		else if (a === "--worktree") cli.worktrees.push(args[++i]);
		else if (a === "--yes") cli.apply = true;
		else if (a === "--min-kb")
			cli.minBytes = parseDays("--min-kb", args[++i]) * 1024;
		else if (a === "--settle-min")
			cli.settleMs = parseDays("--settle-min", args[++i]) * 60_000;
		else if (a === "--max-files")
			cli.maxFiles = parseDays("--max-files", args[++i]);
		else if (a === "--log") cli.log = args[++i];
		else throw new Error(`unexpected argument "${a}"`);
	}
	return cli;
}

// ---------- scan ----------

interface Candidate {
	path: string;
	size: number;
	mtimeMs: number;
	dev: number;
	ino: number;
}

/** Path (worktree-relative, /-separated) is under a whitelisted payload
 *  root. */
export function isDedupePath(rel: string): boolean {
	return rel.split("/").some((s) => DEDUPE_DIR_NAMES.has(s));
}

/** Bounded recursive walk collecting eligible settled files. */
function scanWorktree(
	root: string,
	cli: Cli,
	budget: { left: number },
	out: Candidate[],
): void {
	const stack = [""];
	const now = Date.now();
	while (stack.length && budget.left > 0) {
		const rel = stack.pop()!;
		const abs = rel ? join(root, rel) : root;
		let entries;
		try {
			entries = readdirSync(abs, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const e of entries) {
			if (budget.left-- <= 0) return;
			const r = rel ? `${rel}/${e.name}` : e.name;
			if (e.isDirectory()) {
				if (!SKIP_DIR_NAMES.has(e.name)) stack.push(r);
				continue;
			}
			if (!e.isFile() || !isDedupePath(r)) continue;
			try {
				const st = lstatSync(join(root, r));
				if (
					!st.isFile() ||
					st.size < cli.minBytes ||
					now - st.mtimeMs < cli.settleMs
				)
					continue;
				out.push({
					path: join(root, r),
					size: st.size,
					mtimeMs: st.mtimeMs,
					dev: st.dev,
					ino: st.ino,
				});
			} catch {
				/* vanished */
			}
		}
	}
}

function worktreesOf(repo: string): string[] {
	try {
		return execFileSync("git", ["-C", repo, "worktree", "list", "--porcelain"], {
			encoding: "utf8",
			maxBuffer: 64 * 1024 * 1024,
		})
			.split("\n")
			.filter((l) => l.startsWith("worktree "))
			.map((l) => l.slice(9).trim())
			.filter(Boolean);
	} catch {
		return [];
	}
}

function hash(path: string): string {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

// ---------- dedupe ----------

export interface DedupeResult {
	scanned: number;
	candidates: number;
	hashed: number;
	linked: number;
	reclaimedBytes: number;
	errors: string[];
}

export function dedupe(paths: string[], cli: Cli): DedupeResult {
	const res: DedupeResult = {
		scanned: 0,
		candidates: 0,
		hashed: 0,
		linked: 0,
		reclaimedBytes: 0,
		errors: [],
	};
	const candidates: Candidate[] = [];
	const budget = { left: cli.maxFiles };
	for (const root of paths) {
		scanWorktree(root, cli, budget, candidates);
		res.scanned++;
	}
	res.candidates = candidates.length;

	// size buckets — only sizes seen >1 can duplicate
	const bySize = new Map<number, Candidate[]>();
	for (const c of candidates) {
		const arr = bySize.get(c.size);
		if (arr) arr.push(c);
		else bySize.set(c.size, [c]);
	}

	// Canonical file per (device, hash): hardlinks cannot cross volumes,
	// so each device gets its own canonical for the same content.
	const canonByKey = new Map<string, Candidate>();
	// A candidate's hash always describes that candidate's own content at
	// hash time — never a group-mate's — so a path replaced mid-run can only
	// be relinked to content it provably held. Candidates that still match
	// the scan snapshot (size+mtime+inode) are "stable"; same-inode paths
	// share the cached hash because a live inode's index is unique.
	const hashByInode = new Map<string, string>();
	for (const [, group] of bySize) {
		if (group.length < 2) continue;
		const stillSame = (c: Candidate): Candidate | null => {
			try {
				const st = statSync(c.path);
				return st.size === c.size &&
					st.mtimeMs === c.mtimeMs &&
					st.ino === c.ino
					? c
					: null;
			} catch {
				return null;
			}
		};
		const stable = group.filter((c) => stillSame(c) !== null);
		// Reclaim accounting: a recorded inode's storage frees only when
		// every stable alias has been relinked elsewhere.
		const inodeLeft = new Map<string, number>();
		for (const c of stable) {
			const k = `${c.dev}:${c.ino}`;
			inodeLeft.set(k, (inodeLeft.get(k) ?? 0) + 1);
		}
		for (const c of stable) {
			// Re-verify before trusting the recorded inode: a path replaced
			// since the filter must not borrow a cached hash or a canonical
			// slot its current content does not own.
			if (stillSame(c) === null) continue;
			const ikey = `${c.dev}:${c.ino}`;
			let h = hashByInode.get(ikey);
			if (!h) {
				try {
					h = hash(c.path);
				} catch (e) {
					res.errors.push(`hash ${c.path}: ${(e as Error).message}`);
					continue;
				}
				hashByInode.set(ikey, h);
				res.hashed++;
			}
			const key = `${c.dev}:${h}`;
			let canon = canonByKey.get(key);
			if (canon && canon.dev === c.dev && canon.ino === c.ino) continue;
			if (!canon) {
				canonByKey.set(key, c);
				continue;
			}
			if (!cli.apply) {
				res.linked++;
				const left = (inodeLeft.get(ikey) ?? 1) - 1;
				inodeLeft.set(ikey, left);
				if (left === 0) res.reclaimedBytes += c.size;
				continue;
			}
			// atomic replace: re-verify then link temp + rename over
			try {
				if (stillSame(c) === null) continue;
				const cst = statSync(canon.path);
				if (cst.size !== canon.size || cst.mtimeMs !== canon.mtimeMs) {
					// Canonical was rewritten since the scan; this verified
					// candidate still holds the hashed content and becomes
					// the new canonical.
					canonByKey.set(key, c);
					canon = c;
					continue;
				}
				const tmp = `${c.path}.dedupe-${process.pid}`;
				linkSync(canon.path, tmp);
				try {
					renameSync(tmp, c.path);
				} catch (re) {
					try {
						unlinkSync(tmp);
					} catch {
						/* temp alias could not be removed */
					}
					throw re;
				}
				res.linked++;
				const left = (inodeLeft.get(ikey) ?? 1) - 1;
				inodeLeft.set(ikey, left);
				if (left === 0) res.reclaimedBytes += c.size;
			} catch (e) {
				res.errors.push(`link ${c.path}: ${(e as Error).message}`);
			}
		}
	}
	return res;
}

// ---------- main ----------

function fmtBytes(n: number): string {
	return n > 1 << 30
		? `${(n / (1 << 30)).toFixed(1)}GiB`
		: `${(n / (1 << 20)).toFixed(1)}MiB`;
}

const isMain =
	process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
	let cli: Cli;
	try {
		cli = parseCli(process.argv.slice(2));
	} catch (e) {
		console.error(`worktree-dedupe: ${(e as Error).message}`);
		process.exit(1);
	}
	const roots = [...cli.worktrees];
	for (const repo of cli.repos) roots.push(...worktreesOf(repo));
	if (!roots.length) {
		console.error("worktree-dedupe: no worktrees (pass --repo or --worktree)");
		process.exit(1);
	}
	console.log(
		`worktree-dedupe ${cli.apply ? "APPLY" : "DRY-RUN"} — ${new Date().toISOString()}`,
	);
	const r = dedupe(roots, cli);
	const summary =
		`roots=${r.scanned} candidates=${r.candidates} hashed=${r.hashed} ` +
		`linked=${r.linked} reclaimed=${fmtBytes(r.reclaimedBytes)} errors=${r.errors.length}`;
	console.log(summary);
	for (const e of r.errors.slice(0, 20)) console.log(`  ! ${e}`);
	if (!cli.apply) console.log("dry-run — re-run with --yes to apply");
	if (cli.log) {
		try {
			appendFileSync(
				cli.log,
				`[${new Date().toISOString()}] worktree-dedupe ${cli.apply ? "apply" : "dry-run"} ${summary}\n`,
			);
		} catch (e) {
			console.error(`worktree-dedupe: log write failed: ${(e as Error).message}`);
		}
	}
}
