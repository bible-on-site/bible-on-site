import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { createConnection } from "node:net";
import { promisify } from "node:util";
import { captureTestHostStacks, monitorTestHostShutdown } from "./test-host-diagnostics.mjs";

const [assemblyArgument, tool, artifactsArgument] = process.argv.slice(2);
assert.ok(assemblyArgument && tool && artifactsArgument, "Require harness DLL, stack tool and artifact directory.");
const assembly = resolve(assemblyArgument);
const artifacts = resolve(artifactsArgument, "reporting-validation");
await mkdir(artifacts, { recursive: true });
const execute = promisify(execFile);
const results = {};
for (const mode of ["default", "synchronous", "leak", "sdk-exit", "telemetry-disabled"]) {
  const directory = await mkdtemp(join(tmpdir(), "mobile-reporting-probe-"));
  const config = mode === "default" ? join(directory, "testconfig.json") : join(dirname(assembly), "testconfig.json");
  if (mode === "default") await writeFile(config, "{}");
  const monitor = monitorTestHostShutdown(() => captureTestHostStacks(directory, tool, execute));
  const child = spawn("dotnet", [assembly, "--config-file", config,
    "--filter-query", "/[(Category=ReportingLifecycleProbe)]", "--explicit", "only",
    "--progress", "off", "--results-directory", directory,
    "--diagnostic", "--diagnostic-verbosity", "Information",
    "--diagnostic-output-directory", join(artifacts, `${mode}-mtp`)], {
    windowsHide: true, env: { ...process.env, MOBILE_E2E_REPORTING_PROBE: directory,
      TESTINGPLATFORM_TELEMETRY_OPTOUT: mode === "sdk-exit" ? "0" : "1",
      DOTNET_CLI_TELEMETRY_OPTOUT: mode === "sdk-exit" ? "0" : process.env.DOTNET_CLI_TELEMETRY_OPTOUT,
      MOBILE_E2E_SDK_EXIT_PROBE: mode === "sdk-exit" ? "1" : "0",
      MOBILE_E2E_TELEMETRY_DISABLED_PROBE: mode === "telemetry-disabled" ? "1" : "0",
      MOBILE_E2E_REPORTING_LEAK: mode === "leak" ? "1" : "0", MOBILE_E2E_HOST_DIAGNOSTICS: directory },
  });
  let output = "";
  let release;
  let releaseError;
  for (const [name, stream] of [["stdout", child.stdout], ["stderr", child.stderr]]) {
    stream.on("data", chunk => {
      output += chunk;
      monitor.write(chunk, name);
      if (mode === "sdk-exit" && !release && /FATAL ERROR.*Foreground threads/.test(output)) {
        // Unblock the SDK's actual exit callback only after the original guard
        // reports the failure. No foreground application thread was created.
        release = readFile(join(directory, "sdk-exit.json"), "utf8").then(json => new Promise((resolveRelease, rejectRelease) => {
          const socket = createConnection({ host: "127.0.0.1", port: JSON.parse(json).releasePort });
          socket.once("error", rejectRelease);
          socket.once("connect", () => { socket.end(); resolveRelease(); });
        })).catch(error => { releaseError = error; });
      }
    });
  }
  const closed = new Promise((resolveExit, reject) => { child.once("error", reject); child.once("close", resolveExit); });
  const deadline = setTimeout(() => child.kill("SIGKILL"), 20000);
  try {
    const exitCode = await closed;
    await release;
    if (releaseError) throw releaseError;
    assert.notEqual(exitCode, null, `${mode}: the test host did not finish inside the existing 20-second process budget; inspect its startup diagnostics.`);
    const reporterJson = await readFile(join(directory, "reporter.json"), "utf8");
    const reporter = JSON.parse(reporterJson);
    await writeFile(join(artifacts, `${mode}-reporter.json`), reporterJson);
    const expectedBus = mode === "default" ? "Xunit.Internal.MessageBus" : "Xunit.Internal.SynchronousMessageBus";
    assert.equal(reporter.bus, expectedBus, `${mode}: the delivered reporting configuration must select the actual bus`);
    assert.equal(reporter.foregroundReporter, mode === "default");
    assert.equal(reporter.reporterIsAlive, mode === "default" ? true : null);
    if (mode === "sdk-exit") {
      await monitor.stop();
      assert.equal(exitCode, 1);
      assert.match(output, /FATAL ERROR.*Foreground threads/);
      const sdkJson = await readFile(join(directory, "sdk-exit.json"), "utf8");
      const sdk = JSON.parse(sdkJson);
      assert.equal(sdk.applicationForegroundThreadsCreated, 0);
      assert.match(sdk.callback, /SelfDiagnosticsInitializer$/);
      await writeFile(join(artifacts, "sdk-exit.json"), sdkJson);
      for (const file of (await readdir(directory)).filter(file => /^stack-\d+(?:-error)?\.txt$/.test(file))) {
        await copyFile(join(directory, file), join(artifacts, `sdk-exit-${file}`));
      }
      results[mode] = { exitCode, backgroundSdkExitBlock: true, applicationForegroundThreadsCreated: 0 };
    } else if (mode === "telemetry-disabled") {
      assert.equal(exitCode, 0);
      const telemetry = JSON.parse(await readFile(join(directory, "telemetry.json"), "utf8"));
      assert.deepEqual(telemetry, { optedOut: true, sdkLoaded: false });
      results[mode] = { exitCode, ...telemetry };
    } else if (mode !== "leak") {
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
    const registrations = (await readdir(directory)).filter(file => /^host-\d+\.json$/.test(file));
    await writeFile(join(artifacts, `${mode}-process.json`), JSON.stringify({
      pid: child.pid, exitCode: child.exitCode, signal: child.signalCode, registrations,
    }, null, 2));
    for (const file of (await readdir(directory)).filter(file => /^(?:host-\d+|reporter|leak-thread)\.json$/.test(file))) {
      await copyFile(join(directory, file), join(artifacts, `${mode}-${file}`));
    }
    assert.ok(!relative(resolve(tmpdir()), directory).startsWith(".."));
    await rm(directory, { recursive: true, force: true });
  }
}
await writeFile(join(artifacts, "verified.json"), JSON.stringify(results, null, 2));
console.log("Reporting lifecycle validated:", JSON.stringify(results));
