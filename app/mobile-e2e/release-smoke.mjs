// Android Release startup smoke (#2373): installs the Release-configuration
// APK and proves the production startup path reaches a usable reader without
// crashing. Debug/e2e builds define DISABLE_ANALYTICS, so only this leg can
// execute the Firebase Analytics initialization that killed #2247 store
// builds while every green test kept passing.
//
// Analytics isolation (#2120) is preserved at runtime, not by compiling the
// branch out: the cold launch carries the suite's BIBLE_E2E intent extra, so
// MainActivity still calls FirebaseAnalyticsImplementation.Initialize — the
// exact member that NRE'd — and then sets IsAnalyticsCollectionEnabled=false.
// The smoke fails if that marker is absent (path not exercised), reports
// enabled=true (isolation lost), or logs the DISABLE_ANALYTICS build line
// (the leg shipped the wrong build).
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { waitForAndroidDevice } from "./android-readiness.mjs";
import { startNativeLog } from "./native-logs.mjs";

export const APP_PACKAGE = "com.tanah.daily929";
// Matches the mobile suite's standard first-screen wait (PerekPage.WaitForStartup).
const READER_DEADLINE_MS = 45000;
// #2247's NRE fired inside OnCreate; the post-ready hold keeps watching for
// late managed/native deaths and ANRs beyond that original crash window.
const LIVENESS_HOLD_MS = 10000;
const POLL_MS = 750;
const ADB_CALL_TIMEOUT_MS = 30000;
const UI_DUMP_PATH = "/data/local/tmp/release-smoke-ui.xml";
// The app interpolates a C# bool — enabled=False — so accept either casing.
const ANALYTICS_LINE = /\[Analytics\] collection enabled=(true|false)/i;
const ANALYTICS_COMPILED_OUT =
  "[Analytics] collection deactivated at build time (DISABLE_ANALYTICS)";

const FATAL_SIGNAL = /Fatal signal \d+ \(SIG/;
const DIED_PID = /\(pid \d+\) has died/;
const TEARDOWN_DEADLINE_MS = 10000;

// Killing the app — force-stop, `pm clear`, or `install -r` over a running
// package — races the per-phase logcat clear: WMS posts the dead window's
// WIN DEATH on the system_server thread after the kill returns, so a clear
// that wins the race still records the stale death as a crash of the new
// launch (the upgrade phase hit this in #2700). Wait for the process to die
// and give the window teardown one more poll to post before clearing.
export async function waitForProcessTeardown(isAlive, sleep, deadlineMs = TEARDOWN_DEADLINE_MS) {
  const goneDeadline = Date.now() + deadlineMs;
  while (await isAlive() && Date.now() < goneDeadline) {
    await sleep(POLL_MS);
  }
  await sleep(POLL_MS);
}

// Unexpected-death records scoped to this package. "has died"/"WIN DEATH" are
// checked only inside a launch window (logcat is cleared per phase), where a
// process death can never be a planned force-stop. Plain-string scoping keeps
// the signatures literal — dynamic RegExp is a flagged ReDoS vector here.
export function crashSignatures(logcat, pkg) {
  const found = [];
  const lines = logcat.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const window = lines.slice(i, i + 4).join("\n");
    if (line.includes("FATAL EXCEPTION") && window.includes(`Process: ${pkg},`)) {
      found.push(`FATAL EXCEPTION (${pkg})`);
    }
    if (FATAL_SIGNAL.test(line) && window.includes(pkg)) {
      found.push(line.trim());
    }
    if (line.includes(`ANR in ${pkg}`)) {
      found.push(`ANR in ${pkg}`);
    }
    if (line.includes(`Process ${pkg} (pid `) && DIED_PID.test(line)) {
      found.push(`process death (${pkg})`);
    }
    if (line.includes("WIN DEATH") && line.includes(pkg)) {
      found.push("window death");
    }
  }
  return [...new Set(found)];
}

// "isolated" is the only passing state: initialization ran and collection
// stayed off. "live" means suite traffic would reach the production property;
// "compiled-out" means a DISABLE_ANALYTICS build slipped into the guard and
// the startup path never ran; "absent" means the marker never printed.
export function analyticsStatus(logcat, _pkg) {
  if (logcat.includes(ANALYTICS_COMPILED_OUT)) return { state: "compiled-out" };
  const match = logcat.match(ANALYTICS_LINE);
  if (!match) return { state: "absent" };
  return { state: match[1].toLowerCase() === "false" ? "isolated" : "live" };
}

