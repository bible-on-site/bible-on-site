import { execFile, spawn } from "node:child_process";
import { appendFileSync, closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { promisify } from "node:util";
import { monitorNativeInteractions } from "./native-hang-monitor.mjs";
import { iosInteractionDiagnostics, sampleIosFallback } from "./ios-interaction-diagnostics.mjs";
import { listenScenarioFailures } from "./scenario-failure-monitor.mjs";
import { probeAppiumReadiness, waitForAppiumReadiness } from "./appium-readiness.mjs";
import { prepareWda } from "./prepare-wda.mjs";
import { captureNativeFrame, exportNativeLog, startNativeLog } from "./native-logs.mjs";
import { waitForAndroidDevice } from "./android-readiness.mjs";
import { installAppUnderTest } from "./android-install.mjs";
import { collectAndroidCrashDiagnostics } from "./android-crash-diagnostics.mjs";
import { iosAppLogPids, iosAppPids } from "./ios-processes.mjs";
import { terminateIosTestApp } from "./ios-app-cleanup.mjs";
import { captureTestHostStacks, monitorTestHostShutdown } from "./test-host-diagnostics.mjs";
import { prepareIosProcessInspector } from "./ios-process-inspector.mjs";
import { exitCode, phaseRecorder, remainingBudget } from "./shutdown-budget.mjs";

const directory = dirname(fileURLToPath(import.meta.url));
const runStarted = Date.now();
const platform = process.env.MOBILE_PLATFORM?.toLowerCase();
if (!["android", "ios"].includes(platform)) throw new Error("Set MOBILE_PLATFORM to Android or iOS.");
if (!process.env.MOBILE_UDID) throw new Error("Set MOBILE_UDID to the emulator/simulator identifier.");
const artifacts = process.env.MOBILE_E2E_ARTIFACTS ?? resolve(directory, "../.artifacts/mobile-e2e", platform);
mkdirSync(artifacts, { recursive: true });
// Coverage evidence is per-run state: a stale record from an earlier run must
// never attribute its automation ids to tests of this run (#2085).
rmSync(resolve(artifacts, "coverage-evidence"), { recursive: true, force: true });
// Same for executable coverage dumps pulled from the instrumented app
// process (#1232): a stale dump would merge another build's hits.
rmSync(resolve(artifacts, "app-coverage"), { recursive: true, force: true });
const appPath = process.env.MOBILE_APP_PATH ?? resolve(directory,
  platform === "android"
    ? "../BibleOnSite/bin/Debug/net10.0-android/android-x64/com.tanah.daily929-Signed.apk"
    : "../BibleOnSite/bin/Debug/net10.0-ios/iossimulator-arm64/BibleOnSite.app");
if (!existsSync(appPath)) throw new Error(`Build the app with bun run build:app first: ${appPath}`);
if (platform === "ios" && !existsSync(resolve(appPath, "GoogleService-Info.plist"))) {
  throw new Error("The iOS app is missing its root Firebase configuration resource.");
}
const execute = promisify(execFile);
let androidAdb;
if (platform === "android") {
  const androidSdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
  const adb = androidSdk ? resolve(androidSdk, "platform-tools", process.platform === "win32" ? "adb.exe" : "adb") : "adb";
  androidAdb = adb;
  const deviceReadinessLog = resolve(artifacts, "device-readiness.jsonl");
  writeFileSync(deviceReadinessLog, "");
  await waitForAndroidDevice({ adb, udid: process.env.MOBILE_UDID, execute,
    observe: (observation) => appendFileSync(deviceReadinessLog, `${JSON.stringify(observation)}\n`) });
}
const inspectorPath = platform === "ios" ? await prepareIosProcessInspector() : undefined;
const wdaPath = platform === "ios" ? (process.env.MOBILE_WDA_PATH ?? prepareWda()) : undefined;
// Sharded iOS runs host one Appium server per simulator on the same runner, so
// the port is configurable; a single run keeps the default 4723.
const appiumPort = process.env.MOBILE_APPIUM_PORT ?? "4723";
if (!/^[0-9]+$/.test(appiumPort)) throw new Error(`MOBILE_APPIUM_PORT must be a port number, got '${appiumPort}'.`);
// Refuse an existing listener so a local run cannot accidentally use somebody
// else's Appium session. CI assigns a whole runner to each matrix entry.
await new Promise((resolvePort, reject) => {
  const probe = createServer();
  probe.on("error", reject);
  probe.listen(Number(appiumPort), "127.0.0.1", () => probe.close(resolvePort));
});
if (platform === "android") {
  // `adb install` picks an IncFS incremental install whenever the binary and
  // device support it; Xamarin mmaps assemblies.blob out of the staged APK and
  // can SIGSEGV in libmonodroid open_from_bundles before IncFS materializes
  // the page (#2773). The pilot installs the AUT on the deterministic
  // --no-incremental path and marks it preinstalled so UiAutomator2 keeps
  // reusing it under noReset — driver-initiated installs would be incremental
  // again. MOBILE_KEEP_APP swaps the APK while retaining the review data.
  const installation = await installAppUnderTest({ adb: androidAdb, udid: process.env.MOBILE_UDID,
    appPath, packageId: "com.tanah.daily929", keepData: process.env.MOBILE_KEEP_APP === "1", execute });
  console.log(installation.output);
}
let serverLogOpen = true;
const serverLog = openSync(resolve(artifacts, "appium.log"), "w");
const interactions = platform === "ios" ? iosInteractionDiagnostics({
  artifacts, udid: process.env.MOBILE_UDID,
  nativeLog: resolve(artifacts, "device-live.log"), execute,
}) : undefined;
const hangMonitor = interactions ? monitorNativeInteractions((command, request) =>
  interactions.capture(command, request)) : undefined;
const server = spawn(process.execPath, [resolve(directory, "node_modules/appium/index.js"),
  "--address", "127.0.0.1", "--port", appiumPort, "--log-no-colors", "--log-timestamp",
  "--use-drivers", platform === "android" ? "uiautomator2" : "xcuitest"], {
  cwd: directory, windowsHide: true, stdio: ["ignore", hangMonitor ? "pipe" : serverLog, hangMonitor ? "pipe" : serverLog],
});
for (const stream of [server.stdout, server.stderr].filter(Boolean)) {
  stream.on("data", (chunk) => {
    if (serverLogOpen) writeSync(serverLog, chunk);
    if (stream === server.stdout) hangMonitor?.write(chunk);
  });
}
let serverExit;
server.on("exit", (code, signal) => { serverExit = `code ${code}, signal ${signal}`; });
const readinessLog = resolve(artifacts, "appium-readiness.jsonl");
writeFileSync(readinessLog, "");
const readinessStarted = Date.now();
const observeReadiness = (observation) => appendFileSync(readinessLog, `${JSON.stringify({
  time: new Date().toISOString(), elapsedMs: Date.now() - readinessStarted, ...observation,
})}\n`);
server.on("spawn", () => observeReadiness({ phase: "spawned", pid: server.pid }));
const hostDiagnostics = resolve(artifacts, "test-host-diagnostics");
rmSync(hostDiagnostics, { recursive: true, force: true });
mkdirSync(hostDiagnostics, { recursive: true });
const shutdownMonitor = process.env.MOBILE_E2E_DOTNET_STACK
  ? monitorTestHostShutdown(() => captureTestHostStacks(hostDiagnostics,
    process.env.MOBILE_E2E_DOTNET_STACK, execute)) : undefined;
let test;
let diagnosticsFailed = false;
const androidEmulator = platform === "android" && /^emulator-\d+$/.test(process.env.MOBILE_UDID);
let nativeStream;
if (platform === "ios") {
  nativeStream = startNativeLog("xcrun", ["simctl", "spawn", process.env.MOBILE_UDID,
    "log", "stream", "--style", "compact", "--level", "info", "--predicate", 'process == "BibleOnSite"'],
    resolve(artifacts, "device-live.log"));
} else if (androidEmulator) {
  try {
    // Record before the first AUT launch so a process that dies between tests
    // still leaves its PID, lifecycle and native crash output in this run.
    nativeStream = startNativeLog(androidAdb, ["-s", process.env.MOBILE_UDID,
      "logcat", "-b", "main,system,crash,events", "-v", "threadtime", "-T", "1"],
      resolve(artifacts, "device-live.log"));
  } catch (error) {
    writeFileSync(resolve(artifacts, "android-native-log-start-error.txt"), String(error));
    console.error("Could not start Android native log capture:", error.message);
  }
}

async function sampleIosApp(phase) {
  const captureSignal = AbortSignal.timeout(15000);
  try {
    // Another simulator may share this host, so a name-wide pgrep could
    // sample a different device's healthy app — writing its stacks into this
    // run's failure artifacts and pausing it mid-test. The device's own
    // launchd table resolves only this run's app; a failed session that
    // already terminated the app simply leaves no PID row to find.
    const listing = await execute("xcrun", ["simctl", "spawn", process.env.MOBILE_UDID,
      "launchctl", "list"], { timeout: 5000, signal: captureSignal });
    writeFileSync(resolve(artifacts, `native-${phase}-processes.txt`), listing.stdout);
    try {
      await execute("xcrun", ["simctl", "io", process.env.MOBILE_UDID, "screenshot",
        resolve(artifacts, `native-${phase}.png`)], { timeout: 5000, signal: captureSignal });
    } catch (error) {
      diagnosticsFailed = true;
      writeFileSync(resolve(artifacts, `native-${phase}-screenshot-error.txt`), String(error));
      console.error("Could not capture the iOS frame:", error.message);
    }
    for (const pid of iosAppPids(listing.stdout)) {
      const stats = await execute("ps", ["-p", pid, "-o", "pid,ppid,%cpu,rss,state"], { timeout: 5000, signal: captureSignal });
      writeFileSync(resolve(artifacts, `native-${phase}-process-${pid}.txt`), stats.stdout);
      // Sampling a busy process stalled for its entire 120-second budget.
      // Attach without eager symbol loading, capture a bounded backtrace and
      // detach. Loss of debugger connection must also leave the app detached.
      const captured = await execute("sudo", ["-n", "xcrun", "lldb", "--no-lldbinit", "--batch",
        "--one-line-before-file", "settings set target.preload-symbols false",
        "--one-line-before-file", "settings set target.detach-on-error true",
        "--attach-pid", pid, "--one-line", "thread backtrace -c 40 all",
        "--one-line", "process detach"], { timeout: 10000, signal: captureSignal });
      writeFileSync(resolve(artifacts, `native-${phase}-stack-${pid}.txt`), captured.stdout + captured.stderr);
    }
  } catch (error) {
    diagnosticsFailed = true;
    writeFileSync(resolve(artifacts, `native-${phase}-stack-error.txt`), JSON.stringify({
      message: error.message, code: error.code, killed: error.killed, signal: error.signal,
      stdout: error.stdout, stderr: error.stderr,
    }, null, 2));
    console.error("Could not sample the iOS app:", error);
  }
}
let failureObserverConfirmed = false;
const failureDirectory = resolve(hostDiagnostics, "scenario-failures");
if (platform === "ios") mkdirSync(failureDirectory, { recursive: true });
let failureMonitor;
const stop = () => { test?.kill(); server.kill(); nativeStream?.kill(); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

try {
  failureMonitor = interactions ? await listenScenarioFailures(failureDirectory, async (request, { signal } = {}) => {
    const result = await interactions.failure(request, { signal });
    if (result.status === "error") diagnosticsFailed = true;
    return result;
  }) : undefined;
  const ready = await waitForAppiumReadiness({ observe: observeReadiness, exited: () => serverExit,
    probe: (options) => probeAppiumReadiness({ ...options, port: Number(appiumPort) }) });
  if (!ready) throw new Error(`Appium did not become ready. See ${artifacts}/appium.log`);
  const launch = process.env.MOBILE_E2E_PREBUILT === "1"
    ? [resolve(directory, "../devops/bin/Debug/_build.dll")]
    : ["run", "--project", "devops", "--"];
  test = spawn("dotnet", [...launch, "TestMobileE2E", "--configuration", "Debug"], {
    cwd: resolve(directory, ".."), windowsHide: true, stdio: ["inherit", "pipe", "pipe"],
    env: { ...process.env, MOBILE_APP_PATH: appPath, MOBILE_E2E_ARTIFACTS: artifacts, MOBILE_E2E_HOST_DIAGNOSTICS: hostDiagnostics,
      MOBILE_E2E_FAILURE_DIAGNOSTICS: failureMonitor ? failureDirectory : "",
      MOBILE_E2E_FAILURE_DIAGNOSTICS_PORT: failureMonitor ? String(failureMonitor.port) : "",
      ...(wdaPath ? { MOBILE_WDA_PATH: wdaPath } : {}),
      ...(platform === "android" ? { MOBILE_APP_PREINSTALLED: "1" } : {}),
      APPIUM_SERVER: `http://127.0.0.1:${appiumPort}` },
  });
  for (const [name, stream, output] of [["stdout", test.stdout, process.stdout], ["stderr", test.stderr, process.stderr]]) {
    stream.on("data", chunk => {
      output.write(chunk);
      shutdownMonitor?.write(chunk, name);
    });
  }
  // 'close' waits for stdio, and a grandchild inheriting the pipes can hold it
  // past the pilot deadline after the test process already exited (#2423).
  process.exitCode = await exitCode(test);
} finally {
  // Cleanup shares the supervisor's wall-clock deadline: each phase is timed
  // into pilot-phases.jsonl and log exports are capped by the remaining budget
  // so diagnostics cannot consume it after a green run (#2423).
  const deadlineMs = Number(process.env.MOBILE_E2E_PILOT_DEADLINE_MS);
  const phase = phaseRecorder(resolve(artifacts, "pilot-phases.jsonl"));
  const budget = (capMs) => Math.min(capMs, remainingBudget(deadlineMs, 3000));
  try {
    await phase("test-host-shutdown", () => shutdownMonitor?.stop());
  } catch (error) {
    diagnosticsFailed = true;
    console.error("Could not capture test-host shutdown stacks:", error);
  }
  try {
    await phase("scenario-failure-monitor", () => failureMonitor?.stop());
    failureObserverConfirmed = true;
  } catch (error) {
    diagnosticsFailed = true;
    console.error("Could not finish scenario-failure handoff:", error);
  }
  try {
    await phase("native-hang-monitor", () => hangMonitor?.stop());
  } catch (error) {
    diagnosticsFailed = true;
    console.error("Could not finish native hang capture:", error);
  }
  try {
    await phase("native-log-stream", () => nativeStream?.stop());
  } catch (error) {
    if (platform === "ios") diagnosticsFailed = true;
    else writeFileSync(resolve(artifacts, "android-native-log-stop-error.txt"), String(error));
    console.error("Could not finish native log stream:", error);
  }
  if (androidEmulator && process.exitCode !== 0) {
    // Failure-only, read-only collection: never attach to a healthy app, root
    // the emulator, retry the test, or extend the shared pilot deadline.
    try {
      await phase("android-crash-diagnostics", () => collectAndroidCrashDiagnostics({
        adb: androidAdb, udid: process.env.MOBILE_UDID, artifacts, runStarted,
        timeoutMs: budget(15000), execute,
      }));
    } catch (error) {
      writeFileSync(resolve(artifacts, "android-crash-diagnostics-error.txt"), String(error));
      console.error("Could not capture Android crash diagnostics:", error.message);
    }
  }
  if (platform === "ios" && test && process.exitCode !== 0) {
    // Symbolication can consume substantial resources on simulator runners.
    // Sample surviving apps only if no earlier failure handoff could identify the original.
    // An exited/unknown pinned PID must never fall back to a later scenario's app.
    const outcome = await phase("ios-app-sampling", () =>
      sampleIosFallback(failureMonitor, failureObserverConfirmed, () => sampleIosApp("cleanup")));
    writeFileSync(resolve(artifacts, "native-cleanup-sampling.json"), JSON.stringify(outcome, null, 2));
  }
  if (diagnosticsFailed) process.exitCode ||= 1;
  if (platform === "ios") {
    try {
      const cleanup = await phase("ios-app-terminate", () =>
        terminateIosTestApp(process.env.MOBILE_UDID, {
          keepApp: process.env.MOBILE_KEEP_APP === "1", inspectorPath,
          observedPids: () => iosAppLogPids(readFileSync(resolve(artifacts, "device-live.log"), "utf8")),
        }));
      writeFileSync(resolve(artifacts, "ios-app-cleanup.json"), JSON.stringify(cleanup, null, 2));
    } catch (error) {
      writeFileSync(resolve(artifacts, "ios-app-cleanup-error.txt"), String(error));
      console.error("Could not terminate this run's iOS app:", error);
      process.exitCode ||= 1;
    }
  }
  try {
    const androidSdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
    const adb = androidSdk ? resolve(androidSdk, "platform-tools", process.platform === "win32" ? "adb.exe" : "adb") : "adb";
    // Log export duration scales with how long the suite ran; a 30s budget
    // intermittently times out after a full test pass and fails the job.
    // Each export is further capped by the remaining pilot deadline (#2423).
    const logExportTimeout = 120000;
    const command = platform === "android" ? adb : "xcrun";
    const args = platform === "android"
      ? ["-s", process.env.MOBILE_UDID, "logcat", "-d"]
      : ["simctl", "spawn", process.env.MOBILE_UDID, "log", "show", "--style", "compact", "--last", `${Math.ceil((Date.now() - runStarted) / 1000)}s`, "--predicate", 'process == "BibleOnSite"'];
    const deviceLogBudget = budget(logExportTimeout);
    if (deviceLogBudget > 0)
      await phase("device-log-export", () =>
        exportNativeLog(command, args, resolve(artifacts, "device.log"), deviceLogBudget));
    else
      writeFileSync(resolve(artifacts, "device-log-skipped.txt"),
        "Skipped: the pilot deadline left no remaining budget for log export.");
    if (platform === "ios") {
      const lifecycleBudget = budget(logExportTimeout);
      if (lifecycleBudget > 0)
        await phase("app-lifecycle-export", () =>
          exportNativeLog("xcrun", ["simctl", "spawn", process.env.MOBILE_UDID,
            "log", "show", "--style", "compact", "--last", "10m", "--predicate",
            '(process == "SpringBoard" OR process == "runningboardd" OR process == "ReportCrash" OR process == "testmanagerd") AND (eventMessage CONTAINS[c] "daily929" OR eventMessage CONTAINS[c] "BibleOnSite" OR eventMessage CONTAINS[c] "WebDriverAgent" OR eventMessage CONTAINS[c] "xctrunner")'],
          resolve(artifacts, "app-lifecycle.log"), lifecycleBudget));
      else
        writeFileSync(resolve(artifacts, "app-lifecycle-skipped.txt"),
          "Skipped: the pilot deadline left no remaining budget for log export.");
      await phase("crash-report-copy", () => {
        const reportDirectories = [resolve(homedir(), "Library/Logs/DiagnosticReports"),
          resolve(homedir(), "Library/Developer/CoreSimulator/Devices", process.env.MOBILE_UDID,
            "data/Library/Logs/CrashReporter")];
        for (const [index, reports] of reportDirectories.entries()) {
          if (!existsSync(reports)) continue;
          for (const report of readdirSync(reports)) {
            const source = resolve(reports, report);
            const metadata = statSync(source);
            if ((report.startsWith("BibleOnSite") || report.startsWith("WebDriverAgent")) && metadata.isFile() && metadata.mtimeMs >= runStarted) {
              copyFileSync(source, resolve(artifacts, `crash-${index}-${report}`));
            }
          }
        }
      });
    }
  } catch (error) {
    // Diagnostic-only: a failed log export must not fail a passing run.
    writeFileSync(resolve(artifacts, "device-log-error.txt"), String(error));
    console.error("Could not export native device logs:", error);
  }
  stop();
  serverLogOpen = false;
  closeSync(serverLog);
}
