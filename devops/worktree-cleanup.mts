/**
 * Daily git-worktree hygiene for this machine's multi-worktree workflow.
 *
 * Removes stale worktrees (branch deleted on remote / no open PR / clean or
 * only benign dirt), sweeps unregistered debris directories left behind by
 * partial removals, and prunes heavy build dirs (node_modules, .next, target,
 * bin/obj …) inside kept worktrees that have been idle for a while — those are
 * regenerable and are what actually duplicate gigabytes across worktrees.
 *
 * Safety:
 * - Never touches the main checkout, the worktree the script runs from, or any
 *   ancestor worktree of it.
 * - Worktrees whose branch has an open PR (gh) are always kept.
 * - If `gh`, `git fetch`, or the remote-ref listing fails, no worktree is
 *   removed at all — deletion requires positive evidence a worktree is done.
 * - A dirty worktree is removed only when every status line is recoverable
 *   (uncommitted deletions of tracked files, or generated churn).
 * - Ignored files are invisible to a plain `git status`: a removal candidate
 *   is kept when it contains any ignored path that is not recognizably
 *   regenerable (e.g. .env files or local dumps Git cannot restore).
 * - Debris dirs are only deleted when empty or when they provably hold files
 *   tracked in the default branch — a random sibling folder is never touched.
 * - Branch refs are never deleted — removing a worktree loses no commits.
 *
 * Dry-run by default; pass --yes to apply.
 *
 * Usage:
 *   node <repo>/devops/worktree-cleanup.mts [--repo <path>]... [--yes]
 *     [--debris-days N=2] [--idle-days N=14] [--no-heavy] [--keep <name>]...
 *     [--log <file>]
 */
import { execFileSync } from "node:child_process";
import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	rmSync,
	statSync,
} from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export interface WorktreeInfo {
	path: string;
	branch: string | null; // null = detached HEAD
	head: string;
}

export type Disposition =
	| "protected"
	| "open-pr"
	| "real-dirty"
	| "ignored-local"
	| "remote-unknown"
	| "detached-unmerged"
	| "stale-fresh"
	| "remove";

interface ClassifyInput {
	wt: WorktreeInfo;
	isMain: boolean;
	isProtected: boolean;
	openPr: boolean;
	/** The remote branch is gone AND (a closed/merged PR's head commit equals
	 *  the current tip, or the branch had a configured upstream). Never-pushed
	 *  local branches and re-pushed branch names are NOT remote-done. */
	remoteDone: boolean;
	mergedIntoDefault: boolean;
	idleBeyondThreshold: boolean;
	statusLines: string[];
	benignDirtyRe: RegExp;
}

export function parseWorktrees(porcelain: string): WorktreeInfo[] {
	const out: WorktreeInfo[] = [];
	let cur: Partial<WorktreeInfo> | null = null;
	for (const line of porcelain.split("\n")) {
		if (line.startsWith("worktree ")) {
			if (cur?.path) out.push(cur as WorktreeInfo);
			cur = { path: line.slice(9).trim(), branch: null, head: "" };
		} else if (cur && line.startsWith("HEAD ")) {
			cur.head = line.slice(5).trim();
		} else if (cur && line.startsWith("branch refs/heads/")) {
			cur.branch = line.slice(18).trim();
		} else if (cur && line === "detached") {
			cur.branch = null;
		}
	}
	if (cur?.path) out.push(cur as WorktreeInfo);
	return out;
}

/**
 * A dirty worktree is still removable when every uncommitted change is a
 * deletion of a tracked file (recoverable from HEAD) or matches a known
 * generated file (e.g. ` M app/.nuke/build.schema.json`).
 */
export function isBenignDirty(statusLines: string[], benignRe: RegExp): boolean {
	if (statusLines.length === 0) return false;
	return statusLines.every((l) => l.startsWith(" D ") || benignRe.test(l));
}

export function classify(input: ClassifyInput): Disposition {
	const { wt } = input;
	if (input.isMain || input.isProtected) return "protected";
	if (input.openPr) return "open-pr";
	const clean = input.statusLines.length === 0;
	const benign = !clean && isBenignDirty(input.statusLines, input.benignDirtyRe);
	if (wt.branch === null) {
		// Detached HEAD: removing orphans the commit — only safe when it is
		// already reachable from the default branch.
		if (input.mergedIntoDefault && (clean || benign)) return "remove";
		return "detached-unmerged";
	}
	if (!clean && !benign) return "real-dirty";
	// Stale = remote says the work is done (closed PR / deleted upstream), tip
	// already in the default branch, or the checkout simply sat idle past the
	// threshold. A fresh clean worktree on a live un-PR'd branch is left alone.
	if (input.remoteDone || input.mergedIntoDefault || input.idleBeyondThreshold)
		return "remove";
	return "stale-fresh";
}

