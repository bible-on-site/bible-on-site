import { execFile } from "node:child_process";
import { promisify } from "node:util";

const executeFile = promisify(execFile);
const bundleId = "com.tanah.daily929";

export async function terminateIosTestApp(udid, { keepApp = false, execute = executeFile } = {}) {
  if (!udid) throw new Error("Simulator app cleanup requires this run's explicit UDID.");
  const started = Date.now();
  if (keepApp) return { status: "kept", udid, bundleId, elapsedMs: 0 };
  let status = "terminated";
  try {
    // Direct simulator control avoids XCTest's app.running/terminate calls
    // inside WDA session deletion. Own only this app on this explicit device.
    await execute("xcrun", ["simctl", "terminate", udid, bundleId], {
      timeout: 5000, windowsHide: true,
    });
  } catch (error) {
    const message = `${error.stderr ?? ""} ${error.message ?? ""}`;
    if (!/NSPOSIXErrorDomain.*code[= :]\s*3/.test(message) ||
        !/found nothing to terminate|no such process/i.test(message)) throw error;
    status = "already-stopped";
  }
  return { status, udid, bundleId, elapsedMs: Date.now() - started };
}
