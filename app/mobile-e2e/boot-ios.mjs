import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { loadIosSimulatorDriver, selectSimulator } from "./simulator.mjs";

// --early selects the device, exports its coordinates and kicks the boot so
// the ~5-minute CoreSimulator startup overlaps the workload install and app
// build; --ready blocks on bootstatus and warms the driver bridge. With no
// flag both run inline, which keeps `npm run ios:boot` whole for local runs.
const early = process.argv.includes("--early");
const ready = process.argv.includes("--ready");

const run = (...args) => execFileSync("xcrun", args, { encoding: "utf8", timeout: 300000 });
let udid;
if (!ready) {
  const sdk = run("--sdk", "iphonesimulator", "--show-sdk-version").trim();
  const select = () => selectSimulator(JSON.parse(run("simctl", "list", "devices", "available", "--json")).devices, sdk);
  let device = select();
  if (!device) {
    execFileSync("xcodebuild", ["-downloadPlatform", "iOS"], { stdio: "inherit", timeout: 900000 });
    device = select();
  }
  if (!device) throw new Error(`No available iPhone simulator runtime compatible with iOS SDK ${sdk}.`);
  console.log(`Booting ${device.name}, iOS ${device.version}, ${device.udid}`);
  if (device.state !== "Booted") run("simctl", "boot", device.udid);
  udid = device.udid;
  if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, `MOBILE_UDID=${device.udid}\nMOBILE_OS_VERSION=${device.version}\n`);
  console.log(`MOBILE_UDID=${device.udid}`);
  console.log(`MOBILE_OS_VERSION=${device.version}`);
}
if (!early) {
  udid ??= process.env.MOBILE_UDID;
  if (!udid) throw new Error("MOBILE_UDID is unset; run 'node boot-ios.mjs --early' first.");
  process.stdout.write(run("simctl", "bootstatus", udid, "-b"));
  // Warm the locked driver's native CoreSimulator bridge before starting a
  // test session. Its first lookup can build the bridge and hide the original
  // error behind an "unknown UDID" message; a preflight keeps that failure
  // actionable.
  const { getSimulator } = await loadIosSimulatorDriver();
  await getSimulator(udid);
  console.log("Appium CoreSimulator lookup is ready.");
}
