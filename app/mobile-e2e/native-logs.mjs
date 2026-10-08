import { execFileSync } from "node:child_process";
import { closeSync, openSync } from "node:fs";

// Native logs can exceed tens of megabytes after a fresh commentary import.
// Stream stdout to the artifact instead of buffering the entire log in Node.
export function exportNativeLog(command, args, destination, timeout = 120000) {
  const output = openSync(destination, "w");
  try {
    execFileSync(command, args, {
      timeout,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
      stdio: ["ignore", output, "pipe"],
    });
  } finally {
    closeSync(output);
  }
}
