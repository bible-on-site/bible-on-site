import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cancelMergedRuns, GitHubCliApi, main } from "./cancel-merged-pr-runs.mjs";
import { POLICY } from "./reap-obsolete-merge-groups.mjs";

const sha = character => character.repeat(40);
const repo = () => ({ id: POLICY.repositoryId, full_name: POLICY.repository });
const association = number => ({ number, base: { repo: repo() } });
const run = (id = 1, event = "merge_group") => ({ id, workflow_id: 100 + id, event,
  repository: repo(), head_repository: repo(), head_sha: sha("a"), status: "queued", conclusion: null,
  head_branch: event === "merge_group" ? `gh-readonly-queue/master/pr-10-${sha("b")}` : "feature",
  pull_requests: [association(10)] });
function fixture(runs = [run()]) {
  const state = { runs: structuredClone(runs), cancels: [], journal: [], open: new Set(), queue: [] };
  const api = {
    async listRuns(event, status) { return structuredClone(state.runs.filter(r => r.event === event && r.status === status)); },
    async getRun(id) { return structuredClone(state.runs.find(r => r.id === id)); },
    async getPullRequest(number) { return { number, base: { repo: repo() },
      state: state.open.has(number) ? "open" : "closed", merged: !state.open.has(number),
      merged_at: state.open.has(number) ? null : "2026-11-18T09:50:00Z" }; },
    async getCommitPullRequests() { return []; },
    async getQueue() { return { data: { repository: { databaseId: POLICY.repositoryId,
      nameWithOwner: POLICY.repository, defaultBranchRef: { target: { oid: sha("f") } },
      mergeQueue: { entries: { totalCount: state.queue.length, pageInfo: { hasNextPage: false }, nodes: structuredClone(state.queue) } } } } }; },
    async cancelRun(id) { state.cancels.push(id); Object.assign(state.runs.find(r => r.id === id), { status: "completed", conclusion: "cancelled" }); },
  };
  return { state, api, journal: async value => state.journal.push(value) };
}
const execute = (f, options = {}) => cancelMergedRuns({ api: f.api, journal: f.journal, ...options });
const queueNode = (head, base) => ({ position: 1, state: "AWAITING_CHECKS", headCommit: { oid: head },
  baseCommit: { oid: base }, pullRequest: { number: 20, headRefOid: sha("e") } });

test("cancels all merged queue workflows, PR validation and native PR quality runs", async () => {
  const rows = [run(), run(2), run(3, "pull_request"), { ...run(4, "dynamic"), head_branch: "refs/pull/10/head" }];
  const f = fixture(rows);
  f.api.cancelRun = async id => {
    assert.equal(f.state.journal.at(-1).kind, "cancel-intent");
    f.state.cancels.push(id);
    Object.assign(f.state.runs.find(r => r.id === id), { status: "completed", conclusion: "cancelled" });
  };
  const report = await execute(f, { dryRun: false });
  assert.equal(report.actions.length, 4);
  assert.deepEqual(f.state.cancels, [3, 1, 2, 4]);
  assert.equal(f.state.journal.filter(j => j.kind === "cancel-observed").length, 4);
});

test("dry-run is mutation free and handles a backlog larger than one page", async () => {
  const f = fixture(Array.from({ length: 109 }, (_, i) => run(i + 1)));
  const report = await execute(f);
  assert.equal(report.actions.length, 109);
  assert.ok(report.actions.every(a => a.outcome === "would-cancel"));
  assert.deepEqual(f.state.cancels, []);
  assert.deepEqual(f.state.journal, []);
});

test("keeps open PRs, merely closed PRs and master/deployment runs", async () => {
  const f = fixture([run(), run(2, "pull_request"), run(3, "push"), run(4, "workflow_dispatch"),
    { ...run(5, "dynamic"), head_branch: "master" }, { ...run(6), head_branch: "unknown-queue" }]);
  f.state.open.add(10);
  assert.deepEqual((await execute(f, { dryRun: false })).actions, []);
  f.state.open.clear();
  const read = f.api.getPullRequest;
  f.api.getPullRequest = async number => ({ ...await read(number), merged: false, merged_at: null });
  assert.deepEqual((await execute(f, { dryRun: false })).actions, []);
  assert.deepEqual(f.state.cancels, []);
});

