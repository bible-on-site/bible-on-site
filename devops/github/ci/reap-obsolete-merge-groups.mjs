import { readFile, stat, writeFile, mkdir, open } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const POLICY = Object.freeze({
  repository: "bible-on-site/bible-on-site",
  repositoryId: 810119373,
  workflowId: 105623149,
  workflowPath: ".github/workflows/ci.yml",
  base: "master",
  maxPage: 100,
  maxCandidates: 100,
  maxRequests: 50,
  maxCancellations: 2,
  maxBodyBytes: 2 * 1024 * 1024,
  requestTimeoutMs: 10_000,
});
const active = new Set(["queued", "in_progress"]);
const completedWithoutCancellation = new Set(["success", "failure", "neutral", "skipped", "timed_out", "action_required", "stale", "startup_failure"]);
const states = new Set(["AWAITING_CHECKS", "LOCKED", "MERGEABLE", "QUEUED", "UNMERGEABLE"]);
class ReaperError extends Error {
  constructor(code) { super(code); this.code = code; }
}
function requireValue(value, code) { if (!value) throw new ReaperError(code); }
function positive(value) { return Number.isSafeInteger(value) && value > 0; }
function hex(value) {
  if (typeof value !== "string" || value.length !== 40) return false;
  for (const c of value) if (!"0123456789abcdef".includes(c)) return false;
  return true;
}
export function queueRef(value) {
  if (typeof value !== "string" || value.length > 128) return false;
  const parts = value.split("/");
  if (parts.length !== 3 || parts[0] !== "gh-readonly-queue" || parts[1] !== POLICY.base) return false;
  const tail = parts[2].split("-");
  if (tail.length !== 3 || tail[0] !== "pr" || !hex(tail[2])) return false;
  const number = tail[1];
  if (!number || number.length > 16 || number[0] === "0") return false;
  for (const c of number) if (c < "0" || c > "9") return false;
  return positive(Number(number));
}
function repository(value) {
  return value?.id === POLICY.repositoryId && value?.full_name === POLICY.repository;
}
function immutableRun(run) {
  return positive(run?.id) && run.workflow_id === POLICY.workflowId
    && run.event === "merge_group" && repository(run.repository)
    && repository(run.head_repository) && queueRef(run.head_branch)
    && hex(run.head_sha) && run.head_commit?.id === run.head_sha;
}
function sameRun(a, b) {
  return immutableRun(b) && a.id === b.id && a.head_sha === b.head_sha
    && a.head_branch === b.head_branch;
}
function fullRunPage(page) {
  requireValue(Array.isArray(page?.workflow_runs) && page.hasNextPage === false
    && Number.isSafeInteger(page.total_count) && page.total_count >= 0
    && page.total_count <= POLICY.maxPage
    && page.total_count === page.workflow_runs.length, "INCOMPLETE_RUN_PAGE");
  return page.workflow_runs;
}
function fullQueue(response) {
  const repo = response?.repository;
  requireValue(repo?.databaseId === POLICY.repositoryId
    && repo.nameWithOwner === POLICY.repository, "QUEUE_REPOSITORY");
  const entries = repo.mergeQueue?.entries;
  requireValue(entries && Array.isArray(entries.nodes)
    && entries.pageInfo?.hasNextPage === false
    && Number.isSafeInteger(entries.totalCount)
    && entries.totalCount === entries.nodes.length
    && entries.totalCount <= POLICY.maxPage, "INCOMPLETE_QUEUE_PAGE");
  const heads = [], bases = [], prs = new Set();
  for (const [index, node] of entries.nodes.entries()) {
    requireValue(node && states.has(node.state) && node.position === index + 1
      && positive(node.pullRequest?.number) && hex(node.pullRequest.headRefOid)
      && !prs.has(node.pullRequest.number), "QUEUE_TOPOLOGY");
    prs.add(node.pullRequest.number);
    const head = node.headCommit?.oid ?? null;
    const base = node.baseCommit?.oid ?? null;
    // Entries not yet folded into a merge group carry no commits at all;
    // grouped entries always carry both. A lone null is unknown topology.
    requireValue((head === null) === (base === null), "QUEUE_TOPOLOGY");
    if (head === null) {
      requireValue(node.state === "QUEUED" || node.state === "UNMERGEABLE", "UNKNOWN_QUEUE_HEAD");
      continue;
    }
    requireValue(hex(head) && hex(base), "UNKNOWN_QUEUE_HEAD");
    heads.push(head);
    bases.push(base);
  }
  return { heads, bases };
}
async function freshProof(api, listed) {
  const run = await api.getRun(listed.id);
  requireValue(sameRun(listed, run), "RUN_CHANGED");
  if (!active.has(run.status)) return { safe: false, reason: "not-active" };
  // A positive authenticated ref read precedes interpreting exact-ref 404.
  const master = await api.getRef(POLICY.base);
  requireValue(master.status === 200 && master.ref === "refs/heads/master"
    && hex(master.sha), "REF_READ_NOT_PROVEN");
  if (master.sha === run.head_sha) return { safe: false, reason: "current-master-head" };
  const number = Number(run.head_branch.split("/")[2].split("-")[1]);
  const pr = await api.getPullRequest(number);
  requireValue(pr.number === number && ["OPEN", "CLOSED", "MERGED"].includes(pr.state), "PR_IDENTITY");
  if (pr.state === "MERGED" || pr.mergedAt !== null) return { safe: false, reason: "merged-production-validation" };
  const ref = await api.getRef(run.head_branch);
  if (ref.status === 200) {
    requireValue(ref.ref === "refs/heads/" + run.head_branch && hex(ref.sha), "REF_CHANGED");
    return { safe: false, reason: "ref-exists" };
  }
  requireValue(ref.status === 404 && Object.keys(ref).length === 1, "AMBIGUOUS_REF_RESULT");
  const snapshot = await api.getQueue();
  const queue = fullQueue(snapshot);
  requireValue(hex(snapshot.repository.defaultBranchRef?.target?.oid), "DEFAULT_HEAD");
  if (snapshot.repository.defaultBranchRef.target.oid === run.head_sha) return { safe: false, reason: "current-master-head" };
  if (queue.heads.includes(run.head_sha) || queue.bases.includes(run.head_sha)) {
    return { safe: false, reason: "current-queue-reference" };
  }
  return { safe: true, runId: run.id, head: run.head_sha, ref: run.head_branch,
    refDeleted: true, queueHeads: queue.heads, queueBases: queue.bases };
}

