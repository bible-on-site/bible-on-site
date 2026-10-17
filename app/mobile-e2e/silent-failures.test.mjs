import assert from "node:assert/strict";
import { test } from "node:test";
import { classify, findTrxFiles, report, run, scanTrxFiles } from "./silent-failures.mjs";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The scanner matches substrings, so fixture content needs no document
// structure — just the counted token and the signature text.
const trx = (results, messages) => "<UnitTestResult ".repeat(results) + messages;

test("scanTrxFiles counts each signature across files", () => {
  const { tests, findings } = scanTrxFiles(["a.trx", "b.trx"], (path) => path === "a.trx"
    ? trx(2, "coverage reset failed: 403")
    : trx(3, "coverage reset failed: 403 coverage dump failed: timeout"));
  assert.equal(tests, 5);
  assert.equal(findings.get("coverage reset failed:"), 2);
  assert.equal(findings.get("coverage dump failed:"), 1);
  assert.equal(findings.has("coverage collection failed:"), false);
});

test("scanTrxFiles counts byte-identical Retries mirrors once", () => {
  const mirrored = trx(6, "coverage dump failed: timeout");
  const { tests, findings } = scanTrxFiles(["mobile-e2e.trx", "Retries/1/mobile-e2e.trx"],
    () => mirrored);
  assert.equal(tests, 6);
  assert.equal(findings.get("coverage dump failed:"), 1);
});

test("classify fails a repeated signature and warns on a single occurrence", () => {
  const rows = classify(new Map([
    ["coverage reset failed:", 3],
    ["coverage dump failed:", 1],
  ]));
  assert.deepEqual(rows, [
    { signature: "coverage reset failed:", count: 3, severity: "error" },
    { signature: "coverage dump failed:", count: 1, severity: "warning" },
  ]);
});

test("report exits non-zero only on a systematic signature", () => {
  const notes = [];
  const annotate = (level, message) => notes.push([level, message]);
  const exit = report({ tests: 6, findings: new Map([["coverage reset failed:", 5]]) }, annotate);
  assert.equal(exit, 1);
  assert.equal(notes[0][0], "error");
  assert.match(notes[0][1], /coverage reset failed.*5x/);
});

test("report passes and still surfaces a lone transient as a warning", () => {
  const notes = [];
  const exit = report({ tests: 6, findings: new Map([["coverage dump failed:", 1]]) },
    (level, message) => notes.push([level, message]));
  assert.equal(exit, 0);
  assert.equal(notes[0][0], "warning");
});

test("report passes quietly when nothing fires", () => {
  assert.equal(report({ tests: 4, findings: new Map() }), 0);
});

test("findTrxFiles recurses into the Retries layout", () => {
  const root = mkdtempSync(join(tmpdir(), "silent-failures-"));
  mkdirSync(join(root, "Retries", "HG8A2", "1"), { recursive: true });
  writeFileSync(join(root, "mobile-e2e.trx"), trx(1, ""));
  writeFileSync(join(root, "Retries", "HG8A2", "1", "mobile-e2e.trx"), trx(0, ""));
  writeFileSync(join(root, "notes.txt"), "ignored");
  const files = findTrxFiles(root);
  assert.equal(files.length, 2);
  assert.ok(files.every((file) => file.endsWith(".trx")));
});

test("findTrxFiles tolerates a missing results directory", () => {
  assert.deepEqual(findTrxFiles(join(tmpdir(), "does-not-exist-silent-failures")), []);
});

test("run fails a successful pilot that produced no report", () => {
  const notes = [];
  const exit = run(join(tmpdir(), "no-trx-here"), "success",
    (level, message) => notes.push([level, message]));
  assert.equal(exit, 1);
  assert.equal(notes[0][0], "error");
  assert.match(notes[0][1], /succeeded without a report/);
});

test("run treats a missing report as informational when the pilot failed", () => {
  assert.equal(run(join(tmpdir(), "no-trx-here"), "failure"), 0);
});
