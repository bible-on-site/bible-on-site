import { execFileSync, spawn } from "node:child_process";
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

// Save diagnostics while the suite runs, including when CI cancels the job
// before its final log export can execute.
export function startNativeLog(command, args, destination) {
  const output = openSync(destination, "w");
  let child;
  try {
    child = spawn(command, args, { windowsHide: true, stdio: ["ignore", output, output] });
  } catch (error) {
    closeSync(output);
    throw error;
  }
  let failure;
  let stopping = false;
  const completion = new Promise((resolve) => {
    child.once("error", (error) => { failure = error; resolve(); });
    child.once("exit", (code, signal) => {
      if (!stopping) failure = new Error(`Native log stream exited unexpectedly: code ${code}, signal ${signal}`);
      resolve();
    });
  });
  return {
    completion,
    kill() { stopping = true; child.kill(); },
    async stop() {
      this.kill();
      const escalation = setTimeout(() => child.kill("SIGKILL"), 3000);
      let deadline;
      try {
        await Promise.race([completion, new Promise((_, reject) => {
          deadline = setTimeout(() => reject(new Error("Native log stream did not stop within five seconds")), 5000);
        })]);
        if (failure) throw failure;
      } finally {
        clearTimeout(escalation);
        clearTimeout(deadline);
        closeSync(output);
      }
    },
  };
}
