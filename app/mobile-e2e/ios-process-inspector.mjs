import { execFile } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const directory = dirname(fileURLToPath(import.meta.url));
const executeFile = promisify(execFile);

// Preparation runs before device tests, outside the five-second cleanup bound.
// Compile on this host so simulator consumers need no additional runtime.
export async function prepareIosProcessInspector({
  outputPath = resolve(directory, "../.artifacts/mobile-process/ios-process-inspector"),
  execute = executeFile,
} = {}) {
  mkdirSync(dirname(outputPath), { recursive: true });
  await execute("/usr/bin/xcrun", ["clang", "-O2", "-Wall", "-Wextra", "-Werror",
    resolve(directory, "ios-process-inspector.c"), "-lproc", "-o", outputPath],
  { timeout: 5000, windowsHide: true });
  if (!existsSync(outputPath)) throw new Error("The native iOS process inspector was not produced.");
  return outputPath;
}
