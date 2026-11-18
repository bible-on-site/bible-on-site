import { execFileSync } from "node:child_process";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { POLICY, queueRef, fullQueue, durableJournal } from "./reap-obsolete-merge-groups.mjs";

const statuses = ["queued", "in_progress", "pending", "waiting"];
const events = ["pull_request", "merge_group", "dynamic"];
const sha = value => typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
const positive = value => Number.isSafeInteger(value) && value > 0;
function requireValue(value, message) { if (!value) throw new Error(message); }
function ownRepository(value) { return value?.id === POLICY.repositoryId && value.full_name === POLICY.repository; }

function identity(run) {
  requireValue(positive(run?.id) && positive(run.workflow_id) && ownRepository(run.repository)
    && positive(run.head_repository?.id) && sha(run.head_sha)
    && typeof run.head_branch === "string", "Invalid run identity");
  return run;
}
function sameRun(left, right) {
  identity(left);
  identity(right);
  return left.id === right.id && left.workflow_id === right.workflow_id && left.event === right.event
    && left.head_sha === right.head_sha && left.head_branch === right.head_branch
    && left.head_repository.id === right.head_repository.id;
}

async function pullNumbers(run, api) {
  if (run.event === "merge_group") {
    return queueRef(run.head_branch) ? [Number(run.head_branch.split("/")[2].split("-")[1])] : [];
  }
  if (run.event === "dynamic") {
    const match = /^refs\/pull\/([1-9][0-9]*)\/(head|merge)$/.exec(run.head_branch);
    return match && positive(Number(match[1])) ? [Number(match[1])] : [];
  }
  if (run.event !== "pull_request") return [];
  const linked = Array.isArray(run.pull_requests) ? run.pull_requests : [];
  // GitHub clears a workflow run's pull_requests array when its PR merges.
  // Its commit-to-PR API retains that association, including older PR heads.
  const associations = linked.length ? linked : (await api.getCommitPullRequests(run.head_sha)).filter(pr =>
    pr.head?.ref === run.head_branch && pr.head.repo?.id === run.head_repository.id);
  return [...new Set(associations.filter(pr => positive(pr.number)
    && pr.base?.repo?.id === POLICY.repositoryId).map(pr => pr.number))].sort((a, b) => a - b);
}

function protectedHeads(response) {
  const repo = response?.data?.repository;
  requireValue(!response.errors && repo?.databaseId === POLICY.repositoryId
    && sha(repo.defaultBranchRef?.target?.oid), "Incomplete queue visibility");
  const queue = fullQueue(response.data);
  return new Set([repo.defaultBranchRef.target.oid, ...queue.heads, ...queue.bases]);
}

/** Only metadata is inspected. Never execute a PR checkout or its artifacts. */
export async function cancelMergedRuns({ api, journal, dryRun = true }) {
  const report = { dryRun, actions: [] };
  const runs = new Map();
  const inventories = await Promise.allSettled(statuses.map(status => api.listRuns(status)));
  for (const inventory of inventories) {
    if (inventory.status === "rejected") throw inventory.reason;
    for (const run of inventory.value) {
      if (!events.includes(run.event)) continue;
      const key = identity(run);
      requireValue(!runs.has(run.id) || sameRun(runs.get(run.id), key), "Run changed while listing");
      runs.set(run.id, run);
    }
  }
  // Confirm visibility before the first mutation, including an empty candidate set.
  protectedHeads(await api.getQueue());
  const merged = new Map();
  async function isMerged(number) {
    if (merged.has(number)) return merged.get(number);
    const pr = await api.getPullRequest(number);
    requireValue(pr.number === number && ownRepository(pr.base?.repo)
      && ["open", "closed"].includes(pr.state), "Invalid PR identity");
    const result = pr.state === "closed" && pr.merged === true && typeof pr.merged_at === "string";
    // A merge cannot be undone; an OPEN result is never cached across runs.
    if (result) merged.set(number, true);
    return result;
  }
  for (const listed of runs.values()) {
    if (!statuses.includes(listed.status)) continue;
    const numbers = await pullNumbers(listed, api);
    if (!numbers.length) continue;
    let eligible = true;
    for (const number of numbers) if (!(await isMerged(number))) eligible = false;
    if (!eligible) continue;
    const current = await api.getRun(listed.id);
    requireValue(sameRun(current, listed), "Run identity changed");
    const currentNumbers = await pullNumbers(current, api);
    requireValue(currentNumbers.length === numbers.length
      && currentNumbers.every((number, index) => number === numbers[index]), "Run PR identity changed");
    if (!statuses.includes(current.status)) continue;
    // A queue commit can still be a base of another live group after its PR merges.
    if (protectedHeads(await api.getQueue()).has(current.head_sha)) continue;
    const action = { runId: current.id, head: current.head_sha, event: current.event, pullRequests: numbers };
    report.actions.push(action);
    if (dryRun) { action.outcome = "would-cancel"; continue; }
    requireValue(typeof journal === "function", "Durable journal required");
    await journal({ kind: "cancel-intent", ...action });
    let requestError;
    try { await api.cancelRun(current.id); }
    catch (error) { requestError = error; }
    // Reconcile an uncertain POST once. Never retry a cancellation or force it.
    const after = await api.getRun(current.id);
    requireValue(sameRun(after, current), "Reconciliation identity changed");
    action.status = after.status;
    action.conclusion = after.conclusion;
    action.outcome = after.status === "completed" ? "completed" : "cancellation-requested";
    await journal({ kind: "cancel-observed", ...action, requestAccepted: !requestError });
    if (requestError && after.status !== "completed") throw requestError;
  }
  return report;
}

