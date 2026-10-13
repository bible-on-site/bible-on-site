// Simulator device-state capture for app-mobile-e2e.yml's iOS leg.
//
// `quiesce <expected-udid>` runs post-test on cache-miss runs eligible to
// publish: it removes the test app and WebDriverAgent so the captured device
// stays clean (a leftover app could make Appium skip reinstalling the fresh
// build), then shuts the device down so the saved directory is a consistent
// Shutdown state instead of a mid-write Booted one.
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const SHUTDOWN_TIMEOUT_MS = 120000;
const POLL_INTERVAL_MS = 2000;
// Removed even when listapps enumeration fails, so a partial listing can never
// leave the known test installs inside the saved device.
const KNOWN_TEST_BUNDLES = [
  "com.tanah.daily929",
  "com.facebook.WebDriverAgentRunner.xctrunner",
];

export function deviceDirectory(udid, home = homedir()) {
  return join(home, "Library", "Developer", "CoreSimulator", "Devices", udid);
}

// Only test installs are removed; Apple-bundled apps stay in the saved state.
export function testBundleIds(installed) {
  return Object.keys(installed).filter((id) => /daily929|webdriveragent/i.test(id));
}

export function deviceState(simctlDevices, udid) {
  for (const devices of Object.values(simctlDevices)) {
    for (const device of devices) {
      if (device.udid === udid) return device.state;
    }
  }
  return undefined;
}

export function deviceStateConsistent(deviceDir, dirExists = existsSync) {
  return ["device.plist", "data"].every((entry) => dirExists(join(deviceDir, entry)));
}

export async function quiesce({
  udid,
  expectedUdid,
  run = (command, args, options = {}) => execFileSync(command, args, { timeout: 30000, ...options }),
  sleep = delay,
  now = Date.now,
  timeout = SHUTDOWN_TIMEOUT_MS,
  dirExists = existsSync,
  observe = () => {},
}) {
  // The key names one device; capturing another would poison it, and without a
  // booted device there is no warm state worth saving.
  if (!udid || udid !== expectedUdid) {
    observe({ saved: false, reason: "booted device differs from the resolved cache key" });
    return false;
  }
  const directory = deviceDirectory(udid);
  if (deviceState(currentDevices(run), udid) !== "Booted") {
    observe({ saved: false, reason: "device is not fully booted" });
    return false;
  }
  let bundleIds = KNOWN_TEST_BUNDLES;
  try {
    const listing = run("xcrun", ["simctl", "listapps", udid]);
    const json = run("plutil", ["-convert", "json", "-o", "-", "-"], { input: listing });
    bundleIds = [...new Set([...KNOWN_TEST_BUNDLES, ...testBundleIds(JSON.parse(json.toString()))])];
  } catch (error) {
    observe({ note: "listapps enumeration failed, removing known test bundles", error: String(error) });
  }
  for (const id of bundleIds) {
    try {
      run("xcrun", ["simctl", "uninstall", udid, id]);
      observe({ uninstalled: id });
    } catch (error) {
      observe({ note: `uninstall ${id} skipped`, error: String(error) });
    }
  }
  try {
    run("xcrun", ["simctl", "shutdown", udid]);
  } catch (error) {
    observe({ note: "shutdown signal failed (device may already be off)", error: String(error) });
  }
  const started = now();
  while (now() - started < timeout) {
    const state = deviceState(currentDevices(run), udid);
    observe({ state, elapsedMs: now() - started });
    if (state === "Shutdown") {
      const saved = deviceStateConsistent(directory, dirExists);
      observe({ saved });
      return saved;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  observe({ saved: false, reason: "shutdown timeout" });
  return false;
}

function currentDevices(run) {
  return JSON.parse(run("xcrun", ["simctl", "list", "devices", "--json"]).toString()).devices;
}

function output(name, value) {
  appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

if (resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, expectedUdid] = process.argv.slice(2);
  if (command === "quiesce") {
    if (!expectedUdid) throw new Error("Usage: ios-sim-state.mjs quiesce <resolved-udid>");
    const saved = await quiesce({
      udid: process.env.MOBILE_UDID,
      expectedUdid,
      observe: (observation) => console.log(JSON.stringify(observation)),
    });
    if (!saved) {
      console.log(
        "::warning::Simulator device state was not captured cleanly; " +
          "the device-state cache will not be saved this run.",
      );
    }
    output("saved", String(saved));
  } else {
    throw new Error(`Unknown command "${command}" (quiesce).`);
  }
}
