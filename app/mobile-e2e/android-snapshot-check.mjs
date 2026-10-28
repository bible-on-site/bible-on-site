// AVD snapshot integrity for app-mobile-e2e.yml's cached-AVD flow.
//
// `validate-restored` runs after a snapshot cache hit: the emulator tolerates
// an incompatible snapshot by cold-booting, but a structurally broken AVD
// (missing ini/config or snapshot payload) is cheaper to delete and rebuild
// than to feed to the emulator. The next stage then cold-boots a fresh device.
// Host-specific lock files are removed only while no emulator is running.
//
// `confirm-saved` runs after the clean-snapshot stage: the action's `emu kill`
// is graceful but asynchronous, so this waits for the process to exit, retries
// the kill, and finally confirms the snapshot payload reached the AVD
// directory before any cache save is allowed to capture it.
import { execFile } from "node:child_process";
import { appendFileSync, existsSync, lstatSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
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

export function emulatorProcesses(processList, avdName, udid, knownPids = new Set()) {
	return processList
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.filter((line) => {
			const match = /^(\d+)\s+(\S+)(?:\s+(.*))?$/.exec(line);
			if (!match) throw new Error(`Unreadable process record: ${line}`);
			const executable = basename(match[2]);
			if (executable !== "emulator" && !executable.startsWith("qemu-system-") && !knownPids.has(match[1])) return false;
			if (!avdName) return true;
			const args = (match[3] ?? "").split(/\s+/);
			const sameAvd = args.includes(`@${avdName}`) ||
				(args.includes("-avd") && args[args.indexOf("-avd") + 1] === avdName);
			if (!sameAvd || !udid) return sameAvd;
			if (args.filter((arg) => ["-port", "-ports"].includes(arg)).length > 1) return false;
			const port = args.includes("-port") ? args[args.indexOf("-port") + 1] :
				args.includes("-ports") ? args[args.indexOf("-ports") + 1]?.split(",")[0] : "5554";
			return `emulator-${port}` === udid;
		});
}


function processPid(line) {
	return line.split(/\s+/)[0];
}

/** Linux identity survives argv teardown; start time fences PID reuse. */
export function linuxProcessIdentity(pid, { read = readFileSync, stat = statSync } = {}) {
	if (!/^[1-9]\d*$/.test(pid) || !Number.isSafeInteger(Number(pid)) || Number(pid) <= 1)
		throw new Error("Invalid emulator process identity.");
	const state = () => {
		const text = read("/proc/" + pid + "/stat", "utf8");
		const end = text.lastIndexOf(")");
		const fields = text.slice(end + 2).trim().split(/\s+/);
		if (!text.startsWith(pid + " (") || end < 0 ||
			!/^[A-Za-z]$/.test(fields[0] ?? "") || !/^\d+$/.test(fields[19] ?? ""))
			throw new Error("Unreadable emulator process identity.");
		return { pid, state: fields[0], startTime: fields[19] };
	};
	const absent = (error) => {
		if (error.code !== "ENOENT") throw error;
		// Missing /proc itself is an inspection failure, not proof of exit.
		read("/proc/self/stat", "utf8");
		return { pid, exited: true };
	};
	let before;
	try { before = state(); } catch (error) { return absent(error); }
	if (["Z", "X", "x"].includes(before.state)) return { ...before, exited: true };
	let executable;
	try { executable = stat("/proc/" + pid + "/exe", { bigint: true }); }
	catch (error) {
		if (error.code !== "ENOENT") throw error;
		let after;
		try { after = state(); } catch (missing) { return absent(missing); }
		if (["Z", "X", "x"].includes(after.state)) return { ...after, exited: true };
		throw new Error("Cannot inspect the live emulator executable.", { cause: error });
	}
	let command;
	try { command = read("/proc/" + pid + "/cmdline", "utf8").split("\0").filter(Boolean).join(" "); }
	catch (error) { return absent(error); }
	let after;
	try { after = state(); } catch (error) { return absent(error); }
	if (before.startTime !== after.startTime) throw new Error("Emulator PID changed during inspection.");
	if (["Z", "X", "x"].includes(after.state)) return { ...after, exited: true };
	return { ...after, device: executable.dev.toString(), inode: executable.ino.toString(), command };
}

export async function captureEmulatorOwners({
	avdName, udid, execute = promisify(execFile), inspectProcess = linuxProcessIdentity,
}) {
	if (!/^[A-Za-z0-9_-]+$/.test(avdName) || !/^emulator-\d+$/.test(udid))
		throw new Error("Require an explicit AVD and emulator serial.");
	const running = await runningEmulators(execute);
	const owned = emulatorProcesses(running.join("\n"), avdName, udid);
	if (!owned.length || owned.length !== running.length)
		throw new Error("Cannot record unverified emulator ownership.");
	const owners = owned.map((line) => {
		const identity = inspectProcess(processPid(line));
		if (identity.exited) throw new Error("Emulator exited before owner handoff.");
		const command = identity.pid + " " + identity.command;
		if (emulatorProcesses(command, avdName, udid).length !== 1)
			throw new Error("Cannot record current emulator ownership.");
		return { ...identity, command };
	});
	return { schema: 1, avdName, udid, capturedAt: new Date().toISOString(), owners };
}

export function readEmulatorOwners(path, avdName, udid) {
	let receipt;
	try { receipt = JSON.parse(readFileSync(path, "utf8")); }
	catch (error) { if (error.code === "ENOENT") return []; throw error; }
	if (!receipt || receipt.schema !== 1 || receipt.avdName !== avdName || receipt.udid !== udid ||
		!Array.isArray(receipt.owners) || !receipt.owners.length ||
		receipt.owners.some((owner) => !owner || typeof owner.pid !== "string" ||
			!/^[1-9]\d*$/.test(owner.pid) || !Number.isSafeInteger(Number(owner.pid)) ||
			Number(owner.pid) <= 1 || ["startTime", "device", "inode"].some((key) =>
				typeof owner[key] !== "string" || !/^\d+$/.test(owner[key]))) ||
		new Set(receipt.owners.map((owner) => owner.pid)).size !== receipt.owners.length)
		throw new Error("Invalid or mismatched emulator owner receipt.");
	return receipt.owners;
}

function receiptTargetMatches(line, avdName, udid) {
	const args = line.split(/\s+/).slice(2);
	const avds = args.filter((arg) => arg.startsWith("@"));
	if (avds.some((arg) => arg !== "@" + avdName)) return false;
	const avdFlags = args.flatMap((arg, index) => arg === "-avd" ? [index] : []);
	if (avdFlags.length > 1 || avdFlags.some((index) => args[index + 1] !== avdName)) return false;
	const ports = args.flatMap((arg, index) => ["-port", "-ports"].includes(arg) ? [index] : []);
	return ports.length <= 1 && ports.every((index) =>
		"emulator-" + args[index + 1]?.split(",")[0] === udid);
}

function avdPaths(avdHome, avdName) {
	if (!/^[A-Za-z0-9_-]+$/.test(avdName)) throw new Error("Invalid AVD name.");
	let home = resolve(avdHome);
	try {
		const info = lstatSync(home);
		if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`Refuse linked or invalid AVD home: ${home}`);
		// Anchor operations to the canonical configured home (including platform
		// aliases such as macOS /var), never to an unresolved child path.
		home = realpathSync(home);
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
	}
	const avdDir = resolve(home, `${avdName}.avd`);
	const ini = resolve(home, `${avdName}.ini`);
	if (dirname(avdDir) !== home || dirname(ini) !== home) throw new Error("AVD paths escape the AVD home.");
	for (const path of [avdDir, ini]) {
		try {
			if (lstatSync(path).isSymbolicLink()) throw new Error(`Refuse linked AVD path: ${path}`);
		} catch (error) {
			if (error.code !== "ENOENT") throw error;
		}
	}
	return { home, avdDir, ini };
}