/**
 * Metadata only. The injected API is the only mutation boundary.
 * Complete first pages are required; pagination/unknown topology fail closed.
 * Fresh proof is repeated before each normal cancel, but GitHub has no atomic
 * expected-head lease on cancellation: the final-read/POST race remains.
 */
export async function reap({ eventName, payload, api, dryRun = true, journal }) {
  const report = { mode: dryRun ? "dry-run" : "apply", complete: false,
    actions: [], cancelRequests: [], mutationConfirmed: 0 };
  try {
    requireValue(repository(payload?.repository)
      && payload.repository.default_branch === POLICY.base, "EVENT_REPOSITORY");
    if (eventName === "workflow_run") {
      const trigger = payload.workflow_run;
      if (trigger?.event !== "merge_group") {
        report.complete = true; report.ignored = "unrelated-event"; return report;
      }
      requireValue(immutableRun(trigger), "TRIGGER_RUN");
    } else if (eventName === "delete") {
      if (payload.ref_type !== "branch" || !queueRef(payload.ref)) {
        report.complete = true; report.ignored = "unrelated-ref"; return report;
      }
    } else {
      throw new ReaperError("UNSUPPORTED_EVENT");
    }
    const repo = await api.getRepository();
    requireValue(repository(repo) && repo.default_branch === POLICY.base, "API_REPOSITORY");
    const workflow = await api.getWorkflow();
    requireValue(workflow.id === POLICY.workflowId && workflow.path === POLICY.workflowPath,
      "WORKFLOW_IDENTITY");
    const collected = [];
    // No pagination is silently dropped. Overflow retains manual cleanup.
    for (const status of ["queued", "in_progress"]) {
      collected.push(...fullRunPage(await api.listRuns(status)));
    }
    const candidates = new Map();
    for (const run of collected) {
      if (run.event !== "merge_group" || run.workflow_id !== POLICY.workflowId) continue;
      requireValue(immutableRun(run), "CANDIDATE_IDENTITY");
      if (!active.has(run.status)) continue;
      const prior = candidates.get(run.id);
      requireValue(!prior || sameRun(prior, run), "DUPLICATE_RUN_CHANGED");
      candidates.set(run.id, run);
    }
    requireValue(candidates.size <= POLICY.maxCandidates, "CANDIDATE_LIMIT");
    // A merged PR's remaining tests may still validate production under HEADGREEN.
    // Cache only this irreversible state, never an OPEN result across fences.
    const merged = new Set();
    const numbers = [...new Set([...candidates.values()].map(run => Number(run.head_branch.split("/")[2].split("-")[1])))];
    for (const number of numbers) {
      const pr = await api.getPullRequest(number);
      requireValue(pr.number === number && ["OPEN", "CLOSED", "MERGED"].includes(pr.state), "PR_IDENTITY");
      if (pr.state === "MERGED" || pr.mergedAt !== null) merged.add(number);
    }
    // Validate global queue visibility/completeness before the first mutation.
    fullQueue(await api.getQueue());
    let plannedCancellations = 0;
    for (const listed of [...candidates.values()].sort((a, b) => a.id - b.id)) {
      const action = { runId: listed.id, head: listed.head_sha, proofs: [] };
      report.actions.push(action);
      const number = Number(listed.head_branch.split("/")[2].split("-")[1]);
      if (merged.has(number)) { action.outcome = "skipped"; action.reason = "merged-production-validation"; continue; }
      if (plannedCancellations >= POLICY.maxCancellations) { action.outcome = "skipped"; action.reason = "per-run-cancellation-limit"; continue; }
      for (let fence = 0; fence < 2; fence++) {
        const proof = await freshProof(api, listed);
        action.proofs.push(proof);
        if (!proof.safe) { action.outcome = "skipped"; action.reason = proof.reason; break; }
      }
      if (action.outcome === "skipped") continue;
      // Dry-run must model the same bounded work as apply, including its cap.
      // Otherwise a backlog consumes the request budget after enough safe plans.
      plannedCancellations++;
      if (dryRun) { action.outcome = "would-cancel"; continue; }
      requireValue(typeof journal === "function", "DURABLE_JOURNAL_REQUIRED");
      await journal({ kind: "cancel-intent", runId: listed.id, head: listed.head_sha, ref: listed.head_branch, proofs: action.proofs });
      report.cancelRequests.push({ runId: listed.id, head: listed.head_sha });
      let requestError;
      try {
        const status = await api.cancelRun(listed.id);
        requireValue(status === 202 || status === 204, "CANCEL_NOT_ACCEPTED");
        action.outcome = "cancellation-requested";
      } catch (error) {
        requestError = error;
        action.outcome = "request-outcome-unknown";
      }
      // One reconciliation read, never another POST or a polling loop.
      const after = await api.getRun(listed.id);
      requireValue(sameRun(listed, after), "RECONCILE_IDENTITY");
      action.observedStatus = after.status;
      action.observedConclusion = after.conclusion;
      await journal({ kind: "cancel-observed", runId: listed.id, head: listed.head_sha, status: after.status, conclusion: after.conclusion, requestAccepted: !requestError });
      if (after.status === "completed" && after.conclusion === "cancelled") {
        action.outcome = "cancelled"; report.mutationConfirmed++;
      } else if (after.status === "completed" && completedWithoutCancellation.has(after.conclusion)) {
        // The run can finish between the final proof and the normal cancel POST.
        // Its exact immutable identity is already checked; no cancellation is credited.
        action.outcome = "completed-without-cancellation";
      } else if (requestError) {
        throw new ReaperError("CANCEL_OUTCOME_UNCONFIRMED");
      }
    }
    report.complete = true;
    return report;
  } catch (error) {
    report.error = error instanceof ReaperError ? error.code : "API_READ_FAILED";
    const failure = new ReaperError(report.error);
    failure.report = report;
    throw failure;
  }
}

