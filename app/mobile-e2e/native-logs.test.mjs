import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, rmdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { monitorNativeInteractions } from "./native-hang-monitor.mjs";
import { captureNativeFrame, exportNativeLog, startNativeLog } from "./native-logs.mjs";
import * as nativeLogs from "./native-logs.mjs";

function withArtifact(run) {
  const directory = mkdtempSync(join(tmpdir(), "mobile-native-log-test-"));
  const artifact = join(directory, "device.log");
  try {
    run(artifact);
  } finally {
    unlinkSync(artifact);
    rmdirSync(directory);
  }
}

test("exports native stdout larger than the previous 20 MB buffer without truncation", () => {
  withArtifact((artifact) => {
    const length = 24 * 1024 * 1024;
    exportNativeLog(process.execPath, ["-e", `process.stdout.write('x'.repeat(${length}))`], artifact);
    assert.equal(statSync(artifact).size, length);
  });
});

test("preserves a partial artifact and reports a native command failure", () => {
  withArtifact((artifact) => {
    assert.throws(() => exportNativeLog(process.execPath,
      ["-e", "process.stdout.write('partial log'); process.exit(7)"], artifact),
    (error) => error.status === 7);
    assert.equal(readFileSync(artifact, "utf8"), "partial log");
  });
});

async function withStreamArtifact(run) {
  const directory = mkdtempSync(join(tmpdir(), "mobile-native-stream-test-"));
  const artifact = join(directory, "device-live.log");
  try { await run(artifact); }
  finally { unlinkSync(artifact); rmdirSync(directory); }
}

async function waitForLog(artifact) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (readFileSync(artifact, "utf8").includes("live log")) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("The test log stream did not start");
}

test("preserves live output and stops the owned streaming process", async () => {
  await withStreamArtifact(async (artifact) => {
    const stream = startNativeLog(process.execPath,
      ["-e", "process.stdout.write('live log'); setInterval(() => {}, 1000)"], artifact);
    try { await waitForLog(artifact); }
    finally { await stream.stop(); }
    assert.equal(readFileSync(artifact, "utf8"), "live log");
  });
});

for (const code of [0, 7]) {
  test(`reports an unexpected streaming process exit ${code} while preserving its output`, async () => {
    await withStreamArtifact(async (artifact) => {
      const stream = startNativeLog(process.execPath,
        ["-e", `process.stdout.write('live log'); process.exit(${code})`], artifact);
      await stream.completion;
      await assert.rejects(stream.stop(), (err) => String(err.message).includes(`code ${code}`));
      assert.equal(readFileSync(artifact, "utf8"), "live log");
    });
  });
}

