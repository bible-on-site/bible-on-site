// The sharded iOS run hosts two simulators on one runner (#2083): a host-wide
// `pgrep -x` cannot tell which device owns a BibleOnSite process, so the
// failure sampler asks this run's own simulator instead. `simctl spawn <udid>
// launchctl list` prints that device's launchd table — `PID`, `Status`,
// `Label` — where a running app appears as
// `UIKitApplication:<bundle-id>[<hash>]` with its host PID (simulator
// processes are host processes) and a `-` when it is registered but not
// running, which is also how a crashed app reads.
export const IOS_APP_BUNDLE_ID = "com.tanah.daily929";

export function iosAppPids(launchctlList, bundleId = IOS_APP_BUNDLE_ID) {
  return launchctlList.split("\n")
    .filter((line) => line.includes(bundleId))
    .map((line) => line.trim().split(/\s+/)[0])
    .filter((pid) => /^[0-9]+$/.test(pid));
}

// The stream is restricted to BibleOnSite on the run's explicit simulator.
// Use its observed host PIDs to avoid inspecting every process on a busy Mac.
export function iosAppLogPids(log) {
  const pids = new Set();
  // Scan once without allocating every line and its whitespace fields.
  // Accessibility logs can contain megabytes of multiline snapshot text.
  const header = /^\d{4}-\d{2}-\d{2}[ \t]+\S+[ \t]+\S+[ \t]+BibleOnSite\[(\d+):[0-9a-f]+\](?=\s|$)/gim;
  for (const match of log.matchAll(header)) pids.add(Number(match[1]));
  return [...pids];
}
