import assert from "node:assert/strict";
import { test } from "node:test";
import { loadIosSimulatorDriver, planShardPeer, selectSimulator, SHARD_PEER_NAME } from "./simulator.mjs";

test("loads the locked iOS simulator driver with its ESM-only export before booting a device", async () => {
  const driver = await loadIosSimulatorDriver();
  assert.equal(typeof driver.getSimulator, "function");
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

test("reuses a leftover shard-peer device matching the primary's runtime and model", () => {
  const runtime = "com.apple.CoreSimulator.SimRuntime.iOS-26-5";
  const model = "com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro";
  const primary = { name: "iPhone 17 Pro", udid: "primary", version: "26.5", runtime, deviceTypeIdentifier: model };
  const leftover = { name: SHARD_PEER_NAME, udid: "peer", isAvailable: true, deviceTypeIdentifier: model, state: "Shutdown" };
  const plan = planShardPeer({
    [runtime]: [primary, leftover],
    "com.apple.CoreSimulator.SimRuntime.iOS-26-4": [
      { name: SHARD_PEER_NAME, udid: "wrong-runtime", isAvailable: true, deviceTypeIdentifier: model, state: "Shutdown" }],
  }, primary);
  assert.equal(plan.device.udid, "peer");
  assert.equal(plan.device.version, "26.5");
  assert.equal(plan.device.runtime, runtime);
  // A same-named peer on another runtime pairs the wrong OS profile — stale.
  assert.deepEqual(plan.stale.map((entry) => entry.udid), ["wrong-runtime"]);
});

test("replaces a retained peer cloned under a different model so shards stay same-model", () => {
  const runtime = "com.apple.CoreSimulator.SimRuntime.iOS-26-5";
  const primary = { name: "iPhone 18", udid: "primary", version: "26.5", runtime,
    deviceTypeIdentifier: "com.apple.CoreSimulator.SimDeviceType.iPhone-18" };
  const stale = { name: SHARD_PEER_NAME, udid: "old-peer", isAvailable: true, state: "Shutdown",
    deviceTypeIdentifier: "com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro" };
  const plan = planShardPeer({ [runtime]: [primary, stale] }, primary);
  assert.equal(plan.device, undefined);
  assert.deepEqual(plan.create, {
    name: SHARD_PEER_NAME,
    deviceTypeIdentifier: "com.apple.CoreSimulator.SimDeviceType.iPhone-18",
    runtime,
  });
  assert.deepEqual(plan.stale.map((entry) => entry.udid), ["old-peer"]);
});

test("clones the primary's model and runtime when no shard peer exists", () => {
  const runtime = "com.apple.CoreSimulator.SimRuntime.iOS-26-5";
  const primary = { name: "iPhone 17 Pro", udid: "primary", version: "26.5", runtime, deviceTypeIdentifier: "com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro" };
  const plan = planShardPeer({ [runtime]: [primary] }, primary);
  assert.equal(plan.device, undefined);
  assert.deepEqual(plan.create, {
    name: SHARD_PEER_NAME,
    deviceTypeIdentifier: "com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro",
    runtime,
  });
  assert.deepEqual(plan.stale, []);
});

test("keeps the selected device's runtime identifier for shard-peer cloning", () => {
  const selected = selectSimulator({
    "com.apple.CoreSimulator.SimRuntime.iOS-26-5": [{ name: "iPhone 17 Pro", udid: "device", isAvailable: true }],
  }, "26.5");
  assert.equal(selected.runtime, "com.apple.CoreSimulator.SimRuntime.iOS-26-5");
});
