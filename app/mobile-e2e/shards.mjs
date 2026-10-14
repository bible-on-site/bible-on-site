import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

// The iOS suite splits across two simulators on the one xcode-27 runner
// (#2083): each shard owns a device UDID, an Appium port, an artifacts
// directory and a `Shard` trait filter, so every scenario still runs exactly
// once — the two groups are disjoint by trait construction.
export const SHARD_COUNT = 2;

// Builds the per-shard run environments from the parent process env. Shard N
// takes MOBILE_UDID_SHARD_N (exported by ios:boot when MOBILE_E2E_SHARD_COUNT=2)
// and the Appium port 4722+N, and its MOBILE_E2E_SHARD index narrows the
// dotnet test filter in TestMobileE2E.
export function shardRuns(env, artifactsDir) {
  const runs = [];
  for (let shard = 1; shard <= SHARD_COUNT; shard++) {
    const udid = env[`MOBILE_UDID_SHARD_${shard}`];
    if (!udid) {
      throw new Error(`Set MOBILE_UDID_SHARD_${shard} (ios:boot exports it when MOBILE_E2E_SHARD_COUNT=2).`);
    }
    const artifacts = join(artifactsDir, `shard${shard}`);
    runs.push({
      shard,
      artifacts,
      env: {
        ...env,
        MOBILE_UDID: udid,
        MOBILE_APPIUM_PORT: String(4722 + shard),
        // WDA listens on the host-shared loopback inside each simulator, so it
        // needs a per-device port just like the Appium server.
        MOBILE_WDA_PORT: String(8099 + shard),
        MOBILE_E2E_COVERAGE_PORT: String(4786 + shard),
        MOBILE_E2E_ARTIFACTS: artifacts,
        // Local two-device mode keeps both shared CI groups on device one.
        MOBILE_E2E_SHARD: shard === 1 ? "1,3" : "2",
      },
    });
  }
  return runs;
}

// Merges per-shard coverage evidence into the run's top-level artifacts dir,
// which is where the e2e-impact collect step looks. Every scenario must run on
// exactly one shard, and each record is named by the full test identity —
// Namespace.Class.Method — so a filename shared by two shard directories can
// only be the same test running twice: fail rather than publish double-counted
// coverage.
export function mergeShardEvidence(shardArtifactsDirs, destinationDir) {
  rmSync(destinationDir, { recursive: true, force: true });
  mkdirSync(destinationDir, { recursive: true });
  for (const artifactsDir of shardArtifactsDirs) {
    const evidenceDir = join(artifactsDir, "coverage-evidence");
    if (!existsSync(evidenceDir)) continue;
    for (const file of readdirSync(evidenceDir).sort()) {
      const target = join(destinationDir, file);
      if (existsSync(target)) {
        throw new Error(`Coverage overlap: ${file} was produced by more than one shard.`);
      }
      copyFileSync(join(evidenceDir, file), target);
    }
  }
}

// Executable coverage includes startup snapshots on every device. Preserve each
// shard's dumps and errors, including identically named startup snapshots.
export function mergeShardAppCoverage(shardArtifactsDirs, destinationDir) {
  rmSync(destinationDir, { recursive: true, force: true });
  mkdirSync(destinationDir, { recursive: true });
  for (const [index, artifactsDir] of shardArtifactsDirs.entries()) {
    const source = join(artifactsDir, "app-coverage");
    if (!existsSync(source)) continue;
    for (const file of readdirSync(source).sort()) {
      copyFileSync(join(source, file), join(destinationDir, `shard${index + 1}-${file}`));
    }
  }
}