// ---------- git helpers ----------

function git(repo: string, args: string[]): string {
	return execFileSync("git", ["-C", repo, ...args], {
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
	});
}

function tryGit(repo: string, args: string[], input?: string): string | null {
	try {
		return execFileSync("git", ["-C", repo, ...args], {
			encoding: "utf8",
			maxBuffer: 64 * 1024 * 1024,
			stdio: ["pipe", "pipe", "ignore"],
			input,
		});
	} catch {
		return null;
	}
}

interface BranchPr {
	open: boolean;
	/** headRefOid of each closed/merged PR for this exact branch name. */
	closedOids: Set<string>;
}

/**
 * PR state for one branch, queried by name so unrelated PR history can never
 * crowd it out. null when gh is unavailable.
 */
function branchPr(repo: string, branch: string): BranchPr | null {
	try {
		const out = execFileSync(
			"gh",
			[
				"pr",
				"list",
				"--repo",
				repoSlug(repo),
				"--state",
				"all",
				"--head",
				branch,
				"--limit",
				"20",
				"--json",
				"headRefOid,state",
			],
			{ encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
		);
		const prs = JSON.parse(out) as { headRefOid: string; state: string }[];
		return {
			open: prs.some((p) => p.state === "OPEN"),
			closedOids: new Set(
				prs.filter((p) => p.state !== "OPEN").map((p) => p.headRefOid),
			),
		};
	} catch {
		return null;
	}
}

function repoSlug(repo: string): string {
	const url = (tryGit(repo, ["remote", "get-url", "origin"]) ?? "").trim();
	const m = url.match(/[:/]([^/:]+\/[^/:]+)$/);
	return m ? m[1].replace(/\.git$/, "") : ".";
}

// ---------- fs helpers ----------

const HEAVY_DIRS = new Set([
	"node_modules",
	".next",
	"dev-dist",
	"dist",
	"target",
	"bin",
	"obj",
	".coverage",
	"coverage",
	"TestResults",
	"test-results",
	"playwright-report",
	"android-build",
	".vs",
]);

function newestTopLevelMtime(dir: string): number {
	let newest = 0;
	for (const e of readdirSync(dir, { withFileTypes: true })) {
		try {
			const m = statSync(join(dir, e.name)).mtimeMs;
			if (m > newest) newest = m;
		} catch {
			/* entry vanished */
		}
	}
	return newest;
}

/**
 * Last-activity timestamp for a worktree: newest top-level entry mtime plus
 * the gitdir's HEAD and reflog (updated by checkouts/commits). The index is
 * deliberately excluded — `git status` refreshes it, so our own scan would
 * mark every worktree as active.
 */
function lastActivityMs(wtPath: string): number {
	let newest = newestTopLevelMtime(wtPath);
	const gitDir = tryGit(wtPath, ["rev-parse", "--git-dir"])?.trim();
	if (gitDir) {
		const gd = resolve(wtPath, gitDir);
		for (const f of ["HEAD", join("logs", "HEAD")]) {
			try {
				const m = statSync(join(gd, f)).mtimeMs;
				if (m > newest) newest = m;
			} catch {
				/* file missing */
			}
		}
	}
	return newest;
}

/** Directories with heavy names inside `root`, searched to `depth` levels. */
function* heavyDirs(root: string, depth: number): Generator<string> {
	if (depth < 0) return;
	let entries;
	try {
		entries = readdirSync(root, { withFileTypes: true });
	} catch {
		return;
	}
	for (const e of entries) {
		if (!e.isDirectory()) continue;
		const p = join(root, e.name);
		if (HEAVY_DIRS.has(e.name)) yield p;
		else yield* heavyDirs(p, depth - 1);
	}
}

function rmrf(p: string): boolean {
	try {
		rmSync(p, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 });
		return !existsSync(p);
	} catch {
		return false;
	}
}

/** True if `rel` (or anything under it) is tracked in the worktree — those
 *  dirs (e.g. devops/coverage) are content, not regenerable build output. */
function isTracked(wtPath: string, absDir: string, relTo: string): boolean {
	const rel = absDir.slice(relTo.length + 1).split(sep).join("/");
	const out = tryGit(wtPath, ["ls-files", "--", rel]);
	return out !== null && out.trim().length > 0;
}

