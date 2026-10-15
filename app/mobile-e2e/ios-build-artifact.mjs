import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);
export const appBundle = "app/BibleOnSite/bin/Debug/net10.0-ios/iossimulator-arm64/BibleOnSite.app";
const projectOutputs = [
  "app/devops/bin/Debug", "app/devops/obj",
  "app/BibleOnSite.Tests.MobileE2E/bin/Debug", "app/BibleOnSite.Tests.MobileE2E/obj",
];
const roots = [appBundle, ...projectOutputs, "coverage-app"];
const requiredFiles = [
  `${appBundle}/BibleOnSite`, `${appBundle}/Info.plist`, `${appBundle}/GoogleService-Info.plist`,
  `${appBundle}/_CodeSignature/CodeResources`,
  "app/devops/bin/Debug/_build.dll", "app/devops/bin/Debug/_build.deps.json",
  "app/devops/bin/Debug/_build.runtimeconfig.json", "app/devops/obj/project.assets.json",
  "app/BibleOnSite.Tests.MobileE2E/bin/Debug/net10.0/BibleOnSite.Tests.MobileE2E.dll",
  "app/BibleOnSite.Tests.MobileE2E/bin/Debug/net10.0/BibleOnSite.Tests.MobileE2E.deps.json",
  "app/BibleOnSite.Tests.MobileE2E/bin/Debug/net10.0/BibleOnSite.Tests.MobileE2E.runtimeconfig.json",
  "app/BibleOnSite.Tests.MobileE2E/bin/Debug/net10.0/testconfig.json",
  "app/BibleOnSite.Tests.MobileE2E/obj/project.assets.json",
  "coverage-app/template.opencover.xml", "coverage-app/coverage-manifest.json",
];

async function digest(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function validateIdentity(sourceSha, toolchain) {
  const validSha = typeof sourceSha === "string" && sourceSha.length === 40 &&
    Array.from(sourceSha).every(character => "0123456789abcdef".includes(character));
  if (!validSha || !toolchain) throw new Error("Missing exact build source/toolchain identity.");
}

async function validateFiles(root, coverage) {
  for (const path of requiredFiles) {
    const file = path.startsWith("coverage-app/") ? join(coverage, path.slice("coverage-app/".length)) : join(root, path);
    if (!(await stat(file)).isFile()) throw new Error(`Missing build file: ${path}`);
  }
}

async function validateCoverage(coverage, sourceSha) {
  const manifest = JSON.parse(await readFile(join(coverage, "coverage-manifest.json"), "utf8"));
  if (manifest.kind !== "app-e2e-coverage-build/1" || manifest.sourceSha !== sourceSha ||
      manifest.platform !== "iOS" || manifest.configuration !== "Debug") {
    throw new Error("Coverage template does not belong to this iOS Debug build.");
  }
}

export function validateArchiveEntries(entries) {
  const files = new Set();
  for (const line of entries.split(/\r?\n/).filter(Boolean)) {
    const path = line.replace(/\/$/, "");
    if (path.includes("\\") || path.split("/").some(part => part === ".." || part === "." || !part) ||
        !roots.some(root => path === root || path.startsWith(`${root}/`))) {
      throw new Error(`Unexpected build archive entry: ${line}`);
    }
    files.add(path);
  }
  for (const file of requiredFiles) {
    if (!files.has(file)) throw new Error(`Missing build archive entry: ${file}`);
  }
}

export async function packIosBuild(root, coverage, output, sourceSha, toolchain) {
  root = resolve(root);
  coverage = resolve(coverage);
  output = resolve(output);
  validateIdentity(sourceSha, toolchain);
  await validateFiles(root, coverage);
  await validateCoverage(coverage, sourceSha);
  await mkdir(output, { recursive: true });
  const archive = join(output, "ios-build.tar.gz");
  // tar preserves Mach-O modes and framework symlinks; upload-artifact's ZIP
  // alone does not. Exclude Apple's companion metadata entries, which are
  // outside the declared output roots; signatures live in the bundle itself.
  // https://github.com/libarchive/libarchive/blob/master/tar/bsdtar.c
  // The coverage template travels with these exact assemblies.
  // --force-local keeps a drive-letter archive path (C:\…) local under GNU
  // tar on Windows; bsdtar accepts it identically.
  await execute("tar", ["--force-local", "-czf", archive, "-C", root, appBundle, ...projectOutputs,
    "-C", dirname(coverage), "coverage-app"], {
    windowsHide: true, env: { ...process.env, COPYFILE_DISABLE: "1" },
  });
  const { stdout } = await execute("tar", ["--force-local", "-tzf", archive], { maxBuffer: 8 * 1024 * 1024, windowsHide: true });
  validateArchiveEntries(stdout);
  const manifest = {
    kind: "ios-mobile-e2e-build/1", sourceSha, toolchain, workspace: root,
    archiveSha256: await digest(archive), archiveBytes: (await stat(archive)).size,
  };
  await writeFile(join(output, "ios-build.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

export async function restoreIosBuild(root, input, artifacts, sourceSha, toolchain) {
  root = resolve(root);
  validateIdentity(sourceSha, toolchain);
  const manifest = JSON.parse(await readFile(join(input, "ios-build.json"), "utf8"));
  // MSBuild intermediates retain absolute checkout/NuGet paths. Refuse a host
  // with different coordinates instead of quietly rebuilding a second app.
  if (manifest.kind !== "ios-mobile-e2e-build/1" || manifest.sourceSha !== sourceSha ||
      manifest.toolchain !== toolchain || manifest.workspace !== root) {
    throw new Error("iOS build source, toolchain or workspace does not match this runner.");
  }
  const archive = join(input, "ios-build.tar.gz");
  if (manifest.archiveBytes !== (await stat(archive)).size || manifest.archiveSha256 !== await digest(archive)) {
    throw new Error("iOS build archive integrity check failed.");
  }
  const { stdout } = await execute("tar", ["--force-local", "-tzf", archive], { maxBuffer: 8 * 1024 * 1024, windowsHide: true });
  validateArchiveEntries(stdout);
  await execute("tar", ["--force-local", "-xzf", archive, "-C", root, appBundle, ...projectOutputs], { windowsHide: true });
  await mkdir(artifacts, { recursive: true });
  await execute("tar", ["--force-local", "-xzf", archive, "-C", artifacts, "coverage-app"], { windowsHide: true });
  const coverage = join(artifacts, "coverage-app");
  await validateFiles(root, coverage);
  await validateCoverage(coverage, sourceSha);
  await writeFile(join(artifacts, "ios-build.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [operation, ...args] = process.argv.slice(2);
  if (args.length !== 5 || !["pack", "restore"].includes(operation)) {
    throw new Error("Usage: ios-build-artifact.mjs pack|restore <workspace> <coverage|input> <output|artifacts> <source-sha> <toolchain>");
  }
  const manifest = await (operation === "pack" ? packIosBuild : restoreIosBuild)(...args);
  console.log(`${operation}: ${manifest.sourceSha}, ${manifest.archiveBytes} bytes, SHA256 ${manifest.archiveSha256}`);
}
