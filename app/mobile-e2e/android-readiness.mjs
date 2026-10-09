import { execFile } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

export async function waitForAndroidDevice({ adb, udid, timeout = 120000, stableFor = 10000,
  interval = 1000, execute = promisify(execFile), sleep = delay, now = Date.now, observe = () => {} }) {
  const started = now();
  let stableSince;
  while (now() - started < timeout) {
    try {
      const options = { timeout: 5000, windowsHide: true };
      const state = (await execute(adb, ["-s", udid, "get-state"], options)).stdout.trim();
      const boot = (await execute(adb, ["-s", udid, "shell", "getprop", "sys.boot_completed"], options)).stdout.trim();
      const packages = (await execute(adb, ["-s", udid, "shell", "pm", "path", "android"], options)).stdout.trim();
      const ready = state === "device" && boot === "1" && packages.startsWith("package:");
      observe({ elapsedMs: now() - started, ready, state, boot, packages });
      if (ready) {
        stableSince ??= now();
        if (now() - stableSince >= stableFor) return;
      } else {
        stableSince = undefined;
      }
    } catch (error) {
      observe({ elapsedMs: now() - started, ready: false, code: error.code, error: String(error) });
      if (["ENOENT", "EACCES"].includes(error.code)) throw error;
      stableSince = undefined;
    }
    await sleep(interval);
  }
  throw new Error(`Android device ${udid} did not keep a booted, responsive package manager for ${stableFor}ms within ${timeout}ms.`);
}
