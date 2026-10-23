#!/usr/bin/env node
/**
 * Collects every review thread with activity inside an audit window and writes
 * a reproducible JSON inventory (issue #2114). Re-runnable: the window bounds
 * are arguments, the output embeds the exact UTC cutoff used.
 *
 * Usage:
 *   node devops/review-audit/collect-review-findings.mjs \
 *     --since 2026-09-23 --until 2026-10-23 \
 *     --out devops/review-audit/findings-2026-09-23_2026-10-23.json
 *
 * Data source: gh api graphql — pullRequests ordered by UPDATED_AT (a review
 * comment bumps updatedAt, so the updated filter is a superset of the PRs
 * with review activity in the window), then per-PR reviewThreads with their
 * comments. Threads whose only comments predate the window are dropped; the
 * window filter is applied on comment createdAt, never on PR creation date.
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const args = Object.fromEntries(
	process.argv
		.slice(2)
		.map((a, i, arr) => (a.startsWith("--") ? [a.slice(2), arr[i + 1]] : null))
		.filter(Boolean),
);
const since = `${args.since}T00:00:00Z`;
// Exclusive upper bound: timestamps carry fractional seconds, so the
// window ends at the following midnight rather than 23:59:59Z.
const untilDate = new Date(`${args.until}T00:00:00Z`);
untilDate.setUTCDate(untilDate.getUTCDate() + 1);
const until = untilDate.toISOString();
const out = args.out;
if (!args.since || !args.until || !out) {
	console.error("usage: collect-review-findings.mjs --since YYYY-MM-DD --until YYYY-MM-DD --out file.json");
	process.exit(2);
}

const QUERY = `
query($cursor: String) {
  repository(owner: "bible-on-site", name: "bible-on-site") {
    pullRequests(first: 30, after: $cursor, orderBy: {field: UPDATED_AT, direction: DESC}) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number
        title
        state
        isDraft
        updatedAt
        reviewThreads(first: 100) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            isResolved
            isOutdated
            isCollapsed
            path
            line
            resolvedBy { login }
            comments(first: 100) {
              pageInfo { hasNextPage endCursor }
              nodes {
                databaseId
                createdAt
                author { login __typename }
                authorAssociation
                body
                path
                diffHunk
                url
              }
            }
          }
        }
        reviews(first: 100) {
          nodes {
            createdAt
            state
            author { login __typename }
            body
            url
          }
        }
      }
    }
  }
  rateLimit { remaining cost }
}`;

function gql(query, variables) {
	const stdout = execFileSync(
		"gh",
		[
			"api",
			"graphql",
			"-f",
			`query=${query}`,
			...Object.entries(variables).flatMap(([k, v]) => ["-F", `${k}=${v}`]),
		],
		{ maxBuffer: 64 * 1024 * 1024, encoding: "utf8" },
	);
	return JSON.parse(stdout).data;
}

const THREAD_PAGE = `
query($pr: Int!, $cursor: String!) {
  repository(owner: "bible-on-site", name: "bible-on-site") {
    pullRequest(number: $pr) {
      reviewThreads(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          isResolved isOutdated isCollapsed path line
          resolvedBy { login }
          comments(first: 100) {
            pageInfo { hasNextPage endCursor }
            nodes {
              databaseId createdAt author { login __typename }
              authorAssociation body path diffHunk url
            }
          }
        }
      }
    }
  }
}`;

const COMMENT_PAGE = `
query($thread: ID!, $cursor: String!) {
  node(id: $thread) {
    ... on PullRequestReviewThread {
      comments(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          databaseId createdAt author { login __typename }
          authorAssociation body path diffHunk url
        }
      }
    }
  }
}`;

const prs = [];
let cursor = "null";
for (;;) {
	const data = gql(QUERY, cursor === "null" ? {} : { cursor });
	const page = data.repository.pullRequests;
	for (const pr of page.nodes) if (pr.updatedAt >= since) prs.push(pr);
	if (!page.pageInfo.hasNextPage || page.nodes.at(-1).updatedAt < since) break;
	cursor = page.pageInfo.endCursor;
}
console.log(`${prs.length} PRs updated since ${since}`);

// Page deep reviewThreads / comments where the first page truncated.
for (const pr of prs) {
	let tCursor = pr.reviewThreads.pageInfo.endCursor || null;
	while (pr.reviewThreads.pageInfo.hasNextPage) {
		const d = gql(THREAD_PAGE, { pr: pr.number, cursor: tCursor });
		const rt = d.repository.pullRequest.reviewThreads;
		pr.reviewThreads.nodes.push(...rt.nodes);
		tCursor = rt.pageInfo.endCursor;
		pr.reviewThreads.pageInfo = rt.pageInfo;
	}
	for (const t of pr.reviewThreads.nodes) {
		let cCursor = t.comments.pageInfo?.endCursor || null;
		while (t.comments.pageInfo?.hasNextPage) {
			const d = gql(COMMENT_PAGE, { thread: t.id, cursor: cCursor });
			const c = d.node.comments;
			t.comments.nodes.push(...c.nodes);
			cCursor = c.pageInfo.endCursor;
			t.comments.pageInfo = c.pageInfo;
		}
	}
}

// Window filter on comment/review createdAt; keep threads with ≥1 in-window comment.
const inventory = [];
for (const pr of prs) {
	const threads = pr.reviewThreads.nodes
		.map((t) => ({
			...t,
			// In-window replies to a pre-window finding would otherwise
			// lose the finding they discuss — keep the thread's root
			// comment alongside the filtered set.
			originalComment: t.comments.nodes[0] ?? null,
			comments: t.comments.nodes.filter(
				(c) => c.createdAt >= since && c.createdAt < until,
			),
		}))
		.filter((t) => t.comments.length > 0);
	const reviews = (pr.reviews?.nodes || []).filter(
		(r) => r.createdAt >= since && r.createdAt < until && r.body?.trim(),
	);
	if (threads.length === 0 && reviews.length === 0) continue;
	inventory.push({
		pr: pr.number,
		title: pr.title,
		state: pr.state,
		isDraft: pr.isDraft,
		threads,
		reviews,
	});
}

writeFileSync(
	out,
	JSON.stringify(
		{
			window: { since, until, collectedAt: new Date().toISOString() },
			prsScanned: prs.length,
			prsWithActivity: inventory.length,
			inventory,
		},
		null,
		1,
	),
);
console.log(
	`wrote ${out}: ${inventory.length} PRs with in-window review activity`,
);