/** Ignored names that are reproducible build/tool output, so deleting the
 *  worktree that contains them loses nothing. Anything else ignored
 *  (.env, dumps, notes) makes the worktree non-removable. */
const REGENERABLE_NAMES = new Set([
	...HEAVY_DIRS,
	".venv",
	"venv",
	"__pycache__",
	".pytest_cache",
	".mypy_cache",
	".ruff_cache",
	".turbo",
	".cache",
	".parcel-cache",
	".gradle",
	"htmlcov",
	".nyc_output",
	".hypothesis",
	".dart_tool",
]);
const REGENERABLE_FILE_RE =
	/\.(tsbuildinfo|py[co]|log|tmp|swp|swo)$|^(Thumbs\.db|\.DS_Store|desktop\.ini)$/i;

/** Porcelain `--ignored` path → true when it is provably regenerable. */
export function isRegenerableIgnored(ignoredPath: string): boolean {
	const p = ignoredPath.replace(/^"|"$/g, "").replace(/\/+$/, "");
	return (
		p.split("/").some((s) => REGENERABLE_NAMES.has(s)) ||
		REGENERABLE_FILE_RE.test(p)
	);
}

/** Split `git status --porcelain --ignored` output into tracked changes and
 *  ignored paths (`!!` entries, prefix stripped). */
export function splitStatus(porcelain: string): {
	changes: string[];
	ignored: string[];
} {
	const changes: string[] = [];
	const ignored: string[] = [];
	for (const l of porcelain.split("\n").filter(Boolean)) {
		if (l.startsWith("!!")) ignored.push(l.slice(3));
		else changes.push(l);
	}
	return { changes, ignored };
}

/** repo-relative path → blob sha for every file in `ref`'s tree; null on
 *  failure (shallow or missing ref). */
export function trackedFiles(
	repo: string,
	ref: string,
): Map<string, string> | null {
	const out = tryGit(repo, ["ls-tree", "-r", "-z", ref]);
	if (out === null) return null;
	const m = new Map<string, string>();
	for (const rec of out.split("\0")) {
		const t = rec.indexOf("\t");
		if (t < 0) continue;
		m.set(rec.slice(t + 1), rec.slice(rec.lastIndexOf(" ", t) + 1, t));
	}
	return m;
}

/**
 * True when `root` is provably a checkout remnant: at least one file matches
 * a tracked path AND its blob hash, and every other file is either a tracked
 * name or recognizably regenerable. One matching `.gitignore` surrounded by
 * unrelated files is not evidence. Returns false on a `.git` anywhere inside
 * (foreign repo or live worktree) and on budget exhaustion.
 */
export function isCheckoutRemnant(
	repo: string,
	root: string,
	tracked: ReadonlyMap<string, string>,
	maxEntries = 5000,
): boolean {
	const candidates: [string, string][] = []; // [relpath, abspath]
	const stack = [""];
	let seen = 0;
	while (stack.length) {
		const rel = stack.pop() as string;
		let entries;
		try {
			entries = readdirSync(join(root, rel), { withFileTypes: true });
		} catch {
			continue;
		}
		for (const e of entries) {
			if (++seen > maxEntries) return false;
			if (e.name === ".git") return false;
			const rp = rel ? `${rel}/${e.name}` : e.name;
			if (e.isDirectory()) stack.push(rp);
			else if (tracked.has(rp)) candidates.push([rp, join(root, rp)]);
			else if (!isRegenerableIgnored(rp)) return false; // unexplained file
		}
	}
	if (candidates.length === 0) return false;
	const slice = candidates.slice(0, 200);
	const out = tryGit(
		repo,
		["hash-object", "--stdin-paths"],
		slice.map(([, abs]) => abs).join("\n"),
	);
	if (out === null) return false;
	const hashes = out
		.split("\n")
		.map((s) => s.trim())
		.filter(Boolean);
	if (hashes.length !== slice.length) return false; // cannot align safely
	return slice.some(([rel], i) => tracked.get(rel) === hashes[i]);
}

// ---------- CLI ----------

interface Cli {
	repos: string[];
	yes: boolean;
	debrisDays: number;
	idleDays: number;
	heavy: boolean;
	keepNames: Set<string>;
	log?: string;
}

