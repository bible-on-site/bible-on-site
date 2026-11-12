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
 * - If `gh` or `git fetch` fails, the script degrades to keeping everything —
 *   it only deletes when it has positive evidence a worktree is done.
 * - A dirty worktree is removed only when every status line is recoverable
 *   (uncommitted deletions of tracked files, or generated churn).
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
	| "detached-unmerged"
	| "stale-fresh"
	| "remove";

interface ClassifyInput {
	wt: WorktreeInfo;
	isMain: boolean;
	isProtected: boolean;
	openPrBranches: Set<string>;
	remoteBranchGone: boolean;
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
	if (wt.branch && input.openPrBranches.has(wt.branch)) return "open-pr";
	const clean = input.statusLines.length === 0;
	const benign = !clean && isBenignDirty(input.statusLines, input.benignDirtyRe);
	if (wt.branch === null) {
		// Detached HEAD: removing orphans the commit — only safe when it is
		// already reachable from the default branch.
		if (input.mergedIntoDefault && (clean || benign)) return "remove";
		return "detached-unmerged";
	}
	if (!clean && !benign) return "real-dirty";
	// Stale = branch deleted on remote (post-merge cleanup), tip already in the
	// default branch, or the checkout simply sat idle past the threshold. A
	// fresh clean worktree on a live un-PR'd branch is left alone.
	if (input.remoteBranchGone || input.mergedIntoDefault || input.idleBeyondThreshold)
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

function tryGit(repo: string, args: string[]): string | null {
	try {
		return execFileSync("git", ["-C", repo, ...args], {
			encoding: "utf8",
			maxBuffer: 64 * 1024 * 1024,
			stdio: ["ignore", "pipe", "ignore"],
		});
	} catch {
		return null;
	}
}

function openPrBranches(repo: string): Set<string> | null {
	try {
		const out = execFileSync(
			"gh",
			[
				"pr",
				"list",
				"--repo",
				repoSlug(repo),
				"--state",
				"open",
				"--limit",
				"400",
				"--json",
				"headRefName",
				"--jq",
				".[].headRefName",
			],
			{ encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
		);
		return new Set(out.split("\n").map((s) => s.trim()).filter(Boolean));
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
	if (!fetched) log(`[${repo}] fetch failed — treating all remote branches as present`);

	const porcelain = git(repo, ["worktree", "list", "--porcelain"]);
	const worktrees = parseWorktrees(porcelain);
	const registered = new Set(worktrees.map((w) => resolve(w.path)));
	const mainPath = registered.size ? worktrees[0].path : repo;

	const openPrs = openPrBranches(repo);
	if (openPrs === null) log(`[${repo}] gh unavailable — treating all branches as open PRs`);

	const remoteBranches = new Set<string>(
		(tryGit(repo, ["branch", "-r", "--format=%(refname:strip=3)"]) ?? "")
			.split("\n")
			.map((s) => s.trim())
			.filter((b) => b && b !== "HEAD"),
	);

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

	for (const wt of worktrees.slice(1)) {
		const wpath = resolve(wt.path);
		if (!existsSync(wpath)) continue; // pruned below
		const status = tryGit(wpath, ["status", "--porcelain"]) ?? "ERROR";
		const statusLines = status.split("\n").filter(Boolean);
		const merged =
			tryGit(wpath, ["merge-base", "--is-ancestor", "HEAD", defaultRef]) !== null;
		const disp = classify({
			wt,
			isMain: wpath === resolve(mainPath),
			isProtected: isProtectedPath(wpath),
			openPrBranches: openPrs ?? new Set(wt.branch ? [wt.branch] : []),
			remoteBranchGone: wt.branch !== null && !remoteBranches.has(wt.branch),
			mergedIntoDefault: merged,
			idleBeyondThreshold:
				now - newestTopLevelMtime(wpath) >= cli.debrisDays * 86400_000,
			statusLines: status === "ERROR" ? ["?"] : statusLines,
			benignDirtyRe: benignRe,
		});
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
	tryGit(repo, ["worktree", "prune", "-v"]);

	// Sweep unregistered debris dirs inside worktree bucket dirs.
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
			const idleMs = now - newestTopLevelMtime(child);
			const empty = readdirSync(child).length === 0;
			if (!empty && idleMs < cli.debrisDays * 86400_000) continue;
			if (cli.yes) rmrf(child);
			report.debris.push(child);
		}
	}

	// Prune regenerable heavy dirs inside kept, idle worktrees.
	if (cli.heavy) {
		for (const [wpath, disp] of report.kept) {
			if (disp === "protected") continue;
			const idleMs = now - newestTopLevelMtime(wpath);
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