// Start before launch: noisy emulator services can overwrite the startup
// marker in Android's circular buffer before the first UI dump completes.
export function startReleaseLog(command, args, destination) {
  const stream = startNativeLog(command, args, destination);
  let stopping;
  return {
    read: () => readFileSync(destination, "utf8"),
    stop: () => stopping ??= stream.stop(),
  };
}

// MAUI maps AutomationId to resource-id under the app package namespace.
const READER_NODE = /<node\b[^>]*\bresource-id="com\.tanah\.daily929:id\/PerekSource"[^>]*>/;

export function readerReady(uiXml) {
  const node = READER_NODE.exec(uiXml);
  if (!node) return false;
  const text = /\btext="([^"]*)"/.exec(node[0]);
  return !!text && text[1].trim().length > 0;
}

export function launcherComponent(resolveOutput) {
  const line = resolveOutput.split("\n").map(l => l.trim()).filter(l => l.includes("/")).pop();
  if (!line || !/^[\w.]+[\w$]*\/[\w.$]+$/.test(line)) {
    throw new Error(`Could not resolve the ${APP_PACKAGE} launcher activity from: ${resolveOutput.trim()}`);
  }
  return line;
}

// The focused window must be one of the app's own activities — a system error
// dialog titled "Application Error: <pkg>" never carries a component slash.
export function appComponentFocused(dumpsysWindow, pkg) {
  const focusLines = dumpsysWindow.split("\n")
    .filter(l => /mCurrentFocus|mFocusedApp|mResumedActivity/.test(l));
  return focusLines.some(l => l.includes(`${pkg}/`));
}

// Required coverage from #2373: a fresh cold start, a retained-data relaunch
// (extras are dropped — the persisted marker file must hold isolation), and
// an install-over-existing upgrade startup. "fresh" also clears data: the AVD
// may be a cached snapshot that already carries the app, and a cold start on
// someone else's retained state is not a cold start.
export function launchPlan() {
  return [
    { name: "cold-start", e2eMarker: true, install: "fresh" },
    { name: "relaunch-retained", e2eMarker: false, install: "none", stopFirst: true },
    { name: "upgrade-retained", e2eMarker: false, install: "upgrade" },
  ];
}

