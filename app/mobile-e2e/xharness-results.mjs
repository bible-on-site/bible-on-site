// xUnit-v2 → JUnit results adapter for the in-process device-test layer
// (#3349). XHarness pulls the instrumentation's xUnit-v2 XML off the device;
// our reporting consumes JUnit (timings.ts junitDurations and the generic JUnit
// artifact readers), so the leg converts rather than teaching the pipeline a
// second dialect. The raw xUnit file stays beside the adapted report.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { child, descendants, parseXml } from "../../devops/e2e-coverage-trees/xml.ts";

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * `Namespace.Class.Method` → { classname, name }. xUnit's `name` carries the
 * theory arguments (`Type.Method(number: 15, ...)`), so it is the identity
 * source whenever present — otherwise every InlineData row collapses onto the
 * bare method name and a failure cannot name its input.
 */
function testcaseIdentity(test) {
  const type = test.attrs.type ?? "";
  const method = test.attrs.method ?? "";
  const display = test.attrs.name ?? "";
  if (type !== "" && display !== "") {
    const name = display.startsWith(`${type}.`) ? display.slice(type.length + 1) : display;
    return { classname: type, name };
  }
  if (type !== "" && method !== "") return { classname: type, name: method };
  const dot = display.lastIndexOf(".");
  return dot === -1
    ? { classname: type || "device-tests", name: display }
    : { classname: display.slice(0, dot), name: display.slice(dot + 1) };
}

function testcaseXml(test) {
  const { classname, name } = testcaseIdentity(test);
  const result = (test.attrs.result ?? "").toLowerCase();
  const time = test.attrs.time ?? "0";
  const parts = [`    <testcase classname="${escapeXml(classname)}" name="${escapeXml(name)}" time="${escapeXml(time)}">`];
  if (result === "fail") {
    const failure = child(test, "failure");
    const message = failure ? (child(failure, "message")?.text ?? "").trim() : "";
    const stack = failure ? (child(failure, "stack-trace")?.text ?? "").trim() : "";
    parts.push(`      <failure message="${escapeXml(message)}">${escapeXml(stack)}</failure>`);
  } else if (result === "skip") {
    const reason = child(test, "reason");
    const message = reason ? (child(reason, "message")?.text ?? "").trim() : "";
    parts.push(`      <skipped${message ? ` message="${escapeXml(message)}"` : ""}/>`);
  }
  parts.push("    </testcase>");
  return parts.join("\n");
}

/**
 * Converts the xUnit-v2 `testResults.xml` XHarness pulled into `xharnessDir`
 * into `resultsDir/device-tests.xml` (JUnit) and returns the run's tallies.
 * A missing report is infra failure — throw, do not fabricate a green one.
 */
export function adaptXHarnessResults({ xharnessDir, resultsDir }) {
  if (!existsSync(xharnessDir)) {
    throw new Error(`XHarness output directory does not exist: ${xharnessDir}`);
  }
  const report = readdirSync(xharnessDir)
    .filter(name => name.toLowerCase().endsWith(".xml"))
    .sort()
    .pop();
  if (!report) {
    throw new Error(`No xUnit results XML under ${xharnessDir} — the instrumentation produced nothing the leg can report.`);
  }
  const source = join(xharnessDir, report);
  const root = parseXml(readFileSync(source, "utf8"));
  const tests = descendants(root, "test");
  if (tests.length === 0) {
    throw new Error(`${source} contains no <test> records — treating the run as infrastructure failure.`);
  }
  let passed = 0, failed = 0, skipped = 0, seconds = 0;
  for (const test of tests) {
    const result = (test.attrs.result ?? "").toLowerCase();
    if (result === "fail") failed++;
    else if (result === "skip") skipped++;
    else passed++;
    const t = Number.parseFloat(test.attrs.time ?? "");
    if (Number.isFinite(t)) seconds += t;
  }
  mkdirSync(resultsDir, { recursive: true });
  const out = join(resultsDir, "device-tests.xml");
  writeFileSync(out, `<?xml version="1.0" encoding="utf-8"?>
<testsuites name="device-tests" tests="${tests.length}" failures="${failed}" skipped="${skipped}" time="${seconds.toFixed(3)}">
  <testsuite name="BibleOnSite.DeviceTests" tests="${tests.length}" failures="${failed}" skipped="${skipped}" time="${seconds.toFixed(3)}">
${tests.map(testcaseXml).join("\n")}
  </testsuite>
</testsuites>
`);
  return { total: tests.length, passed, failed, skipped, source, out };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [xharnessDir, resultsDir] = process.argv.slice(2);
  if (!xharnessDir || !resultsDir) {
    throw new Error("usage: node xharness-results.mjs <xharness-output-dir> <results-dir>");
  }
  const summary = adaptXHarnessResults({ xharnessDir: resolve(xharnessDir), resultsDir: resolve(resultsDir) });
  console.log(`device tests: ${summary.total} cases (${summary.passed} passed, ${summary.failed} failed, ${summary.skipped} skipped) -> ${summary.out}`);
}
