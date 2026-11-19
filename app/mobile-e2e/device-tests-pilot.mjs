// Emulator wrapper for the XHarness device-test pilot (#3349), mirroring
// android-pilot.mjs: supervise() keeps the shared wall-clock deadline, and
// runAndroidPilot ends only this -no-snapshot-save QEMU tree afterwards so the
// action cannot retain the emulator's inherited output pipes.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runAndroidPilot, terminateAndroidTestEmulator } from "./android-pilot.mjs";
import { supervise } from "./supervise.mjs";

const directory = dirname(fileURLToPath(import.meta.url));
if (process.platform !== "linux") throw new Error("The disposable Android CI pilot requires Linux.");
const artifacts = process.env.MOBILE_E2E_ARTIFACTS ?? resolve(directory, "../.artifacts/device-tests");
mkdirSync(artifacts, { recursive: true });
const run = supervise(process.execPath, [resolve(directory, "device-tests.mjs")], { cwd: directory });
process.exitCode = await runAndroidPilot({
  run: () => run.result,
  cleanup: () => terminateAndroidTestEmulator({ avdName: process.env.AVD_NAME, udid: process.env.MOBILE_UDID }),
  record: result => {
    writeFileSync(resolve(artifacts, "android-emulator-cleanup.json"), `${JSON.stringify(result, null, 2)}\n`);
    console.log(`Android emulator cleanup: ${JSON.stringify(result)}`);
  },
});
