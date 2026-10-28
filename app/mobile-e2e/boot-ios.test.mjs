import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { bootIos } from "./boot-ios.mjs";

const UDID = "00000000-1111-2222-3333-444444444444";
const OTHER_UDID = "11111111-2222-3333-4444-555555555555";

function fixture(t, extra = {}) {
  const directory = mkdtempSync(join(tmpdir(), "ios-boot-handoff-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const calls = [];
  const env = { GITHUB_OUTPUT: join(directory, "output"), GITHUB_ENV: join(directory, "env") };
  let devices = {
    "com.apple.CoreSimulator.SimRuntime.iOS-27-0": [
      { udid: UDID, name: "iPhone 17", isAvailable: true, state: "Shutdown" },
      { udid: OTHER_UDID, name: "iPhone 17 Pro", isAvailable: true, state: "Shutdown" },
    ],
  };
  const options = {
    env,
    run: (...args) => {
      calls.push(["sync", ...args]);
      if (args[0] === "--sdk") return "27.0\n";
      if (args[1] === "list") return JSON.stringify({ devices });
      if (args[1] === "boot") return "";
      throw new Error(`Unexpected xcrun command: ${args.join(" ")}`);
    },
    downloadPlatform: () => { calls.push(["download"]); },
    execute: async (...args) => { calls.push(["async", ...args]); return { stdout: "" }; },
    loadDriver: async () => ({ getSimulator: async (udid) => { calls.push(["driver", udid]); } }),
    log: () => {},
    ...extra,
  };
  return { options, calls, env, setDevices: (value) => { devices = value; } };
}

test("start publishes its exact selected identity only after boot initiation, then wait avoids device listing", async (t) => {
  const { options, calls, env } = fixture(t);
  await bootIos({ ...options, mode: "start" });
  assert.deepEqual(calls.filter(([kind, , command]) => kind === "sync" && command === "boot"), [
    ["sync", "simctl", "boot", UDID],
  ]);
  assert.equal(readFileSync(env.GITHUB_OUTPUT, "utf8"), `udid=${UDID}\nversion=27.0\n`);
  assert.equal(existsSync(env.GITHUB_ENV), false);

  const handoff = Object.fromEntries(readFileSync(env.GITHUB_OUTPUT, "utf8").trim().split("\n").map((line) => line.split("=")));
  const waitCalls = [];
  await bootIos({ ...options, mode: "wait",
    env: { ...env, MOBILE_UDID: handoff.udid, MOBILE_OS_VERSION: handoff.version },
    run: (...args) => {
      waitCalls.push(args);
      if (args[0] === "--sdk") return "27.0\n";
      throw new Error("Wait must not re-enumerate, reselect or boot a handed-off simulator.");
    },
  });
  assert.deepEqual(waitCalls, [["--sdk", "iphonesimulator", "--show-sdk-version"]]);
  assert.deepEqual(calls.find(([kind]) => kind === "async"), [
    "async", "xcrun", ["simctl", "bootstatus", UDID], { encoding: "utf8", timeout: 300000 },
  ]);
  assert.ok(calls.some(([kind, udid]) => kind === "driver" && udid === UDID));
  assert.ok(!calls.some(([kind]) => kind === "download"));
  assert.equal(readFileSync(env.GITHUB_ENV, "utf8"), `MOBILE_UDID=${UDID}\nMOBILE_OS_VERSION=27.0\n`);
});

test("a failed start never publishes a simulator handoff", async (t) => {
  const { options, env } = fixture(t);
  await assert.rejects(bootIos({ ...options, mode: "start", run: (...args) => {
    if (args[1] === "boot") throw new Error("boot failed");
    return options.run(...args);
  } }), /boot failed/);
  assert.equal(existsSync(env.GITHUB_OUTPUT), false);
  assert.equal(existsSync(env.GITHUB_ENV), false);
});

for (const [label, handoff] of [
  ["missing version", { MOBILE_UDID: UDID }],
  ["missing UDID", { MOBILE_OS_VERSION: "27.0" }],
  ["empty identity", { MOBILE_UDID: "", MOBILE_OS_VERSION: "" }],
  ["malformed UDID", { MOBILE_UDID: "other-device", MOBILE_OS_VERSION: "27.0" }],
  ["injected runtime output", { MOBILE_UDID: UDID, MOBILE_OS_VERSION: "27.0\nEXTRA=value" }],
  ["malformed runtime", { MOBILE_UDID: UDID, MOBILE_OS_VERSION: "27--0" }],
  ["runtime newer than SDK", { MOBILE_UDID: UDID, MOBILE_OS_VERSION: "27.1" }],
]) {
  test(`wait rejects ${label} without listing devices, downloading, booting or exporting env`, async (t) => {
    const { options, calls, env } = fixture(t);
    await assert.rejects(bootIos({ ...options, mode: "wait", env: { ...env, ...handoff } }),
      /handoff requires|incompatible/);
    assert.deepEqual(calls, [["sync", "--sdk", "iphonesimulator", "--show-sdk-version"]]);
    assert.equal(existsSync(env.GITHUB_ENV), false);
  });
}

test("wait accepts a compatible older runtime and preserves its exact version", async (t) => {
  const { options, calls, env } = fixture(t);
  await bootIos({ ...options, mode: "wait", env: { ...env, MOBILE_UDID: UDID, MOBILE_OS_VERSION: "26.5.1" } });
  assert.ok(!calls.some(([kind, , command]) => kind === "sync" && command === "list"));
  assert.equal(readFileSync(env.GITHUB_ENV, "utf8"), `MOBILE_UDID=${UDID}\nMOBILE_OS_VERSION=26.5.1\n`);
});

test("standalone wait still inspects and boots the real selected device", async (t) => {
  const { options, calls } = fixture(t);
  await bootIos({ ...options, mode: "wait" });
  assert.ok(calls.some(([kind, , command]) => kind === "sync" && command === "list"));
  assert.ok(calls.some(([kind, , command, udid]) => kind === "sync" && command === "boot" && udid === UDID));
  assert.ok(calls.some(([kind, udid]) => kind === "driver" && udid === UDID));
});

test("selection still downloads a missing compatible runtime and inspects the result", async (t) => {
  const { options, calls, setDevices } = fixture(t);
  setDevices({});
  await bootIos({ ...options, mode: "wait", downloadPlatform: () => {
    calls.push(["download"]);
    setDevices({ "com.apple.CoreSimulator.SimRuntime.iOS-26-5": [
      { udid: UDID, name: "iPhone", isAvailable: true, state: "Shutdown" },
    ] });
  } });
  assert.equal(calls.filter(([kind, , command]) => kind === "sync" && command === "list").length, 2);
  assert.equal(calls.filter(([kind]) => kind === "download").length, 1);
});

test("resolve only reports the selected device and never boots or downloads a runtime", async (t) => {
  const { options, calls, env, setDevices } = fixture(t);
  await bootIos({ ...options, mode: "resolve" });
  assert.equal(readFileSync(env.GITHUB_OUTPUT, "utf8"), `udid=${UDID}\nversion=27.0\n`);
  assert.ok(!calls.some(([kind, , command]) => kind === "download" || command === "boot"));
  setDevices({});
  await bootIos({ ...options, mode: "resolve" });
  assert.ok(!calls.some(([kind]) => kind === "download"));
});

for (const stage of ["bootstatus", "driver lookup"]) {
  test(`wait does not export readiness when ${stage} fails`, async (t) => {
    const { options, env } = fixture(t);
    await assert.rejects(bootIos({ ...options, mode: "wait",
      env: { ...env, MOBILE_UDID: UDID, MOBILE_OS_VERSION: "27.0" },
      ...(stage === "bootstatus" ? { execute: async () => { throw new Error("bootstatus failed"); } }
        : { loadDriver: async () => ({ getSimulator: async () => { throw new Error("lookup failed"); } }) }),
    }), /failed/);
    assert.equal(existsSync(env.GITHUB_ENV), false);
  });
}

for (const sdk of ["not-a-version", "27.0\nEXTRA=value"]) {
  test(`wait rejects an invalid SDK version without falling back to device selection: ${JSON.stringify(sdk)}`, async (t) => {
    const { options, calls, env } = fixture(t);
    await assert.rejects(bootIos({ ...options, mode: "wait",
      env: { ...env, MOBILE_UDID: UDID, MOBILE_OS_VERSION: "27.0" },
      run: (...args) => { calls.push(["sync", ...args]); return sdk; },
    }), /Invalid iOS SDK version/);
    assert.deepEqual(calls, [["sync", "--sdk", "iphonesimulator", "--show-sdk-version"]]);
    assert.equal(existsSync(env.GITHUB_ENV), false);
  });
}
