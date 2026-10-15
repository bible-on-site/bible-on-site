import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { captureTestHostStacks, monitorTestHostShutdown } from "./test-host-diagnostics.mjs";

const [assemblyArgument, tool, artifactsArgument] = process.argv.slice(2);
assert.ok(assemblyArgument && tool && artifactsArgument, "Require harness DLL, stack tool and artifact directory.");
const assembly = resolve(assemblyArgument);
const artifacts = resolve(artifactsArgument, "reporting-validation");
await mkdir(artifacts, { recursive: true });
const execute = promisify(execFile);
const results = {};
for (const mode of ["default", "synchronous", "leak"]) {
  const directory = await mkdtemp(join(tmpdir(), "mobile-reporting-probe-"));
  const config = mode === "default" ? join(directory, "testconfig.json") : join(dirname(assembly), "testconfig.json");
  if (mode === "default") await writeFile(config, "{}");
  const monitor = monitorTestHostShutdown(() => captureTestHostStacks(directory, tool, execute));
  const child = spawn("dotnet", [assembly, "--config-file", config,
    "--filter-query", "/[(Category=ReportingLifecycleProbe)]", "--explicit", "only",
    "--progress", "off", "--results-directory", directory], {
    windowsHide: true, env: { ...process.env, MOBILE_E2E_REPORTING_PROBE: directory,
      MOBILE_E2E_REPORTING_LEAK: mode === "leak" ? "1" : "0", MOBILE_E2E_HOST_DIAGNOSTICS: directory },
  });
  let output = "";
  for (const [name, stream] of [["stdout", child.stdout], ["stderr", child.stderr]]) {
    stream.on("data", chunk => { output += chunk; monitor.write(chunk, name); });
  }
  const closed = new Promise((resolveExit, reject) => { child.once("error", reject); child.once("close", resolveExit); });
  const deadline = setTimeout(() => child.kill("SIGKILL"), 20000);
  try {
    const exitCode = await closed;
    assert.notEqual(exitCode, null, "The original xUnit guard must exit before the probe watchdog.");
    const reporterJson = await readFile(join(directory, "reporter.json"), "utf8");
    const reporter = JSON.parse(reporterJson);
    await writeFile(join(artifacts, `${mode}-reporter.json`), reporterJson);
    const expectedBus = mode === "default" ? "Xunit.Internal.MessageBus" : "Xunit.Internal.SynchronousMessageBus";
    assert.equal(reporter.bus, expectedBus, `${mode}: the delivered reporting configuration must select the actual bus`);
    assert.equal(reporter.foregroundReporter, mode === "default");
    assert.equal(reporter.reporterIsAlive, mode === "default" ? true : null);
    if (mode !== "leak") {
      assert.equal(exitCode, 0);
      results[mode] = { exitCode, ...reporter };
    } else {
      await monitor.stop();
      assert.equal(exitCode, 1);
      assert.match(output, /FATAL ERROR.*Foreground threads/);
      const leakJson = await readFile(join(directory, "leak-thread.json"), "utf8");
      const leak = JSON.parse(leakJson);
      assert.equal(leak.isBackground, false);
      assert.equal(leak.name, "Intentional foreground leak regression");
      assert.match(leak.stack, /ReportingLifecycleProbe.*ObserveReportingAndShutdown/);
      await writeFile(join(artifacts, "leak-thread.json"), leakJson);
      // External full-CLR symbol rundown is diagnostic evidence, not a proxy for
      // the reporter's identity. Preserve its bounded success or exact failure.
      let externalStackCaptured = false;
      for (const file of (await readdir(directory)).filter(file => /^stack-\d+(?:-error)?\.txt$/.test(file))) {
        const stack = await readFile(join(directory, file), "utf8");
        await writeFile(join(artifacts, `external-${file}`), stack);
        externalStackCaptured ||= !file.endsWith("-error.txt") && stack.includes("ReportingLifecycleProbe");
      }
      results[mode] = { exitCode, foregroundLeak: true, ownStackRecorded: true, externalStackCaptured };
    }
  } finally {
    clearTimeout(deadline);
    child.kill();
    await closed;
    await monitor.stop();
    await writeFile(join(artifacts, `${mode}-output.txt`), output);
    assert.ok(!relative(resolve(tmpdir()), directory).startsWith(".."));
    await rm(directory, { recursive: true, force: true });
  }
}
await writeFile(join(artifacts, "verified.json"), JSON.stringify(results, null, 2));
console.log("Reporting lifecycle validated:", JSON.stringify(results));
