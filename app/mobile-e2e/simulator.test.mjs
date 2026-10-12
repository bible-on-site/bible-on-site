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

test("reuses a leftover shard-peer device on the primary's runtime", () => {
  const runtime = "com.apple.CoreSimulator.SimRuntime.iOS-26-5";
  const primary = { name: "iPhone 17 Pro", udid: "primary", version: "26.5", runtime, deviceTypeIdentifier: "com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro" };
  const leftover = { name: SHARD_PEER_NAME, udid: "peer", isAvailable: true };
  const plan = planShardPeer({
    [runtime]: [primary, leftover],
    "com.apple.CoreSimulator.SimRuntime.iOS-26-4": [{ name: SHARD_PEER_NAME, udid: "wrong-runtime", isAvailable: true }],
  }, primary);
  assert.equal(plan.device.udid, "peer");
  assert.equal(plan.device.version, "26.5");
});

test("clones the primary's model and runtime when no shard peer exists", () => {
  const runtime = "com.apple.CoreSimulator.SimRuntime.iOS-26-5";
  const primary = { name: "iPhone 17 Pro", udid: "primary", version: "26.5", runtime, deviceTypeIdentifier: "com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro" };
  const plan = planShardPeer({ [runtime]: [primary] }, primary);
  assert.deepEqual(plan.create, {
    name: SHARD_PEER_NAME,
    deviceTypeIdentifier: "com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro",
    runtime,
  });
});

test("keeps the selected device's runtime identifier for shard-peer cloning", () => {
  const selected = selectSimulator({
    "com.apple.CoreSimulator.SimRuntime.iOS-26-5": [{ name: "iPhone 17 Pro", udid: "device", isAvailable: true }],
  }, "26.5");
  assert.equal(selected.runtime, "com.apple.CoreSimulator.SimRuntime.iOS-26-5");
});
