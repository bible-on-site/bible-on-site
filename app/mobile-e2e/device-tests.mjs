// XHarness device-test runner (#3349), executed inside the emulator-runner
// action like run.mjs: the device is already booted by the workflow's AVD
// machinery; this script proves readiness (writing the same device-readiness
// evidence the SDK cache validator reads), runs the TestDeviceAndroid Nuke
// target, then adapts the pulled xUnit-v2 XML into the JUnit report the
// results pipeline reads — including for a run whose tests failed.
import { execFile, spawn } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { waitForAndroidDevice } from "./android-readiness.mjs";
import { exportNativeLog } from "./native-logs.mjs";
import { adaptXHarnessResults } from "./xharness-results.mjs";

const directory = dirname(fileURLToPath(import.meta.url));
const appDirectory = resolve(directory, "..");
const udid = process.env.MOBILE_UDID;
if (!udid) throw new Error("Set MOBILE_UDID to the emulator identifier.");
const artifacts = process.env.MOBILE_E2E_ARTIFACTS ?? resolve(appDirectory, ".artifacts/device-tests");
mkdirSync(artifacts, { recursive: true });
const androidSdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
const adb = androidSdk
  ? resolve(androidSdk, "platform-tools", process.platform === "win32" ? "adb.exe" : "adb")
  : "adb";
const execute = promisify(execFile);

const readinessLog = resolve(artifacts, "device-readiness.jsonl");
writeFileSync(readinessLog, "");
await waitForAndroidDevice({
  adb, udid, execute,
  observe: (observation) => appendFileSync(readinessLog, `${JSON.stringify(observation)}\n`),
});

// Same prebuilt-tool contract as run.mjs: the workflow's harness-validation
// step leaves devops/bin/Debug/_build.dll behind, so MOBILE_E2E_PREBUILT=1
// starts no MSBuild evaluation. A local run without the flag goes through
// `dotnet run --project devops` as usual.
const launch = process.env.MOBILE_E2E_PREBUILT === "1"
  ? [resolve(appDirectory, "devops/bin/Debug/_build.dll")]
  : ["run", "--project", "devops", "--"];

let exitCode = 1;
try {
  exitCode = await new Promise((complete) => {
    const run = spawn("dotnet", [...launch, "TestDeviceAndroid"], {
      cwd: appDirectory,
      windowsHide: true,
      stdio: ["ignore", "inherit", "inherit"],
      env: { ...process.env, MOBILE_UDID: udid, MOBILE_E2E_ARTIFACTS: artifacts },
    });
    run.once("error", error => { console.error("Could not start TestDeviceAndroid:", error); complete(1); });
    run.once("exit", code => complete(code ?? 1));
  });
} finally {
  if (exitCode !== 0) {
    try {
      // A failing device-test run gets the same bounded logcat export the
      // Appium pilot does — the instrumentation's crash evidence lives there.
      // Runs BEFORE the adapter: a crashed instrumentation that produced no
      // XML still leaves its logcat behind.
      await exportNativeLog(adb, ["-s", udid, "logcat", "-d"], resolve(artifacts, "device.log"), 60000);
    } catch (error) {
      writeFileSync(resolve(artifacts, "device-log-error.txt"), String(error));
    }
  }
  // The adapter runs regardless of the instrumentation exit code: failed
  // tests still produce a report, and a missing report is the adapter's own
  // loud failure — never an empty green.
  const summary = adaptXHarnessResults({
    xharnessDir: resolve(artifacts, "xharness"),
    resultsDir: resolve(artifacts, "results"),
  });
  console.log(`device tests: ${summary.total} cases (${summary.passed} passed, ${summary.failed} failed, ${summary.skipped} skipped) -> ${summary.out}`);
}
process.exitCode = exitCode;
