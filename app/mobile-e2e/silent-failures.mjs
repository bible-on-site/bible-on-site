import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Diagnostic-only messages the harness writes to trx output without failing
// the test — by design, so a coverage outage cannot decide a scenario's
// outcome. The trade-off is that a systematic break (e.g. every coverage
// reset answering 403 for a whole run) stays invisible until someone mines
// the artifacts. This scan restores the signal: one occurrence is reported
// as a warning (legit transient — an endpoint mid-launch, a recovered adb
// transport), two or more of the same signature is systematic and fails.
export const SIGNATURES = [
  "coverage reset failed:",
  "coverage dump failed:",
  "coverage collection failed:",
  "Could not capture device diagnostics:",
  "the session died during startup",
];

const countOccurrences = (haystack, needle) => haystack.split(needle).length - 1;

export function findTrxFiles(dir, list = []) {
  if (!existsSync(dir)) return list;
  for (const entry of readdirSync(dir, { withFileTypes: true })) { // nosemgrep -- CI artifacts dir fixed by the workflow, no user input
    const path = join(dir, entry.name); // nosemgrep -- entry names are dirents under that dir
    if (entry.isDirectory()) findTrxFiles(path, list);
    else if (entry.name.endsWith(".trx")) list.push(path);
  }
  return list;
}

export function scanTrxFiles(files, read = (path) => readFileSync(path, "utf8")) { // nosemgrep -- paths come from findTrxFiles above, not user input
  const findings = new Map();
  const seen = new Set();
  let tests = 0;
  for (const file of files) {
    const text = read(file);
    // MTP mirrors the run trx under Retries/<id>/1/ byte-for-byte; a genuine
    // retry attempt produces different content and still counts.
    const hash = createHash("sha256").update(text).digest("hex");
    if (seen.has(hash)) continue;
    seen.add(hash);
    tests += countOccurrences(text, "<UnitTestResult ");
    for (const signature of SIGNATURES) {
      const count = countOccurrences(text, signature);
      if (count > 0) findings.set(signature, (findings.get(signature) ?? 0) + count);
    }
  }
  return { tests, findings };
}

// severity: "error" once a signature repeats (systematic), else "warning".
export function classify(findings, threshold = 2) {
  return [...findings.entries()].map(([signature, count]) => ({
    signature,
    count,
    severity: count >= threshold ? "error" : "warning",
  }));
}

export function report({ tests, findings }, annotate = (level, message) =>
  console.log(`::${level}::${message}`)) {
  const findingsList = classify(findings);
  for (const { signature, count, severity } of findingsList) {
    annotate(severity,
      `[silent-failures] "${signature.trim()}" appeared ${count}x across ${tests} test(s) — `
      + (severity === "error" ? "systematic harness degradation, not flake" : "single occurrence, likely transient"));
  }
  if (findingsList.length === 0) {
    console.log(`[silent-failures] ${tests} test(s) scanned; no diagnostic failure signatures.`);
  }
  return findingsList.some(({ severity }) => severity === "error") ? 1 : 0;
}

export function run(dir, pilotOutcome, annotate = (level, message) =>
  console.log(`::${level}::${message}`)) {
  const files = findTrxFiles(dir);
  if (files.length === 0) {
    // A green pilot that produced no report left this gate with no evidence
    // to scan — that absence is itself a systematic failure. A failed pilot
    // may legitimately exit before writing results and fails loudly elsewhere.
    const message = `[silent-failures] no .trx files under ${dir}`;
    if (pilotOutcome === "success") {
      annotate("error", `${message} — the pilot succeeded without a report.`);
      return 1;
    }
    console.log(`${message} — nothing to scan.`);
    return 0;
  }
  return report(scanTrxFiles(files), annotate);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const dir = process.argv[2];
  const pilotOutcome = process.argv[3] ?? "";
  if (!dir) {
    console.error("usage: node silent-failures.mjs <results-dir> [pilot-outcome]");
    process.exit(2);
  }
  process.exit(run(dir, pilotOutcome));
}
