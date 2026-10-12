import { execFile, execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { promisify } from "node:util";
import { loadIosSimulatorDriver, planShardPeer, selectSimulator } from "./simulator.mjs";

const mode = process.argv[2] ?? "boot";
if (!["start", "wait", "boot"].includes(mode)) throw new Error(`Unknown ios:boot mode '${mode}'.`);
// MOBILE_E2E_SHARD_COUNT=2 boots a second same-model simulator next to the
// primary so the iOS suite can split across two devices (#2083).
const shardCount = process.env.MOBILE_E2E_SHARD_COUNT === "2" ? 2 : 1;
const run = (...args) => execFileSync("xcrun", args, { encoding: "utf8", timeout: 300000 });
const sdk = run("--sdk", "iphonesimulator", "--show-sdk-version").trim();
const listDevices = () => JSON.parse(run("simctl", "list", "devices", "available", "--json")).devices;
const select = () => selectSimulator(listDevices(), sdk);
let primary = select();
if (!primary) {
  execFileSync("xcodebuild", ["-downloadPlatform", "iOS"], { stdio: "inherit", timeout: 900000 });
  primary = select();
}
if (!primary) throw new Error(`No available iPhone simulator runtime compatible with iOS SDK ${sdk}.`);
const devices = [primary];
if (shardCount === 2) {
  const plan = planShardPeer(listDevices(), primary);
  // A retained peer matching only the reserved name — cloned under a different
  // model or an old runtime — would pair the shards with different device
  // profiles, so it is deleted before the same-model sibling is reused or
  // created in its place.
  for (const stale of plan.stale) {
    if (stale.state !== "Shutdown") run("simctl", "shutdown", stale.udid);
    run("simctl", "delete", stale.udid);
    console.log(`Deleted stale ${stale.name} (${stale.udid}) — not ${primary.deviceTypeIdentifier} on ${primary.runtime}.`);
  }
  if (plan.device) {
    devices.push(plan.device);
  } else {
    const { name, deviceTypeIdentifier, runtime } = plan.create;
    const udid = run("simctl", "create", name, deviceTypeIdentifier, runtime).trim();
    console.log(`Created ${name}, iOS ${primary.version}, ${udid}`);
    devices.push({ name, udid, state: "Shutdown", version: primary.version, runtime });
  }
}
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
  // The peer is cloned from the primary's runtime, so one OS version covers
  // every shard. Sharded runs export per-shard UDIDs instead of MOBILE_UDID.
  const envLines = shardCount === 2
    ? devices.map((device, index) => `MOBILE_UDID_SHARD_${index + 1}=${device.udid}`).join("\n")
    : `MOBILE_UDID=${devices[0].udid}`;
  if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, `${envLines}\nMOBILE_OS_VERSION=${devices[0].version}\n`);
  console.log(envLines);
  console.log(`MOBILE_OS_VERSION=${devices[0].version}`);
}
