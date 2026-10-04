import assert from "node:assert/strict";
import { test } from "node:test";
import { selectSimulator } from "./simulator.mjs";

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
