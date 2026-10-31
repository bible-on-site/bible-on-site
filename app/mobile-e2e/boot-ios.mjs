import { execFile, execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { compareVersions, loadIosSimulatorDriver, selectSimulator } from "./simulator.mjs";

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

export async function bootIos({
  mode = "boot",
  env = process.env,
  run = (...args) => execFileSync("xcrun", args, { encoding: "utf8", timeout: 300000 }),
  downloadPlatform = () => execFileSync("xcodebuild", ["-downloadPlatform", "iOS"], { stdio: "inherit", timeout: 900000 }),
  execute = promisify(execFile),
  loadDriver = loadIosSimulatorDriver,
  log = console.log,
} = {}) {
  if (!["start", "wait", "boot", "resolve"].includes(mode)) throw new Error(`Unknown ios:boot mode '${mode}'.`);
  const sdk = run("--sdk", "iphonesimulator", "--show-sdk-version").trim();
  const listDevices = () => JSON.parse(run("simctl", "list", "devices", "available", "--json")).devices;
  const select = () => selectSimulator(listDevices(), sdk);
  // The start step already selected and started this exact device. Re-listing
  // every simulator while it boots adds a blocking CoreSimulator round trip.
  // Standalone wait still selects normally; a partial handoff must never pick
  // another device or download a runtime instead.
  const handoff = mode === "wait" && (env.MOBILE_UDID !== undefined || env.MOBILE_OS_VERSION !== undefined);
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
  // Monitor without -b: it never re-issues a boot, and still waits out a Booted
  // device whose startup is in progress. Warm the locked driver's native bridge
  // for this exact UDID before allowing the test session to start.
  await Promise.all([
    execute("xcrun", ["simctl", "bootstatus", primary.udid], { encoding: "utf8", timeout: 300000 })
      .then(({ stdout }) => process.stdout.write(stdout)),
    getSimulator(primary.udid),
  ]);
  log("Appium CoreSimulator lookup is ready.");
  const envLines = `MOBILE_UDID=${primary.udid}\nMOBILE_OS_VERSION=${primary.version}\n`;
  if (env.GITHUB_ENV) appendFileSync(env.GITHUB_ENV, envLines);
  log(envLines.trimEnd());
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await bootIos({ mode: process.argv[2] ?? "boot" });
}
