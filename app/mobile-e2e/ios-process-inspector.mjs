import { execFile } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const directory = dirname(fileURLToPath(import.meta.url));
const executeFile = promisify(execFile);

// Preparation runs before device tests, outside the five-second cleanup bound.
// Compile on this host so simulator consumers need no additional runtime. The
// bound guards a hung compiler, not the cleanup deadline — host builds get the
// same 300s budget as prepare-wda; a loaded runner's cold xcrun exceeds 5s.
export async function prepareIosProcessInspector({
  outputPath = resolve(directory, "../.artifacts/mobile-process/ios-process-inspector"),
  execute = executeFile,
} = {}) {
  const preparation = AbortSignal.timeout(300000);
  mkdirSync(dirname(outputPath), { recursive: true });
  await execute("/usr/bin/xcrun", ["clang", "-O2", "-Wall", "-Wextra", "-Werror",
    resolve(directory, "ios-process-inspector.c"), "-lproc", "-o", outputPath],
  { signal: preparation, timeout: 300000, windowsHide: true });
  if (!existsSync(outputPath)) throw new Error("The native iOS process inspector was not produced.");
  // Exercise the produced executable before tests. First-launch validation
  // and dynamic-loader work belong to preparation, not app termination.
  const { stdout, stderr = "" } = await execute(outputPath, [String(process.pid)],
    { signal: preparation, windowsHide: true });
  if (stderr.trim() || !stdout.startsWith(`${process.pid} L /`)) {
    throw new Error("The native iOS process inspector did not inspect its preparer.");
  }
  return outputPath;
}
