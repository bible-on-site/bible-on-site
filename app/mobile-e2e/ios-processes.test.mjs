import assert from "node:assert/strict";
import { test } from "node:test";
import { iosAppLogPids, iosAppPids } from "./ios-processes.mjs";

// `launchctl list` answers for the one device it was spawned on, so a peer
// shard's app can never appear in the table — the rows below model a single
// simulator's own services.
const LISTING = [
  "PID\tStatus\tLabel",
  "-\t0\tcom.apple.SpringBoard",
  "8421\t0\tUIKitApplication:com.tanah.daily929[ab12]",
  "99\t0\tUIKitApplication:com.example.other[cd34]",
].join("\n");

test("returns the app's host PID from its own simulator's launchd table", () => {
  assert.deepEqual(iosAppPids(LISTING), ["8421"]);
});

test("ignores a registered app that is not running and unrelated labels", () => {
  const output = [
    "PID\tStatus\tLabel",
    "-\t0\tcom.apple.SpringBoard",
    "-\t0\tUIKitApplication:com.tanah.daily929[ef56]",
  ].join("\n");
  assert.deepEqual(iosAppPids(output), []);
});

test("returns nothing when the app never launched on the device", () => {
  assert.deepEqual(iosAppPids("PID\tStatus\tLabel\n-\t0\tcom.apple.SpringBoard\n"), []);
});

test("live-log identity collects only app metadata PIDs, including relaunches", () => {
  const log = [
    "2026-10-14 17:59:34.868 Df BibleOnSite[15058:b634] [reader-native] rendered",
    "2026-10-14 17:59:34.869 Df BibleOnSite[15058:b635] another message",
    "2026-10-14 17:59:34.870 Df BibleOnSite[2345:abc] relaunched",
    "2026-10-14 17:59:34.871 Df OtherApp[999:abc] BibleOnSite[888:abc] payload",
    "payload BibleOnSite[777:abc]",
  ].join("\n");
  assert.deepEqual(iosAppLogPids(log), [15058, 2345]);
  assert.deepEqual(iosAppLogPids(""), []);
});
