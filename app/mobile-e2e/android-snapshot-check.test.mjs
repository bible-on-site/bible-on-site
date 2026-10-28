import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	captureEmulatorOwners,
	confirmSaved,
	linuxProcessIdentity,
	readEmulatorOwners,
	emulatorProcesses,
	missingAvdEntries,
	validateRestored,
} from "./android-snapshot-check.mjs";

const SNAPSHOT_DIR = join("/avd", "mobile_e2e.avd", "snapshots", "default_boot");
const completeAvd = (avdHome, avdName) =>
	new Set([
		join(avdHome, `${avdName}.ini`),
		join(avdHome, `${avdName}.avd`, "config.ini"),
	]);

test("module import from eval without a script argument does not run the CLI", () => {
	const script = new URL("./android-snapshot-check.mjs", import.meta.url).href;
	const result = spawnSync(process.execPath, ["--input-type=module", "--eval",
		`const module = await import(${JSON.stringify(script)}); console.log(typeof module.emulatorProcesses);`,
	], { encoding: "utf8" });
	assert.equal(result.status, 0, result.stderr);
	assert.equal(result.stdout.trim(), "function");
});

test("complete restored AVD passes validation", () => {
	const files = completeAvd("/avd", "mobile_e2e");
	assert.equal(
		missingAvdEntries(
			"/avd",
			"mobile_e2e",
			(path) => files.has(path),
			() => ["snapshot.pb", "ram.bin"],
		).length,
		0,
	);
});

test("empty snapshot payload fails validation", () => {
	const files = completeAvd("/avd", "mobile_e2e");
	const missing = missingAvdEntries(
		"/avd",
		"mobile_e2e",
		(path) => files.has(path),
		() => [],
	);
	assert.deepEqual(missing, [SNAPSHOT_DIR]);
});

test("emulatorProcesses finds only processes for this AVD", () => {
	const list = [
		"1234 /sdk/emulator/emulator -port 5554 -avd mobile_e2e -no-window",
		"2345 /sdk/emulator/qemu-system-x86_64 -avd mobile_e2e",
		"3456 /sdk/emulator/emulator -avd other_avd",
		"4567 /sdk/emulator/emulator -avd mobile_e2e_other",
		"5678 node android-snapshot-check.mjs mobile_e2e",
	].join("\n");
	assert.deepEqual(emulatorProcesses(list, "mobile_e2e"), [
		"1234 /sdk/emulator/emulator -port 5554 -avd mobile_e2e -no-window",
		"2345 /sdk/emulator/qemu-system-x86_64 -avd mobile_e2e",
	]);
});

test("emulator ownership requires matching explicit or default console port", () => {
	const list = [
		"42 emulator -avd mobile_e2e",
		"43 emulator -avd mobile_e2e -port 5554",
		"44 qemu-system-x86_64 -avd mobile_e2e -ports 5554,5555",
		"45 emulator -avd mobile_e2e -port 5556",
		"46 emulator -avd mobile_e2e -port 5554 -port 5556",
	].join("\n");
	assert.deepEqual(emulatorProcesses(list, "mobile_e2e", "emulator-5554").map((line) => line.split(" ")[0]), ["42", "43", "44"]);
});

test("confirmSaved returns true once the process exits and files exist", async () => {
	let polls = 0;
	const saved = await confirmSaved({
		adb: "/adb",
		udid: "emulator-5554",
		avdHome: "/avd",
		avdName: "mobile_e2e",
		execute: async (cmd, args) => {
			if (cmd === "/adb") return { stdout: "List of devices attached\n\n" };
			assert.equal(cmd, "ps");
			assert.deepEqual(args, ["-ww", "-eo", "pid=,args="]);
			polls += 1;
			if (polls < 2) return { stdout: "42 emulator -avd mobile_e2e" };
			return { stdout: "9 node android-snapshot-check.mjs" };
		},
		sleep: async () => {},
		now: (() => {
			let t = 0;
			return () => (t += 1000);
		})(),
		list: () => ["snapshot.pb", "ram.bin"],
	});
	assert.equal(saved, true);
	assert.equal(polls, 2);
});

