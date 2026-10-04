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
        .map((device) => ({ ...device, version: runtimeVersion }));
    })
    .sort((left, right) => compare(version(right.version), version(left.version))
      || left.name.localeCompare(right.name))[0];
}
