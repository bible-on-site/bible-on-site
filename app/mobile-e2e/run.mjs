import { execFileSync, spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createServer } from "node:net";

const directory = dirname(fileURLToPath(import.meta.url));
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
const stop = () => { test?.kill(); server.kill(); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
try {
  const deadline = Date.now() + 60000;
  let ready = false;
  while (Date.now() < deadline) {
    if (serverExit) throw new Error(`Appium exited (${serverExit}). See ${artifacts}/appium.log`);
    try {
      const response = await fetch("http://127.0.0.1:4723/status", { signal: AbortSignal.timeout(1000) });
      if (response.ok && (await response.json()).value?.ready) { ready = true; break; }
    } catch (error) {
      if (!error.cause?.code && error.name !== "TimeoutError") throw error;
      // Connection refusal is expected until the server finishes loading its driver.
    }
    await delay(250);
  }
  if (!ready) throw new Error(`Appium did not become ready. See ${artifacts}/appium.log`);
  test = spawn("dotnet", ["run", "--project", "devops", "--", "TestMobileE2E", "--configuration", "Debug"], {
    cwd: resolve(directory, ".."), windowsHide: true, stdio: "inherit",
    env: { ...process.env, MOBILE_APP_PATH: appPath, MOBILE_E2E_ARTIFACTS: artifacts, APPIUM_SERVER: "http://127.0.0.1:4723" },
  });
  process.exitCode = await new Promise((resolveExit, reject) => {
    test.on("error", reject);
    test.on("exit", (code) => resolveExit(code ?? 1));
  });
} finally {
  try {
    const androidSdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
    const adb = androidSdk ? resolve(androidSdk, "platform-tools", process.platform === "win32" ? "adb.exe" : "adb") : "adb";
    const nativeLog = platform === "android"
      ? execFileSync(adb, ["-s", process.env.MOBILE_UDID, "logcat", "-d"], { encoding: "utf8", timeout: 30000, maxBuffer: 20 * 1024 * 1024, windowsHide: true })
      : execFileSync("xcrun", ["simctl", "spawn", process.env.MOBILE_UDID, "log", "show", "--style", "compact", "--last", "10m", "--predicate", 'process == "BibleOnSite"'], { encoding: "utf8", timeout: 30000, maxBuffer: 20 * 1024 * 1024 });
    writeFileSync(resolve(artifacts, "device.log"), nativeLog);
  } catch (error) {
    writeFileSync(resolve(artifacts, "device-log-error.txt"), String(error));
    console.error("Could not export native device logs:", error);
    process.exitCode ||= 1;
  }
  stop();
  closeSync(serverLog);
}
