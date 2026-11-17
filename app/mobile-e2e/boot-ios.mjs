import { execFile, execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { compareVersions, loadIosNativeSimulator, loadIosSimulatorDriver, selectSimulator } from "./simulator.mjs";

function handedOffSimulator(env, sdk) {
  const udid = env.MOBILE_UDID;
  const version = env.MOBILE_OS_VERSION;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(udid ?? "")
    || !/^\d+(?:\.\d+){1,2}$/.test(version ?? "")) {
    throw new Error("The iOS boot handoff requires an explicit simulator UDID and numeric runtime version.");
  }
  if (!/^\d+(?:\.\d+){0,2}$/.test(sdk)) throw new Error("Invalid iOS SDK version in simulator handoff.");
  if (compareVersions(version, sdk) > 0) {
    throw new Error(`Handed-off iOS runtime ${version} is incompatible with SDK ${sdk}.`);
  }
  return { udid, version, state: "Booting" };
}

function nativeIosVersion(identifier) {
  const prefix = "com.apple.CoreSimulator.SimRuntime.iOS-";
  if (typeof identifier !== "string" || !identifier.startsWith(prefix)) return undefined;
  const parts = identifier.slice(prefix.length).split("-", 4);
  if (parts.length > 3) return undefined;
  for (const part of parts) {
    if (part.length === 0) return undefined;
    for (const character of part) {
      if (character < "0" || character > "9") return undefined;
    }
  }
  return parts.join(".");
}

