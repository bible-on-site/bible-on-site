import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { test } from "node:test";
import { appBundle, packIosBuild, restoreIosBuild, validateArchiveEntries } from "./ios-build-artifact.mjs";

const sha = "0123456789abcdef0123456789abcdef01234567";
const toolchain = "xcode27-dotnet10.0.402-mauiios10.0.401.1";
const files = [
  `${appBundle}/BibleOnSite`, `${appBundle}/Info.plist`, `${appBundle}/GoogleService-Info.plist`,
  `${appBundle}/_CodeSignature/CodeResources`,
  "app/devops/bin/Debug/_build.dll", "app/devops/bin/Debug/_build.deps.json",
  "app/devops/bin/Debug/_build.runtimeconfig.json", "app/devops/obj/project.assets.json",
  "app/BibleOnSite.Tests.MobileE2E/bin/Debug/net10.0/BibleOnSite.Tests.MobileE2E.dll",
  "app/BibleOnSite.Tests.MobileE2E/bin/Debug/net10.0/BibleOnSite.Tests.MobileE2E.deps.json",
  "app/BibleOnSite.Tests.MobileE2E/bin/Debug/net10.0/BibleOnSite.Tests.MobileE2E.runtimeconfig.json",
  "app/BibleOnSite.Tests.MobileE2E/bin/Debug/net10.0/testconfig.json",
  "app/BibleOnSite.Tests.MobileE2E/obj/project.assets.json",
];
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "ios-build-artifact-"));
  t.after(() => {
    assert.ok(!relative(resolve(tmpdir()), root).startsWith(".."));
    rmSync(root, { recursive: true, force: true });
  });
  const workspace = join(root, "checkout");
  const coverage = join(workspace, "builder", "coverage-app");
  for (const path of files) {
    mkdirSync(dirname(join(workspace, path)), { recursive: true });
    writeFileSync(join(workspace, path), `built bytes: ${path}`);
  }
  mkdirSync(coverage, { recursive: true });
  writeFileSync(join(coverage, "template.opencover.xml"), '<CoverageSession><Modules><Module hash="exact-built-hash"/></Modules></CoverageSession>');
  writeFileSync(join(coverage, "coverage-manifest.json"), JSON.stringify({
    kind: "app-e2e-coverage-build/1", sourceSha: sha, platform: "iOS", configuration: "Debug",
  }));
  return { workspace, coverage, output: join(root, "upload"), artifacts: join(workspace, "shard1") };
}

test("round-trip keeps exact app/harness bytes, coverage identity, executable modes and framework links", async t => {
  const { workspace, coverage, output, artifacts } = fixture(t);
  const executable = join(workspace, appBundle, "BibleOnSite");
  const expected = readFileSync(executable);
  if (process.platform !== "win32") {
    chmodSync(executable, 0o755);
    symlinkSync("BibleOnSite", join(workspace, appBundle, "Current"));
  }
  if (process.platform === "darwin") {
    // Apple's tar would otherwise add undeclared ._Debug/._coverage-app entries.
    execFileSync("xattr", ["-w", "com.apple.metadata:test", "test-build", join(workspace, "app/devops/bin/Debug")]);
    execFileSync("xattr", ["-w", "com.apple.metadata:test", "test-build", coverage]);
  }
  const packed = await packIosBuild(workspace, coverage, output, sha, toolchain);
  for (const path of files) rmSync(join(workspace, path));
  if (process.platform !== "win32") rmSync(join(workspace, appBundle, "Current"));
  const restored = await restoreIosBuild(workspace, output, artifacts, sha, toolchain);
  assert.deepEqual(restored, packed);
  assert.deepEqual(readFileSync(executable), expected);
  assert.match(readFileSync(join(artifacts, "coverage-app", "template.opencover.xml"), "utf8"), /exact-built-hash/);
  assert.equal(JSON.parse(readFileSync(join(artifacts, "coverage-app", "coverage-manifest.json"))).sourceSha, sha);
  assert.deepEqual(JSON.parse(readFileSync(join(artifacts, "ios-build.json"))), packed);
  assert.ok(existsSync(join(workspace, "app/devops/bin/Debug/_build.dll")));
  if (process.platform !== "win32") {
    assert.equal(lstatSync(executable).mode & 0o777, 0o755);
    assert.equal(readlinkSync(join(workspace, appBundle, "Current")), "BibleOnSite");
  }
  assert.equal(existsSync(join(workspace, "coverage-app")), false);
});

