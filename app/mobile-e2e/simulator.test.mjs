import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { bootIos } from "./boot-ios.mjs";
import { compareVersions, loadIosNativeSimulator, loadIosSimulatorDriver, selectSimulator } from "./simulator.mjs";

test("loads the locked iOS simulator driver with its ESM-only export before booting a device", async () => {
  const driver = await loadIosSimulatorDriver();
  assert.equal(typeof driver.getSimulator, "function");
  const native = await loadIosNativeSimulator();
  assert.equal(typeof native.NativeSimctl, "function");
  assert.equal(typeof native.NativeSimctl.prototype.getDevices, "function");
});

test("chooses the newest available iPhone runtime compatible with Xcode, not a newer incompatible runtime", () => {
  const device = (name, udid, isAvailable = true) => ({ name, udid, isAvailable });
  const selected = selectSimulator({
    "com.apple.CoreSimulator.SimRuntime.iOS-27-0": [device("iPhone 18", "too-new")],
    "com.apple.CoreSimulator.SimRuntime.iOS-26-5": [device("iPad Pro", "tablet"), device("iPhone 17", "unavailable", false), device("iPhone 17 Pro", "compatible")],
    "com.apple.CoreSimulator.SimRuntime.iOS-26-4": [device("iPhone 16", "older")],
  }, "26.5");
  assert.equal(selected.udid, "compatible");
  assert.equal(selected.version, "26.5");
});

test("picks one deterministic UDID among identical devices so resolve and boot agree", () => {
  const device = (udid) => ({ name: "iPhone 17", udid, isAvailable: true });
  const selected = selectSimulator({
    "com.apple.CoreSimulator.SimRuntime.iOS-27-0": [device("BBBB-0000"), device("AAAA-0000")],
  }, "27.0");
  assert.equal(selected.udid, "AAAA-0000");
});

test("reports no compatible device rather than silently choosing an unsupported OS", () => {
  assert.equal(selectSimulator({ "com.apple.CoreSimulator.SimRuntime.iOS-27-0": [
    { name: "iPhone 18", udid: "too-new", isAvailable: true },
  ] }, "26.5"), undefined);
});

test("ignores malformed runtime identifiers and other Apple platforms", () => {
  const devices = [{ name: "iPhone", udid: "invalid", isAvailable: true }];
  assert.equal(selectSimulator({
    "com.apple.CoreSimulator.SimRuntime.iOS-26--5": devices,
    "com.apple.CoreSimulator.SimRuntime.iOS-26-5-invalid": devices,
    "com.apple.CoreSimulator.SimRuntime.tvOS-26-5": devices,
  }, "26.5"), undefined);
});

test("keeps the selected device's runtime identifier", () => {
  const selected = selectSimulator({
    "com.apple.CoreSimulator.SimRuntime.iOS-26-5": [{ name: "iPhone 17 Pro", udid: "device", isAvailable: true }],
  }, "26.5");
  assert.equal(selected.runtime, "com.apple.CoreSimulator.SimRuntime.iOS-26-5");
});


test("compares numeric runtime versions with omitted zero components", () => {
  assert.equal(compareVersions("27.0", "27"), 0);
  assert.equal(compareVersions("27.0.0", "27.0"), 0);
  assert.ok(compareVersions("26.10", "26.9") > 0);
  assert.ok(compareVersions("26.5.1", "27.0") < 0);
  assert.ok(compareVersions("27.0.1", "27.0") > 0);
});

const UDID = "a0000000-b111-c222-d333-e44444444444";
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
  let nativeDevices = [{ udid: UDID, runtimeIdentifier: "com.apple.CoreSimulator.SimRuntime.iOS-27-0", state: 2 }];
  let simState = "Booted";
  const simQueue = [];
  const simulator = {
    stat: async () => { calls.push(["sim-stat"]); return { state: simQueue.length ? simQueue.shift() : simState }; },
    boot: async () => { calls.push(["sim-boot"]); },
    waitForBoot: async () => { calls.push(["sim-wait"]); },
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
    loadDriver: async () => ({ getSimulator: async (udid, lookup) => { calls.push(["driver", udid, ...(lookup ? [lookup] : [])]); return simulator; } }),
    loadNativeDriver: async () => ({ NativeSimctl: class {
      constructor(options) { calls.push(["native", options]); }
      async getDevices() { calls.push(["native-devices"]); return nativeDevices; }
    } }),
    log: () => {},
    ...extra,
  };
  return { options, calls, env, simQueue, setSimState: (value) => { simState = value; },
    setDevices: (value) => { devices = value; },
    setNativeDevices: (value) => { nativeDevices = value; } };
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
  assert.ok(!calls.some(([kind]) => kind === "native"));
});

