import { execFileSync, spawn } from "node:child_process";
import { closeSync, openSync, writeFileSync } from "node:fs";

// A pre-deadline observation must not pause a healthy app with launchctl/LLDB
// or replace a successful test exit with a failed diagnostic probe.
export async function captureNativeFrame(command, args, destination, execute) {
  try {
    await execute(command, [...args, destination], { timeout: 5000, windowsHide: true });
    return null;
  } catch (error) {
    writeFileSync(`${destination}-error.json`, JSON.stringify({
      message: error.message, code: error.code, killed: error.killed, signal: error.signal,
    }, null, 2));
    return error;
  }
}
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

// Keep automation-side events on the same explicit simulator, in their own
// artifact. Mixing them into the app-only stream could evict the app's last
// identity from the failure collector's bounded tail.
export function iosAutomationLogArguments(udid) {
  return ["simctl", "spawn", udid, "log", "stream", "--style", "compact", "--level", "info",
    "--predicate", 'process BEGINSWITH "WebDriverAgent" OR process == "testmanagerd"'];
}

// Device-scoped streams disappear with the simulator. Observe its host-side
// lifecycle independently so a shutdown during an otherwise valid XCTest
// query retains the service's reason and requesting client. Do not launch,
// inspect, or signal the simulator while collecting this evidence.
export function iosHostLogArguments() {
  return ["stream", "--style", "compact", "--level", "info", "--predicate",
    'process == "CoreSimulatorService" OR process == "DeviceHub" OR process == "Simulator" OR process == "simulatord" OR process == "launchd_sim"'];
}

// Stop every owned reader even when one failed. Each retains the existing
// five-second stop cap; concurrent joins do not add another shutdown allowance.
export async function stopNativeLogStreams(streams) {
  const results = await Promise.allSettled(streams.filter(Boolean)
    .map(stream => Promise.resolve().then(() => stream.stop())));
  const errors = results.filter(result => result.status === "rejected").map(result => result.reason);
  if (errors.length) throw new AggregateError(errors, "Native log streams failed");
}
