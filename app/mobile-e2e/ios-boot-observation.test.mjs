import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { snapshotIosBoot, startIosBootObservation } from "./ios-boot-observation.mjs";

const UDID = "a0000000-b111-c222-d333-e44444444444";
function fixture(t) {
  const home = mkdtempSync(join(tmpdir(), "ios-bootstrap-evidence-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const device = join(home, "Library", "Developer", "CoreSimulator", "Devices", UDID);
  const run = join(device, "data", "var", "run");
  mkdirSync(run, { recursive: true });
  const plist = Buffer.from("bplist00-controlled-shutdown-state");
  writeFileSync(join(device, "device.plist"), plist);
  const artifacts = join(home, "artifacts");
  const output = join(artifacts, "ios-boot-observation");
  return { home, device, run, plist, artifacts, output, options: { home, artifacts, udid: UDID, stage: "before-cache", env: {} } };
}

test("snapshots persist exact plist bytes and bounded lock metadata without changing device files", t => {
  const f = fixture(t);
  writeFileSync(join(f.run, "launchd.lock"), "private-lock-contents");
  const result = snapshotIosBoot({ ...f.options, env: { DEVELOPER_DIR: "/selected/Xcode", IOS_SIM_CACHE_HIT: "true" } });
  assert.equal(result.udid, UDID);
  assert.equal(result.cacheHit, "true");
  assert.equal(result.developerDir, "/selected/Xcode");
  assert.equal(result.plist.sha256, createHash("sha256").update(f.plist).digest("hex"));
  assert.deepEqual(readFileSync(join(f.output, "before-cache.device.plist")), f.plist);
  assert.deepEqual(readFileSync(join(f.device, "device.plist")), f.plist);
  assert.equal(readFileSync(join(f.run, "launchd.lock"), "utf8"), "private-lock-contents");
  assert.equal(result.files[0].path, "data/var/run/launchd.lock");
  assert(!JSON.stringify(result).includes("private-lock-contents"));
});

test("an absent pre-restore directory is captured without requiring a service call", t => {
  const f = fixture(t);
  rmSync(f.device, { recursive: true });
  const result = snapshotIosBoot(f.options);
  assert.equal(result.directoryError, "ENOENT");
  assert.equal(result.plist.error, "ENOENT");
  assert(existsSync(join(f.output, "before-cache.json")));
});

test("invalid identity and stages cannot select a filesystem source", t => {
  const f = fixture(t);
  assert.throws(() => snapshotIosBoot({ ...f.options, udid: "../other" }), /UUID/);
  assert.throws(() => snapshotIosBoot({ ...f.options, stage: "../other" }), /stage/);
  assert(!existsSync(f.artifacts));
});

test("linked device or data directories never expose another device's files", t => {
  const f = fixture(t);
  const other = join(f.home, "unrelated");
  mkdirSync(other);
  writeFileSync(join(other, "secret"), "unrelated-private-data");
  rmSync(join(f.device, "data"), { recursive: true });
  symlinkSync(other, join(f.device, "data"), "junction");
  const result = snapshotIosBoot(f.options);
  assert.equal(result.entries.data.type, "link");
  assert.deepEqual(result.files, []);
  rmSync(f.device, { recursive: true });
  symlinkSync(other, f.device, "junction");
  assert.throws(() => snapshotIosBoot(f.options), /outside the owned/);
  assert.equal(readFileSync(join(other, "secret"), "utf8"), "unrelated-private-data");
});

test("oversized plist bytes are not copied, and directory output is bounded", t => {
  const f = fixture(t);
  writeFileSync(join(f.device, "device.plist"), Buffer.alloc(1024 * 1024 + 1));
  for (let i = 0; i < 140; i++) writeFileSync(join(f.run, `lock-${String(i).padStart(3, "0")}`), "x");
  const result = snapshotIosBoot(f.options);
  assert.equal(result.plist.sha256, undefined);
  assert(!existsSync(join(f.output, "before-cache.device.plist")));
  assert.equal(result.runEntryCount, 140);
  assert.equal(result.files.length, 128);
  assert.equal(result.runEntriesTruncated, true);
});

test("a run directory linked outside this device is not traversed", t => {
  const f = fixture(t);
  const other = join(f.home, "unrelated");
  mkdirSync(other);
  writeFileSync(join(other, "must-not-copy"), "private");
  rmSync(f.run, { recursive: true });
  symlinkSync(other, f.run, "junction");
  const result = snapshotIosBoot(f.options);
  assert.match(result.runDirectoryError, /escapes/);
  assert.deepEqual(result.files, []);
});

test("observer only reads host evidence, joins every reader, and retains collection failures", async t => {
  const f = fixture(t);
  const commands = [], stopped = [], reports = [];
  const deviceLogs = join(f.home, "Library", "Logs", "CoreSimulator", UDID);
  mkdirSync(deviceLogs, { recursive: true });
  writeFileSync(join(deviceLogs, "system.log"), "x".repeat(70000) + "last-device-event");
  const observer = startIosBootObservation({ ...f.options, report: value => reports.push(value),
    stream(command, args) {
      commands.push([command, args]);
      return { async stop() { stopped.push("unified"); throw new Error("controlled reader failure"); } };
    },
    classic() { return { async stop() { stopped.push("classic"); } }; },
    async execute(command, args, options) {
      commands.push([command, args, options.timeout]);
      assert.equal(options.timeout, 1000);
      return { stdout: "12 1 S 00:20 /Library/CoreSimulatorService\n13 1 S 00:20 /usr/bin/unrelated\n" };
    },
  });
  observer.snapshot("wait-start");
  await observer.stop();
  assert.deepEqual(stopped.sort(), ["classic", "unified"]);
  assert.equal(commands[0][0], "/usr/bin/log");
  assert.equal(commands[1][0], "/bin/ps");
  assert(commands.every(([command]) => command !== "xcrun"));
  assert.match(readFileSync(join(f.output, "host-processes.log"), "utf8"), /CoreSimulatorService/);
  assert(!readFileSync(join(f.output, "host-processes.log"), "utf8").includes("unrelated"));
  const tail = readFileSync(join(f.output, "device.tail.log"), "utf8");
  assert.equal(Buffer.byteLength(tail), 65536);
  assert(tail.endsWith("last-device-event"));
  const collection = JSON.parse(readFileSync(join(f.output, "collection.json"), "utf8"));
  assert.match(collection.errors.join("\n"), /Native log streams failed/);
  assert.equal(collection.deviceLog.bytes, 65536);
  assert(reports.length > 0);
});

test("missing log tools remain diagnostic failures and a rejected process query is joined", async t => {
  const f = fixture(t);
  const observer = startIosBootObservation({ ...f.options, report: () => {},
    stream() { throw new Error("log command missing"); },
    classic() { throw new Error("classic log unreadable"); },
    async execute() { throw new Error("bounded ps failure"); },
  });
  observer.snapshot("wait-failed");
  await observer.stop();
  const collection = JSON.parse(readFileSync(join(f.output, "collection.json"), "utf8"));
  assert.equal(collection.errors.length, 3);
  assert.equal(collection.deviceLog.error, "ENOENT");
});
