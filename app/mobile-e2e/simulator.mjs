export function compareVersions(left, right) {
  const parts = (value) => value.split(/[.-]/).map(Number);
  const leftParts = parts(left);
  const rightParts = parts(right);
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index++) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

// Restrict selection to an available iPhone runtime supported by the selected
// Xcode SDK. A newer installed runtime can belong to a different Xcode release.
export function selectSimulator(devices, sdkVersion) {
  return Object.entries(devices)
    .flatMap(([runtime, entries]) => {
      const prefix = "com.apple.CoreSimulator.SimRuntime.iOS-";
      if (!runtime.startsWith(prefix)) return [];
      const parts = runtime.slice(prefix.length).split("-");
      if (parts.some((part) => !/^[0-9]+$/.test(part))) return [];
      const runtimeVersion = parts.join(".");
      if (compareVersions(runtimeVersion, sdkVersion) > 0) return [];
      return entries.filter((device) => device.isAvailable && device.name.startsWith("iPhone"))
        .map((device) => ({ ...device, version: runtimeVersion, runtime }));
    })
    // UDID tie-break: identical name+runtime entries must resolve to one device
    // across the resolve/boot/save steps or the simulator-state cache would key
    // and capture different directories.
    .sort((left, right) => compareVersions(right.version, left.version)
      || left.name.localeCompare(right.name) || left.udid.localeCompare(right.udid))[0];
}

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export async function loadIosSimulatorDriver() {
  // Resolve from the locked driver so the package manager may nest or hoist its dependency.
  // The simulator exports only an ESM entry; resolve its public metadata first.
  const driverRequire = createRequire(import.meta.resolve("appium-xcuitest-driver"));
  const metadataPath = driverRequire.resolve("appium-ios-simulator/package.json");
  const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
  return import(pathToFileURL(resolve(dirname(metadataPath), metadata.main)).href);
}
