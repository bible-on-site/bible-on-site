import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { lstat, open, readlink, readdir, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const executeFile = promisify(execFile);
export function executeIosCommand(command, args, { input, ...options } = {}) {
  const pending = executeFile(command, args, options);
  let inputError;
  // A child that rejects its arguments may exit before consuming stdin.
  // Retain its exit code/stderr rather than crashing on an unhandled EPIPE.
  pending.child.stdin.on("error", error => { inputError = error; });
  pending.child.stdin.end(input);
  return pending.then(result => {
    if (inputError) throw new Error("Could not deliver the complete iOS command input.", { cause: inputError });
    return result;
  });
}
const bundleId = "com.tanah.daily929";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Read the small Mach-O header directly. Starting lipo/uname for this same
// immutable executable delayed a measured Appium session by 199 seconds.
export async function verifySimulatorExecutable(path) {
  const file = await open(path, "r");
  try {
    const header = Buffer.alloc(32);
    if ((await file.read(header, 0, 32, 0)).bytesRead !== 32 ||
        header.readUInt32LE(0) !== 0xfeedfacf || header.readUInt32LE(4) !== 0x100000c ||
        header.readUInt32LE(12) !== 2) {
      throw new Error("The iOS AUT must be a thin arm64 Mach-O executable.");
    }
    const count = header.readUInt32LE(16);
    const size = header.readUInt32LE(20);
    if (count > 4096 || size > 16 * 1024 * 1024) throw new Error("Invalid Mach-O load commands.");
    const commands = Buffer.alloc(size);
    if ((await file.read(commands, 0, size, 32)).bytesRead !== size) throw new Error("Truncated Mach-O load commands.");
    let offset = 0;
    let simulator = false;
    for (let index = 0; index < count; index++) {
      if (offset + 8 > size) throw new Error("Invalid Mach-O load command.");
      const command = commands.readUInt32LE(offset);
      const bytes = commands.readUInt32LE(offset + 4);
      if (bytes < 8 || offset + bytes > size) throw new Error("Invalid Mach-O load command size.");
      if (command === 0x32) {
        if (bytes < 24 || commands.readUInt32LE(offset + 8) !== 7) {
          throw new Error("The iOS AUT was not built for iPhoneSimulator.");
        }
        simulator = true;
      }
      offset += bytes;
    }
    if (!simulator || offset !== size) throw new Error("Missing iPhoneSimulator Mach-O build identity.");
  } finally { await file.close(); }
}

// Every file participates, including the woven IL/recorder and native AOT
// payload. Checking only the launcher would accept a different managed build.
export async function bundleDigest(root, checkDeadline = () => {}) {
  root = await realpath(root);
  const hash = createHash("sha256");
  async function visit(directory) {
    for (const name of (await readdir(directory)).sort()) {
      checkDeadline();
      const path = join(directory, name);
      const entry = await lstat(path);
      const key = relative(root, path).split(sep).join("/");
      if (entry.isSymbolicLink()) {
        const target = await readlink(path);
        const resolved = relative(root, await realpath(path));
        if (isAbsolute(target) || resolved === ".." || resolved.startsWith(`..${sep}`) || isAbsolute(resolved)) {
          throw new Error(`Bundle symlink escapes its app: ${key}`);
        }
        hash.update(JSON.stringify([key, "link", target]));
      } else if (entry.isDirectory()) {
        hash.update(JSON.stringify([key, "directory"]));
        await visit(path);
      } else if (entry.isFile()) {
        const content = createHash("sha256");
        for await (const chunk of createReadStream(path)) {
          checkDeadline();
          content.update(chunk);
        }
        hash.update(JSON.stringify([key, "file", entry.size, content.digest("hex")]));
      } else throw new Error(`Unsupported bundle entry: ${key}`);
    }
  }
  await visit(root);
  return hash.digest("hex");
}

export async function prepareIosApp({
  appPath, udid, nonce, keepData = false, deadlineMs,
  execute = executeIosCommand, now = Date.now, platform = process.platform,
  devicesRoot = join(homedir(), "Library/Developer/CoreSimulator/Devices"),
}) {
  const started = now();
  if (platform !== "darwin") throw new Error("iOS installation requires macOS.");
  if (!uuid.test(udid ?? "") || !/^[0-9a-f]{32}$/i.test(nonce ?? "")) {
    throw new Error("Missing exact simulator/session identity.");
  }
  if (!Number.isFinite(deadlineMs) || deadlineMs <= started || deadlineMs - started > 300000) {
    throw new Error("iOS preparation must share the existing 300 second session deadline.");
  }
  const checkDeadline = () => {
    if (now() >= deadlineMs) throw new Error("iOS preparation exhausted the 300 second session deadline.");
  };
  const run = async (command, args, options = {}) => {
    checkDeadline();
    const result = await execute(command, args, {
      ...options, timeout: Math.max(1, Math.floor(deadlineMs - now())), killSignal: "SIGKILL",
      maxBuffer: 8 * 1024 * 1024, encoding: "utf8", windowsHide: true,
    });
    checkDeadline();
    return result.stdout;
  };
  const requestedAppPath = resolve(appPath);
  appPath = await realpath(requestedAppPath);
  const info = JSON.parse(await run("plutil", ["-convert", "json", "-o", "-", join(appPath, "Info.plist")]));
  if (info.CFBundleIdentifier !== bundleId || info.CFBundleSupportedPlatforms?.length !== 1 ||
      info.CFBundleSupportedPlatforms[0] !== "iPhoneSimulator" ||
      typeof info.CFBundleExecutable !== "string" || !info.CFBundleExecutable ||
      basename(info.CFBundleExecutable) !== info.CFBundleExecutable || /[\\/]/.test(info.CFBundleExecutable)) {
    throw new Error("The iOS AUT has an unexpected bundle/platform/executable identity.");
  }
  await verifySimulatorExecutable(join(appPath, info.CFBundleExecutable));
  const expectedDigest = await bundleDigest(appPath, checkDeadline);
  const devices = JSON.parse(await run("xcrun", ["simctl", "list", "devices", "--json"])).devices;
  const matching = Object.entries(devices).flatMap(([runtime, list]) =>
    list.filter(device => device.udid === udid).map(device => ({ ...device, runtime })));
  if (matching.length !== 1 || matching[0].state !== "Booted" || !matching[0].isAvailable ||
      !matching[0].runtime.startsWith("com.apple.CoreSimulator.SimRuntime.iOS-")) {
    throw new Error("The selected iOS simulator is not uniquely available and booted.");
  }
  const installedApps = async () => {
    const listing = await run("xcrun", ["simctl", "listapps", udid]);
    return JSON.parse(await run("plutil", ["-convert", "json", "-o", "-", "-"], { input: listing }));
  };
  if (Object.hasOwn(await installedApps(), bundleId)) {
    if (keepData) {
      // simctl reports an exact error when this app is already stopped.
      // Any other failure leaves process ownership uncertain and is fatal.
      try { await run("xcrun", ["simctl", "terminate", udid, bundleId]); }
      catch (error) {
        const report = String(error.stderr ?? "");
        if (error.code !== 3 || !report.includes("domain=NSPOSIXErrorDomain, code=3") ||
            !report.includes("found nothing to terminate")) throw error;
        checkDeadline();
      }
    } else {
      await run("xcrun", ["simctl", "uninstall", udid, bundleId]);
      if (Object.hasOwn(await installedApps(), bundleId)) throw new Error("iOS reset left the AUT installed.");
    }
  }
  const installStarted = now();
  await run("xcrun", ["simctl", "install", udid, appPath]);
  const installMs = now() - installStarted;
  if (!Object.hasOwn(await installedApps(), bundleId)) throw new Error("iOS install did not register the AUT.");
  const installedPath = (await run("xcrun", ["simctl", "get_app_container", udid, bundleId, "app"])).trim();
  const containerRoot = join(await realpath(devicesRoot), udid, "data/Containers/Bundle/Application");
  const installedRealPath = await realpath(installedPath);
  const parts = relative(containerRoot, installedRealPath).split(sep);
  if (!isAbsolute(installedPath) || installedRealPath === appPath || parts.length !== 2 ||
      !uuid.test(parts[0]) || parts[1] !== "BibleOnSite.app") {
    throw new Error("iOS install did not identify this simulator's exact AUT container.");
  }
  if (await bundleDigest(installedPath, checkDeadline) !== expectedDigest ||
      await bundleDigest(appPath, checkDeadline) !== expectedDigest) {
    throw new Error("Installed iOS AUT bytes differ from the exact input bundle.");
  }
  checkDeadline();
  return { kind: "ios-verified-install/1", udid, appPath: requestedAppPath, canonicalAppPath: appPath, nonce,
    bundleId, bundleSha256: expectedDigest, keepData, installMs, preparationMs: now() - started };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [appPath, udid, nonce, keep, deadline] = process.argv.slice(2);
  if (process.argv.length !== 7 || !["reset", "keep"].includes(keep)) throw new Error("Invalid iOS installation arguments.");
  console.log(JSON.stringify(await prepareIosApp({ appPath, udid, nonce,
    keepData: keep === "keep", deadlineMs: Number(deadline) })));
}