test("pending interaction captures only a bounded simulator frame without attaching to the app", async () => {
  const directory = mkdtempSync(join(tmpdir(), "mobile-native-frame-test-"));
  const artifact = join(directory, "native-interaction.png");
  const calls = [];
  try {
    const error = await captureNativeFrame("xcrun", ["simctl", "io", "device-1", "screenshot"], artifact,
      async (command, args, options) => {
        calls.push({ command, args, options });
        writeFileSync(artifact, "captured frame");
      });
    assert.equal(error, null);
    assert.equal(readFileSync(artifact, "utf8"), "captured frame");
    assert.deepEqual(calls, [{ command: "xcrun",
      args: ["simctl", "io", "device-1", "screenshot", artifact],
      options: { timeout: 5000, windowsHide: true } }]);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("a failed observation retains diagnostics without failing a successfully completed interaction", async () => {
  const directory = mkdtempSync(join(tmpdir(), "mobile-native-frame-test-"));
  const artifact = join(directory, "native-interaction.png");
  const error = Object.assign(new Error("simulator probe failed"), { code: 143, killed: true });
  let trigger;
  const monitor = monitorNativeInteractions(() => captureNativeFrame("xcrun",
    ["simctl", "io", "device-1", "screenshot"], artifact, async () => { throw error; }), {
      schedule(callback) { trigger = callback; }, cancel() {},
    });
  try {
    monitor.write("[HTTP] --> POST /session/id/elements {}\n");
    trigger();
    monitor.write("[HTTP] <-- POST /session/id/elements 200 35000 ms\n");
    await monitor.stop();
    assert.deepEqual(JSON.parse(readFileSync(`${artifact}-error.json`, "utf8")), {
      message: "simulator probe failed", code: 143, killed: true,
    });
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

for (const firstExit of [null, 7]) {
  test(`joins both original and automation streams when the first stream ${firstExit === null ? "is alive" : "failed"}`, async () => {
    const directory = mkdtempSync(join(tmpdir(), "mobile-automation-stream-test-"));
    const appFile = join(directory, "app.log"), automationFile = join(directory, "automation.log");
    const hostFile = join(directory, "host.log");
    const source = (label, exit) => `process.stdout.write('${label} live log'); ${exit === null
      ? "setInterval(() => {}, 1000)" : `process.exit(${exit})`}`;
    const app = startNativeLog(process.execPath, ["-e", source("app", firstExit)], appFile);
    const automation = startNativeLog(process.execPath, ["-e", source("automation", null)], automationFile);
    const host = startNativeLog(process.execPath, ["-e", source("host", null)], hostFile);
    let automationExited = false;
    let hostExited = false;
    let shutdownAttempted = false;
    void automation.completion.then(() => { automationExited = true; });
    void host.completion.then(() => { hostExited = true; });
    // The prior runner closes only its original stream. Keep that real behavior
    // as the red control until the joint stop operation exists.
    const stop = nativeLogs.stopNativeLogStreams ?? (async ([first]) => first.stop());
    try {
      await Promise.all([waitForLog(appFile), waitForLog(automationFile), waitForLog(hostFile)]);
      if (firstExit !== null) await app.completion;
      let failure;
      shutdownAttempted = true;
      try { await stop([app, automation, host]); } catch (error) { failure = error; }
      assert.equal(automationExited, true, "the owned automation process must exit before shutdown finishes");
      assert.equal(hostExited, true, "the host observer must exit even when a device stream failed");
      assert.equal(readFileSync(appFile, "utf8"), "app live log");
      assert.equal(readFileSync(automationFile, "utf8"), "automation live log");
      assert.equal(readFileSync(hostFile, "utf8"), "host live log");
      if (firstExit === null) assert.equal(failure, undefined);
      else {
        assert.ok(failure instanceof AggregateError);
        assert.ok(failure.errors.some(error => error.message.includes("code 7")));
      }
    } finally {
      await Promise.allSettled([
        ...(!shutdownAttempted ? [app.stop()] : []),
        ...(!automationExited ? [automation.stop()] : []),
        ...(!hostExited ? [host.stop()] : []),
      ]);
      rmSync(directory, { recursive: true, force: true });
    }
  });
}

test("automation logging stays on the explicit simulator and does not replace the app stream", () => {
  const argumentsFor = nativeLogs.iosAutomationLogArguments ?? ((udid) => [
    "simctl", "spawn", udid, "log", "stream", "--style", "compact", "--level", "info",
    "--predicate", 'process == "BibleOnSite"',
  ]);
  for (const udid of ["24E299B4-C77B-4426-AC2B-71243825F07C", "BA92BF1D-FB36-472C-8917-683A2BF212EE"]) {
    const args = argumentsFor(udid);
    assert.deepEqual(args.slice(0, 9), ["simctl", "spawn", udid, "log", "stream", "--style", "compact", "--level", "info"]);
    assert.equal(args[9], "--predicate");
    assert.equal(args.length, 11);
    assert.match(args[10], /process BEGINSWITH "WebDriverAgent"/);
    assert.match(args[10], /process == "testmanagerd"/);
    assert.ok(!args[10].includes("BibleOnSite"), "keep the app-only identity stream separate");
  }
});

test("host lifecycle logging remains independent of device RPCs and limits its process scope", () => {
  const args = nativeLogs.iosHostLogArguments();
  assert.deepEqual(args.slice(0, 6), ["stream", "--style", "compact", "--level", "info", "--predicate"]);
  const names = args[6].split(" OR ").map(term => {
    const match = /^process == "([A-Za-z_]+)"$/.exec(term);
    assert.ok(match, "only exact process filters may broaden this host observer");
    return match[1];
  });
  assert.deepEqual(names.sort(), ["CoreSimulatorService", "DeviceHub", "Simulator", "launchd_sim", "simulatord"].sort());
  assert.equal(args.length, 7);
  assert.ok(!args.includes("simctl"));
});

test("an automation-start failure still closes the original stream", async () => {
  await withStreamArtifact(async (artifact) => {
    const stream = startNativeLog(process.execPath,
      ["-e", "process.stdout.write('live log'); setInterval(() => {}, 1000)"], artifact);
    let exited = false;
    void stream.completion.then(() => { exited = true; });
    let stopped = false;
    try {
      await waitForLog(artifact);
      await nativeLogs.stopNativeLogStreams([stream, undefined]);
      stopped = true;
      assert.equal(exited, true);
      assert.equal(readFileSync(artifact, "utf8"), "live log");
    } finally { if (!stopped) await stream.stop(); }
  });
});

test("pipe observations persist immediate stdout and final stderr before stream completion", async () => {
  await withStreamArtifact(async artifact => {
    let observed = "";
    const stream = startNativeLog(process.execPath, ["-e",
      "process.stdout.write('live log early\\n'); process.stderr.write('last log\\n');"], artifact, {
      onOutput(chunk) {
        assert.ok(readFileSync(artifact, "utf8").includes(chunk.toString()));
        observed += chunk.toString();
      },
    });
    await stream.completion;
    await assert.rejects(stream.stop(), /exited unexpectedly: code 0/);
    for (const value of ["live log early", "last log"]) {
      assert.ok(observed.includes(value));
      assert.ok(readFileSync(artifact, "utf8").includes(value));
    }
  });
});

test("observer errors remain reportable after the owned child stops", async () => {
  await withStreamArtifact(async artifact => {
    const stream = startNativeLog(process.execPath,
      ["-e", "process.stdout.write('live log'); setInterval(() => {}, 1000)"], artifact,
      { onOutput() { throw new Error("observer failed"); } });
    await waitForLog(artifact);
    await assert.rejects(stream.stop(), /observer failed/);
    assert.equal(readFileSync(artifact, "utf8"), "live log");
  });
});
