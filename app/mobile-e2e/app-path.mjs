import { resolve } from "node:path";

// Use one lexical identity across the parent, helper receipt and C# client.
// Keep symlink spelling; only relative and dot segments are normalized.
export function resolveMobileAppPath(directory, platform, override) {
  return resolve(override ?? resolve(directory, platform === "android"
    ? "../BibleOnSite/bin/Debug/net11.0-android/android-x64/com.tanah.daily929-Signed.apk"
    : "../BibleOnSite/bin/Debug/net11.0-ios/iossimulator-arm64/BibleOnSite.app"));
}