for (const waitingOn of ["bootstatus", "native warmup"]) {
  test(`selected Xcode native warmup preserves owned identity and waits for ${waitingOn}`, async (t) => {
    const { options, calls, env } = fixture(t);
    const developerDir = "/Applications/Xcode_27.app/Contents/Developer";
    let complete;
    const pending = new Promise((resolve) => { complete = resolve; });
    const devices = [{ udid: UDID.toUpperCase(), runtimeIdentifier: "com.apple.CoreSimulator.SimRuntime.iOS-27-0", state: 2 }];
    const running = bootIos({ ...options, mode: "wait",
      env: { ...env, MOBILE_UDID: UDID, MOBILE_OS_VERSION: "27.0.0", DEVELOPER_DIR: developerDir },
      execute: async (...args) => {
        calls.push(["async", ...args]);
        if (waitingOn === "bootstatus") await pending;
        return { stdout: "" };
      },
      loadNativeDriver: async () => ({ NativeSimctl: class {
        constructor(options) { calls.push(["native", options]); }
        async getDevices() {
          calls.push(["native-devices"]);
          if (waitingOn === "native warmup") await pending;
          return devices;
        }
      } }),
    });
    await new Promise(setImmediate);
    assert.equal(existsSync(env.GITHUB_ENV), false);
    complete();
    await running;
    assert.deepEqual(calls.filter(([kind]) => kind === "native"), [["native", { developerDir }]]);
    assert.equal(calls.filter(([kind]) => kind === "native-devices").length, 1);
    assert.deepEqual(calls.filter(([kind]) => kind === "driver"), [["driver", UDID, { checkExistence: false }]]);
    assert.deepEqual(calls.filter(([kind]) => kind === "async"), [
      ["async", "xcrun", ["simctl", "bootstatus", UDID], { encoding: "utf8", timeout: 300000 }],
    ]);
    assert.ok(!calls.some(([kind, , command]) => kind === "download" || command === "boot" || command === "list"));
    assert.equal(readFileSync(env.GITHUB_ENV, "utf8"), `MOBILE_UDID=${UDID}\nMOBILE_OS_VERSION=27.0.0\n`);
  });
}

for (const [label, devices] of [
  ["missing owned UDID", [{ udid: OTHER_UDID, runtimeIdentifier: "com.apple.CoreSimulator.SimRuntime.iOS-27-0" }]],
  ["wrong iOS runtime", [{ udid: UDID, runtimeIdentifier: "com.apple.CoreSimulator.SimRuntime.iOS-26-5" }]],
  ["another Apple platform", [{ udid: UDID, runtimeIdentifier: "com.apple.CoreSimulator.SimRuntime.tvOS-27-0" }]],
  ["malformed runtime", [{ udid: UDID, runtimeIdentifier: "invalid" }]],
  ["empty runtime component", [{ udid: UDID, runtimeIdentifier: "com.apple.CoreSimulator.SimRuntime.iOS-" }]],
  ["repeated runtime separator", [{ udid: UDID, runtimeIdentifier: "com.apple.CoreSimulator.SimRuntime.iOS-27--0" }]],
  ["trailing empty runtime component", [{ udid: UDID, runtimeIdentifier: "com.apple.CoreSimulator.SimRuntime.iOS-27-0-" }]],
  ["excess runtime components", [{ udid: UDID, runtimeIdentifier: "com.apple.CoreSimulator.SimRuntime.iOS-27-0-0-0" }]],
  ["non-ASCII runtime digits", [{ udid: UDID, runtimeIdentifier: "com.apple.CoreSimulator.SimRuntime.iOS-２７-0" }]],
]) {
  test(`selected Xcode warmup rejects ${label} without exporting readiness`, async (t) => {
    const { options, calls, env, setNativeDevices } = fixture(t);
    setNativeDevices(devices);
    await assert.rejects(bootIos({ ...options, mode: "wait",
      env: { ...env, MOBILE_UDID: UDID, MOBILE_OS_VERSION: "27.0", DEVELOPER_DIR: "/Applications/Xcode_27.app/Contents/Developer" },
    }), /owned UDID|expected iOS runtime/);
    assert.equal(existsSync(env.GITHUB_ENV), false);
    assert.ok(!calls.some(([kind]) => kind === "driver"));
  });
}

for (const runtimeIdentifier of ["com.apple.CoreSimulator.SimRuntime.iOS-27", "com.apple.CoreSimulator.SimRuntime.iOS-27-0-0"]) {
  test(`selected Xcode warmup accepts compatible numeric runtime ${runtimeIdentifier}`, async (t) => {
    const { options, env, setNativeDevices } = fixture(t);
    setNativeDevices([{ udid: UDID, runtimeIdentifier }]);
    await bootIos({ ...options, mode: "wait",
      env: { ...env, MOBILE_UDID: UDID, MOBILE_OS_VERSION: "27.0", DEVELOPER_DIR: "/Applications/Xcode_27.app/Contents/Developer" },
    });
    assert.equal(readFileSync(env.GITHUB_ENV, "utf8"), `MOBILE_UDID=${UDID}\nMOBILE_OS_VERSION=27.0\n`);
  });
}