export class GitHubCliApi {
  constructor(execute = execFileSync) { this.execute = execute; }
  request(endpoint, { paginate = false, data, method } = {}) {
    const args = ["api", endpoint];
    if (paginate) args.push("--paginate", "--slurp");
    if (method) args.push("--method", method);
    if (data) args.push("--input", "-");
    const text = this.execute("gh", args, { encoding: "utf8", timeout: POLICY.requestTimeoutMs,
      maxBuffer: 16 * 1024 * 1024, input: data ? JSON.stringify(data) : undefined });
    return text.trim() ? JSON.parse(text) : null;
  }
  async listRuns(status) {
    requireValue(statuses.includes(status), "Invalid run filter");
    const pages = this.request(`repos/${POLICY.repository}/actions/runs?status=${status}&per_page=100`, { paginate: true });
    requireValue(Array.isArray(pages) && pages.length > 0
      && pages.every(page => Array.isArray(page.workflow_runs) && Number.isSafeInteger(page.total_count)
        && page.total_count >= 0), "Invalid run pages");
    const runs = pages.flatMap(page => page.workflow_runs);
    requireValue(pages.every(page => page.total_count <= runs.length), "Incomplete run pages");
    return runs;
  }
  async getRun(id) { return this.request(`repos/${POLICY.repository}/actions/runs/${id}`); }
  async getPullRequest(number) { return this.request(`repos/${POLICY.repository}/pulls/${number}`); }
  async getCommitPullRequests(head) {
    requireValue(sha(head), "Invalid commit identity");
    const pages = this.request(`repos/${POLICY.repository}/commits/${head}/pulls?per_page=100`, { paginate: true });
    requireValue(Array.isArray(pages) && pages.length > 0 && pages.every(Array.isArray), "Invalid commit PR pages");
    return pages.flat();
  }
  async cancelRun(id) { this.request(`repos/${POLICY.repository}/actions/runs/${id}/cancel`, { method: "POST" }); }
  async getQueue() {
    return this.request("graphql", { data: { query: 'query { repository(owner:"bible-on-site",name:"bible-on-site") { databaseId nameWithOwner defaultBranchRef { target { oid } } mergeQueue(branch:"master") { entries(first:100) { totalCount pageInfo { hasNextPage } nodes { position state headCommit { oid } baseCommit { oid } pullRequest { number headRefOid } } } } } }' } });
  }
}

export async function main({ env = process.env, args = process.argv.slice(2), api = new GitHubCliApi(),
  directory = ".artifacts/obsolete-merge-groups" } = {}) {
  requireValue(env.GITHUB_REPOSITORY === POLICY.repository && env.GITHUB_REF === "refs/heads/master"
    && sha(env.GITHUB_SHA), "Trusted default-branch context required");
  const payload = JSON.parse(await readFile(env.GITHUB_EVENT_PATH, "utf8"));
  const event = env.GITHUB_EVENT_NAME;
  requireValue(ownRepository(payload.repository) && ((event === "pull_request_target" && payload.action === "closed")
    || (event === "workflow_run" && events.includes(payload.workflow_run?.event))
    || (event === "delete" && payload.ref_type === "branch" && queueRef(payload.ref))), "Unsupported cleanup event");
  requireValue(args.length === 1 && ["--apply", "--dry-run"].includes(args[0]), "Explicit mode required");
  const report = await cancelMergedRuns({ api, dryRun: args[0] === "--dry-run",
    journal: durableJournal(`${directory}/merged-actions.jsonl`) });
  const path = `${directory}/merged-proof.json`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
  return report;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