export class GitHubApi {
  constructor(token, fetcher = fetch) {
    requireValue(typeof token === "string" && token.length > 0, "TOKEN_MISSING");
    this.token = token; this.fetcher = fetcher; this.requests = 0;
  }
  async request(path, { method = "GET", data, missing = false } = {}) {
    requireValue(++this.requests <= POLICY.maxRequests, "REQUEST_BUDGET_EXHAUSTED");
    requireValue(path === "/repos/" + POLICY.repository || path.startsWith("/repos/" + POLICY.repository + "/") || path === "/graphql",
      "API_PATH");
    const url = new URL(path, "https://api.github.com");
    requireValue(url.origin === "https://api.github.com", "API_ORIGIN");
    requireValue(!url.hash && (url.pathname === "/repos/" + POLICY.repository || url.pathname.startsWith("/repos/" + POLICY.repository + "/")
      || url.pathname === "/graphql"), "API_PATH");
    const response = await this.fetcher(url, {
      method, redirect: "error", signal: AbortSignal.timeout(POLICY.requestTimeoutMs),
      headers: { Authorization: "Bearer " + this.token, Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json" },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    if (missing && response.status === 404) {
      await response.body?.cancel();
      return { status: 404 };
    }
    requireValue(response.status === 200 || (method === "POST"
      && (response.status === 202 || response.status === 204)), "HTTP_" + response.status);
    const length = Number(response.headers.get("content-length"));
    requireValue(!Number.isFinite(length) || length <= POLICY.maxBodyBytes, "BODY_LIMIT");
    const reader = response.body?.getReader(), parts = [];
    let size = 0;
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > POLICY.maxBodyBytes) { await reader.cancel(); throw new ReaperError("BODY_LIMIT"); }
        parts.push(value);
      }
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.length; }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { status: response.status, data: text ? JSON.parse(text) : null,
      hasNextPage: Boolean(response.headers.get("link")) };
  }
  async getRepository() { return (await this.request("/repos/" + POLICY.repository)).data; }
  async getWorkflow() {
    return (await this.request("/repos/" + POLICY.repository + "/actions/workflows/ci.yml")).data;
  }
  async listRuns(status) {
    requireValue(active.has(status), "RUN_STATUS");
    const r = await this.request("/repos/" + POLICY.repository + "/actions/workflows/"
      + POLICY.workflowId + "/runs?event=merge_group&status=" + status + "&per_page=100&page=1");
    return { ...r.data, hasNextPage: r.hasNextPage };
  }
  async getRun(id) {
    requireValue(positive(id), "RUN_ID");
    return (await this.request("/repos/" + POLICY.repository + "/actions/runs/" + id)).data;
  }
  async getRef(branch) {
    requireValue(branch === POLICY.base || queueRef(branch), "REF_INPUT");
    const r = await this.request("/repos/" + POLICY.repository + "/git/ref/heads/" + branch,
      { missing: true });
    return r.status === 404 ? { status: 404 }
      : { status: r.status, ref: r.data.ref, sha: r.data.object?.sha };
  }
  async getPullRequest(number) {
    requireValue(positive(number), "PR_NUMBER");
    const response = (await this.request("/repos/" + POLICY.repository + "/pulls/" + number)).data;
    requireValue(response.number === number && ["open", "closed"].includes(response.state)
      && (response.merged_at === null || typeof response.merged_at === "string"), "PR_RESPONSE");
    return { number, state: response.merged_at ? "MERGED" : response.state.toUpperCase(), mergedAt: response.merged_at };
  }
  async getQueue() {
    const query = 'query { repository(owner:"bible-on-site",name:"bible-on-site") { databaseId nameWithOwner defaultBranchRef { target { oid } } mergeQueue(branch:"master") { entries(first:100) { totalCount pageInfo { hasNextPage } nodes { position state headCommit { oid } baseCommit { oid } pullRequest { number headRefOid } } } } } }';
    const r = await this.request("/graphql", { method: "POST", data: { query } });
    requireValue(!r.data.errors && r.data.data, "GRAPHQL_ERRORS");
    return r.data.data;
  }
  async cancelRun(id) {
    requireValue(positive(id), "RUN_ID");
    return (await this.request("/repos/" + POLICY.repository + "/actions/runs/" + id + "/cancel",
      { method: "POST" })).status;
  }
}