test("rejects another source/toolchain/workspace before overwriting a runner file", async t => {
  const { workspace, coverage, output, artifacts } = fixture(t);
  await packIosBuild(workspace, coverage, output, sha, toolchain);
  const executable = join(workspace, appBundle, "BibleOnSite");
  writeFileSync(executable, "runner marker");
  await assert.rejects(restoreIosBuild(workspace, output, artifacts, "b".repeat(40), toolchain), /does not match/);
  await assert.rejects(restoreIosBuild(workspace, output, artifacts, sha, "different-Xcode"), /does not match/);
  await assert.rejects(restoreIosBuild(join(workspace, "other"), output, artifacts, sha, toolchain), /does not match/);
  assert.equal(readFileSync(executable, "utf8"), "runner marker");
  assert.equal(existsSync(artifacts), false);
});

test("source identity must be an exact lowercase hexadecimal string before reading build files", async t => {
  const { workspace, coverage, output, artifacts } = fixture(t);
  for (const invalid of [undefined, null, 123, { toString: () => sha }, sha.slice(1), `${sha}0`, sha.toUpperCase(), `${sha.slice(0, -1)}g`, `${sha}\n`]) {
    await assert.rejects(packIosBuild(workspace, coverage, output, invalid, toolchain), /Missing exact build source/);
    await assert.rejects(restoreIosBuild(workspace, output, artifacts, invalid, toolchain), /Missing exact build source/);
  }
  assert.equal(existsSync(output), false);
  assert.equal(existsSync(artifacts), false);
});

test("archive corruption is rejected before any extraction", async t => {
  const { workspace, coverage, output, artifacts } = fixture(t);
  await packIosBuild(workspace, coverage, output, sha, toolchain);
  const archive = join(output, "ios-build.tar.gz");
  const bytes = readFileSync(archive);
  bytes[bytes.length - 1] ^= 0xff;
  writeFileSync(archive, bytes);
  await assert.rejects(restoreIosBuild(workspace, output, artifacts, sha, toolchain), /integrity/);
  assert.equal(existsSync(artifacts), false);
});

test("cannot package missing binaries or a coverage template from another build", async t => {
  const { workspace, coverage, output } = fixture(t);
  await assert.rejects(packIosBuild(workspace, coverage, output, "b".repeat(40), toolchain), /does not belong/);
  rmSync(join(workspace, "app/devops/bin/Debug/_build.dll"));
  await assert.rejects(packIosBuild(workspace, coverage, output, sha, toolchain), /ENOENT/);
  assert.equal(existsSync(output), false);
});

test("missing runtime metadata cannot publish or extract a prebuilt consumer", async t => {
  for (const path of files.filter(file => file.endsWith(".deps.json") || file.endsWith(".runtimeconfig.json"))) {
    const { workspace, coverage, output } = fixture(t);
    rmSync(join(workspace, path));
    await assert.rejects(packIosBuild(workspace, coverage, output, sha, toolchain), /ENOENT/);
    assert.equal(existsSync(output), false);
    const entries = [...files.filter(file => file !== path), "coverage-app/template.opencover.xml",
      "coverage-app/coverage-manifest.json"].join("\n");
    assert.throws(() => validateArchiveEntries(entries), /Missing build archive entry/);
  }
});

test("only declared app/harness/coverage paths may be extracted, with every required file present", () => {
  const entries = [...files, "coverage-app/template.opencover.xml", "coverage-app/coverage-manifest.json"].join("\n");
  validateArchiveEntries(entries);
  for (const unexpected of ["/tmp/escape", "coverage-app/../escape", "app/devops/../../escape", "app/BibleOnSite/obj/stale", "coverage-app\\escape"]) {
    assert.throws(() => validateArchiveEntries(`${entries}\n${unexpected}`), /Unexpected/);
  }
  assert.throws(() => validateArchiveEntries(files.join("\n")), /Missing build archive entry/);
});
