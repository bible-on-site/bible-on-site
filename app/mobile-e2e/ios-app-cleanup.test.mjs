import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { prepareIosProcessInspector } from "./ios-process-inspector.mjs";
import { test } from "node:test";
import { ownedIosTestAppProcesses as parseOwned, terminateIosTestApp as terminateOwned } from "./ios-app-cleanup.mjs";

const devicesRoot = "/Users/runner with spaces/Library/Developer/CoreSimulator/Devices";
const ownedIosTestAppProcesses = (listing, udid) => parseOwned(listing, udid, devicesRoot);
const terminateIosTestApp = (udid, options = {}) => terminateOwned(udid, { devicesRoot, inspectorPath: "/owned/native-inspector", observedPids: [1234, 2345], ...options });

const udid = "CD85F334-D4C3-44B6-A7B8-EAABB9C6C1B4";
const otherUdid = "B8D3DB6B-98FB-4E92-9ACE-9BC307F7FDE7";
const appPath = device => `/Users/runner with spaces/Library/Developer/CoreSimulator/Devices/${device}/data/Containers/Bundle/Application/51DBBA3D-91A6-4E0F-BE84-D779BCE6C0F3/BibleOnSite.app/BibleOnSite`;
const listing = (pid = 1234, device = udid, state = "S") => ` ${pid} ${state} ${appPath(device)}\n`;

test("owns only the installed app executable on its explicit simulator", () => {
  const records = ownedIosTestAppProcesses(listing() + listing(2345, otherUdid) +
    `3456 S ${appPath(udid)}.other\n4567 S /bin/node ${appPath(udid)}\n` +
    `5678 S ${appPath(udid).replace("BibleOnSite.app/", "Other.app/")}\n`, udid);
  assert.deepEqual(records, [{ pid: 1234, state: "S", executable: appPath(udid) }]);
  for (const invalid of ["", "owned-simulator", `${udid}/../${otherUdid}`]) {
    assert.throws(() => ownedIosTestAppProcesses("", invalid), /explicit UDID/);
  }
  assert.throws(() => ownedIosTestAppProcesses("1 S " + appPath(udid), udid), /process identity/);
  assert.throws(() => ownedIosTestAppProcesses("1234 S BibleOnSite", udid), /ownership/);
  assert.throws(() => ownedIosTestAppProcesses(listing().replace("/51DBBA3D-", "/../51DBBA3D-"), udid), /executable path/);
});

test("terminates only owned PIDs and confirms their exit within the original total deadline", async () => {
  const calls = [], signals = [];
  let time = 0;
  const result = await terminateIosTestApp(udid, {
    execute: async (...args) => { calls.push(args); time += 15;
      return { stdout: calls.length === 1 ? listing() + listing(2345, otherUdid) : listing(2345, otherUdid) }; },
    signal: (...args) => signals.push(args), now: () => time,
  });
  assert.deepEqual(signals, [[1234, "SIGKILL"]]);
  assert.deepEqual(calls, [
    ["/owned/native-inspector", ["1234", "2345"], { timeout: 5000, windowsHide: true }],
    ["/owned/native-inspector", ["1234", "2345"], { timeout: 4985, windowsHide: true }],
  ]);
  assert.equal(result.status, "terminated");
  assert.deepEqual(result.pids, [1234]);
  assert.equal(result.elapsedMs, 30);
});

test("keep-app review leaves the app running and missing ownership fails before execution", async () => {
  const execute = async () => { throw new Error("must not execute"); };
  assert.equal((await terminateIosTestApp(udid, { keepApp: true, execute })).status, "kept");
  await assert.rejects(terminateIosTestApp("", { execute }), /explicit UDID/);
});

test("an absent or zombie app is already stopped and an exit race is accepted", async () => {
  for (const stdout of ["", listing(1234, udid, "Z+")]) {
    const result = await terminateIosTestApp(udid, { execute: async () => ({ stdout }),
      signal: () => { throw new Error("must not signal"); } });
    assert.equal(result.status, "already-stopped");
  }
  let calls = 0;
  assert.equal((await terminateIosTestApp(udid, {
    execute: async () => ({ stdout: ++calls === 1 ? listing() : "" }),
    signal: () => { throw Object.assign(new Error("exited"), { code: "ESRCH" }); },
  })).status, "terminated");
});

test("process-list and permission errors remain failures without retry", async () => {
  for (const error of [new Error("ps unavailable"), Object.assign(new Error("ps timed out"), { killed: true })]) {
    let calls = 0;
    await assert.rejects(terminateIosTestApp(udid, { execute: async () => { calls++; throw error; } }), e => e === error);
    assert.equal(calls, 1);
  }
  const denied = Object.assign(new Error("denied"), { code: "EPERM" });
  await assert.rejects(terminateIosTestApp(udid, { execute: async () => ({ stdout: listing() }),
    signal: () => { throw denied; } }), e => e === denied);
});