export function durableJournal(path) {
  return async value => {
    const allowed = new Set(["cancel-intent", "cancel-observed"]);
    requireValue(allowed.has(value.kind) && positive(value.runId) && hex(value.head), "JOURNAL_SCHEMA");
    await mkdir(dirname(path), { recursive: true });
    const handle = await open(path, "a", 0o600);
    try { await handle.writeFile(JSON.stringify(value) + "\n"); await handle.sync(); }
    finally { await handle.close(); }
  };
}

async function main() {
  const args = process.argv.slice(2);
  requireValue(args.length === 1 && ["--dry-run", "--apply"].includes(args[0]), "MODE_REQUIRED");
  requireValue(process.env.GITHUB_REPOSITORY === POLICY.repository
    && process.env.GITHUB_REF === "refs/heads/master" && hex(process.env.GITHUB_SHA),
  "TRUSTED_DEFAULT_CONTEXT");
  const path = process.env.GITHUB_EVENT_PATH;
  requireValue(path && (await stat(path)).size <= POLICY.maxBodyBytes, "EVENT_FILE_LIMIT");
  const payload = JSON.parse(await readFile(path, "utf8"));
  let report, failed = false;
  try {
    report = await reap({ eventName: process.env.GITHUB_EVENT_NAME, payload,
      api: new GitHubApi(process.env.GITHUB_TOKEN), dryRun: args[0] === "--dry-run",
      journal: durableJournal(".artifacts/obsolete-merge-groups/actions.jsonl") });
  } catch (error) { report = error.report ?? { complete: false, error: "CONTROL_FAILED" }; failed = true; }
  const evidence = ".artifacts/obsolete-merge-groups/proof.json";
  await mkdir(dirname(evidence), { recursive: true });
  await writeFile(evidence, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
  if (failed) process.exitCode = 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
