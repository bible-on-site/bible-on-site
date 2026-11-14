import { copyFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

// A dead simulator can take the app and WDA down together. Their own crash
// reports alone cannot distinguish that from an application failure. The
// runner belongs to this job; retain only relevant reports from this run.
const processNames = ["BibleOnSite", "WebDriverAgent", "WebDriverAgentRunner", "CoreSimulatorService",
  "com.apple.CoreSimulator.CoreSimulatorService", "DeviceHub", "Simulator", "simulatord", "SpringBoard", "backboardd", "testmanagerd",
  "runningboardd", "launchd_sim", "JetsamEvent"];

export function copyIosCrashReports(directories, artifacts, runStarted) {
  for (const [index, directory] of directories.entries()) {
    if (!existsSync(directory)) continue;
    for (const report of readdirSync(directory)) {
      if (!processNames.some(name => report.startsWith(`${name}_`)
        || report.startsWith(`${name}-`))) continue;
      const source = resolve(directory, report);
      const metadata = statSync(source);
      if (metadata.isFile() && metadata.mtimeMs >= runStarted) {
        copyFileSync(source, resolve(artifacts, `crash-${index}-${report}`));
      }
    }
  }
}
