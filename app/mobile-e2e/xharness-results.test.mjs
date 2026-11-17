import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { adaptXHarnessResults } from "./xharness-results.mjs";
import { descendants, parseXml } from "../../devops/e2e-coverage-trees/xml.ts";

const XUNIT_REPORT = `<?xml version="1.0" encoding="utf-8"?>
<assemblies timestamp="11/16/2026 10:00:00">
  <assembly name="BibleOnSite.DeviceTests.dll" total="6" passed="4" failed="1" skipped="1" errors="0" time="3.5">
    <collection name="ParityTests" total="3" time="0.5" failed="0" skipped="0" passed="3">
      <test name="BibleOnSite.DeviceTests.Tests.ParityTests.a_marker_prepends_a_styled_span_before_the_pasuk_spans"
            type="BibleOnSite.DeviceTests.Tests.ParityTests"
            method="a_marker_prepends_a_styled_span_before_the_pasuk_spans" time="0.5" result="Pass" />
      <test name="BibleOnSite.DeviceTests.Tests.ParityTests.gimatry_converts_numbers_to_hebrew_letters(number: 1, expected: &quot;א&quot;)"
            type="BibleOnSite.DeviceTests.Tests.ParityTests"
            method="gimatry_converts_numbers_to_hebrew_letters" time="0.1" result="Pass" />
      <test name="BibleOnSite.DeviceTests.Tests.ParityTests.gimatry_converts_numbers_to_hebrew_letters(number: 15, expected: &quot;טו&quot;)"
            type="BibleOnSite.DeviceTests.Tests.ParityTests"
            method="gimatry_converts_numbers_to_hebrew_letters" time="0.1" result="Pass" />
    </collection>
    <collection name="DeviceOnlyTests" total="3" time="3.0" failed="1" skipped="1" passed="1">
      <test name="BibleOnSite.DeviceTests.Tests.DeviceOnlyTests.deviceinfo_reports_a_real_android_platform"
            type="BibleOnSite.DeviceTests.Tests.DeviceOnlyTests"
            method="deviceinfo_reports_a_real_android_platform" time="1.0" result="Pass" />
      <test name="BibleOnSite.DeviceTests.Tests.DeviceOnlyTests.handler_is_created_by_the_real_android_registry"
            type="BibleOnSite.DeviceTests.Tests.DeviceOnlyTests"
            method="handler_is_created_by_the_real_android_registry" time="1.5" result="Fail">
        <failure exception-type="Xunit.Sdk.IsTypeException"><message>Assert.IsType() Failure: expected ButtonHandler, actual LabelHandler</message><stack-trace>at handler()</stack-trace></failure>
      </test>
      <test name="BibleOnSite.DeviceTests.Tests.DeviceOnlyTests.a_capability_probe"
            type="BibleOnSite.DeviceTests.Tests.DeviceOnlyTests"
            method="a_capability_probe" time="0.5" result="Skip">
        <reason><message>requires a physical display</message></reason>
      </test>
    </collection>
  </assembly>
</assemblies>`;

describe("adaptXHarnessResults", () => {
  test("converts the pulled xUnit-v2 report to JUnit with per-case times", () => {
    const root = mkdtempSync(join(tmpdir(), "xharness-"));
    const xharnessDir = join(root, "xharness");
    const resultsDir = join(root, "results");
    mkdirSync(xharnessDir, { recursive: true });
    writeFileSync(join(xharnessDir, "testResults.xml"), XUNIT_REPORT);

    const summary = adaptXHarnessResults({ xharnessDir, resultsDir });
    assert.equal(summary.total, 6);
    assert.equal(summary.passed, 4);
    assert.equal(summary.failed, 1);
    assert.equal(summary.skipped, 1);

    const junit = parseXml(readFileSync(summary.out, "utf8"));
    assert.equal(junit.name, "testsuites");
    const cases = descendants(junit, "testcase");
    assert.equal(cases.length, 6);
    const failing = cases.find(c => c.attrs.name === "handler_is_created_by_the_real_android_registry");
    assert.equal(failing.attrs.classname, "BibleOnSite.DeviceTests.Tests.DeviceOnlyTests");
    assert.equal(failing.attrs.time, "1.5");
    const failure = failing.children.find(c => c.name === "failure");
    assert.match(failure.attrs.message, /IsType\(\) Failure/);
    assert.match(failure.text, /at handler\(\)/);
    const skipped = cases.find(c => c.attrs.name === "a_capability_probe");
    assert.equal(skipped.children[0].name, "skipped");
    assert.equal(skipped.children[0].attrs.message, "requires a physical display");
    // Theory rows keep their arguments in the JUnit name — otherwise every
    // InlineData case collapses onto the bare method and a failure cannot
    // name its input.
    const theoryNames = cases
      .filter(c => c.attrs.classname === "BibleOnSite.DeviceTests.Tests.ParityTests" && c.attrs.name.startsWith("gimatry_"))
      .map(c => c.attrs.name);
    assert.deepEqual(theoryNames, [
      "gimatry_converts_numbers_to_hebrew_letters(number: 1, expected: \"א\")",
      "gimatry_converts_numbers_to_hebrew_letters(number: 15, expected: \"טו\")",
    ]);
  });

  test("rejects a run that produced no report instead of fabricating green", () => {
    const root = mkdtempSync(join(tmpdir(), "xharness-"));
    mkdirSync(join(root, "xharness"), { recursive: true });
    assert.throws(() => adaptXHarnessResults({ xharnessDir: join(root, "xharness"), resultsDir: join(root, "results") }),
      /No xUnit results XML/);
  });

  test("rejects a report with zero test records", () => {
    const root = mkdtempSync(join(tmpdir(), "xharness-"));
    const xharnessDir = join(root, "xharness");
    mkdirSync(xharnessDir, { recursive: true });
    writeFileSync(join(xharnessDir, "testResults.xml"), `<?xml version="1.0"?><assemblies><assembly name="x" total="0" /></assemblies>`);
    assert.throws(() => adaptXHarnessResults({ xharnessDir, resultsDir: join(root, "results") }),
      /no <test> records/);
  });
});
