#!/usr/bin/env node
/**
 * Generates module-scoped release notes for the shared release flow.
 *
 * Commit scope mirrors `module_changed` in ci/determine-changes.ts: the module
 * directory plus any extra module paths. A commit touching several modules is
 * therefore listed in every affected module's notes. Changes to shared CI-only
 * tooling never trigger a module release, so they stay out of the notes too.
 *
 * Usage:
 *   node release-notes.mjs --generate --module app --tag app-v1.2.3 \
 *     --directory app --extras '["data/recitation/recitation.sqlite"]' \
 *     --out notes.md
 *   node release-notes.mjs --testflight app-v1.2.3 > changelog.txt
 *
 * `--generate` requires a full-history checkout (tags included) plus
 * GH_TOKEN and GITHUB_REPOSITORY for commit → pull request lookups.
 * `--testflight` renders the "What's Changed" section of a published release
 * body as plain text for App Store Connect (4,000 character limit).
 */

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const MAX_COMMITS = 100;
export const TESTFLIGHT_LIMIT = 4000;

const LABEL_SECTIONS = {
	enhancement: "features",
	bug: "fixes",
	performance: "performance",
	security: "security",
	dependencies: "dependencies",
	documentation: "documentation",
};
const PREFIX_SECTIONS = {
	feat: "features",
	fix: "fixes",
	revert: "fixes",
	perf: "performance",
	docs: "documentation",
	chore: "maintenance",
	refactor: "maintenance",
	test: "maintenance",
	ci: "maintenance",
	build: "maintenance",
	style: "maintenance",
};
const SECTION_TITLES = {
	features: "New Features",
	fixes: "Bug Fixes",
	performance: "Performance",
	security: "Security",
	dependencies: "Dependencies",
	documentation: "Documentation",
	maintenance: "Maintenance",
	other: "Other Changes",
};
const SECTION_ORDER = [
	"features",
	"fixes",
	"performance",
	"security",
	"dependencies",
	"documentation",
	"maintenance",
	"other",
];

const runGit = (args, cwd) =>
	execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		maxBuffer: 32 * 1024 * 1024,
	}).trim();

const ghApi = (endpoint) =>
	JSON.parse(
		execFileSync("gh", ["api", endpoint], {
			encoding: "utf8",
			maxBuffer: 16 * 1024 * 1024,
		}),
	);

/** Module release tags sorted newest-first by semantic version. */
export function moduleTags(tagPrefix, git = runGit) {
	const out = git(["tag", "-l", `${tagPrefix}*`, "--sort=-v:refname"]);
	return out ? out.split("\n").filter(Boolean) : [];
}

/**
 * The previous release of the same module: the newest tag other than the one
 * being published. Skipped versions are covered automatically because the
 * commit range always starts at the latest older tag.
 */
export function previousTag(tags, currentTag) {
	return tags.find((tag) => tag !== currentTag) ?? null;
}

/**
 * Commits reachable from HEAD but not `base` that touched `paths`,
 * newest-first. A null base (first release) covers the full history.
 */
export function rangeCommits(base, paths, git = runGit) {
	const out = git([
		"log",
		"--no-merges",
		"--format=%H%x1f%s",
		base ? `${base}..HEAD` : "HEAD",
		"--",
		...paths,
	]);
	if (!out) return [];
	return out.split("\n").map((line) => {
		const [sha, subject] = line.split("\x1f");
		return { sha, subject };
	});
}

/** The pull request that introduced a commit, or null for direct pushes. */
export function associatedPull(repo, sha, api = ghApi) {
	let pulls;
	try {
		pulls = api(`repos/${repo}/commits/${sha}/pulls`);
	} catch (error) {
		console.warn(`PR lookup failed for ${sha}: ${error.message}`);
		return null;
	}
	if (!Array.isArray(pulls)) return null;
	return pulls.find((pr) => pr.merged_at) ?? pulls[0] ?? null;
}

/**
 * Labels win; conventional-commit prefixes cover unlabeled pull requests.
 * Direct pushes have no labels, so their subject takes the title's place.
 */
export function categorize({ labels = [], title = "", subject = "" }) {
	for (const { name } of labels) {
		const section = LABEL_SECTIONS[name];
		if (section) return section;
	}
	const prefix = /^([a-z]+)(?:\([^)]*\))?!?:/i
		.exec(title || subject)?.[1]
		?.toLowerCase();
	return (prefix && PREFIX_SECTIONS[prefix]) || "other";
}

/** Bot-pushed version bumps are release plumbing, not module changes. */
const SKIP_SUBJECTS = /^chore\(release\): Bump versions\b/;

/**
 * Turns scoped commits into note entries: one line per unique pull request,
 * with linked commits as the auditable fallback for direct pushes.
 */
