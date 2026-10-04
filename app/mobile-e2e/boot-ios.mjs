import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { selectSimulator } from "./simulator.mjs";

const run = (...args) => execFileSync("xcrun", args, { encoding: "utf8", timeout: 300000 });
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
process.stdout.write(run("simctl", "bootstatus", device.udid, "-b"));
if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, `MOBILE_UDID=${device.udid}\nMOBILE_OS_VERSION=${device.version}\n`);
console.log(`MOBILE_UDID=${device.udid}`);
console.log(`MOBILE_OS_VERSION=${device.version}`);