test("confirmSaved reports false when the snapshot never lands", async () => {
	const saved = await confirmSaved({
		adb: "/adb",
		udid: "emulator-5554",
		avdHome: "/definitely/missing",
		avdName: "mobile_e2e",
		execute: async (cmd) => {
			return { stdout: cmd === "/adb" ? "List of devices attached\n\n" : "9 node snapshot-check.mjs" };
		},
		sleep: async () => {},
	});
	assert.equal(saved, false);
});

test("confirmSaved bounds the wait for a stuck emulator", async () => {
	let now = 0;
	const calls = [];
	await assert.rejects(confirmSaved({
		adb: "/adb",
		udid: "emulator-5554",
		avdHome: "/avd",
		avdName: "mobile_e2e",
		timeout: 150000,
		execute: async (cmd, args) => {
			calls.push([cmd, ...args].join(" "));
			if (cmd === "ps") return { stdout: "42 emulator -avd mobile_e2e" };
			return { stdout: "" };
		},
		sleep: async () => {},
		now: () => (now += 5000),
	}), /did not stop within the existing deadline/);
	assert.ok(calls.some((call) => call.startsWith("/adb -s emulator-5554 emu kill")));
	assert.ok(calls.includes("kill -- 42"));
});

const stopped = async (cmd) => ({ stdout: cmd === "/adb" ?
	"List of devices attached\n\n" : "9 node android-snapshot-check.mjs" });

function fixture(t) {
	const home = mkdtempSync(join(tmpdir(), "android-snapshot-check-"));
	t.after(() => rmSync(home, { recursive: true, force: true }));
	const avdDir = join(home, "mobile_e2e.avd");
	const snapshot = join(avdDir, "snapshots", "default_boot");
	mkdirSync(snapshot, { recursive: true });
	writeFileSync(join(home, "mobile_e2e.ini"), "path=mobile_e2e.avd\n");
	writeFileSync(join(avdDir, "config.ini"), "AvdId=mobile_e2e\n");
	writeFileSync(join(snapshot, "snapshot.pb"), "snapshot payload");
	return { home, avdDir, snapshot, options: { avdHome: home, avdName: "mobile_e2e",
		adb: "/adb", udid: "emulator-5554", execute: stopped } };
}

test("restored host locks are removed without changing payload or another AVD", async (t) => {
	const { home, avdDir, snapshot, options } = fixture(t);
	for (const name of ["snapshot.lock.lock", "hardware-qemu.ini.lock", "multiinstance.lock"]) {
		writeFileSync(join(avdDir, name), String(process.pid));
	}
	mkdirSync(join(avdDir, "userdata-qemu.img.lock"));
	writeFileSync(join(avdDir, "userdata-qemu.img.lock", "pid"), "123");
	const other = join(home, "other.avd");
	mkdirSync(other);
	writeFileSync(join(other, "snapshot.lock.lock"), "456");
	writeFileSync(join(snapshot, "payload.lock"), "part of payload");
	const observed = [];
	assert.equal(await validateRestored({ ...options, observe: (item) => observed.push(item) }), true);
	assert.equal(existsSync(join(avdDir, "snapshot.lock.lock")), false);
	assert.equal(existsSync(join(avdDir, "hardware-qemu.ini.lock")), false);
	assert.equal(existsSync(join(avdDir, "multiinstance.lock")), false);
	assert.equal(existsSync(join(avdDir, "userdata-qemu.img.lock")), false);
	assert.equal(readFileSync(join(other, "snapshot.lock.lock"), "utf8"), "456");
	assert.equal(readFileSync(join(snapshot, "snapshot.pb"), "utf8"), "snapshot payload");
	assert.equal(readFileSync(join(snapshot, "payload.lock"), "utf8"), "part of payload");
	assert.equal(observed.find((item) => item.lock === "snapshot.lock.lock").pid, String(process.pid));
	assert.ok(observed.every((item) => item.mode && item.modified));
});