test("a shared PR run is retained while any associated PR remains open", async () => {
  const f = fixture([{ ...run(1, "pull_request"), pull_requests: [association(10), association(20)] }]);
  f.state.open.add(20);
  assert.deepEqual((await execute(f, { dryRun: false })).actions, []);
});

test("unknown or foreign PR associations never imply a merged PR", async () => {
  for (const values of [undefined, [], [{ number: 0 }], [association(0)], [{ number: 10, base: { repo: { id: 123 } } }]]) {
    const f = fixture([{ ...run(1, "pull_request"), pull_requests: values }]);
    assert.deepEqual((await execute(f, { dryRun: false })).actions, []);
  }
  for (const branch of ["refs/pull/0/head", "refs/pull/9007199254740992/head", "refs/pull/10/other"]) {
    const f = fixture([{ ...run(1, "dynamic"), head_branch: branch }]);
    assert.deepEqual((await execute(f, { dryRun: false })).actions, []);
  }
});

test("recovers merged PR associations cleared from workflow metadata by GitHub", async () => {
  const f = fixture([{ ...run(1, "pull_request"), pull_requests: [] }]);
  f.api.getCommitPullRequests = async head => {
    assert.equal(head, sha("a"));
    return [{ ...association(10), head: { ref: "feature", sha: sha("d"), repo: repo() } }];
  };
  await execute(f, { dryRun: false });
  assert.deepEqual(f.state.cancels, [1]);
  for (const change of [pr => { pr.head.ref = "reused-branch"; }, pr => { pr.head.repo.id++; },
    pr => { pr.head = null; }, pr => { pr.base.repo.id++; }]) {
    const g = fixture([{ ...run(1, "pull_request"), pull_requests: [] }]);
    g.api.getCommitPullRequests = async () => {
      const pr = { ...association(10), head: { ref: "feature", repo: repo() } }; change(pr); return [pr];
    };
    assert.deepEqual((await execute(g, { dryRun: false })).actions, []);
  }
});

test("preserves current master, live queue heads and live queue bases", async () => {
  for (const protectedBy of ["master", "head", "base"]) {
    const f = fixture();
    if (protectedBy === "master") f.state.runs[0].head_sha = sha("f");
    else f.state.queue = [queueNode(protectedBy === "head" ? sha("a") : sha("b"), protectedBy === "base" ? sha("a") : sha("c"))];
    assert.deepEqual((await execute(f, { dryRun: false })).actions, []);
    assert.deepEqual(f.state.cancels, []);
  }
});

test("a newly protected base at the final queue read prevents cancellation", async () => {
  const f = fixture();
  const read = f.api.getQueue;
  let calls = 0;
  f.api.getQueue = async () => { if (++calls === 2) f.state.queue = [queueNode(sha("c"), sha("a"))]; return read(); };
  assert.deepEqual((await execute(f, { dryRun: false })).actions, []);
});

test("incomplete, malformed and unauthorized queue snapshots fail before a mutation", async () => {
  for (const breakQueue of [
    r => { r.errors = [{ message: "denied" }]; },
    r => { r.data.repository.databaseId++; },
    r => { r.data.repository.defaultBranchRef.target.oid = "bad"; },
    r => { r.data.repository.mergeQueue.entries.pageInfo.hasNextPage = true; },
    r => { r.data.repository.mergeQueue.entries.totalCount = 1; },
  ]) {
    const f = fixture(); const read = f.api.getQueue;
    f.api.getQueue = async () => { const result = await read(); breakQueue(result); return result; };
    await assert.rejects(execute(f, { dryRun: false })); assert.deepEqual(f.state.cancels, []);
  }
});

