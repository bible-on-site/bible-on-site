import { execFileSync, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mergeShardAppCoverage, mergeShardEvidence, shardRuns } from "./shards.mjs";

// Runs the iOS suite split across two simulators on one runner (#2083): each
// shard gets its own run.mjs child — its own Appium server, device, artifacts
// directory and Shard trait filter — so the sequential device scenarios run
// in parallel while coverage stays disjoint-and-complete.
const directory = dirname(fileURLToPath(import.meta.url));
const app = resolve(directory, "..");
const platform = process.env.MOBILE_PLATFORM?.toLowerCase();
if (platform !== "ios") throw new Error("Only the iOS suite shards across two simulators.");
const artifacts = process.env.MOBILE_E2E_ARTIFACTS ?? resolve(directory, "../.artifacts/mobile-e2e", platform);
const shards = shardRuns(process.env, artifacts);

// Both children run `dotnet run`/`dotnet test` at nearly the same moment;
// building the devops and test projects sequentially first leaves them only
// up-to-date checks inside the shards instead of racing the same obj/bin.
execFileSync("dotnet", ["build", resolve(app, "devops"), "--configuration", "Debug"], { cwd: app, stdio: "inherit" });
execFileSync("dotnet", ["build", resolve(app, "BibleOnSite.Tests.MobileE2E"), "--configuration", "Debug",
  "-p:RestoreLockedMode=true"], { cwd: app, stdio: "inherit" });

const children = new Set();
const killChildren = () => { for (const child of children) child.kill(); };
process.on("SIGINT", killChildren);
process.on("SIGTERM", killChildren);

// Interleaved child output stays readable through a per-shard line prefix;
// per-shard artifacts keep logs, results and diagnostics separate.
const runShard = ({ shard, env }) => new Promise((resolveRun) => {
  const child = spawn(process.execPath, [resolve(directory, "run.mjs")], {
    cwd: directory, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  });
  children.add(child);
  for (const [stream, target] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
    createInterface({ input: stream }).on("line", (line) => target.write(`[shard${shard}] ${line}\n`));
  }
  child.on("error", (error) => {
    console.error(`[shard${shard}] could not start: ${error}`);
    resolveRun(1);
  });
  child.on("exit", (code) => {
    children.delete(child);
    resolveRun(code ?? 1);
  });
});

const results = await Promise.all(shards.map(runShard));
// The collect step reads the parent dir's coverage-evidence even when a shard
// failed, so merge whatever the runs produced; each shard already cleared its
// own stale records at startup.
mergeShardEvidence(shards.map((shard) => shard.artifacts), resolve(artifacts, "coverage-evidence"));
mergeShardAppCoverage(shards.map((shard) => shard.artifacts), resolve(artifacts, "app-coverage"));
if (results.some((code) => code !== 0)) process.exitCode = 1;
