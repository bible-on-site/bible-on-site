import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmdirSync, statSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { exportNativeLog, startNativeLog } from "./native-logs.mjs";

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
      await assert.rejects(stream.stop(), new RegExp(`code ${code}`));
      assert.equal(readFileSync(artifact, "utf8"), "live log");
    });
  });
}