test("run and PR identity changes fail closed", async () => {
  for (const change of [r => { r.repository.id++; }, r => { r.workflow_id = 0; },
    r => { r.head_sha = "bad"; }, r => { r.head_repository.id = 0; }]) {
    const f = fixture(); change(f.state.runs[0]);
    await assert.rejects(execute(f, { dryRun: false }), /identity/); assert.deepEqual(f.state.cancels, []);
  }
  const f = fixture(); const read = f.api.getRun;
  f.api.getRun = async id => ({ ...await read(id), head_sha: sha("d") });
  await assert.rejects(execute(f, { dryRun: false }), /identity changed/);
  const g = fixture(); g.api.getPullRequest = async () => ({ number: 11, base: { repo: repo() }, state: "closed" });
  await assert.rejects(execute(g, { dryRun: false }), /PR identity/);
});

test("deduplicates listing races but rejects a changed duplicate", async () => {
  for (const changed of [false, true]) {
    const f = fixture(); const read = f.api.listRuns;
    f.api.listRuns = async (event, status) => event === "merge_group" && status === "in_progress"
      ? [{ ...run(), ...(changed ? { head_sha: sha("d") } : {}) }] : read(event, status);
    if (changed) await assert.rejects(execute(f), /changed while listing/);
    else assert.equal((await execute(f)).actions.length, 1);
  }
});

test("completed runs and runs with changed PR associations are never cancelled", async () => {
  const f = fixture(); const read = f.api.getRun;
  f.api.getRun = async id => ({ ...await read(id), status: "completed" });
  assert.deepEqual((await execute(f, { dryRun: false })).actions, []);
  const g = fixture([run(1, "pull_request")]); const get = g.api.getRun;
  g.api.getRun = async id => ({ ...await get(id), pull_requests: [association(20)] });
  await assert.rejects(execute(g, { dryRun: false }), /identity changed/);
});

test("missing/failed journal prevents cancellation", async () => {
  for (const journal of [undefined, async () => { throw new Error("disk full"); }]) {
    const f = fixture(); await assert.rejects(execute(f, { dryRun: false, journal }));
    assert.deepEqual(f.state.cancels, []);
  }
});

test("one cancellation attempt is reconciled, including completion and ambiguous failures", async () => {
  for (const completes of [true, false]) {
    const f = fixture();
    f.api.cancelRun = async id => {
      f.state.cancels.push(id);
      if (completes) Object.assign(f.state.runs[0], { status: "completed", conclusion: "success" });
      throw new Error("uncertain cancellation");
    };
    if (completes) assert.equal((await execute(f, { dryRun: false })).actions[0].conclusion, "success");
    else await assert.rejects(execute(f, { dryRun: false }), /uncertain cancellation/);
    assert.deepEqual(f.state.cancels, [1]);
    assert.equal(f.state.journal.at(-1).requestAccepted, false);
  }
  const f = fixture(); f.api.cancelRun = async id => f.state.cancels.push(id);
  assert.equal((await execute(f, { dryRun: false })).actions[0].outcome, "cancellation-requested");
  const g = fixture(); const read = g.api.getRun; let calls = 0;
  g.api.getRun = async id => ({ ...await read(id), ...(++calls === 2 ? { head_sha: sha("d") } : {}) });
  await assert.rejects(execute(g, { dryRun: false }), /Reconciliation identity/);
});

test("CLI adapter paginates and refuses truncated run inventories", async () => {
  const calls = [];
  const api = new GitHubCliApi((command, args, options) => {
    calls.push({ command, args, options });
    return JSON.stringify([{ total_count: 2, workflow_runs: [run()] }, { total_count: 2, workflow_runs: [run(2)] }]);
  });
  assert.equal((await api.listRuns("merge_group", "queued")).length, 2);
  assert.ok(calls[0].args.includes("--paginate")); assert.ok(calls[0].args.includes("--slurp"));
  assert.equal(calls[0].options.timeout, POLICY.requestTimeoutMs);
  await assert.rejects(api.listRuns("push", "queued"), /Invalid run filter/);
  for (const pages of [null, [], [{}], [{ total_count: 101, workflow_runs: [run()] }]]) {
    const broken = new GitHubCliApi(() => JSON.stringify(pages));
    await assert.rejects(broken.listRuns("pull_request", "queued"), /run pages/);
  }
});

