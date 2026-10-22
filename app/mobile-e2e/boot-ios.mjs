import { execFile, execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { promisify } from "node:util";
import { loadIosSimulatorDriver, selectSimulator } from "./simulator.mjs";

const mode = process.argv[2] ?? "boot";
if (!["start", "wait", "boot", "resolve"].includes(mode)) throw new Error(`Unknown ios:boot mode '${mode}'.`);
const run = (...args) => execFileSync("xcrun", args, { encoding: "utf8", timeout: 300000 });
const sdk = run("--sdk", "iphonesimulator", "--show-sdk-version").trim();
const listDevices = () => JSON.parse(run("simctl", "list", "devices", "available", "--json")).devices;
const select = () => selectSimulator(listDevices(), sdk);
let primary = select();
// "resolve" only reports the deterministic pick so the workflow can restore
// that primary's saved state before boot. It never downloads a runtime: a
// missing one stays the boot path's job, which re-selects afterwards.
if (mode === "resolve") {
  if (primary) {
    console.log(`Selected ${primary.name}, iOS ${primary.version}, ${primary.udid}`);
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `udid=${primary.udid}\nversion=${primary.version}\n`);
  } else {
    console.log(`No available iPhone simulator runtime compatible with iOS SDK ${sdk}.`);
  }
  process.exit(0);
}
if (!primary) {
  execFileSync("xcodebuild", ["-downloadPlatform", "iOS"], { stdio: "inherit", timeout: 900000 });
  primary = select();
}
if (!primary) throw new Error(`No available iPhone simulator runtime compatible with iOS SDK ${sdk}.`);
// Every shard is its own matrix job on its own runner (#2263) — each boots
// exactly one simulator.
const devices = [primary];
// "start" only kicks the asynchronous boot so it overlaps the app build; "wait"
// gates the tests on a finished boot; the default "boot" runs both halves.
// simctl boot returns once the boot is initiated; a second kick on a live
// device errors, so only a shutdown one gets it.
const kick = (device) => {
  if (device.state !== "Shutdown") return;
  run("simctl", "boot", device.udid);
  device.state = "Booting";
};
if (mode !== "wait") {
  for (const device of devices) {
    console.log(`Booting ${device.name}, iOS ${device.version}, ${device.udid}`);
    kick(device);
  }
}
if (mode !== "start") {
  for (const device of devices) kick(device);
  const { getSimulator } = await loadIosSimulatorDriver();
  // Monitor without -b: it never re-issues a boot, so a live device cannot
  // stall it for minutes behind a "boot an already-booted device" conflict,
  // and it still waits out a Booted device whose startup is in progress.
  // Warm the locked driver's native CoreSimulator bridge before starting a test
  // session. Its first lookup can build the bridge and hide the original error
  // behind an "unknown UDID" message; a preflight keeps that failure actionable.
  await Promise.all(devices.flatMap((device) => [
    promisify(execFile)("xcrun", ["simctl", "bootstatus", device.udid], { encoding: "utf8", timeout: 300000 })
      .then(({ stdout }) => process.stdout.write(stdout)),
    getSimulator(device.udid),
  ]));
  console.log("Appium CoreSimulator lookup is ready.");
  const envLines = `MOBILE_UDID=${devices[0].udid}`;
  if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, `${envLines}\nMOBILE_OS_VERSION=${devices[0].version}\n`);
  console.log(envLines);
  console.log(`MOBILE_OS_VERSION=${devices[0].version}`);
}
