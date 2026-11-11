import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { copyIosCrashReports } from "./ios-crash-reports.mjs";

test("retains app, automation and simulator failures for this run without copying old or unrelated reports", () => {
  const root = mkdtempSync(join(tmpdir(), "ios-crash-reports-"));
  const host = join(root, "host"), device = join(root, "device"), artifacts = join(root, "artifacts");
  for (const directory of [host, device, artifacts]) mkdirSync(directory);
  const started = Date.now() - 10000;
  const hostReports = ["BibleOnSite-2026.ips", "WebDriverAgentRunner-2026.ips",
    "CoreSimulatorService_2026.ips", "Simulator-2026.ips", "simulatord-2026.ips",
    "SpringBoard-2026.ips", "backboardd-2026.ips", "testmanagerd-2026.ips",
    "runningboardd-2026.ips", "launchd_sim-2026.ips", "JetsamEvent-2026.ips"];
  try {
    for (const report of [...hostReports, "OtherApp-2026.ips", "BibleOnSiteOther-2026.ips", "BibleOnSite-old.ips"]) {
      writeFileSync(join(host, report), report);
    }
    utimesSync(join(host, "BibleOnSite-old.ips"), new Date(0), new Date(0));
    mkdirSync(join(host, "BibleOnSite-directory.ips"));
    writeFileSync(join(device, "BibleOnSite-2026.ips"), "device report");
    copyIosCrashReports([host, join(root, "missing"), device], artifacts, started);
    assert.deepEqual(readdirSync(artifacts).sort(), [
      ...hostReports.map(report => `crash-0-${report}`), "crash-2-BibleOnSite-2026.ips",
    ].sort());
    assert.equal(readFileSync(join(artifacts, "crash-2-BibleOnSite-2026.ips"), "utf8"), "device report");
    assert.equal(readFileSync(join(artifacts, "crash-0-BibleOnSite-2026.ips"), "utf8"), "BibleOnSite-2026.ips");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