async function runningEmulators(execute, knownPids = []) {
	const { stdout } = await execute("ps", ["-ww", "-eo", "pid=,args="], { timeout: 10000 });
	if (!stdout.trim()) throw new Error("Empty process table; emulator ownership is unknown.");
	return emulatorProcesses(stdout, undefined, undefined, new Set(knownPids));
}

async function devicePresent(execute, adb, udid) {
	if (!/^emulator-\d+$/.test(udid)) throw new Error("Require an explicit emulator serial.");
	const { stdout } = await execute(adb, ["devices"], { timeout: 5000 });
	const [header, ...devices] = stdout.trim().split(/\r?\n/);
	if (header !== "List of devices attached") throw new Error("Unreadable adb device list.");
	const records = devices.map((line) => line.trim()).filter(Boolean);
	if (records.some((line) => !/^\S+\s+\S+/.test(line))) throw new Error("Unreadable adb device record.");
	return records.some((line) => line.split(/\s+/)[0] === udid);
}

// These PID-bearing files describe the old host, not the cached device. In
// particular, snapshot.lock is locked via snapshot.lock.lock. A restored PID
// can belong to an unrelated process on this runner and look alive to QEMU.
// Call only after successful process/adb checks prove the emulator is stopped.
function removeStoppedAvdLocks({ avdDir }, observe) {
	let entries;
	try { entries = readdirSync(avdDir); }
	catch (error) { if (error.code === "ENOENT") return []; throw error; }
	const locks = entries.filter((name) => name.endsWith(".lock"));
	for (const name of locks) {
		const path = resolve(avdDir, name);
		if (dirname(path) !== avdDir) throw new Error("Lock path escapes the AVD directory.");
		const info = lstatSync(path);
		if (info.isSymbolicLink()) throw new Error(`Refuse linked AVD lock: ${path}`);
		observe({ lock: name, type: info.isDirectory() ? "directory" : "file",
			mode: (info.mode & 0o777).toString(8), size: info.size,
			modified: info.mtime.toISOString(),
			pid: info.isFile() && info.size <= 64 ? readFileSync(path, "utf8").trim() : null });
	}
	for (const name of locks) rmSync(join(avdDir, name), { recursive: true, force: true });
	return locks;
}