for (const stage of ["native lookup", "driver compatibility", "bootstatus"]) {
  test(`selected Xcode warmup preserves ${stage} failures without exporting readiness`, async (t) => {
    const { options, env } = fixture(t);
    await assert.rejects(bootIos({ ...options, mode: "wait",
      env: { ...env, MOBILE_UDID: UDID, MOBILE_OS_VERSION: "27.0", DEVELOPER_DIR: "/Applications/Xcode_27.app/Contents/Developer" },
      ...(stage === "native lookup" ? { loadNativeDriver: async () => ({ NativeSimctl: class {
        async getDevices() { throw new Error("native lookup failed"); }
      } }) } : {}),
      ...(stage === "driver compatibility" ? { loadDriver: async () => ({ getSimulator: async () => { throw new Error("compatibility failed"); } }) } : {}),
      ...(stage === "bootstatus" ? { execute: async () => { throw new Error("bootstatus failed"); } } : {}),
    }), /failed/);
    assert.equal(existsSync(env.GITHUB_ENV), false);
  });
}

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

test("heal leaves a still-booted handed-off device alone", async (t) => {
  const { options, calls, env } = fixture(t);
  await bootIos({ ...options, mode: "heal",
    env: { ...env, MOBILE_UDID: UDID, MOBILE_OS_VERSION: "27.0" } });
  assert.deepEqual(calls.filter(([kind]) => kind === "driver"), [["driver", UDID]]);
  assert.ok(!calls.some(([kind]) => kind === "sim-boot" || kind === "sim-wait"
    || kind === "async" || kind === "native" || kind === "download"));
  assert.ok(!calls.some(([kind, , command]) => kind === "sync" && command === "boot"));
  assert.equal(existsSync(env.GITHUB_ENV), false);
});

test("heal boots a handed-off device the runner powered off and waits for it", async (t) => {
  const { options, calls, env, setSimState } = fixture(t);
  setSimState("Shutdown");
  await bootIos({ ...options, mode: "heal",
    env: { ...env, MOBILE_UDID: UDID, MOBILE_OS_VERSION: "27.0" } });
  assert.deepEqual(calls.filter(([kind]) => kind === "sim-boot"), [["sim-boot"]]);
  assert.deepEqual(calls.filter(([kind]) => kind === "sim-wait"), [["sim-wait"]]);
  assert.ok(!calls.some(([kind, , command]) => kind === "sync" && command === "boot"));
});

test("heal waits out a still-booting handed-off device without rebooting", async (t) => {
  const { options, calls, env, setSimState } = fixture(t);
  setSimState("Booting");
  await bootIos({ ...options, mode: "heal",
    env: { ...env, MOBILE_UDID: UDID, MOBILE_OS_VERSION: "27.0" } });
  assert.equal(calls.filter(([kind]) => kind === "sim-boot").length, 0);
  assert.deepEqual(calls.filter(([kind]) => kind === "sim-wait"), [["sim-wait"]]);
});

test("heal waits out a mid-flight shutdown, then re-boots the device", async (t) => {
  // Cleanup can still be powering the device off at session entry — a state
  // the native waitForBoot rejects outright. The check waits for the power-off
  // to land, then recovers through the driver's own boot path.
  const { options, calls, env, simQueue, setSimState } = fixture(t);
  setSimState("Shutdown");
  simQueue.push("Shutting Down", "Shutdown");
  await bootIos({ ...options, mode: "heal", sleep: async () => {},
    env: { ...env, MOBILE_UDID: UDID, MOBILE_OS_VERSION: "27.0" } });
  assert.equal(calls.filter(([kind]) => kind === "sim-stat").length, 2);
  assert.deepEqual(calls.filter(([kind]) => kind === "sim-boot"), [["sim-boot"]]);
  assert.deepEqual(calls.filter(([kind]) => kind === "sim-wait"), [["sim-wait"]]);
  assert.ok(!calls.some(([kind, , command]) => kind === "sync" && command === "boot"));
});

test("heal fails when the power-off outlives the boot deadline", async (t) => {
  const { options, calls, env, setSimState } = fixture(t);
  setSimState("Shutting Down");
  let tick = 0;
  await assert.rejects(bootIos({ ...options, mode: "heal",
    env: { ...env, MOBILE_UDID: UDID, MOBILE_OS_VERSION: "27.0" },
    sleep: async () => {}, now: () => (tick += 200000) }),
    /past the boot deadline/);
  assert.equal(calls.filter(([kind]) => kind === "sim-boot").length, 0);
  assert.equal(existsSync(env.GITHUB_ENV), false);
});

test("heal propagates a failed recovery boot without exporting readiness", async (t) => {
  const { options, env, setSimState } = fixture(t);
  setSimState("Shutdown");
  await assert.rejects(bootIos({ ...options, mode: "heal",
    env: { ...env, MOBILE_UDID: UDID, MOBILE_OS_VERSION: "27.0" },
    loadDriver: async () => ({ getSimulator: async () => ({
      stat: async () => ({ state: "Shutdown" }),
      boot: async () => { throw new Error("native boot failed"); },
      waitForBoot: async () => {},
    }) }) }), /native boot failed/);
  assert.equal(existsSync(env.GITHUB_ENV), false);
});
