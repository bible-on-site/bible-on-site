// AVD snapshot integrity for app-mobile-e2e.yml's cached-AVD flow.
//
// `validate-restored` runs after a snapshot cache hit: the emulator tolerates
// an incompatible snapshot by cold-booting, but a structurally broken AVD
// (missing ini/config or snapshot payload) is cheaper to delete and rebuild
// than to feed to the emulator. The next stage then cold-boots a fresh device.
//
// `confirm-saved` runs after the clean-snapshot stage: the action's `emu kill`
// is graceful but asynchronous, so this waits for the process to exit, retries
// the kill, and finally confirms the snapshot payload reached the AVD
// directory before any cache save is allowed to capture it.
import { execFile } from "node:child_process";
import { appendFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const CONFIRM_TIMEOUT_MS = 150000;
const KILL_RETRY_AFTER_MS = 60000;
const PKILL_AFTER_MS = 120000;
const POLL_INTERVAL_MS = 2000;

// A quick-boot snapshot exists when default_boot holds any payload; the exact
// file set varies with emulator version, so presence is checked, not names.
export function snapshotPayloadMissing(
	avdHome,
	avdName,
	list = readdirSync,
) {
	const dir = join(avdHome, `${avdName}.avd`, "snapshots", "default_boot");
	try {
		return list(dir).length === 0;
	} catch {
		return true;
	}
}

export function missingAvdEntries(
	avdHome,
	avdName,
	fileExists = existsSync,
	list = readdirSync,
) {
	const avdDir = join(avdHome, `${avdName}.avd`);
	const missing = [
		join(avdHome, `${avdName}.ini`),
		join(avdDir, "config.ini"),
	].filter((entry) => !fileExists(entry));
	if (snapshotPayloadMissing(avdHome, avdName, list)) {
		missing.push(join(avdDir, "snapshots", "default_boot"));
	}
	return missing;
}

export function emulatorProcesses(processList, avdName) {
	return processList
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.includes(avdName));
}

export async function confirmSaved({
	adb,
	udid,
	avdHome,
	avdName,
	timeout = CONFIRM_TIMEOUT_MS,
	execute = promisify(execFile),
	sleep = delay,
	now = Date.now,
	list = readdirSync,
	observe = () => {},
}) {
	const started = now();
	let killRetried = false;
	let pkillTried = false;
	while (now() - started < timeout) {
		let running = [];
		try {
			const { stdout } = await execute("pgrep", ["-af", avdName], {
				timeout: 10000,
			});
			running = emulatorProcesses(stdout, avdName);
		} catch (error) {
			// pgrep exits 1 on no match. Any other failure means the process list
			// could not be trusted, so confirm the device is gone via adb below.
			if (error.code !== 1) observe({ note: "pgrep failed", error: String(error) });
		}
		if (!running.length) {
			try {
				const state = (
					await execute(adb, ["-s", udid, "get-state"], { timeout: 5000 })
				).stdout.trim();
				if (state) {
					observe({ running: `adb:${state}`, elapsedMs: now() - started });
					await sleep(POLL_INTERVAL_MS);
					continue;
				}
			} catch {
				// adb cannot reach the device: the emulator is really gone.
			}
		}
		if (!running.length) {
			const saved = !snapshotPayloadMissing(avdHome, avdName, list);
			observe({ running: 0, saved });
			return saved;
		}
		observe({ running: running.length, elapsedMs: now() - started });
		const elapsed = now() - started;
		if (!killRetried && elapsed >= KILL_RETRY_AFTER_MS) {
			killRetried = true;
			try {
				await execute(adb, ["-s", udid, "emu", "kill"], { timeout: 15000 });
			} catch (error) {
				observe({ note: "emu kill retry failed", error: String(error) });
			}
		} else if (!pkillTried && elapsed >= PKILL_AFTER_MS) {
			pkillTried = true;
			// A leaked emulator would keep port 5554 and confuse the pilot stage;
			// losing this snapshot only means the cache save is skipped.
			try {
				await execute("pkill", ["-f", avdName], { timeout: 15000 });
			} catch (error) {
				observe({ note: "pkill failed", error: String(error) });
			}
		}
		await sleep(POLL_INTERVAL_MS);
	}
	observe({ running: "timeout", saved: false });
	return false;
}

function output(name, value) {
	appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

function listForDiagnostics(dir) {
	try {
		return readdirSync(dir, { recursive: true }).map(String);
	} catch {
		return [`unreadable: ${dir}`];
	}
}

if (resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const command = process.argv[2];
	const env = process.env;
	const avdHome = env.ANDROID_AVD_HOME ?? join(env.HOME, ".android", "avd");
	const avdName = env.AVD_NAME ?? "mobile_e2e";
	if (command === "validate-restored") {
		const missing = missingAvdEntries(avdHome, avdName);
		if (!missing.length) {
			console.log("Restored AVD snapshot is complete.");
			output("usable", "true");
		} else {
			console.log(
				`::warning::Restored AVD snapshot is incomplete (missing: ${missing.join(", ")}); ` +
					`removing it so the snapshot stage cold-boots a fresh device.`,
			);
			console.log(
				`::group::AVD directory contents\n${listForDiagnostics(join(avdHome, `${avdName}.avd`)).join("\n")}\n::endgroup::`,
			);
			rmSync(join(avdHome, `${avdName}.avd`), { recursive: true, force: true });
			rmSync(join(avdHome, `${avdName}.ini`), { force: true });
			output("usable", "false");
		}
	} else if (command === "confirm-saved") {
		const udid = env.MOBILE_UDID;
		if (!udid) throw new Error("Set MOBILE_UDID to the emulator identifier.");
		const androidSdk = env.ANDROID_HOME ?? env.ANDROID_SDK_ROOT;
		const adb = androidSdk
			? join(androidSdk, "platform-tools", process.platform === "win32" ? "adb.exe" : "adb")
			: "adb";
		const saved = await confirmSaved({
			adb,
			udid,
			avdHome,
			avdName,
			observe: (observation) =>
				console.log(JSON.stringify(observation)),
		});
		if (!saved) {
			console.log(
				`::warning::Quick-boot snapshot did not persist under ${join(avdHome, `${avdName}.avd`, "snapshots")}; ` +
					`tests still run, but the snapshot cache will not be saved this run.`,
			);
			console.log(
				`::group::AVD directory contents\n${listForDiagnostics(join(avdHome, `${avdName}.avd`)).join("\n")}\n::endgroup::`,
			);
		}
		output("saved", String(saved));
	} else {
		throw new Error(`Unknown command "${command}" (validate-restored|confirm-saved).`);
	}
}
