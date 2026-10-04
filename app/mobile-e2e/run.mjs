import { execFile, execFileSync, spawn } from "node:child_process";
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createServer } from "node:net";
import { promisify } from "node:util";
import { get } from "node:http";
import { prepareWda } from "./prepare-wda.mjs";

const directory = dirname(fileURLToPath(import.meta.url));
const runStarted = Date.now();
const platform = process.env.MOBILE_PLATFORM?.toLowerCase();
if (!["android", "ios"].includes(platform)) throw new Error("Set MOBILE_PLATFORM to Android or iOS.");
if (!process.env.MOBILE_UDID) throw new Error("Set MOBILE_UDID to the emulator/simulator identifier.");
const artifacts = process.env.MOBILE_E2E_ARTIFACTS ?? resolve(directory, "../.artifacts/mobile-e2e", platform);
mkdirSync(artifacts, { recursive: true });
const appPath = process.env.MOBILE_APP_PATH ?? resolve(directory,
  platform === "android"
    ? "../BibleOnSite/bin/Debug/net10.0-android/android-x64/com.tanah.daily929-Signed.apk"
    : "../BibleOnSite/bin/Debug/net10.0-ios/iossimulator-arm64/BibleOnSite.app");
if (!existsSync(appPath)) throw new Error(`Build the app with npm run build:app first: ${appPath}`);
if (platform === "ios" && !existsSync(resolve(appPath, "GoogleService-Info.plist"))) {
  throw new Error("The iOS app is missing its root Firebase configuration resource.");
}
const wdaPath = platform === "ios" ? (process.env.MOBILE_WDA_PATH ?? prepareWda()) : undefined;
// Refuse an existing listener so a local run cannot accidentally use somebody
// else's Appium session. CI assigns a whole runner to each matrix entry.
await new Promise((resolvePort, reject) => {
  const probe = createServer();
  probe.on("error", reject);
  probe.listen(4723, "127.0.0.1", () => probe.close(resolvePort));
});
const serverLog = openSync(resolve(artifacts, "appium.log"), "w");
const server = spawn(process.execPath, [resolve(directory, "node_modules/appium/index.js"),
  "--address", "127.0.0.1", "--port", "4723", "--log-no-colors",
  "--use-drivers", platform === "android" ? "uiautomator2" : "xcuitest"], {
  cwd: directory, windowsHide: true, stdio: ["ignore", serverLog, serverLog],
});
let serverExit;
server.on("exit", (code, signal) => { serverExit = `code ${code}, signal ${signal}`; });
let test;
let diagnosticsFailed = false;
const execute = promisify(execFile);

async function sampleIosApp() {
  try {
    // A failed session may already have terminated the app; pgrep returns 1 then.
    let processes;
    try {
      processes = await execute("pgrep", ["-x", "BibleOnSite"], { timeout: 30000 });
    } catch (error) {
      if (error.code === 1) return;
      throw error;
    }
    for (const pid of processes.stdout.trim().split("\n")) {
      if (!pid) continue;
      await execute("sample", [pid, "2", "1", "-mayDie", "-file", resolve(artifacts, `native-stack-${pid}.txt`)],
        { timeout: 120000 });
    }
  } catch (error) {
    diagnosticsFailed = true;
    writeFileSync(resolve(artifacts, "native-stack-error.txt"), String(error));
    console.error("Could not sample the iOS app:", error);
  }
}
const stop = () => { test?.kill(); server.kill(); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

function serverIsReady() {
  return new Promise((resolveReady, reject) => {
    const request = get({ hostname: "127.0.0.1", port: 4723, path: "/status", timeout: 1000 }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("error", reject);
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => {
        try {
          resolveReady(response.statusCode === 200 && JSON.parse(body).value?.ready === true);
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on("timeout", () => request.destroy(Object.assign(new Error("Appium readiness timed out"), { code: "ETIMEDOUT" })));
    request.on("error", (error) => {
      if (["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT"].includes(error.code)) {
        // The owned loopback service is still loading its driver.
        resolveReady(false);
      } else {
        reject(error);
      }
    });
  });
}

try {
  const deadline = Date.now() + 60000;
  let ready = false;
  while (Date.now() < deadline) {
    if (serverExit) throw new Error(`Appium exited (${serverExit}). See ${artifacts}/appium.log`);
    if (await serverIsReady()) { ready = true; break; }
    await delay(250);
  }
  if (!ready) throw new Error(`Appium did not become ready. See ${artifacts}/appium.log`);
  test = spawn("dotnet", ["run", "--project", "devops", "--", "TestMobileE2E", "--configuration", "Debug"], {
    cwd: resolve(directory, ".."), windowsHide: true, stdio: "inherit",
    env: { ...process.env, MOBILE_APP_PATH: appPath, MOBILE_E2E_ARTIFACTS: artifacts,
      ...(wdaPath ? { MOBILE_WDA_PATH: wdaPath } : {}), APPIUM_SERVER: "http://127.0.0.1:4723" },
  });
  process.exitCode = await new Promise((resolveExit, reject) => {
    test.on("error", reject);
    test.on("exit", (code) => resolveExit(code ?? 1));
  });
} finally {
  if (platform === "ios" && process.exitCode !== 0) {
    // Symbolication can consume substantial resources on simulator runners.
    // Sample surviving failed/hung apps after tests, never alongside healthy runs.
    await sampleIosApp();
  }
  if (diagnosticsFailed) process.exitCode ||= 1;
  try {
    const androidSdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
    const adb = androidSdk ? resolve(androidSdk, "platform-tools", process.platform === "win32" ? "adb.exe" : "adb") : "adb";
    const nativeLog = platform === "android"
      ? execFileSync(adb, ["-s", process.env.MOBILE_UDID, "logcat", "-d"], { encoding: "utf8", timeout: 30000, maxBuffer: 20 * 1024 * 1024, windowsHide: true })
      : execFileSync("xcrun", ["simctl", "spawn", process.env.MOBILE_UDID, "log", "show", "--style", "compact", "--last", `${Math.ceil((Date.now() - runStarted) / 1000)}s`, "--predicate", 'process == "BibleOnSite"'], { encoding: "utf8", timeout: 30000, maxBuffer: 20 * 1024 * 1024 });
    writeFileSync(resolve(artifacts, "device.log"), nativeLog);
    if (platform === "ios") {
      const lifecycleLog = execFileSync("xcrun", ["simctl", "spawn", process.env.MOBILE_UDID,
        "log", "show", "--style", "compact", "--last", "10m", "--predicate",
        '(process == "SpringBoard" OR process == "runningboardd" OR process == "ReportCrash") AND (eventMessage CONTAINS[c] "daily929" OR eventMessage CONTAINS[c] "BibleOnSite")'],
      { encoding: "utf8", timeout: 30000, maxBuffer: 20 * 1024 * 1024 });
      writeFileSync(resolve(artifacts, "app-lifecycle.log"), lifecycleLog);
      const reportDirectories = [resolve(homedir(), "Library/Logs/DiagnosticReports"),
        resolve(homedir(), "Library/Developer/CoreSimulator/Devices", process.env.MOBILE_UDID,
          "data/Library/Logs/CrashReporter")];
      for (const [index, reports] of reportDirectories.entries()) {
        if (!existsSync(reports)) continue;
        for (const report of readdirSync(reports)) {
          const source = resolve(reports, report);
          const metadata = statSync(source);
          if (report.startsWith("BibleOnSite") && metadata.isFile() && metadata.mtimeMs >= runStarted) {
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
  closeSync(serverLog);
}