export function collectEntries({ repo, commits, api = ghApi }) {
	const seenPulls = new Set();
	const entries = [];
	const scoped = commits.filter(
		(commit) => !SKIP_SUBJECTS.test(commit.subject),
	);
	for (const commit of scoped.slice(0, MAX_COMMITS)) {
		const pr = associatedPull(repo, commit.sha, api);
		if (pr) {
			if (seenPulls.has(pr.number)) continue;
			seenPulls.add(pr.number);
			entries.push({
				kind: "pr",
				section: categorize(pr),
				number: pr.number,
				title: pr.title,
				author: pr.user?.login,
			});
		} else {
			entries.push({
				kind: "commit",
				section: categorize(commit),
				sha: commit.sha,
				subject: commit.subject,
			});
		}
	}
	return { entries, overflow: Math.max(0, scoped.length - MAX_COMMITS) };
}

export function renderNotes({ repo, tag, prevTag, entries, overflow = 0 }) {
	const lines = ["## What's Changed", ""];
	const grouped = new Map(SECTION_ORDER.map((key) => [key, []]));
	for (const entry of entries) grouped.get(entry.section).push(entry);
	for (const key of SECTION_ORDER) {
		const group = grouped.get(key);
		if (!group.length) continue;
		lines.push(`### ${SECTION_TITLES[key]}`, "");
		for (const entry of group) {
			if (entry.kind === "pr") {
				const by = entry.author ? ` by @${entry.author}` : "";
				lines.push(
					`* ${entry.title}${by} in https://github.com/${repo}/pull/${entry.number}`,
				);
			} else {
				lines.push(
					`* ${entry.subject} in https://github.com/${repo}/commit/${entry.sha}`,
				);
			}
		}
		lines.push("");
	}
	if (overflow > 0) lines.push(`* ...and ${overflow} earlier commits`, "");
	if (!entries.length) {
		lines.push(
			`* No changes scoped to this module${prevTag ? ` since ${prevTag}` : ""}.`,
			"",
		);
	}
	const compare = prevTag
		? `compare/${prevTag}...${tag}`
		: `commits/${tag}`;
	lines.push(`**Full Changelog**: https://github.com/${repo}/${compare}`);
	return lines.join("\n");
}

export function generateNotes({
	repo,
	moduleName,
	tag,
	directory,
	extraPaths = [],
	git = runGit,
	api = ghApi,
}) {
	const prevTag = previousTag(moduleTags(`${moduleName}-v`, git), tag);
	const commits = rangeCommits(prevTag, [directory, ...extraPaths], git);
	const { entries, overflow } = collectEntries({ repo, commits, api });
	return renderNotes({ repo, tag, prevTag, entries, overflow });
}

/** Extracts and flattens "What's Changed" for TestFlight's What to Test. */
export function renderTestFlightNotes(body, tag, limit = TESTFLIGHT_LIMIT) {
	const version = tag.includes("-v") ? `v${tag.split("-v").pop()}` : tag;
	const section = /## What's Changed\n([\s\S]*?)(?=\n## |\n\*\*Full Changelog|\n<!-- |$)/
		.exec(body ?? "")?.[1]
		?.trim();
	if (!section) return `Automated build ${version}`;
	const notes = section
		.split("\n")
		.map((line) => {
			const heading = /^###\s+(.*)/.exec(line);
			if (heading) return `${heading[1]}:`;
			const bullet = /^\*\s+(.*)/.exec(line);
			if (!bullet) return null;
			const text = bullet[1]
				.replace(/\s+by @\S+ in https?:\S+$/, "")
				.replace(/\s+in https?:\S+$/, "")
				.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
			return `• ${text}`;
		})
		.filter(Boolean)
		.join("\n");
	if (notes.length <= limit) return notes;
	return `${notes.slice(0, limit - 1).replace(/\n[^\n]*$/, "")}\n…`;
}

function parseArgs(argv) {
	const args = {};
	for (let i = 0; i < argv.length; i++) {
		if (!argv[i].startsWith("--")) continue;
		// A `--flag` followed by another option is a boolean, not a value pair.
		args[argv[i].slice(2)] =
			i + 1 < argv.length && !argv[i + 1].startsWith("--")
				? argv[++i]
				: "true";
	}
	return args;
}

if (
	process.argv[1] &&
	path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	const args = parseArgs(process.argv.slice(2));
	const repo = process.env.GITHUB_REPOSITORY;
	if (!repo) throw new Error("GITHUB_REPOSITORY is required");
	if (args.testflight) {
		const release = ghApi(
			`repos/${repo}/releases/tags/${args.testflight}`,
		);
		console.log(renderTestFlightNotes(release.body, args.testflight));
	} else {
		for (const required of ["module", "tag", "directory"]) {
			if (!args[required]) throw new Error(`--${required} is required`);
		}
		const extraPaths = JSON.parse(args.extras ?? "[]");
		if (
			!Array.isArray(extraPaths) ||
			!extraPaths.every((item) => typeof item === "string")
		)
			throw new Error("--extras must be a JSON array of paths");
		const notes = generateNotes({
			repo,
			moduleName: args.module,
			tag: args.tag,
			directory: args.directory,
			extraPaths,
		});
		if (args.out) writeFileSync(args.out, `${notes}\n`);
		else console.log(notes);
	}
}
