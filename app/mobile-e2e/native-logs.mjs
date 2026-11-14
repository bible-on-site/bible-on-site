import { execFileSync, spawn } from "node:child_process";
import { closeSync, openSync, statSync, writeFileSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

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
export function startNativeLog(command, args, destination, { onOutput } = {}) {
  const output = openSync(destination, "w");
  let child;
  let failure;
  try {
    child = spawn(command, args, { windowsHide: true,
      stdio: onOutput ? ["ignore", "pipe", "pipe"] : ["ignore", output, output] });
  } catch (error) {
    closeSync(output);
    throw error;
  }
  if (onOutput) {
    for (const pipe of [child.stdout, child.stderr]) pipe.on("data", chunk => {
      try {
        // Persist before notifying the observer; close waits for both pipes
        // to drain, so the final event cannot race descriptor cleanup.
        writeSync(output, chunk);
        onOutput(chunk);
      } catch (error) { failure ??= error; }
    });
  }
  let stopping = false;
  const completion = new Promise((resolve) => {
    child.once("error", (error) => { failure ??= error; resolve(); });
    child.once("close", (code, signal) => {
      if (!stopping) failure ??= new Error(`Native log stream exited unexpectedly: code ${code}, signal ${signal}`);
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
// lifecycle independently to retain the service's events when a device
// disappears during an otherwise valid XCTest query. Do not launch,
// inspect, or signal the simulator while collecting this evidence. The
// CoreSimulator subsystem term keeps client-side records — every simctl or
// CoreSimulatorKit caller is a potential requester — while the explicit
// process terms retain service records emitted under other subsystems.
export function iosHostLogArguments() {
  return ["stream", "--style", "compact", "--level", "info", "--predicate",
    'process == "CoreSimulatorService" OR process == "com.apple.CoreSimulator.CoreSimulatorService" OR process == "DeviceHub" OR process == "Simulator" OR process == "simulatord" OR process == "launchd_sim" OR process == "simctl" OR subsystem BEGINSWITH "com.apple.CoreSimulator"'];
}

// The bounded shutdown check also watches a debug-level probe built on the
// same predicate. If this captures a lifecycle record the info-level
// contract misses, collection — not the OS — is what loses the evidence.
export function iosHostDebugProbeArguments() {
  const args = iosHostLogArguments();
  args[args.indexOf("--level") + 1] = "debug";
  return args;
}

// A post-hoc `log show` reads the persisted store after the observation
// window, recovering records a live stream can drop and exposing what the
// current persistence configuration retains. --info/--debug ask the query
// for the levels the stream's --level flag covers. Callers bound `--last`
// to the measurement window so an earlier shutdown of the same device
// cannot count as evidence for the controlled one.
export function iosHostPosthocArguments(seconds = 120) {
  return ["show", "--last", `${seconds}s`, "--style", "compact", "--info", "--debug",
    "--predicate", iosHostLogArguments().at(-1)];
}

// CoreSimulator also keeps a host file log. On the measured macOS image its
// lifecycle records are absent from unified logging, even at debug level.
// Start at an absolute byte offset so an append before tail opens is retained.
export function startIosClassicHostLog(destination, { onOutput, home = homedir(),
  start = startNativeLog } = {}) {
  const candidates = [join(home, "Library", "Logs", "CoreSimulator", "CoreSimulator.log"),
    join(home, "Library", "Logs", "CoreSimulator.log")];
  let source, offset = null;
  for (const path of candidates) {
    let status;
    try { status = statSync(path); }
    catch (error) {
      if (["ENOENT", "ENOTDIR"].includes(error.code)) continue;
      throw error;
    }
    if (status.isFile()) { source = path; offset = status.size; break; }
  }
  writeFileSync(`${destination}.source.json`, JSON.stringify({ source: source ?? null,
    candidates, offset, startedAt: new Date().toISOString() }, null, 2));
  if (!source) return undefined;
  return start("/usr/bin/tail", ["-c", `+${offset + 1}`, "-F", source], destination, { onOutput });
}

// Stop every owned reader even when one failed. Each retains the existing
// five-second stop cap; concurrent joins do not add another shutdown allowance.
export async function stopNativeLogStreams(streams) {
  const results = await Promise.allSettled(streams.filter(Boolean)
    .map(stream => Promise.resolve().then(() => stream.stop())));
  const errors = results.filter(result => result.status === "rejected").map(result => result.reason);
  if (errors.length) throw new AggregateError(errors, "Native log streams failed");
}