test("pre-save confirmation removes stopped host locks before caching", async (t) => {
	const { avdDir, options } = fixture(t);
	writeFileSync(join(avdDir, "snapshot.lock.lock"), String(process.pid));
	assert.equal(await confirmSaved(options), true);
	assert.equal(existsSync(join(avdDir, "snapshot.lock.lock")), false);
});

test("incomplete stopped AVD is removed with its ini, leaving sibling AVD intact", async (t) => {
	const { home, avdDir, snapshot, options } = fixture(t);
	rmSync(snapshot, { recursive: true });
	const sibling = join(home, "other.ini");
	writeFileSync(sibling, "keep");
	assert.equal(await validateRestored(options), false);
	assert.equal(existsSync(avdDir), false);
	assert.equal(existsSync(join(home, "mobile_e2e.ini")), false);
	assert.equal(readFileSync(sibling, "utf8"), "keep");
});

for (const [label, execute] of [
	["active matching emulator", async () => ({ stdout: "42 emulator -avd mobile_e2e" })],
	["emulator with unknown AVD ownership", async () => ({ stdout: "42 qemu-system-x86_64 -no-window" })],
	["process inspection failure", async () => { throw new Error("ps unavailable"); }],
	["empty process table", async () => ({ stdout: "" })],
	["malformed process table", async () => ({ stdout: "invalid process record" })],
	["ADB inspection failure", async (cmd) => { if (cmd === "/adb") throw new Error("adb unavailable"); return stopped(cmd); }],
	["malformed ADB response", async (cmd) => cmd === "/adb" ? ({ stdout: "unexpected response" }) : stopped(cmd)],
	["malformed ADB device record", async (cmd) => cmd === "/adb" ? ({ stdout: "List of devices attached\ninvalid-record\n" }) : stopped(cmd)],
	["offline device still listed", async (cmd) => cmd === "/adb" ? ({ stdout: "List of devices attached\nemulator-5554\toffline\n" }) : stopped(cmd)],
]) {
	test(`restore refuses ${label} without deleting the AVD`, async (t) => {
		const { avdDir, options } = fixture(t);
		const lock = join(avdDir, "snapshot.lock.lock");
		writeFileSync(lock, "42");
		await assert.rejects(validateRestored({ ...options, execute }));
		assert.equal(readFileSync(lock, "utf8"), "42");
	});
}

for (const [label, execute] of [
	["process command failure", async () => { throw new Error("ps unavailable"); }],
	["ADB command failure", async (cmd) => { if (cmd === "/adb") throw new Error("adb unavailable"); return stopped(cmd); }],
	["another AVD", async () => ({ stdout: "42 emulator -avd mobile_e2e_other" })],
	["unknown emulator ownership", async () => ({ stdout: "42 qemu-system-x86_64 -no-window" })],
	["different emulator port", async () => ({ stdout: "42 emulator -avd mobile_e2e -port 5556" })],
	["ambiguous emulator port arguments", async () => ({ stdout: "42 emulator -avd mobile_e2e -port 5554 -ports 5556,5557" })],
]) {
	test(`pre-save refuses ${label} without removing locks or terminating anything`, async (t) => {
		const { avdDir, options } = fixture(t);
		const lock = join(avdDir, "snapshot.lock.lock");
		writeFileSync(lock, "42");
		const calls = [];
		await assert.rejects(confirmSaved({ ...options, execute: async (cmd, args) => {
			calls.push(cmd); return execute(cmd, args);
		} }));
		assert.equal(readFileSync(lock, "utf8"), "42");
		assert.ok(calls.every((cmd) => ["ps", "/adb"].includes(cmd)));
	});
}