export async function bootIos({
  mode = "boot",
  env = process.env,
  run = (...args) => execFileSync("xcrun", args, { encoding: "utf8", timeout: 300000 }),
  downloadPlatform = () => execFileSync("xcodebuild", ["-downloadPlatform", "iOS"], { stdio: "inherit", timeout: 900000 }),
  execute = promisify(execFile),
  loadDriver = loadIosSimulatorDriver,
  loadNativeDriver = loadIosNativeSimulator,
  sleep = delay,
  now = Date.now,
  log = console.log,
} = {}) {
  if (!["start", "wait", "boot", "resolve", "heal"].includes(mode)) throw new Error(`Unknown ios:boot mode '${mode}'.`);
  const sdk = run("--sdk", "iphonesimulator", "--show-sdk-version").trim();
  const listDevices = () => JSON.parse(run("simctl", "list", "devices", "available", "--json")).devices;
  const select = () => selectSimulator(listDevices(), sdk);
  // The start step already selected and started this exact device. Re-listing
  // every simulator while it boots adds a blocking CoreSimulator round trip.
  // Standalone wait still selects normally; a partial handoff must never pick
  // another device or download a runtime instead.
  const handoff = (mode === "wait" || mode === "heal") && (env.MOBILE_UDID !== undefined || env.MOBILE_OS_VERSION !== undefined);
  let primary = handoff ? handedOffSimulator(env, sdk) : select();
  // Resolve only reports the deterministic pick before optional state restore.
  if (mode === "resolve") {
    if (primary) {
      log(`Selected ${primary.name}, iOS ${primary.version}, ${primary.udid}`);
      if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `udid=${primary.udid}\nversion=${primary.version}\n`);
    } else {
      log(`No available iPhone simulator runtime compatible with iOS SDK ${sdk}.`);
    }
    return;
  }
  if (!primary) {
    downloadPlatform();
    primary = select();
  }
  if (!primary) throw new Error(`No available iPhone simulator runtime compatible with iOS SDK ${sdk}.`);
  if (mode === "heal") {
    // The xcode-27-arm64 20261112.0361.1 runner image lets simdiskimaged
    // unmount the iOS runtime while a device boots; a straddling boot still
    // passes bootstatus, then powers off about a minute later when the
    // cleanup lands (actions/runner-images#15334). The Appium session then
    // spends its fixed 300-second deadline re-booting the dead device before
    // installing anything. Verify the handed-off device is still usable at
    // session entry and boot it again through the driver's own native bridge
    // — the same path Appium recovers with — so the session never inherits a
    // destroyed device.
    const { getSimulator } = await loadDriver();
    const simulator = await getSimulator(primary.udid);
    const stat = async () => (await simulator.stat()).state;
    let state = await stat();
    if (state === "Booted") return;
    if (state === "Shutting Down") {
      // The runner's cleanup is mid-flight: the native waitForBoot rejects
      // 'Shutting Down', so give the power-off the same bounded window a boot
      // gets, then boot the device once it is actually down.
      log(`Simulator ${primary.udid} is shutting down after the reported boot; waiting for the power-off.`);
      const deadline = now() + 300000;
      while (state === "Shutting Down") {
        if (now() > deadline) {
          throw new Error(`Simulator ${primary.udid} stayed 'Shutting Down' past the boot deadline.`);
        }
        await sleep(5000);
        state = await stat();
      }
    }
    if (state === "Shutdown") {
      log(`Simulator ${primary.udid} was powered off after the reported boot; booting it again.`);
      await simulator.boot();
    } else {
      log(`Simulator ${primary.udid} is still ${state ?? "unlisted"} after the reported boot; waiting for it.`);
    }
    await simulator.waitForBoot(300000);
    return;
  }
  // Every shard has its own runner and boots exactly one simulator.
  const kick = (device) => {
    if (device.state !== "Shutdown") return;
    run("simctl", "boot", device.udid);
    device.state = "Booting";
  };
  if (mode !== "wait") {
    log(`Booting ${primary.name}, iOS ${primary.version}, ${primary.udid}`);
    kick(primary);
  }
  if (mode === "start") {
    // Publish only after boot initiation succeeds. The wait step consumes these
    // outputs verbatim, and exports the runtime env only after readiness.
    if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `udid=${primary.udid}\nversion=${primary.version}\n`);
    return;
  }
  kick(primary);
  const { getSimulator } = await loadDriver();
  const warmup = async () => {
    if (!env.DEVELOPER_DIR) return getSimulator(primary.udid);
    // The workflow already selected this Xcode. The pinned native wrapper's
    // default discovery shells out to xcode-select even with DEVELOPER_DIR.
    const { NativeSimctl } = await loadNativeDriver();
    const devices = await new NativeSimctl({ developerDir: env.DEVELOPER_DIR }).getDevices();
    const owned = devices.find((device) => device.udid.toLowerCase() === primary.udid.toLowerCase());
    if (!owned) throw new Error(`No native simulator found with owned UDID '${primary.udid}'.`);
    const runtime = nativeIosVersion(owned.runtimeIdentifier);
    if (!runtime || compareVersions(runtime, primary.version) !== 0) {
      throw new Error(`Native simulator '${primary.udid}' does not match expected iOS runtime ${primary.version}.`);
    }
    // Keep Appium's Xcode compatibility check while reusing the exact native
    // identity just verified, rather than enumerating it a second time.
    return getSimulator(primary.udid, { checkExistence: false });
  };
  // Monitor without -b: it never re-issues a boot, and still waits out a Booted
  // device whose startup is in progress. Warm the locked driver's native bridge
  // for this exact UDID before allowing the test session to start.
  await Promise.all([
    execute("xcrun", ["simctl", "bootstatus", primary.udid], { encoding: "utf8", timeout: 300000 })
      .then(({ stdout }) => process.stdout.write(stdout)),
    warmup(),
  ]);
  log("Appium CoreSimulator lookup is ready.");
  const envLines = `MOBILE_UDID=${primary.udid}\nMOBILE_OS_VERSION=${primary.version}\n`;
  if (env.GITHUB_ENV) appendFileSync(env.GITHUB_ENV, envLines);
  log(envLines.trimEnd());
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await bootIos({ mode: process.argv[2] ?? "boot" });
}
