import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

// The iOS suite splits across dynamically planned single-simulator runners
// (#2263): each shard is its own matrix job with its own device, Appium
// server and artifacts directory, assigned an explicit case manifest so
// every scenario still runs exactly once.

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