test("invalid AVD names cannot escape the intended cache directory", async (t) => {
	const { options } = fixture(t);
	for (const avdName of ["../other", "..\\other", "", "foo/bar", "foo\\bar"]) {
		await assert.rejects(validateRestored({ ...options, avdName }), /Invalid AVD name/);
		await assert.rejects(confirmSaved({ ...options, avdName }), /Invalid AVD name/);
	}
});

test("linked AVD directories are rejected before recursive deletion", async (t) => {
	const { home, avdDir, options } = fixture(t);
	const other = join(home, "other.avd");
	mkdirSync(other);
	writeFileSync(join(other, "keep"), "keep");
	rmSync(avdDir, { recursive: true });
	symlinkSync(other, avdDir, process.platform === "win32" ? "junction" : "dir");
	await assert.rejects(validateRestored(options), /Refuse linked AVD path/);
	assert.equal(readFileSync(join(other, "keep"), "utf8"), "keep");
});

test("linked AVD homes are rejected before removing locks or incomplete devices", async (t) => {
	const { home, avdDir, options } = fixture(t);
	const link = `${home}-linked`;
	t.after(() => rmSync(link, { recursive: true, force: true }));
	writeFileSync(join(avdDir, "snapshot.lock.lock"), "42");
	symlinkSync(home, link, process.platform === "win32" ? "junction" : "dir");
	await assert.rejects(validateRestored({ ...options, avdHome: link }), /Refuse linked or invalid AVD home/);
	await assert.rejects(confirmSaved({ ...options, avdHome: link }), /Refuse linked or invalid AVD home/);
	assert.equal(readFileSync(join(avdDir, "snapshot.lock.lock"), "utf8"), "42");
});

test("linked lock directories are rejected without removing their targets", async (t) => {
	const { home, avdDir, options } = fixture(t);
	const other = join(home, "other");
	mkdirSync(other);
	writeFileSync(join(other, "keep"), "keep");
	symlinkSync(other, join(avdDir, "snapshot.lock.lock"), process.platform === "win32" ? "junction" : "dir");
	await assert.rejects(validateRestored(options), /Refuse linked AVD lock/);
	assert.equal(readFileSync(join(other, "keep"), "utf8"), "keep");
});

test("pre-save never signals PID 1 even when it appears to own the AVD", async (t) => {
	const { options } = fixture(t);
	let now = 0;
	const calls = [];
	await assert.rejects(confirmSaved({ ...options, now: () => (now += 5000), sleep: async () => {},
		execute: async (cmd) => { calls.push(cmd); return { stdout: "1 emulator -avd mobile_e2e" }; } }), /unsafe emulator process identity/);
	assert.ok(!calls.includes("kill"));
});

test("Linux restore CLI repairs cached locks with explicit workflow serial and refuses a missing serial", {
	skip: process.platform === "win32",
}, (t) => {
	const { home, avdDir } = fixture(t);
	const platformTools = join(home, "sdk", "platform-tools");
	mkdirSync(platformTools, { recursive: true });
	writeFileSync(join(platformTools, "adb"), '#!/bin/sh\nprintf "List of devices attached\\n\\n"\n', { mode: 0o755 });
	const lock = join(avdDir, "snapshot.lock.lock");
	const output = join(home, "github-output");
	const env = { ...process.env, ANDROID_AVD_HOME: home, ANDROID_HOME: join(home, "sdk"),
		MOBILE_E2E_ARTIFACTS: join(home, "artifacts"), AVD_NAME: "mobile_e2e", MOBILE_UDID: "emulator-5554", GITHUB_OUTPUT: output };
	const script = fileURLToPath(new URL("./android-snapshot-check.mjs", import.meta.url));
	writeFileSync(lock, String(process.pid));
	const complete = spawnSync(process.execPath, [script, "validate-restored"], { env, encoding: "utf8" });
	assert.equal(complete.status, 0, complete.stderr);
	assert.match(complete.stdout, /snapshot\.lock\.lock/);
	assert.match(readFileSync(output, "utf8"), /usable=true/);
	assert.equal(existsSync(lock), false);
	writeFileSync(lock, "42");
	delete env.MOBILE_UDID;
	const missing = spawnSync(process.execPath, [script, "validate-restored"], { env, encoding: "utf8" });
	assert.notEqual(missing.status, 0);
	assert.match(missing.stderr, /Require an explicit emulator serial/);
	assert.equal(readFileSync(lock, "utf8"), "42");
	env.MOBILE_UDID = "emulator-5554";
	writeFileSync(join(platformTools, "ps"), '#!/bin/sh\nprintf "42 qemu-system-x86_64 -no-window\\n"\n', { mode: 0o755 });
	env.PATH = `${platformTools}:${env.PATH}`;
	const unsafe = spawnSync(process.execPath, [script, "confirm-saved"], { env, encoding: "utf8" });
	assert.notEqual(unsafe.status, 0);
	assert.match(unsafe.stderr, /refusing termination and the next launch/);
	assert.doesNotMatch(readFileSync(output, "utf8"), /saved=true/);
	assert.equal(readFileSync(lock, "utf8"), "42");
});

