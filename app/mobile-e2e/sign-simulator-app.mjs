import { execFileSync } from "node:child_process";
import { closeSync, openSync, readSync, readdirSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const machoMagic = new Set([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe,
  0xcafebabe, 0xbebafeca, 0xcafebabf, 0xbfbafeca]);

export function simulatorSigningTargets(app) {
  const targets = [];
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      // Framework symlinks point back into the bundle; never sign their targets twice.
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        visit(path);
        if (/\.(framework|appex|app)$/.test(entry.name)) targets.push(path);
      } else if (entry.isFile()) {
        const descriptor = openSync(path, "r");
        try {
          const header = Buffer.alloc(4);
          if (readSync(descriptor, header, 0, 4, 0) === 4 && machoMagic.has(header.readUInt32BE())) {
            targets.push(path);
          }
        } finally { closeSync(descriptor); }
      }
    }
  }
  visit(app);
  // Nested native code must be signed before its enclosing bundle.
  return targets.sort((first, second) => second.split(sep).length - first.split(sep).length)
    .concat(app);
}

export function signSimulatorApp(app, { execute = execFileSync, platform = process.platform } = {}) {
  if (platform !== "darwin") throw new Error("Simulator signing requires macOS.");
  const supported = JSON.parse(execute("plutil", ["-extract", "CFBundleSupportedPlatforms", "json", "-o", "-",
    join(app, "Info.plist")], { encoding: "utf8", windowsHide: true }));
  if (!Array.isArray(supported) || supported.length !== 1 || supported[0] !== "iPhoneSimulator") {
    throw new Error("Ad-hoc signing is restricted to an iPhoneSimulator app bundle.");
  }
  const targets = simulatorSigningTargets(app);
  for (const target of targets) {
    execute("codesign", ["--force", "--sign", "-", "--timestamp=none",
      "--preserve-metadata=identifier,entitlements,requirements,flags", target],
      { stdio: "inherit", windowsHide: true });
  }
  execute("codesign", ["--verify", "--deep", "--strict", app], { stdio: "inherit", windowsHide: true });
  return targets.length;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = process.env.MOBILE_APP_PATH ?? resolve(fileURLToPath(new URL("../BibleOnSite/bin/Debug/net10.0-ios/iossimulator-arm64/BibleOnSite.app", import.meta.url)));
  console.log(`Signed and verified ${signSimulatorApp(app)} simulator code targets.`);
}