function parseCli(args: string[]): Cli {
	const cli: Cli = {
		repos: [],
		yes: false,
		debrisDays: 2,
		idleDays: 14,
		heavy: true,
		keepNames: new Set(),
	};
	for (let i = 0; i < args.length; i++) {
		const a = args[i];
		if (a === "--yes") cli.yes = true;
		else if (a === "--no-heavy") cli.heavy = false;
		else if (a === "--repo") cli.repos.push(resolve(args[++i]));
		else if (a === "--keep") cli.keepNames.add(args[++i]);
		else if (a === "--debris-days") cli.debrisDays = Number(args[++i]);
		else if (a === "--idle-days") cli.idleDays = Number(args[++i]);
		else if (a === "--log") cli.log = args[++i];
		else {
			console.error(`worktree-cleanup: unexpected argument "${a}"`);
			process.exit(1);
		}
	}
	if (cli.repos.length === 0) {
		// Default: the checkout this script lives in (devops/.. == repo root).
		cli.repos.push(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
	}
	return cli;
}

function makeLogger(log?: string) {
	return (line: string) => {
		console.log(line);
		if (log) {
			mkdirSync(dirname(log), { recursive: true });
			appendFileSync(log, `${new Date().toISOString()} ${line}\n`);
		}
	};
}

export function sweepableContainer(
	containerDir: string,
	registeredPaths: Set<string>,
	isWorktree: boolean,
): boolean {
	// Never sweep inside a registered worktree (e.g. the main checkout's root),
	// and only sweep bucket dirs: ones that hold several worktrees, or are
	// named like one (bos-wt, hfb-wt, worktrees). This avoids touching dirs
	// like a Temp folder that happened to host a single worktree.
	if (isWorktree) return false;
	let count = 0;
	for (const p of registeredPaths) if (dirname(p) === containerDir) count++;
	return count >= 2 || /-wt$|^worktrees?$/i.test(basename(containerDir));
}

interface RepoReport {
	repo: string;
	removed: string[];
	kept: [string, Disposition][];
	debris: string[];
	pruned: string[];
	errors: string[];
}

function processRepo(repo: string, cli: Cli, log: (s: string) => void): RepoReport {
	const report: RepoReport = {
		repo,
		removed: [],
		kept: [],
		debris: [],
		pruned: [],
		errors: [],
	};
	const fetched = tryGit(repo, ["fetch", "--prune"]) !== null;
	if (!fetched) log(`[${repo}] fetch failed — keeping all worktrees`);

	const porcelain = git(repo, ["worktree", "list", "--porcelain"]);
	const worktrees = parseWorktrees(porcelain);
	const registered = new Set(worktrees.map((w) => resolve(w.path)));
	const mainPath = registered.size ? worktrees[0].path : repo;

	const remoteOut = tryGit(repo, ["branch", "-r", "--format=%(refname:strip=3)"]);
	if (remoteOut === null)
		log(`[${repo}] remote ref listing failed — keeping all worktrees`);
	const remoteBranches = new Set<string>(
		(remoteOut ?? "")
			.split("\n")
			.map((s) => s.trim())
			.filter((b) => b && b !== "HEAD"),
	);

	// Worktree removal requires successful fetch and remote-ref state; the PR
	// check is per-branch below (a failed gh call keeps that worktree too).
	const remoteOk = fetched && remoteOut !== null;

	const defaultRef = (
		tryGit(repo, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]) ??
		"origin/master"
	).trim();
	const now = Date.now();
	const cwd = resolve(process.cwd());
	const benignRe = /^ M app[/\\]\.nuke[/\\]build\.schema\.json$/;

	// A worktree that contains the current cwd (or is the cwd) must survive —
	// deleting it would pull the floor out from under this process. Worktrees
	// under .windsurf/ are session-managed by the IDE — never touch them.
	const isProtectedPath = (p: string) => {
		const rp = resolve(p);
		return (
			cwd === rp ||
			cwd.startsWith(rp + sep) ||
			rp.startsWith(cwd + sep) ||
			/[\\/]\.windsurf[\\/]/.test(rp)
		);
	};

	const containers = new Set<string>();
	for (const wt of worktrees) containers.add(dirname(resolve(wt.path)));

	const hasUpstream = (b: string) =>
		(tryGit(repo, ["config", "--get", `branch.${b}.remote`]) ?? "").trim() !== "";

	for (const wt of worktrees.slice(1)) {
		const wpath = resolve(wt.path);
		if (!existsSync(wpath)) continue; // pruned below
		const { changes, ignored } = splitStatus(
			tryGit(wpath, ["status", "--porcelain", "--ignored"]) ?? "ERROR",
		);
		let disp: Disposition;
		const bp = remoteOk && wt.branch !== null ? branchPr(repo, wt.branch) : null;
		if (!remoteOk || (wt.branch !== null && bp === null)) {
			if (wt.branch !== null && remoteOk && bp === null)
				log(`[${repo}] gh lookup failed for ${wt.branch} — keeping`);
			disp =
				wpath === resolve(mainPath) || isProtectedPath(wpath)
					? "protected"
					: "remote-unknown";
		} else {
			const merged =
				tryGit(wpath, ["merge-base", "--is-ancestor", "HEAD", defaultRef]) !==
				null;
			disp = classify({
				wt,
				isMain: wpath === resolve(mainPath),
				isProtected: isProtectedPath(wpath),
				openPr: bp?.open ?? false,
				remoteDone:
					wt.branch !== null &&
					!remoteBranches.has(wt.branch) &&
					((bp?.closedOids.has(wt.head) ?? false) || hasUpstream(wt.branch)),
				mergedIntoDefault: merged,
				idleBeyondThreshold:
					now - lastActivityMs(wpath) >= cli.idleDays * 86400_000,
				statusLines: changes,
				benignDirtyRe: benignRe,
			});
			if (disp === "remove" && ignored.some((p) => !isRegenerableIgnored(p)))
				disp = "ignored-local";
		}
		if (disp === "remove") {
			if (cli.yes) {
				if (tryGit(repo, ["worktree", "remove", wpath]) === null)
					tryGit(repo, ["worktree", "remove", "--force", wpath]);
				if (existsSync(wpath)) rmrf(wpath);
			}
			report.removed.push(`${wpath} [${wt.branch ?? "detached"}]`);
		} else {
			report.kept.push([wpath, disp]);
		}
	}
	// prune -n in dry-run: dropping stale registrations is a mutation too.
	tryGit(repo, ["worktree", "prune", "-v", ...(cli.yes ? [] : ["-n"])]);

	// Sweep unregistered debris dirs inside worktree bucket dirs — but only
	// empty dirs or dirs provably holding files tracked in the default branch
	// (checkout remnants). Anything else could be an unrelated user folder.
	const trackedSet = trackedFiles(repo, defaultRef);
	for (const dir of containers) {
		if (!existsSync(dir)) continue;
		const isWt = [...registered].some((p) => resolve(p) === dir);
		if (!sweepableContainer(dir, registered, isWt)) continue;
		for (const e of readdirSync(dir, { withFileTypes: true })) {
			if (!e.isDirectory()) continue;
			const child = join(dir, e.name);
			if (cli.keepNames.has(e.name)) continue;
			const rchild = resolve(child);
			if (registered.has(rchild)) continue;
			// A dir that is an ancestor of a registered worktree (nested
			// containers like hfb-wt/hfb-wt) is not debris.
			if ([...registered].some((p) => p.startsWith(rchild + sep))) continue;
			if (existsSync(join(child, ".git"))) continue; // foreign repo, not ours
			const empty = readdirSync(child).length === 0;
			if (!empty) {
				const idleMs = now - newestTopLevelMtime(child);
				const proven =
					trackedSet !== null && isCheckoutRemnant(repo, child, trackedSet);
				if (idleMs < cli.debrisDays * 86400_000 || !proven) continue;
			}
			if (cli.yes) rmrf(child);
			report.debris.push(child);
		}
	}

	// Prune regenerable heavy dirs inside kept, idle worktrees.
	if (cli.heavy) {
		for (const [wpath, disp] of report.kept) {
			if (disp === "protected") continue;
			const idleMs = now - lastActivityMs(wpath);
			if (idleMs < cli.idleDays * 86400_000) continue;
			for (const d of heavyDirs(wpath, 3)) {
				if (isTracked(wpath, d, wpath)) continue;
				if (cli.yes) rmrf(d);
				report.pruned.push(d);
			}
		}
	}
	return report;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
	const cli = parseCli(process.argv.slice(2));
	const log = makeLogger(cli.log);
	log(`worktree-cleanup ${cli.yes ? "APPLY" : "DRY-RUN"} — ${new Date().toISOString()}`);
	for (const repo of cli.repos) {
		try {
			const r = processRepo(repo, cli, log);
			log(
				`[${r.repo}] remove=${r.removed.length} keep=${r.kept.length} debris=${r.debris.length} pruned=${r.pruned.length}`,
			);
			for (const s of r.removed) log(`  - worktree ${s}`);
			for (const s of r.debris) log(`  - debris ${s}`);
			for (const s of r.pruned) log(`  - pruned ${s}`);
			for (const [p, d] of r.kept) log(`  = keep(${d}) ${p}`);
		} catch (e) {
			log(`[${repo}] ERROR: ${(e as Error).message}`);
		}
	}
	if (!cli.yes) log("dry-run — re-run with --yes to apply");
}
