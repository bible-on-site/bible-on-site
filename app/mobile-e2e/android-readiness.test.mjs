import assert from "node:assert/strict";
import { test } from "node:test";
import { waitForAndroidDevice } from "./android-readiness.mjs";

function deviceProbe(probe) {
  let clock = 0;
  const observations = [];
  return {
    observations,
    options: { adb: "adb", udid: "emulator-5554", timeout: 100, stableFor: 20, interval: 10,
      now: () => clock, sleep: async (duration) => { clock += duration; },
      observe: (value) => observations.push(value),
      execute: async (command, args) => {
        assert.equal(command, "adb");
        assert.deepEqual(args.slice(0, 2), ["-s", "emulator-5554"]);
        return { stdout: probe(clock, args.slice(2).join(" ")) };
      } },
  };
}

const readyResponse = (_clock, command) => ({ "get-state": "device\n",
  "shell getprop sys.boot_completed": "1\n", "shell pm path android": "package:/system/framework/framework-res.apk\n" })[command];

test("requires a stable boot and responsive package manager before starting sessions", async () => {
  const { options, observations } = deviceProbe(readyResponse);
  await waitForAndroidDevice(options);
  assert.deepEqual(observations.map((item) => item.elapsedMs), [0, 10, 20]);
  assert.ok(observations.every((item) => item.ready));
});

test("resets the stability window when a booting device temporarily goes offline", async () => {
  const { options, observations } = deviceProbe((clock, command) => {
    if (clock === 10) throw Object.assign(new Error("adb: device offline"), { code: 1 });
    if (clock === 20 && command === "shell getprop sys.boot_completed") return "0\n";
    return readyResponse(clock, command);
  });
  await waitForAndroidDevice(options);
  assert.equal(observations.at(-1).elapsedMs, 50);
  assert.match(observations[1].error, /device offline/);
  assert.equal(observations[2].ready, false);
});

test("fails within the deadline if the package manager never becomes ready", async () => {
  const { options, observations } = deviceProbe((clock, command) =>
    command === "shell pm path android" ? "" : readyResponse(clock, command));
  await assert.rejects(waitForAndroidDevice(options), /did not keep a booted, responsive package manager/);
  assert.equal(observations.at(-1).elapsedMs, 90);
});

test("reports a missing adb executable immediately instead of treating it as boot delay", async () => {
  const { options, observations } = deviceProbe(() => { throw Object.assign(new Error("missing adb"), { code: "ENOENT" }); });
  await assert.rejects(waitForAndroidDevice(options), { code: "ENOENT" });
  assert.equal(observations.length, 1);
});