test("missing or invalid observed PIDs fail before inspecting the host", async () => {
  for (const observedPids of [[], [0], [1], ["1234"], [-1234], [1.5], null]) {
    await assert.rejects(terminateIosTestApp(udid, { observedPids,
      execute: async () => { throw new Error("must not execute"); },
    }), /PIDs observed/);
  }
});

test("native inspector failures cannot masquerade as an already stopped app", async () => {
  for (const error of [Object.assign(new Error("inspector exited 1"), { code: 1, stdout: "", stderr: "" }),
    Object.assign(new Error("inspection failed"), { code: 1, stdout: "", stderr: "permission denied" }),
    Object.assign(new Error("inspection failed"), { code: 1, stdout: "partial output", stderr: "" })]) {
    await assert.rejects(terminateIosTestApp(udid, { execute: async () => { throw error; } }), e => e === error);
  }
});

test("missing inspector and malformed native output fail before signaling", async () => {
  await assert.rejects(terminateIosTestApp(udid, { inspectorPath: undefined,
    execute: async () => { throw new Error("must not execute"); } }), /prepared native/);
  assert.throws(() => ownedIosTestAppProcesses("unidentified process", udid), /inspection output/);
});

test("process-inspection diagnostics cannot pass even with exit zero", async () => {
  await assert.rejects(terminateIosTestApp(udid, {
    execute: async () => ({ stdout: "", stderr: "Failure calling sysctl" }),
  }), /process inspection failed/);
});

test("a process listing that completes after the cleanup deadline cannot pass", async () => {
  let time = 0;
  await assert.rejects(terminateIosTestApp(udid, { now: () => time,
    execute: async () => { time = 5001; return { stdout: "" }; },
  }), /within five seconds/);
});

test("a surviving observed app fails at five seconds with no second termination", async () => {
  let time = 0, signals = 0, calls = 0;
  await assert.rejects(terminateIosTestApp(udid, {
    execute: async () => ({ stdout: listing(++calls === 1 ? 1234 : 2345) }),
    signal: () => { signals++; }, sleep: async ms => { time += ms; }, now: () => time,
  }), /within five seconds/);
  assert.equal(signals, 1);
  assert.equal(time, 5000);
});

test("Darwin kernel inspection kills the owned child and rejects other-device and argv spoofing", {
  skip: process.platform !== "darwin",
}, async () => {
  const temporary = realpathSync(mkdtempSync(join(tmpdir(), "ios-app-owner-")));
  const nativeDevicesRoot = join(temporary, "Devices");
  const inspectorPath = await prepareIosProcessInspector({ outputPath: join(temporary, "inspector") });
  const source = join(temporary, "child.c");
  const binary = join(temporary, "child");
  writeFileSync(source, "#include <unistd.h>\nint main(void) { for (;;) pause(); }\n");
  await promisify(execFile)("/usr/bin/xcrun", ["clang", "-Wall", "-Wextra", "-Werror", source, "-o", binary],
    { timeout: 5000, windowsHide: true });
  const paths = [udid, otherUdid].map(device => join(nativeDevicesRoot, device,
    "data/Containers/Bundle/Application/51DBBA3D-91A6-4E0F-BE84-D779BCE6C0F3/BibleOnSite.app/BibleOnSite"));
  for (const path of paths) { mkdirSync(dirname(path), { recursive: true }); copyFileSync(binary, path); }
  const children = paths.map(path => spawn(path, [], { stdio: "ignore" }));
  children.push(spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    argv0: paths[0], stdio: "ignore",
  }));
  try {
    await Promise.all(children.map(child => once(child, "spawn")));
    const ended = once(children[0], "exit");
    const result = await terminateIosTestApp(udid, { inspectorPath, devicesRoot: nativeDevicesRoot,
      observedPids: children.map(child => child.pid) });
    assert.equal(result.status, "terminated");
    assert.deepEqual(result.pids, [children[0].pid]);
    await ended;
    assert.equal(children[0].signalCode, "SIGKILL");
    for (const child of children.slice(1)) {
      assert.equal(child.exitCode, null);
      assert.equal(child.signalCode, null);
    }
    assert.ok(result.elapsedMs < 5000);
  } finally {
    for (const child of children) if (child.exitCode === null && child.signalCode === null) {
      const ended = once(child, "exit");
      child.kill("SIGKILL");
      await ended;
    }
    rmSync(temporary, { recursive: true, force: true });
  }
});
