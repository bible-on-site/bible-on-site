import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import {
  analyticsStatus,
  appComponentFocused,
  crashSignatures,
  launchPlan,
  launcherComponent,
  readerReady,
  startReleaseLog,
  waitForProcessTeardown,
} from "./release-smoke.mjs";

test("retains startup analytics and crash evidence after the device's rolling log loses it", async () => {
  const directory = mkdtempSync(join(tmpdir(), "release-startup-log-"));
  const destination = join(directory, "live.txt");
  const startup = "I mono-stdout: [Analytics] collection enabled=False\n";
  const crash = "E ActivityManager: ANR in com.tanah.daily929\n";
  const script = `process.stdout.write(${JSON.stringify(startup + crash)});
    process.stdout.write('unrelated emulator output\\n'.repeat(100000));
    process.stdout.write('capture complete'); setInterval(() => {}, 1000);`;
  const capture = startReleaseLog(process.execPath, ["-e", script], destination);
  try {
    const deadline = Date.now() + 5000;
    while (!capture.read().includes("capture complete") && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    await capture.stop();
    const retained = capture.read();
    const rolling = retained.slice(-1024);
    assert.deepEqual(analyticsStatus(rolling), { state: "absent" });
    assert.deepEqual(analyticsStatus(retained), { state: "isolated" });
    assert.deepEqual(crashSignatures(rolling, "com.tanah.daily929"), []);
    assert.deepEqual(crashSignatures(retained, "com.tanah.daily929"), ["ANR in com.tanah.daily929"]);
    assert.ok(retained.endsWith("capture complete"));
  } finally {
    await capture.stop();
    rmSync(directory, { recursive: true, force: true });
  }
});

// The verbatim signature of #2247, captured from the crashing store build on
// the API 36 emulator: the managed setter NRE'd because nothing called
// FirebaseAnalyticsImplementation.Initialize first. A guard that cannot see
// this exact block is not a guard.
const incident2247 = `
--------- beginning of main
02-15 09:12:31.123  5100  5100 I monodroid-assembly: Shared library initialization done
02-15 09:12:31.901  5100  5100 E AndroidRuntime: FATAL EXCEPTION: main
02-15 09:12:31.901  5100  5100 E AndroidRuntime: Process: com.tanah.daily929, PID: 5100
02-15 09:12:31.901  5100  5100 E AndroidRuntime: android.runtime.JavaProxyThrowable: [System.NullReferenceException]: Arg_NullReferenceException
02-15 09:12:31.901  5100  5100 E AndroidRuntime:    at Plugin.Firebase.Analytics.FirebaseAnalyticsImplementation.set_IsAnalyticsCollectionEnabled(Boolean value)
02-15 09:12:31.901  5100  5100 E AndroidRuntime:    at BibleOnSite.MainActivity.OnCreate(Bundle savedInstanceState)
02-15 09:12:31.901  5100  5100 E AndroidRuntime:    at android.app.Activity.performCreate(Activity.java:9000)
02-15 09:12:31.999  5100  5100 E AndroidRuntime: FATAL EXCEPTION: main
02-15 09:12:31.999  5100  5100 E AndroidRuntime: Process: com.tanah.daily929, PID: 5100
`;

describe("crashSignatures", () => {
  test("flags the #2247 fatal managed exception", () => {
    const matches = crashSignatures(incident2247, "com.tanah.daily929");
    assert.ok(matches.length > 0, "the incident logcat must read as a crash");
    assert.ok(matches.some(m => m.includes("FATAL EXCEPTION")), JSON.stringify(matches));
  });

  test("flags native fatal signals, ANRs and unexpected process death", () => {
    const pkg = "com.tanah.daily929";
    assert.ok(crashSignatures(
      `F/libc: Fatal signal 6 (SIGABRT), code -1 in tid 5100 (anah.daily929), pid 5100\nI/DEBUG: >>> com.tanah.daily929 <<<`,
      pkg).length > 0);
    assert.ok(crashSignatures(`E ActivityManager: ANR in com.tanah.daily929 (com.tanah.daily929/crc64abc.MainActivity)`, pkg).length > 0);
    assert.ok(crashSignatures(`I ActivityManager: Process com.tanah.daily929 (pid 4242) has died: vis +99 TOP`, pkg).length > 0);
    assert.ok(crashSignatures(`I WindowManager: WIN DEATH: Window{abc u0 com.tanah.daily929/crc64abc.MainActivity}`, pkg).length > 0);
  });

  test("ignores crash records of other packages", () => {
    const foreign = `E AndroidRuntime: FATAL EXCEPTION: main\nProcess: com.other.app, PID: 1\n`;
    assert.equal(crashSignatures(foreign, "com.tanah.daily929").length, 0);
  });

  test("ignores healthy startup output", () => {
    const healthy = `
I ActivityTaskManager: START u0 {cmp=com.tanah.daily929/crc64abc.MainActivity} with LAUNCHER
I mono-stdout: [Analytics] collection enabled=false
I ActivityManager: Displayed com.tanah.daily929/crc64abc.MainActivity: +412ms
`;
    assert.equal(crashSignatures(healthy, "com.tanah.daily929").length, 0);
  });
});

describe("analyticsStatus", () => {
  const pkg = "com.tanah.daily929";
  test("accepts the isolated Release launch", () => {
    const status = analyticsStatus("I mono-stdout: [Analytics] collection enabled=false", pkg);
    assert.deepEqual(status, { state: "isolated" });
  });

  test("accepts the managed bool casing the app actually prints", () => {
    // MainActivity interpolates a C# bool: enabled=False, not enabled=false.
    const status = analyticsStatus("I mono-stdout: [Analytics] collection enabled=False", pkg);
    assert.deepEqual(status, { state: "isolated" });
  });

  test("rejects a live production collection", () => {
    const status = analyticsStatus("I mono-stdout: [Analytics] collection enabled=true", pkg);
    assert.equal(status.state, "live");
  });

  test("rejects a build that compiled the startup branch out", () => {
    const status = analyticsStatus(
      "I mono-stdout: [Analytics] collection deactivated at build time (DISABLE_ANALYTICS)", pkg);
    assert.equal(status.state, "compiled-out");
  });

  test("reports a missing marker as unexercised", () => {
    assert.deepEqual(analyticsStatus("nothing relevant", pkg), { state: "absent" });
  });
});

describe("readerReady", () => {
  const node = (id, text) =>
    `<node index="0" text="${text}" resource-id="com.tanah.daily929:id/${id}" class="android.widget.TextView" package="com.tanah.daily929" content-desc="" checkable="false" checked="false" clickable="false" enabled="true" focusable="false" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[0,0][1080,100]" />`;
  test("requires the PerekSource label with real text", () => {
    assert.equal(readerReady(`<hierarchy>${node("PerekSource", "בראשית א")}</hierarchy>`), true);
  });
  test("rejects an empty source label and a missing reader", () => {
    assert.equal(readerReady(`<hierarchy>${node("PerekSource", "   ")}</hierarchy>`), false);
    assert.equal(readerReady(`<hierarchy>${node("OtherView", "בראשית א")}</hierarchy>`), false);
    assert.equal(readerReady("UI hierchary dumped to: /dev/tty"), false);
  });
});

describe("launcherComponent", () => {
  test("parses resolve-activity output", () => {
    const out = `priority=0 preferredOrder=0 match=0x108000 specificIndex=-1 isDefault=true
com.tanah.daily929/crc64abcdef0123456789.MainActivity
`;
    assert.equal(launcherComponent(out), "com.tanah.daily929/crc64abcdef0123456789.MainActivity");
  });
  test("throws when no component resolves", () => {
    assert.throws(() => launcherComponent("No activity found"), /launcher activity/);
  });
});

describe("appComponentFocused", () => {
  test("reads the focused app component", () => {
    const dumpsys = `
  mCurrentFocus=Window{6e2d9f3 u0 com.tanah.daily929/crc64abc.MainActivity}
  mFocusedApp=ActivityRecord{a1b2c3 u0 com.tanah.daily929/crc64abc.MainActivity} t42}
`;
    assert.equal(appComponentFocused(dumpsys, "com.tanah.daily929"), true);
  });
  test("rejects launcher focus and crash dialogs", () => {
    assert.equal(appComponentFocused(
      "  mCurrentFocus=Window{111 u0 com.google.android.apps.nexuslauncher/.NexusLauncherActivity}",
      "com.tanah.daily929"), false);
    // The system error dialog keeps the package name in its title but never
    // carries a component slash — a dead app must not read as foreground.
    assert.equal(appComponentFocused(
      "  mCurrentFocus=Window{222 u0 Application Error: com.tanah.daily929}",
      "com.tanah.daily929"), false);
  });
});

describe("waitForProcessTeardown", () => {
  // Mirrors the script's POLL_MS cadence: each poll gap and the trailing
  // window-teardown grace use the same interval.
  const POLL_MS = 750;
  const recorder = () => {
    const sleeps = [];
    return { sleeps, sleep: async (ms) => { sleeps.push(ms); } };
  };

  test("graces once when the process is already gone", async () => {
    const { sleeps, sleep } = recorder();
    let probes = 0;
    await waitForProcessTeardown(async () => (++probes, false), sleep);
    assert.equal(probes, 1, "nothing to wait for when the kill already landed");
    assert.deepEqual(sleeps, [POLL_MS], "one grace poll for the WIN DEATH post");
  });

  test("polls until the process dies, then graces for the WIN DEATH post", async () => {
    const { sleeps, sleep } = recorder();
    const alive = [true, true, false];
    let probes = 0;
    await waitForProcessTeardown(async () => alive[probes++], sleep);
    assert.equal(probes, 3);
    assert.deepEqual(sleeps, [POLL_MS, POLL_MS, POLL_MS]);
  });

  test("gives up polling at the deadline but still graces", async () => {
    const { sleeps, sleep } = recorder();
    let probes = 0;
    await waitForProcessTeardown(async () => (++probes, true), sleep, 0);
    assert.equal(probes, 1, "an elapsed deadline must not hang the smoke");
    assert.deepEqual(sleeps, [POLL_MS]);
  });
});

describe("launchPlan", () => {
  test("covers cold start, retained-data relaunch and upgrade reinstall", () => {
    const plan = launchPlan();
    assert.equal(plan.length, 3);
    assert.equal(plan[0].name, "cold-start");
    assert.equal(plan[0].e2eMarker, true, "first launch carries the isolation marker");
    assert.equal(plan[0].install, "fresh", "cold start installs the packaged APK and clears data");
    assert.equal(plan[1].name, "relaunch-retained");
    assert.equal(plan[1].e2eMarker, false, "relaunch exercises the persisted marker file, not the extra");
    assert.equal(plan[1].install, "none");
    assert.equal(plan[1].stopFirst, true, "relaunch force-stops the prior instance first");
    assert.equal(plan[2].name, "upgrade-retained");
    assert.equal(plan[2].install, "upgrade", "the upgrade phase reinstalls over retained data");
  });
});
