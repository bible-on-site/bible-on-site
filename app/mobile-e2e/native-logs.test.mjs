import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmdirSync, statSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { exportNativeLog } from "./native-logs.mjs";

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