async function main() {
  const directory = dirname(fileURLToPath(import.meta.url));
  const udid = process.env.MOBILE_UDID;
  if (!udid || !/^[\w.-]+$/.test(udid)) {
    throw new Error("Set MOBILE_UDID to the emulator identifier (word chars, dash, dot).");
  }
  const androidSdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
  const adb = androidSdk
    ? resolve(androidSdk, "platform-tools", process.platform === "win32" ? "adb.exe" : "adb")
    : "adb";
  if (androidSdk && !existsSync(adb)) {
    throw new Error(`adb not found under the configured SDK: ${adb}`);
  }
  const artifacts = resolve(process.env.MOBILE_E2E_ARTIFACTS
    ?? resolve(directory, "../.artifacts/mobile-e2e/android-release-smoke"));
  const smokeArtifacts = resolve(artifacts, "release-smoke");
  mkdirSync(smokeArtifacts, { recursive: true });
  const log = (line) => {
    console.log(`[release-smoke] ${line}`);
    appendFileSync(resolve(smokeArtifacts, "release-smoke.log"), `${new Date().toISOString()} ${line}\n`);
  };
  const apk = resolve(process.env.MOBILE_RELEASE_APK ?? resolve(directory,
    "../BibleOnSite/bin/Release/net10.0-android/android-x64/com.tanah.daily929-Signed.apk"));
  if (!apk.endsWith(".apk")) {
    throw new Error(`Release smoke APK must be an .apk file: ${apk}`);
  }
  if (!existsSync(apk)) {
    throw new Error(`Release smoke APK missing — run 'bun run build:release-smoke' first: ${apk}`);
  }
  const execute = promisify(execFile);
  const shell = async (...args) =>
    (await execute(adb, ["-s", udid, "shell", ...args], { timeout: ADB_CALL_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 })).stdout;
  const device = async (...args) =>
    (await execute(adb, ["-s", udid, ...args], { timeout: ADB_CALL_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 })).stdout;
  const processAlive = async () =>
    (await shell("pidof", APP_PACKAGE).catch(() => "")).trim().length > 0;

  // The workflow's device-readiness record greps this file at the artifacts
  // root, matching android-ready.mjs — a genuinely booted device authorizes
  // the master-run SDK cache save.
  const readinessLog = resolve(artifacts, "device-readiness.jsonl");
  writeFileSync(readinessLog, "");
  await waitForAndroidDevice({ adb, udid, execute,
    observe: (observation) => appendFileSync(readinessLog, `${JSON.stringify(observation)}\n`) });
  await shell("wm", "dismiss-keyguard");

  const summary = {
    kind: "android-release-smoke/1",
    package: APP_PACKAGE,
    sourceSha: process.env.GITHUB_SHA ?? null,
    apk: {
      path: apk,
      sha256: createHash("sha256").update(readFileSync(apk)).digest("hex"),
      sizeBytes: readFileSync(apk).length,
    },
    device: {
      sdk: (await shell("getprop", "ro.build.version.sdk")).trim(),
      product: (await shell("getprop", "ro.product.model")).trim(),
      abi: (await shell("getprop", "ro.product.cpu.abi")).trim(),
    },
    phases: [],
    startedUtc: new Date().toISOString(),
  };

  const captureSnapshot = async (phase) => {
    try {
      await shell("uiautomator", "dump", UI_DUMP_PATH);
      const xml = await execute(adb, ["-s", udid, "exec-out", "cat", UI_DUMP_PATH],
        { timeout: ADB_CALL_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 });
      writeFileSync(resolve(smokeArtifacts, `ui-${phase}.xml`), xml.stdout);
      return xml.stdout;
    } catch (error) {
      log(`uiautomator dump failed during ${phase}: ${error.message}`);
      return "";
    }
  };
  const captureScreen = async (phase) => {
    try {
      const png = await execute(adb, ["-s", udid, "exec-out", "screencap", "-p"],
        { timeout: ADB_CALL_TIMEOUT_MS, maxBuffer: 128 * 1024 * 1024, encoding: "buffer" });
      writeFileSync(resolve(smokeArtifacts, `screen-${phase}.png`), png.stdout);
    } catch (error) {
      log(`screencap failed during ${phase}: ${error.message}`);
    }
  };
  const dumpLogcat = async (phase) => {
    try {
      const logcat = await device("logcat", "-d", "-v", "threadtime");
      writeFileSync(resolve(smokeArtifacts, `logcat-${phase}.txt`), logcat);
      return logcat;
    } catch (error) {
      log(`logcat export failed during ${phase}: ${error.message}`);
      return "";
    }
  };

  let failures = 0;
  const runPhase = async ({ name, e2eMarker, install }) => {
    const phase = { name, e2eMarker, install, ok: false, startedUtc: new Date().toISOString() };
    let liveLog;
    const fail = (detail) => {
      phase.error = detail;
      summary.phases.push(phase);
      failures += 1;
      log(`${name}: FAIL — ${detail}`);
    };
    try {
      if (install !== "none") {
        const out = await device("install", "-r", apk);
        log(`${name}: install says ${out.trim().split("\n").pop()}`);
        if (!/Success/.test(out)) return fail(`install failed: ${out.trim()}`);
        if (install === "fresh") await shell("pm", "clear", APP_PACKAGE);
        // `install -r` over a running app force-stops it exactly like the
        // stopFirst path's force-stop does; let its window teardown post
        // before the logcat clear so the stale WIN DEATH cannot read as a
        // crash of the new launch.
        await waitForProcessTeardown(processAlive, delay);
      }
      await device("logcat", "-c");
      liveLog = startReleaseLog(adb, ["-s", udid, "logcat", "-v", "threadtime"],
        resolve(smokeArtifacts, `logcat-live-${name}.txt`));
      const component = launcherComponent(
        await shell("cmd", "package", "resolve-activity", "--brief", APP_PACKAGE));
      const startArgs = ["am", "start", "-n", component];
      if (e2eMarker) startArgs.push("--ez", "BIBLE_E2E", "true");
      const startOut = (await shell(...startArgs)).trim();
      if (/Error|does not exist/i.test(startOut)) return fail(`am start failed: ${startOut}`);
      log(`${name}: launched ${component}${e2eMarker ? " (BIBLE_E2E marker)" : ""}`);

      // Wait for a genuinely usable reader, watching the process and the log
      // the whole way so a crash fails fast instead of timing out blind.
      const deadline = Date.now() + READER_DEADLINE_MS;
      let ready = false;
      let seenProcess = false;
      let lastLogcat = "";
      while (Date.now() < deadline && !ready) {
        const pid = (await shell("pidof", APP_PACKAGE).catch(() => "")).trim();
        seenProcess ||= pid.length > 0;
        // Missing pidof is only a death once the process was observed —
        // the first polls can precede the zygote fork.
        if (seenProcess && !pid) {
          lastLogcat = liveLog.read();
          return fail(`process ${APP_PACKAGE} died before the reader became usable\n${lastLogcat.slice(-4000)}`);
        }
        lastLogcat = liveLog.read();
        const crashes = crashSignatures(lastLogcat, APP_PACKAGE);
        if (crashes.length > 0) return fail(`crash signature in logcat: ${crashes.join("; ")}`);
        const focused = appComponentFocused(await shell("dumpsys", "window").catch(() => ""), APP_PACKAGE);
        const uiXml = focused ? await captureSnapshot(name) : "";
        ready = focused && readerReady(uiXml);
        if (!ready) await delay(POLL_MS);
      }
      if (!ready) return fail(`usable reader (PerekSource) never appeared within ${READER_DEADLINE_MS}ms`);

      // Hold past the original crash window: late managed/native deaths and
      // ANRs still count even after the reader is on screen.
      const holdUntil = Date.now() + LIVENESS_HOLD_MS;
      while (Date.now() < holdUntil) {
        const pid = (await shell("pidof", APP_PACKAGE).catch(() => "")).trim();
        if (!pid) return fail(`process ${APP_PACKAGE} died after the reader became usable`);
        lastLogcat = liveLog.read();
        const crashes = crashSignatures(lastLogcat, APP_PACKAGE);
        if (crashes.length > 0) return fail(`post-ready crash signature: ${crashes.join("; ")}`);
        await delay(POLL_MS);
      }
      await liveLog.stop();
      lastLogcat = liveLog.read();
      liveLog = null;
      const finalCrashes = crashSignatures(lastLogcat, APP_PACKAGE);
      if (finalCrashes.length > 0) return fail(`post-ready crash signature: ${finalCrashes.join("; ")}`);
      const status = analyticsStatus(lastLogcat, APP_PACKAGE);
      if (status.state !== "isolated") {
        return fail(`analytics isolation/exercise check reported '${status.state}' — expected the Release branch to run with collection disabled`);
      }
      await captureScreen(name);
      phase.ok = true;
      phase.elapsedMs = Date.now() - new Date(phase.startedUtc).getTime();
      summary.phases.push(phase);
      log(`${name}: usable reader verified, analytics isolated`);
    } catch (error) {
      return fail(String(error?.message ?? error));
    } finally {
      if (liveLog) {
        try { await liveLog.stop(); }
        catch (error) {
          phase.logError = String(error?.message ?? error);
          log(`${name}: log stream cleanup failed: ${phase.logError}`);
        }
      }
      await dumpLogcat(name).catch(() => {});
    }
  };

  for (const step of launchPlan()) {
    if (step.stopFirst) {
      await shell("am", "force-stop", APP_PACKAGE);
      await waitForProcessTeardown(processAlive, delay);
      log(`${step.name}: force-stopped the app; the marker file persists for this install`);
    }
    await runPhase(step);
    if (failures > 0) break;
  }

  try {
    const pkgDump = await shell("dumpsys", "package", APP_PACKAGE);
    summary.packageInfo = {
      versionName: /versionName=([^\s]+)/.exec(pkgDump)?.[1] ?? null,
      versionCode: /versionCode=([^\s]+)/.exec(pkgDump)?.[1] ?? null,
    };
  } catch (error) {
    log(`package identity capture skipped: ${error.message}`);
  }
  summary.result = failures === 0 ? "pass" : "fail";
  summary.finishedUtc = new Date().toISOString();
  writeFileSync(resolve(smokeArtifacts, "release-smoke-summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  if (failures > 0) {
    throw new Error(`Release startup smoke failed (${failures} phase(s)); see ${smokeArtifacts}`);
  }
  log("all phases passed");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error?.stack ?? error);
    process.exitCode = 1;
  });
}
