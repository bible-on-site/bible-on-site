import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

// xUnit's warning precedes its existing ten-second forced-exit guard. Capture
// live managed stacks now; after the failure the offending process is gone.
export function monitorTestHostShutdown(capture) {
  const partial = new Map();
  let completion = Promise.resolve();
  let captured = false;
  let stopped = false;
  let failure;
  return {
    write(chunk, stream = "stdout") {
      if (captured || stopped) return;
      const value = (partial.get(stream) ?? "") + chunk.toString();
      if (/Waiting \d+ seconds for foreground threads to exit\.\.\./.test(value)) {
        captured = true;
        completion = Promise.resolve().then(capture).catch(error => { failure = error; });
      }
      partial.set(stream, value.slice(-256));
    },
    async stop() { stopped = true; await completion; if (failure) throw failure; },
  };
}

export async function captureTestHostStacks(directory, tool, execute) {
  // All captures share five seconds, inside the existing shutdown guard.
  const signal = AbortSignal.timeout(5000);
  const hosts = (await readdir(directory)).filter(name => /^host-[1-9]\d*\.json$/.test(name));
  if (hosts.length === 0) throw new Error("No registered mobile test hosts to inspect.");
  await Promise.all(hosts.map(async name => {
    const { pid } = JSON.parse(await readFile(join(directory, name), "utf8"));
    if (!Number.isSafeInteger(pid) || pid <= 1 || name !== `host-${pid}.json`) {
      throw new Error(`Invalid harness process registration: ${name}`);
    }
    try {
      const { stdout, stderr } = await execute(tool, ["report", "--process-id", String(pid)],
        { signal, timeout: 5000, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
      await writeFile(join(directory, `stack-${pid}.txt`), stdout + stderr);
    } catch (error) {
      // A process may already have exited. Preserve the tool's exact evidence;
      // the test process's real exit code still decides the test outcome.
      await writeFile(join(directory, `stack-${pid}-error.txt`),
        [error.message, error.stdout, error.stderr].filter(Boolean).join("\n"));
    }
  }));
}
