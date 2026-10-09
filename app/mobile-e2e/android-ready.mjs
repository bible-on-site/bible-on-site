// Stage A of the cached-AVD flow in app-mobile-e2e.yml: prove a freshly created
// device is usable with the same readiness check the pilot applies, then ask
// the emulator to persist its quick-boot snapshot explicitly. `emu kill` in the
// action's teardown saves on exit too, but confirming the explicit save here
// keeps a slow shutdown from racing the cache step.
import { execFile } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { waitForAndroidDevice } from "./android-readiness.mjs";

const execute = promisify(execFile);
const udid = process.env.MOBILE_UDID;
if (!udid) throw new Error("Set MOBILE_UDID to the emulator identifier.");
const androidSdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
const adb = androidSdk
	? resolve(androidSdk, "platform-tools", process.platform === "win32" ? "adb.exe" : "adb")
	: "adb";
const artifacts =
	process.env.MOBILE_E2E_ARTIFACTS ??
	resolve(dirname(fileURLToPath(import.meta.url)), "../.artifacts/mobile-e2e/android");
mkdirSync(artifacts, { recursive: true });
const readinessLog = resolve(artifacts, "device-readiness.jsonl");
writeFileSync(readinessLog, "");
await waitForAndroidDevice({
	adb,
	udid,
	execute,
	observe: (observation) =>
		appendFileSync(readinessLog, `${JSON.stringify(observation)}\n`),
});
try {
	const result = await execute(
		adb,
		["-s", udid, "emu", "avd", "snapshot", "save", "default_boot"],
		{ timeout: 180000 },
	);
	console.log(`Quick-boot snapshot saved: ${result.stdout.trim() || "OK"}`);
} catch (error) {
	// Some emulator builds lack the console snapshot command; the action's
	// graceful kill still persists the boot snapshot, and the verify step
	// decides whether anything was actually written.
	console.log(
		`::warning::Explicit snapshot save failed; relying on save-on-exit. ${error}`,
	);
}