const ownerIdentity = (pid = "42") => ({
	pid, state: "S", startTime: "100", device: "1", inode: "2",
	command: "qemu-system-x86_64 -avd mobile_e2e -port 5554",
});

test("ready handoff captures only verified AVD and port owners", async () => {
	const receipt = await captureEmulatorOwners({
		avdName: "mobile_e2e", udid: "emulator-5554",
		execute: async () => ({ stdout: "42 qemu-system-x86_64 -avd mobile_e2e -port 5554" }),
		inspectProcess: ownerIdentity,
	});
	assert.equal(receipt.schema, 1);
	assert.equal(receipt.owners[0].startTime, "100");
	assert.match(receipt.owners[0].command, /-avd mobile_e2e/);
	await assert.rejects(captureEmulatorOwners({
		avdName: "mobile_e2e", udid: "emulator-5554",
		execute: async () => ({ stdout: "42 qemu-system-x86_64 -avd mobile_e2e -port 5554" }),
		inspectProcess: () => ({ ...ownerIdentity(), command: "qemu-system-x86_64 -avd other" }),
	}), /current emulator ownership/);
	for (const stdout of ["9 node ready.mjs", "42 qemu-system-x86_64 -no-window",
		"42 qemu-system-x86_64 -avd other -port 5554"]) {
		await assert.rejects(captureEmulatorOwners({
			avdName: "mobile_e2e", udid: "emulator-5554",
			execute: async () => ({ stdout }), inspectProcess: ownerIdentity,
		}), /unverified emulator ownership/);
	}
	await assert.rejects(captureEmulatorOwners({
		avdName: "mobile_e2e", udid: "emulator-5554",
		execute: async () => ({ stdout: "42 emulator -avd mobile_e2e" }),
		inspectProcess: (pid) => ({ pid, exited: true }),
	}), /exited before owner handoff/);
});

test("owner receipt rejects malformed, foreign and duplicate identities", (t) => {
	const { home } = fixture(t);
	const path = join(home, "owners.json");
	assert.deepEqual(readEmulatorOwners(path, "mobile_e2e", "emulator-5554"), []);
	const receipt = { schema: 1, avdName: "mobile_e2e", udid: "emulator-5554", owners: [ownerIdentity()] };
	writeFileSync(path, JSON.stringify(receipt));
	assert.deepEqual(readEmulatorOwners(path, "mobile_e2e", "emulator-5554"), receipt.owners);
	for (const bad of [null, {}, { ...receipt, udid: "emulator-5556" },
		{ ...receipt, avdName: "other" }, { ...receipt, owners: [ownerIdentity(), ownerIdentity()] },
		{ ...receipt, owners: [{ ...ownerIdentity(), startTime: null }] }]) {
		writeFileSync(path, JSON.stringify(bad));
		assert.throws(() => readEmulatorOwners(path, "mobile_e2e", "emulator-5554"), /Invalid or mismatched/);
	}
	writeFileSync(path, "{");
	assert.throws(() => readEmulatorOwners(path, "mobile_e2e", "emulator-5554"), SyntaxError);
});