export async function validateRestored({
	avdHome, avdName, adb, udid, execute = promisify(execFile), observe = () => {},
}) {
	const paths = avdPaths(avdHome, avdName);
	const running = await runningEmulators(execute);
	if (running.length || await devicePresent(execute, adb, udid)) {
		throw new Error("Refuse to change a cached AVD while an emulator is running.");
	}
	const missing = missingAvdEntries(paths.home, avdName);
	if (missing.length) {
		observe({ missing });
		rmSync(paths.avdDir, { recursive: true, force: true });
		rmSync(paths.ini, { force: true });
		return false;
	}
	removeStoppedAvdLocks(paths, observe);
	return true;
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
	owners = [],
	inspectProcess = linuxProcessIdentity,
}) {
	const paths = avdPaths(avdHome, avdName);
	if (!/^emulator-\d+$/.test(udid)) throw new Error("Require an explicit emulator serial.");
	const started = now();
	let killRetried = false;
	let pkillTried = false;
	while (now() - started < timeout) {
		let running;
		try {
			running = await runningEmulators(execute, owners.map((owner) => owner.pid));
		} catch (error) {
			observe({ note: "Cannot confirm emulator ownership", error: String(error) });
			throw new Error("Cannot prove the emulator stopped; refusing the next launch.", { cause: error });
		}
		if (!running.length) {
			try {
				if (await devicePresent(execute, adb, udid)) {
					observe({ running: "adb:present", elapsedMs: now() - started });
					await sleep(POLL_INTERVAL_MS);
					continue;
				}
			} catch (error) {
				observe({ note: "Cannot confirm device absence", error: String(error) });
				throw new Error("Cannot prove device absence; refusing the next launch.", { cause: error });
			}
		}
		if (!running.length) {
			const saved = !snapshotPayloadMissing(paths.home, avdName, list);
			if (saved) removeStoppedAvdLocks(paths, observe);
			observe({ running: 0, saved });
			return saved;
		}
		const owned = emulatorProcesses(running.join("\n"), avdName, udid);
		let exiting = false;
		for (const line of running) {
			const owner = owners.find((item) => item.pid === processPid(line));
			if (!owner) continue;
			observe({ process: line, recordedOwner: owner });
			const identity = inspectProcess(owner.pid);
			observe({ owner: identity, process: line });
			if (identity.startTime !== undefined && identity.startTime !== owner.startTime)
				throw new Error("Emulator PID was reused; refusing termination and the next launch.");
			if (identity.exited) { exiting = true; if (!owned.includes(line)) owned.push(line); continue; }
			if (identity.device !== owner.device || identity.inode !== owner.inode ||
				!receiptTargetMatches(line, avdName, udid) ||
				!receiptTargetMatches(identity.pid + " " + identity.command, avdName, udid))
				throw new Error("Emulator owner identity changed; refusing termination and the next launch.");
			if (!owned.includes(line)) owned.push(line);
		}
		if (owned.length !== running.length) {
			observe({ note: "Another emulator has active or unknown AVD ownership", processes: running, saved: false });
			throw new Error("Emulator AVD/port ownership is unknown; refusing termination and the next launch.");
		}
		if (exiting) {
			// A stale PS row is not absence: require the next PS + ADB proof.
			await sleep(POLL_INTERVAL_MS);
			continue;
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
			// Signal only the exact observed AVD/port owners. If they survive the
			// existing deadline, fail this step before another launch is attempted.
			const pids = owned.map((line) => line.split(/\s+/)[0]);
			if (pids.some((pid) => Number(pid) <= 1)) {
				throw new Error("Refuse unsafe emulator process identity and the next launch.");
			}
			try {
				await execute("kill", ["--", ...pids], { timeout: 15000 });
			} catch (error) {
				observe({ note: "emulator termination failed", error: String(error) });
			}
		}
		await sleep(POLL_INTERVAL_MS);
	}
	observe({ running: "timeout", saved: false });
	throw new Error("Emulator did not stop within the existing deadline; refusing the next launch.");
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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const command = process.argv[2];
	const env = process.env;
	const avdHome = env.ANDROID_AVD_HOME ?? join(env.HOME, ".android", "avd");
	const avdName = env.AVD_NAME ?? "mobile_e2e";
	const udid = env.MOBILE_UDID;
	const androidSdk = env.ANDROID_HOME ?? env.ANDROID_SDK_ROOT;
	const adb = androidSdk
		? join(androidSdk, "platform-tools", process.platform === "win32" ? "adb.exe" : "adb")
		: "adb";
	if (command === "validate-restored") {
		const usable = await validateRestored({ avdHome, avdName, adb, udid,
			observe: (observation) => console.log(JSON.stringify(observation)) });
		console.log(usable ? "Restored AVD snapshot is complete; host locks removed." :
			"::warning::Incomplete restored AVD removed; the snapshot stage will cold-boot a fresh device.");
		output("usable", String(usable));
	} else if (command === "confirm-saved") {
		if (!udid) throw new Error("Set MOBILE_UDID to the emulator identifier.");
		const artifacts = env.MOBILE_E2E_ARTIFACTS ?? resolve(dirname(fileURLToPath(import.meta.url)), "../.artifacts/mobile-e2e/android");
		mkdirSync(artifacts, { recursive: true });
		const evidence = join(artifacts, "snapshot-ownership.jsonl");
		writeFileSync(evidence, "");
		const owners = process.platform === "linux" ? readEmulatorOwners(join(artifacts, "avd-owners.json"), avdName, udid) : [];
		const saved = await confirmSaved({
			owners,
			adb,
			udid,
			avdHome,
			avdName,
			observe: (observation) => {
				appendFileSync(evidence, JSON.stringify(observation) + "\n");
				const summary = { ...observation };
				delete summary.processes;
				delete summary.process;
				delete summary.recordedOwner;
				console.log(JSON.stringify(summary));
			},
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
