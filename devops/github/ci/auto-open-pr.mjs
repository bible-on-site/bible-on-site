import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const shaPattern = /^[a-f0-9]{40}$/;

export function pushTarget(event) {
	if (event.deleted || event.forced) return null;
	const repository = event.repository?.full_name;
	const base = event.repository?.default_branch;
	if (
		!/^[-\w.]+\/[-\w.]+$/.test(repository ?? "") ||
		!base ||
		!event.ref?.startsWith("refs/heads/") ||
		!shaPattern.test(event.after ?? "")
	) {
		throw new Error("Invalid branch push payload");
	}
	const head = event.ref.slice("refs/heads/".length);
	if (
		head === base ||
		/^(gh-readonly-queue|dependabot|renovate|artifacts)\//.test(head) ||
		/(?:^|[-/])(evidence|screenshots)(?:[-/]|$)/i.test(head)
	) {
		return null;
	}
	return { repository, base, head, sha: event.after };
}

export function targetIssues(head) {
	const devin = head.startsWith("devin/");
	if (!devin) {
		const issue = /^(?:issue|feat|fix)\/(\d+)(?:-|$)/.exec(head);
		return { devin, numbers: issue ? [Number(issue[1])] : [] };
	}
	const name = head.slice("devin/".length).replace(/^\d{8,}-/, "");
	// Match an issue identifier, never every numeric token (e.g. revision -2).
	const issue =
		/(?:^|-)issue-(\d+)(?:-|$)/.exec(name) ??
		/^(\d+)(?:-|$)/.exec(name) ??
		/^[a-z][a-z0-9-]*-(\d{3,6})(?:-(?:v|r)?\d{1,2})?$/.exec(name);
	return { devin, numbers: issue ? [Number(issue[1])] : [] };
}

function command(executable, args, input) {
	return execFileSync(executable, args, {
		encoding: "utf8",
		input,
		stdio: ["pipe", "pipe", "pipe"],
	});
}

/** Inspect only Git objects; pushed source is never checked out or executed. */
export function describeChanges(base, head, git) {
	const paths = git(["diff", "--name-only", `${base}...${head}`]).trim();
	if (!paths) return null;
	const commits = git([
		"log",
		"--cherry-pick",
		"--right-only",
		"--no-merges",
		"--reverse",
		"--format=%s",
		`${base}...${head}`,
	])
		.trim()
		.split("\n")
		.filter(Boolean);
	if (!commits.length) return null;
	const tipBody = git(["log", "-1", "--format=%b", head]).trim();
	return {
		title: commits[0].slice(0, 256),
		body: `${tipBody}\n\nChanges in this branch:\n${commits.map((s) => `- ${s}`).join("\n")}`.trim(),
	};
}

export function openPullRequest(
	event,
	{
		gh = (args, input) => command("gh", args, input),
		git = (args) => command("git", args),
		log = console.log,
	} = {},
) {
	const target = pushTarget(event);
	const skip = (reason) => {
		log(`Skipping automatic PR: ${reason}`);
		return { created: false, reason };
	};
	if (!target) return skip("push is not eligible");
	const { repository, base, head, sha } = target;
	const json = (args) => JSON.parse(gh(args));
	const history = () =>
		json([
			"pr",
			"list",
			"--repo",
			repository,
			"--state",
			"all",
			"--head",
			head,
			"--limit",
			"1",
			"--json",
			"number",
		]);
	// A prior closed/merged PR owns the branch even after a history rewrite.
	// Intentional follow-ups use a new branch or an explicitly opened PR.
	const alreadyOwned = () => {
		const prs = history();
		if (!Array.isArray(prs)) throw new Error("Invalid PR history response");
		return prs.length > 0;
	};
	if (alreadyOwned()) return skip("branch already has PR history");
	const isCurrent = () => {
		let branch;
		try {
			branch = json([
				"api",
				`repos/${repository}/branches/${encodeURIComponent(head)}`,
			]);
		} catch (error) {
			if (/\bHTTP 404\b/.test(String(error.stderr))) return false;
			throw error;
		}
		if (!shaPattern.test(branch?.commit?.sha ?? "")) {
			throw new Error("Invalid branch response");
		}
		return branch.commit.sha === sha;
	};
	if (!isCurrent()) return skip("branch was deleted or its head changed");
	const { devin, numbers } = targetIssues(head);
	if (devin && !numbers.length) {
		return skip("Devin branch does not identify a backlog issue");
	}
	for (const number of numbers) {
		const issue = json(["api", `repos/${repository}/issues/${number}`]);
		if (issue.pull_request || issue.state !== "open") {
			return skip(`target #${number} is not an open issue`);
		}
		if (
			devin &&
			!issue.labels?.some((label) => label.name === "Devin Backlog")
		) {
			return skip(`target #${number} is outside Devin Backlog`);
		}
	}
	git(["fetch", "--no-tags", "origin", sha]);
	const baseSha = git(["rev-parse", "HEAD"]).trim();
	if (!shaPattern.test(baseSha)) throw new Error("Invalid default-branch HEAD");
	const description = describeChanges(baseSha, sha, git);
	if (!description) return skip("no new non-merge patch with a file diff");
	// Recheck after fetching; do not create for a stale queued push or a racing PR.
	if (!isCurrent() || alreadyOwned()) return skip("push was superseded");
	try {
		gh(
			[
				"pr",
				"create",
				"--repo",
				repository,
				"--base",
				base,
				"--head",
				head,
				"--title",
				description.title,
				"--body-file",
				"-",
			],
			description.body,
		);
	} catch (error) {
		if (alreadyOwned()) return skip("another run created the PR");
		throw error;
	}
	log(`Opened PR for ${head} at ${sha}`);
	return { created: true };
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	openPullRequest(
		JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8")),
	);
}
