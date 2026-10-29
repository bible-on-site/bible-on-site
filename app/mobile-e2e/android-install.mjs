import { execFile } from "node:child_process";
import { promisify } from "node:util";

const probeTimeoutMs = 15000;

const versionAtLeast = (version, required) => {
  const parts = version.split(".").map(Number);
  const requiredParts = required.split(".").map(Number);
  for (let index = 0; index < requiredParts.length; index++) {
    if ((parts[index] ?? 0) !== requiredParts[index]) return (parts[index] ?? 0) > requiredParts[index];
  }
  return true;
};

// `adb install` picks an IncFS incremental install whenever the client binary
// (>= 30.0.1) and the device (abb_exec feature) both support it — the same
// predicate appium-adb's isIncrementalInstallSupported uses. Xamarin mmaps
// assemblies.blob out of the staged APK and can SIGSEGV in libmonodroid
// open_from_bundles before IncFS materializes the page (#2773), so the app
// under test must ride the deterministic --no-incremental path.
export async function incrementalInstallSupported({ adb, udid, execute = promisify(execFile) }) {
  const { stdout: versionOutput } = await execute(adb, ["version"], { timeout: probeTimeoutMs });
  const version = (/^Version ([\d.]+)/m.exec(versionOutput)
    ?? /Android Debug Bridge version ([\d.]+)/.exec(versionOutput))?.[1];
  if (!version || !versionAtLeast(version, "30.0.1")) return false;
  const { stdout: featuresOutput } = await execute(adb, ["-s", udid, "features"], { timeout: probeTimeoutMs });
  return featuresOutput.split(/\s+/).includes("abb_exec");
}

// Installs the app under test deterministically: --no-incremental wherever
// the device could otherwise stage it on IncFS, and -g so sessions reusing
// the package (noReset) keep autoGrantPermissions' manifest grants. Review
// runs keep the app's data with `install -r`; normal runs replace the package
// entirely so every scenario starts from the same clean install.
export async function installAppUnderTest({ adb, udid, appPath, packageId, keepData = false,
    execute = promisify(execFile), installTimeoutMs = 180000 }) {
  const device = (args, options = {}) =>
    execute(adb, ["-s", udid, ...args], { timeout: installTimeoutMs, ...options });
  if (!keepData) {
    // `adb uninstall` exits nonzero on a package that is not installed; the
    // path probe distinguishes that expected case from a genuine failure.
    const { stdout: paths } = await device(["shell", "pm", "path", packageId], { timeout: 30000 });
    if (paths.trim()) await device(["uninstall", packageId]);
  }
  const args = ["install"];
  if (keepData) args.push("-r");
  if (await incrementalInstallSupported({ adb, udid, execute })) args.push("--no-incremental");
  args.push("-g", appPath);
  const { stdout } = await device(args);
  if (!/Success/.test(stdout)) {
    throw new Error(`adb install failed for ${appPath}: ${stdout.trim()}`);
  }
  return { keepData, output: stdout.trim() };
}
