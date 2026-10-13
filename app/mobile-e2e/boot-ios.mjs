import { execFile, execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { promisify } from "node:util";
import { loadIosSimulatorDriver, selectSimulator } from "./simulator.mjs";

const mode = process.argv[2] ?? "boot";
if (!["start", "wait", "boot", "resolve"].includes(mode)) throw new Error(`Unknown ios:boot mode '${mode}'.`);
const run = (...args) => execFileSync("xcrun", args, { encoding: "utf8", timeout: 300000 });
const sdk = run("--sdk", "iphonesimulator", "--show-sdk-version").trim();
const select = () => selectSimulator(JSON.parse(run("simctl", "list", "devices", "available", "--json")).devices, sdk);
let device = select();
// "resolve" only reports the deterministic pick so the workflow can restore
// that device's saved state before boot. It never downloads a runtime: a
// missing one stays the boot path's job, which re-selects afterwards.
if (mode === "resolve") {
  if (device) {
    console.log(`Selected ${device.name}, iOS ${device.version}, ${device.udid}`);
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `udid=${device.udid}\nversion=${device.version}\n`);
  } else {
    console.log(`No available iPhone simulator runtime compatible with iOS SDK ${sdk}.`);
  }
  process.exit(0);
}
if (!device) {
  execFileSync("xcodebuild", ["-downloadPlatform", "iOS"], { stdio: "inherit", timeout: 900000 });
  device = select();
}
if (!device) throw new Error(`No available iPhone simulator runtime compatible with iOS SDK ${sdk}.`);
// "start" only kicks the asynchronous boot so it overlaps the app build; "wait"
// gates the tests on a finished boot; the default "boot" runs both halves.
// simctl boot returns once the boot is initiated; a second kick on a live
// device errors, so only a shutdown one gets it.
const kick = () => {
  if (device.state !== "Shutdown") return;
  run("simctl", "boot", device.udid);
  device = { ...device, state: "Booting" };
};
if (mode !== "wait") {
  console.log(`Booting ${device.name}, iOS ${device.version}, ${device.udid}`);
  kick();
}
if (mode !== "start") {
  kick();
  // Monitor without -b: it never re-issues a boot, so a live device cannot
  // stall it for minutes behind a "boot an already-booted device" conflict,
  // and it still waits out a Booted device whose startup is in progress.
  const ready = promisify(execFile)("xcrun", ["simctl", "bootstatus", device.udid], { encoding: "utf8", timeout: 300000 })
    .then(({ stdout }) => process.stdout.write(stdout));
  // Warm the locked driver's native CoreSimulator bridge before starting a test
  // session. Its first lookup can build the bridge and hide the original error
  // behind an "unknown UDID" message; a preflight keeps that failure actionable.
  const { getSimulator } = await loadIosSimulatorDriver();
  await Promise.all([ready, getSimulator(device.udid)]);
  console.log("Appium CoreSimulator lookup is ready.");
  if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, `MOBILE_UDID=${device.udid}\nMOBILE_OS_VERSION=${device.version}\n`);
  console.log(`MOBILE_UDID=${device.udid}`);
  console.log(`MOBILE_OS_VERSION=${device.version}`);
}
