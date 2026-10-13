import assert from "node:assert/strict";
import { test } from "node:test";
import { deviceState, deviceStateConsistent, quiesce, testBundleIds } from "./ios-sim-state.mjs";

const runtime = "com.apple.CoreSimulator.SimRuntime.iOS-27-0";

test("testBundleIds keeps test installs out of the saved state and leaves Apple apps", () => {
  const installed = {
    "com.tanah.daily929": {},
    "com.facebook.WebDriverAgentRunner.xctrunner": {},
    "com.apple.mobilesafari": {},
    "com.apple.Preferences": {},
  };
  assert.deepEqual(testBundleIds(installed).sort(), [
    "com.facebook.WebDriverAgentRunner.xctrunner",
    "com.tanah.daily929",
  ]);
});

test("deviceState finds the device across runtimes and reports unknown UDIDs", () => {
  const devices = {
    [runtime]: [
      { udid: "AAA", state: "Shutdown" },
      { udid: "BBB", state: "Booted" },
    ],
    "com.apple.CoreSimulator.SimRuntime.iOS-26-5": [{ udid: "CCC", state: "Shutdown" }],
  };
  assert.equal(deviceState(devices, "BBB"), "Booted");
  assert.equal(deviceState(devices, "ZZZ"), undefined);
});

test("deviceStateConsistent requires the registry plist and data volume", () => {
  const present = new Set(["device.plist", "data"]);
  const exists = (path) => [...present].some((entry) => path.endsWith(entry));
  assert.equal(deviceStateConsistent("/dev", exists), true);
  present.delete("data");
  assert.equal(deviceStateConsistent("/dev", exists), false);
});

test("quiesce refuses to capture a device that differs from the resolved cache key", async () => {
  const calls = [];
  const saved = await quiesce({
    udid: "OTHER",
    expectedUdid: "AAA",
    run: (...args) => calls.push(args),
  });
  assert.equal(saved, false);
  assert.equal(calls.length, 0);
});

test("quiesce removes test apps, shuts down and confirms a consistent device directory", async () => {
  const apps = JSON.stringify({
    "com.tanah.daily929": {},
    "com.facebook.WebDriverAgentRunner.xctrunner": {},
    "com.apple.mobilesafari": {},
  });
  const states = ["Booted", "Booting", "Shutdown"];
  const ran = [];
  const saved = await quiesce({
    udid: "AAA",
    expectedUdid: "AAA",
    sleep: () => Promise.resolve(),
    dirExists: () => true,
    run: (command, args) => {
      ran.push(args.join(" "));
      if (args[0] === "simctl" && args[1] === "listapps") return Buffer.from("<plist/>");
      if (command === "plutil") return Buffer.from(apps);
      if (args[1] === "list") {
        const state = states.length > 1 ? states.shift() : states[0];
        return Buffer.from(JSON.stringify({ devices: { [runtime]: [{ udid: "AAA", state }] } }));
      }
      return Buffer.from("");
    },
  });
  assert.equal(saved, true);
  assert.ok(ran.includes("simctl uninstall AAA com.tanah.daily929"));
  assert.ok(ran.includes("simctl uninstall AAA com.facebook.WebDriverAgentRunner.xctrunner"));
  assert.ok(!ran.some((line) => line.includes("mobilesafari")));
  assert.ok(ran.includes("simctl shutdown AAA"));
});

test("quiesce does not capture a device that never reached Booted", async () => {
  const saved = await quiesce({
    udid: "AAA",
    expectedUdid: "AAA",
    run: () => Buffer.from(JSON.stringify({ devices: { [runtime]: [{ udid: "AAA", state: "Shutdown" }] } })),
  });
  assert.equal(saved, false);
});
