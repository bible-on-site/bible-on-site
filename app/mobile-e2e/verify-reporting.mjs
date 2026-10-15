import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, readdir, rm, watch, writeFile } from "node:fs/promises";
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
    if (mode !== "leak") {
      const ready = join(directory, "ready");
      const events = watch(directory, { signal: AbortSignal.timeout(5000) });
      try {
        let isReady = false;
        try { await access(ready); isReady = true; } catch { /* The test has not reached its gate yet. */ }
        if (!isReady) {
          for await (const _event of events) {
            try { await access(ready); break; } catch { /* Registration precedes the ready signal. */ }
          }
        }
      } finally { await events.return(); }
      const pid = (await readFile(ready, "utf8")).trim();
      assert.match(pid, /^[1-9]\d*$/);
      const { stdout } = await execute(tool, ["report", "--process-id", pid], { timeout: 5000, windowsHide: true })
        .catch(async error => {
          await writeFile(join(artifacts, `${mode}-stack-error.txt`),
            [error.message, error.stdout, error.stderr].filter(Boolean).join("\n"));
          throw new Error(`${mode}: live reporting stack capture failed`, { cause: error });
        });
      const foregroundReporter = stdout.includes("Xunit.Internal.MessageBus.ReporterWorker");
      await writeFile(join(artifacts, `${mode}-stack.txt`), stdout);
      assert.equal(foregroundReporter, mode === "default", `${mode}: unexpected result reporter lifetime`);
      await writeFile(join(directory, "release"), "release");
      const exitCode = await closed;
      assert.equal(exitCode, 0);
      results[mode] = { exitCode, foregroundReporter };
    } else {
      const exitCode = await closed;
      await monitor.stop();
      assert.notEqual(exitCode, null, "The original xUnit guard must exit before the probe watchdog.");
      assert.notEqual(exitCode, 0);
      assert.match(output, /FATAL ERROR.*Foreground threads/);
      const files = (await readdir(directory)).filter(file => /^stack-\d+\.txt$/.test(file));
      let captured = false;
      for (const file of files) {
        const stack = await readFile(join(directory, file), "utf8");
        await writeFile(join(artifacts, `leak-${file}`), stack);
        captured ||= stack.includes("ReportingLifecycleProbe") && stack.includes("ObserveReportingAndShutdown");
      }
      assert.ok(captured, "The deliberate foreground leak must have a live managed stack.");
      results[mode] = { exitCode, intentionalWorkerCaptured: captured };
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