test("recorded argv teardown waits for PS and ADB absence before cleaning locks", async (t) => {
	const { avdDir, options } = fixture(t);
	const lock = join(avdDir, "snapshot.lock.lock");
	writeFileSync(lock, "42");
	let polls = 0, clock = 0, adbPolls = 0;
	const sleeps = [], observations = [], commands = [];
	assert.equal(await confirmSaved({
		...options, owners: [ownerIdentity()], inspectProcess: ownerIdentity,
		now: () => clock,
		sleep: async (duration) => { sleeps.push(duration); clock += duration; assert.equal(existsSync(lock), true); },
		observe: (value) => observations.push(value),
		execute: async (command) => {
			commands.push(command);
			if (command === "ps") return { stdout: ++polls === 1 ? "42 qemu-system-x86_64" : "9 node confirm.mjs" };
			assert.equal(command, "/adb");
			return { stdout: ++adbPolls === 1 ? "List of devices attached\nemulator-5554\toffline\n" : "List of devices attached\n\n" };
		},
	}), true);
	assert.deepEqual(sleeps, [2000, 2000]);
	assert.equal(polls, 3);
	assert.ok(observations.some((value) => value.running === "adb:present"));
	assert.equal(existsSync(lock), false);
	assert.ok(commands.every((command) => ["ps", "/adb"].includes(command)));
});

for (const [label, row, identity] of [
	["reused PID", "42 qemu-system-x86_64", { ...ownerIdentity(), startTime: "101" }],
	["reused PID with a different displayed executable", "42 node foreign.mjs", { ...ownerIdentity(), startTime: "101", command: "node foreign.mjs" }],
	["replaced executable", "42 qemu-system-x86_64", { ...ownerIdentity(), inode: "3" }],
	["different executable device", "42 qemu-system-x86_64", { ...ownerIdentity(), device: "3" }],
	["explicit other AVD", "42 qemu-system-x86_64 -avd other", ownerIdentity()],
	["explicit other port", "42 qemu-system-x86_64 -port 5556", ownerIdentity()],
	["ambiguous ports", "42 qemu-system-x86_64 -port 5554 -ports 5556,5557", ownerIdentity()],
	["foreign kernel argv despite stale PS", "42 qemu-system-x86_64", { ...ownerIdentity(), command: "qemu-system-x86_64 -avd other" }],
	["unrecorded owner", "43 qemu-system-x86_64", ownerIdentity()],
]) {
	test("receipt cannot authorize " + label, async (t) => {
		const { avdDir, options } = fixture(t);
		const lock = join(avdDir, "snapshot.lock.lock");
		writeFileSync(lock, "42");
		const calls = [];
		await assert.rejects(confirmSaved({
			...options, owners: [ownerIdentity()], inspectProcess: () => identity,
			execute: async (command) => { calls.push(command); return { stdout: row }; },
		}), /refusing termination and the next launch/);
		assert.equal(readFileSync(lock, "utf8"), "42");
		assert.deepEqual(calls, ["ps"]);
	});
}

test("an exited recorded PID never hides a different unknown live owner", async (t) => {
	const { options } = fixture(t);
	await assert.rejects(confirmSaved({
		...options, owners: [ownerIdentity()],
		inspectProcess: (pid) => ({ pid, startTime: "100", state: "Z", exited: true }),
		execute: async () => ({ stdout: "42 qemu-system-x86_64\n43 qemu-system-x86_64 -no-window" }),
		sleep: async () => { throw new Error("Must reject unknown live ownership before waiting."); },
	}), /ownership is unknown/);
});

