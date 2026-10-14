import { execFile, execFileSync, spawn } from "node:child_process";
import { appendFileSync, closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { promisify } from "node:util";
import { monitorNativeInteractions } from "./native-hang-monitor.mjs";
import { probeAppiumReadiness, waitForAppiumReadiness } from "./appium-readiness.mjs";
import { prepareWda } from "./prepare-wda.mjs";
import { captureNativeFrame, exportNativeLog, startNativeLog } from "./native-logs.mjs";
import { waitForAndroidDevice } from "./android-readiness.mjs";
import { iosAppLogPids, iosAppPids } from "./ios-processes.mjs";
import { terminateIosTestApp } from "./ios-app-cleanup.mjs";

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
if (!existsSync(appPath)) throw new Error(`Build the app with npm run build:app first: ${appPath}`);
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
if (platform === "android" && process.env.MOBILE_KEEP_APP === "1") {
  // UiAutomator2 skips installation entirely with noReset, even when
  // enforceAppInstall is set. Replace the APK while retaining the review data.
  const installation = await execute(androidAdb, ["-s", process.env.MOBILE_UDID, "install", "-r", appPath],
    { timeout: 180000 });
  console.log(installation.stdout.trim());
}
let serverLogOpen = true;
const serverLog = openSync(resolve(artifacts, "appium.log"), "w");
const hangMonitor = platform === "ios" ? monitorNativeInteractions(async (command) => {
  writeFileSync(resolve(artifacts, "native-hang-command.txt"), command);
  // Commands can exceed the observation threshold and still finish within
  // their interaction deadline. Capture through CoreSimulator without app
  // process queries or debugger attachment; sample stacks only after failure.
  const error = await captureNativeFrame("xcrun", ["simctl", "io", process.env.MOBILE_UDID, "screenshot"],
    resolve(artifacts, "native-interaction.png"), execute);
  if (error) console.error("Could not capture the pending interaction frame:", error.message);
}) : undefined;
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
let test;
let diagnosticsFailed = false;
const nativeStream = platform === "ios" ? startNativeLog("xcrun", ["simctl", "spawn", process.env.MOBILE_UDID,
  "log", "stream", "--style", "compact", "--level", "info", "--predicate", 'process == "BibleOnSite"'],
  resolve(artifacts, "device-live.log")) : undefined;

async function sampleIosApp(phase) {
  const captureSignal = AbortSignal.timeout(15000);
  try {
    // Two shard simulators share this host (#2083), so a name-wide pgrep would
    // also sample the peer's healthy app — writing its stacks into this
    // shard's failure artifacts and pausing it mid-test. The device's own
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
const stop = () => { test?.kill(); server.kill(); nativeStream?.kill(); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

try {
  const ready = await waitForAppiumReadiness({ observe: observeReadiness, exited: () => serverExit,
    probe: (options) => probeAppiumReadiness({ ...options, port: Number(appiumPort) }) });
  if (!ready) throw new Error(`Appium did not become ready. See ${artifacts}/appium.log`);
  const launch = process.env.MOBILE_E2E_PREBUILT === "1"
    ? [resolve(directory, "../devops/bin/Debug/_build.dll")]
    : ["run", "--project", "devops", "--"];
  test = spawn("dotnet", [...launch, "TestMobileE2E", "--configuration", "Debug"], {
    cwd: resolve(directory, ".."), windowsHide: true, stdio: "inherit",
    env: { ...process.env, MOBILE_APP_PATH: appPath, MOBILE_E2E_ARTIFACTS: artifacts,
      ...(wdaPath ? { MOBILE_WDA_PATH: wdaPath } : {}), APPIUM_SERVER: `http://127.0.0.1:${appiumPort}` },
  });
  process.exitCode = await new Promise((resolveExit, reject) => {
    test.on("error", reject);
    test.on("exit", (code) => resolveExit(code ?? 1));
  });
} finally {
  try {
    await hangMonitor?.stop();
  } catch (error) {
    diagnosticsFailed = true;
    console.error("Could not finish native hang capture:", error);
  }
  try {
    await nativeStream?.stop();
  } catch (error) {
    diagnosticsFailed = true;
    console.error("Could not finish native log stream:", error);
  }
  if (platform === "ios" && process.exitCode !== 0) {
    // Symbolication can consume substantial resources on simulator runners.
    // Sample surviving failed/hung apps after tests, never alongside healthy runs.
    await sampleIosApp("cleanup");
  }
  if (diagnosticsFailed) process.exitCode ||= 1;
  if (platform === "ios") {
    try {
      const cleanup = await terminateIosTestApp(process.env.MOBILE_UDID, {
        keepApp: process.env.MOBILE_KEEP_APP === "1",
        observedPids: () => iosAppLogPids(readFileSync(resolve(artifacts, "device-live.log"), "utf8")),
      });
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
    const logExportTimeout = 120000;
    const command = platform === "android" ? adb : "xcrun";
    const args = platform === "android"
      ? ["-s", process.env.MOBILE_UDID, "logcat", "-d"]
      : ["simctl", "spawn", process.env.MOBILE_UDID, "log", "show", "--style", "compact", "--last", `${Math.ceil((Date.now() - runStarted) / 1000)}s`, "--predicate", 'process == "BibleOnSite"'];
    exportNativeLog(command, args, resolve(artifacts, "device.log"), logExportTimeout);
    if (platform === "ios") {
      exportNativeLog("xcrun", ["simctl", "spawn", process.env.MOBILE_UDID,
        "log", "show", "--style", "compact", "--last", "10m", "--predicate",
        '(process == "SpringBoard" OR process == "runningboardd" OR process == "ReportCrash" OR process == "testmanagerd") AND (eventMessage CONTAINS[c] "daily929" OR eventMessage CONTAINS[c] "BibleOnSite" OR eventMessage CONTAINS[c] "WebDriverAgent" OR eventMessage CONTAINS[c] "xctrunner")'],
      resolve(artifacts, "app-lifecycle.log"), logExportTimeout);
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
    }
  } catch (error) {
    writeFileSync(resolve(artifacts, "device-log-error.txt"), String(error));
    console.error("Could not export native device logs:", error);
    process.exitCode ||= 1;
  }
  stop();
  serverLogOpen = false;
  closeSync(serverLog);
}
