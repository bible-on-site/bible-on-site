import { spawn } from "node:child_process";

// Diagnostic bytes share the installer's existing stderr pipe. Never wait for
// backpressure or stop draining a native child after the retained prefix fills.
export function iosBootDiagnosticOutput({ udid, nonce, deadlineMs, write = value => process.stderr.write(value), now = Date.now }) {
  const started = now();
  return Object.fromEntries([["bootstatus", 64 * 1024], ["host-resources", 128 * 1024]].map(([source, cap]) => {
    let retained = 0, records = 0, truncated = false;
    return [source, (stream, chunk) => {
      const bytes = Buffer.from(chunk);
      // Bound framing as well as payload if a native child emits one byte per
      // write. The installer owner's existing 8 MiB capture is unchanged.
      const prefix = bytes.subarray(0, records < 512 ? Math.max(0, cap - retained) : 0);
      retained += prefix.length;
      const firstTruncation = !truncated && prefix.length < bytes.length;
      truncated ||= firstTruncation;
      if (!prefix.length && !firstTruncation) return;
      records++;
      write(`${JSON.stringify({ kind: "ios-boot-diagnostic/1", source, stream, udid, nonce,
        at: new Date(now()).toISOString(), elapsedMs: now() - started, remainingMs: deadlineMs - now(),
        retainedBytes: retained, truncated, text: prefix.toString("utf8") })}\n`);
    }];
  }));
}

// The fixed read-only sampler remains inside the installer's owned process
// group. Its normal stop joins pipes; cancellation uses the same group kill
// and original preparation deadline as every other installer child.
export function startIosResourceSampler(output, { deadlineMs, launch = spawn } = {}) {
  if (!Number.isFinite(deadlineMs) || deadlineMs <= Date.now() || deadlineMs - Date.now() > 300000) {
    throw new Error("The resource sampler requires the remaining original preparation deadline.");
  }
  // -F/-R avoid framework and memory-map walks; -S retains swap pressure.
  const child = launch("/usr/bin/top", ["-l", "31", "-s", "10", "-n", "12", "-o", "cpu", "-F", "-R", "-S",
    "-stats", "pid,command,cpu,mem,threads,state,ppid,pgrp"], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let failure, stopping = false, stop;
  for (const [stream, pipe] of [["stdout", child.stdout], ["stderr", child.stderr]]) {
    pipe.on("data", chunk => {
      try { output(stream, chunk); } catch (error) { failure ??= error; }
    });
    pipe.on("error", error => { failure ??= error; });
  }
  const closed = new Promise(resolve => {
    child.once("error", error => { failure ??= error; });
    child.once("close", (code, signal) => {
      if ((code !== 0 || signal) && !(stopping && signal === "SIGKILL")) {
        failure ??= new Error(`Read-only resource sampler failed: code ${code}, signal ${signal}`);
      }
      resolve();
    });
  });
  return { stop() {
    return stop ??= (async () => {
      stopping = true;
      child.kill("SIGKILL");
      await closed;
      if (failure) throw failure;
    })();
  } };
}

export async function withIosResourceSampler(action, start) {
  const sampler = start?.();
  let value, primary;
  try { value = await action(); } catch (error) { primary = error; }
  try { await sampler?.stop(); }
  catch (error) {
    if (primary) throw new AggregateError([primary, error], "iOS preparation and resource sampler cleanup failed.");
    throw error;
  }
  if (primary) throw primary;
  return value;
}