test("an exited recorded PID still requires another PS scan and ADB absence", async (t) => {
	const { options } = fixture(t);
	let polls = 0, clock = 0;
	assert.equal(await confirmSaved({
		...options, owners: [ownerIdentity()],
		inspectProcess: (pid) => ({ pid, startTime: "100", state: "Z", exited: true }),
		execute: async (command) => command === "ps" ?
			({ stdout: ++polls === 1 ? "42 qemu-system-x86_64" : "9 node confirm.mjs" }) :
			({ stdout: "List of devices attached\n\n" }),
		now: () => clock, sleep: async (duration) => { clock += duration; },
	}), true);
	assert.equal(polls, 2);
	assert.equal(clock, 2000);
});

function procStat(state = "S", startTime = "100") {
	const fields = Array(20).fill("0");
	fields[0] = state;
	fields[19] = startTime;
	return "42 (qemu) with parentheses) " + fields.join(" ");
}

test("Linux identity reads stable kernel start time and executable device/inode", () => {
	const identity = linuxProcessIdentity("42", {
		read: (path) => path.endsWith("/cmdline") ? ["qemu-system-x86_64", "-avd", "mobile_e2e", "-port", "5554", ""].join("\0") : procStat(),
		stat: () => ({ dev: 1n, ino: 2n }),
	});
	assert.deepEqual(identity, ownerIdentity());
	assert.throws(() => linuxProcessIdentity("1"), /Invalid emulator process identity/);
	assert.throws(() => linuxProcessIdentity("42", { read: () => "bad stat" }), /Unreadable/);
	let reads = 0;
	assert.throws(() => linuxProcessIdentity("42", {
		read: () => procStat("S", ++reads === 1 ? "100" : "101"),
		stat: () => ({ dev: 1n, ino: 2n }),
	}), /PID changed during inspection/);
});

test("Linux inspection distinguishes exited processes from unavailable live executable metadata", () => {
	const missing = () => { throw Object.assign(new Error("missing"), { code: "ENOENT" }); };
	assert.deepEqual(linuxProcessIdentity("42", {
		read: (path) => path === "/proc/self/stat" ? "readable self" : missing(),
	}), { pid: "42", exited: true });
	assert.throws(() => linuxProcessIdentity("42", { read: missing }), /missing/);
	assert.throws(() => linuxProcessIdentity("42", {
		read: () => procStat(), stat: missing,
	}), /Cannot inspect the live emulator executable/);
	assert.equal(linuxProcessIdentity("42", { read: () => procStat("Z") }).exited, true);
});

test("recorded live PID stays guarded when its displayed argv0 disappears", async (t) => {
	const { avdDir, options } = fixture(t);
	const lock = join(avdDir, "snapshot.lock.lock");
	writeFileSync(lock, "42");
	let polls = 0, clock = 0;
	const sleeps = [];
	assert.equal(await confirmSaved({
		...options, owners: [ownerIdentity()],
		inspectProcess: () => ({ ...ownerIdentity(), command: "" }),
		execute: async (command) => command === "ps" ?
			({ stdout: ++polls === 1 ? "42 ?" : "9 node confirm.mjs" }) :
			({ stdout: "List of devices attached\n\n" }),
		now: () => clock,
		sleep: async (duration) => {
			assert.equal(existsSync(lock), true);
			sleeps.push(duration); clock += duration;
		},
	}), true);
	assert.deepEqual(sleeps, [2000]);
	assert.equal(polls, 2);
	assert.equal(existsSync(lock), false);
});

test("PID validation bounds long inputs and preserves canonical safe integer forms", () => {
	let inspected = 0;
	const read = () => { inspected += 1; throw new Error("valid PID reached inspection"); };
	for (const pid of ["2", "42", 42, "9007199254740991"]) {
		assert.throws(() => linuxProcessIdentity(pid, { read }), /valid PID reached inspection/);
	}
	assert.equal(inspected, 4);
	for (const pid of ["", "0", "1", "01", "-2", "42\n", "4x", "9007199254740992",
		"1" + "0".repeat(200000), "1" + " ".repeat(200000)]) {
		assert.throws(() => linuxProcessIdentity(pid, { read }), /Invalid emulator process identity/);
	}
	assert.equal(inspected, 4);
});
