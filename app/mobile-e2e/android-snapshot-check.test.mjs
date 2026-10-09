import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import {
	confirmSaved,
	emulatorProcesses,
	missingAvdEntries,
} from "./android-snapshot-check.mjs";

const SNAPSHOT_DIR = join("/avd", "mobile_e2e.avd", "snapshots", "default_boot");
const completeAvd = (avdHome, avdName) =>
	new Set([
		join(avdHome, `${avdName}.ini`),
		join(avdHome, `${avdName}.avd`, "config.ini"),
	]);

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
	].join("\n");
	assert.deepEqual(emulatorProcesses(list, "mobile_e2e"), [
		"1234 /sdk/emulator/emulator -port 5554 -avd mobile_e2e -no-window",
		"2345 /sdk/emulator/qemu-system-x86_64 -avd mobile_e2e",
	]);
});

test("confirmSaved returns true once the process exits and files exist", async () => {
	let polls = 0;
	const saved = await confirmSaved({
		adb: "/adb",
		udid: "emulator-5554",
		avdHome: "/avd",
		avdName: "mobile_e2e",
		execute: async (cmd, args) => {
			if (cmd === "/adb") throw new Error("device offline");
			assert.equal(cmd, "pgrep");
			polls += 1;
			if (polls < 2) return { stdout: "1 emulator -avd mobile_e2e" };
			const error = new Error("no match");
			error.code = 1;
			throw error;
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
			if (cmd === "/adb") throw new Error("device offline");
			const error = new Error("no match");
			error.code = 1;
			throw error;
		},
		sleep: async () => {},
	});
	assert.equal(saved, false);
});

test("confirmSaved bounds the wait for a stuck emulator", async () => {
	let now = 0;
	const calls = [];
	const saved = await confirmSaved({
		adb: "/adb",
		udid: "emulator-5554",
		avdHome: "/avd",
		avdName: "mobile_e2e",
		timeout: 150000,
		execute: async (cmd, args) => {
			calls.push([cmd, ...args].join(" "));
			if (cmd === "pgrep") return { stdout: "1 emulator -avd mobile_e2e" };
			return { stdout: "" };
		},
		sleep: async () => {},
		now: () => (now += 5000),
	});
	assert.equal(saved, false);
	assert.ok(calls.some((call) => call.startsWith("/adb -s emulator-5554 emu kill")));
	assert.ok(calls.some((call) => call.startsWith("pkill")));
});