test("CLI adapter uses fixed repository endpoints and one normal cancel POST", async () => {
  const calls = [];
  const api = new GitHubCliApi((command, args, options) => { calls.push({ command, args, options }); return ""; });
  await api.getRun(1); await api.getPullRequest(10); await api.getQueue(); await api.cancelRun(1);
  assert.equal(calls.length, 4);
  assert.equal(calls[0].args[1], `repos/${POLICY.repository}/actions/runs/1`);
  assert.ok(calls[2].args.includes("--input")); assert.ok(calls[2].options.input.includes("mergeQueue"));
  assert.deepEqual(calls[3].args.slice(-2), ["--method", "POST"]);
});

test("commit-to-PR lookup is paginated without guessing branch ownership", async () => {
  const api = new GitHubCliApi((command, args) => {
    assert.ok(args[1].includes(`/commits/${sha("a")}/pulls?per_page=100`));
    assert.ok(args.includes("--paginate"));
    return JSON.stringify([[association(10)], [association(20)]]);
  });
  assert.deepEqual((await api.getCommitPullRequests(sha("a"))).map(pr => pr.number), [10, 20]);
  await assert.rejects(api.getCommitPullRequests("invalid"), /commit identity/);
  for (const pages of [null, [], [{}]]) {
    await assert.rejects(new GitHubCliApi(() => JSON.stringify(pages)).getCommitPullRequests(sha("a")), /commit PR pages/);
  }
});

test("trusted event entrypoint saves proof and rejects candidate execution contexts", async () => {
  const dir = await mkdtemp(join(tmpdir(), "merged-run-cleanup-"));
  try {
    const eventPath = join(dir, "event.json");
    const env = { GITHUB_REPOSITORY: POLICY.repository, GITHUB_REF: "refs/heads/master", GITHUB_SHA: sha("f"),
      GITHUB_EVENT_NAME: "pull_request_target", GITHUB_EVENT_PATH: eventPath };
    const payload = { repository: repo(), action: "closed" };
    await writeFile(eventPath, JSON.stringify(payload));
    for (const mode of ["--dry-run", "--apply"]) {
      const f = fixture();
      const report = await main({ env, args: [mode], api: f.api, directory: dir });
      assert.deepEqual(JSON.parse(await readFile(join(dir, "merged-proof.json"), "utf8")), report);
    }
    await assert.rejects(main({ env: { ...env, GITHUB_REF: "refs/pull/10/merge" }, args: ["--apply"] }), /Trusted/);
    await assert.rejects(main({ env, args: [] }), /Explicit mode/);
    for (const event of ["workflow_run", "delete"]) {
      const eventPayload = { repository: repo(), workflow_run: { event: "pull_request" },
        ref_type: "branch", ref: `gh-readonly-queue/master/pr-10-${sha("b")}` };
      await writeFile(eventPath, JSON.stringify(eventPayload));
      await main({ env: { ...env, GITHUB_EVENT_NAME: event }, args: ["--dry-run"], api: fixture([]).api, directory: dir });
    }
    await assert.rejects(main({ env: { ...env, GITHUB_EVENT_NAME: "push" }, args: ["--apply"] }), /Unsupported/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("workflow only checks out trusted default-branch code and has no scheduler or force cancellation", async () => {
  const workflow = await readFile(new URL("../../../.github/workflows/reap-obsolete-merge-groups.yml", import.meta.url), "utf8");
  assert.match(workflow, /pull_request_target:\s+branches: \[master\]\s+types: \[closed\]/);
  assert.match(workflow, /ref: \$\{\{ github.sha \}\}/);
  assert.match(workflow, /GH_TOKEN: \$\{\{ github.token \}\}/);
  assert.doesNotMatch(workflow, /schedule:|force-cancel|BOT_PAT|pull_request\.head\.sha/);
  assert.match(workflow, /cancel-in-progress: false/);
  const legacy = workflow.split("- name: Cancel only obsolete merge-group runs after two fresh proofs")[1];
  assert.match(legacy, /workflow_run\.event == 'merge_group' &&\s+github.event.workflow_run.workflow_id == 105623149/);
});
