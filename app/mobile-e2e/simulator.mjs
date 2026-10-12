// Restrict selection to an available iPhone runtime supported by the selected
// Xcode SDK. A newer installed runtime can belong to a different Xcode release.
export function selectSimulator(devices, sdkVersion) {
  const version = (value) => value.split(/[.-]/).map(Number);
  const sdk = version(sdkVersion);
  const compare = (left, right) => {
    for (let index = 0; index < Math.max(left.length, right.length); index++) {
      const difference = (left[index] ?? 0) - (right[index] ?? 0);
      if (difference !== 0) return difference;
    }
    return 0;
  };
  return Object.entries(devices)
    .flatMap(([runtime, entries]) => {
      const prefix = "com.apple.CoreSimulator.SimRuntime.iOS-";
      if (!runtime.startsWith(prefix)) return [];
      const parts = runtime.slice(prefix.length).split("-");
      if (parts.some((part) => !/^[0-9]+$/.test(part))) return [];
      const runtimeVersion = parts.join(".");
      if (compare(version(runtimeVersion), sdk) > 0) return [];
      return entries.filter((device) => device.isAvailable && device.name.startsWith("iPhone"))
        .map((device) => ({ ...device, version: runtimeVersion, runtime }));
    })
    .sort((left, right) => compare(version(right.version), version(left.version))
      || left.name.localeCompare(right.name))[0];
}

// Reserved name of the second shard's simulator (#2083).
export const SHARD_PEER_NAME = "mobile-e2e-shard-2";

// The second shard runs on a same-model sibling of the primary so both halves
// share one hardware profile — a runner's preinstalled mix need not contain
// two of anything. A leftover device carrying the reserved name on the same
// runtime is reused, keeping re-runs idempotent; otherwise the caller creates
// the described clone through `simctl create`.
export function planShardPeer(devices, primary, name = SHARD_PEER_NAME) {
  const siblings = devices[primary.runtime] ?? [];
  const existing = siblings.find((device) => device.name === name && device.isAvailable);
  if (existing) return { device: { ...existing, version: primary.version, runtime: primary.runtime } };
  if (!primary.deviceTypeIdentifier) {
    throw new Error(`The primary simulator ${primary.udid} has no deviceTypeIdentifier; cannot clone it for the second shard.`);
  }
  return { create: { name, deviceTypeIdentifier: primary.deviceTypeIdentifier, runtime: primary.runtime } };
}
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export async function loadIosSimulatorDriver() {
  // Resolve from the locked driver so npm may nest or hoist its dependency.
  // The simulator exports only an ESM entry; resolve its public metadata first.
  const driverRequire = createRequire(import.meta.resolve("appium-xcuitest-driver"));
  const metadataPath = driverRequire.resolve("appium-ios-simulator/package.json");
  const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
  return import(pathToFileURL(resolve(dirname(metadataPath), metadata.main)).href);
}
