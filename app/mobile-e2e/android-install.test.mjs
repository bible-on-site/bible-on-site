import assert from "node:assert/strict";
import { test } from "node:test";
import { incrementalInstallSupported, installAppUnderTest } from "./android-install.mjs";

const device = { adb: "adb", udid: "emulator-5554", packageId: "com.tanah.daily929", appPath: "/out/app.apk" };
const binaryVersion = (version) => `Android Debug Bridge version 1.0.41\nVersion ${version}-10161052\n`;

const commandLine = (args) => args[0] === "-s" ? args.slice(2).join(" ") : args.join(" ");

// Records every adb invocation; `responses` maps the joined args (device
// prefix dropped) to the stdout each call returns (or throws).
function adbProbe(responses) {
  const calls = [];
  return {
    calls,
    execute: async (command, args) => {
      calls.push(args);
      const response = responses[commandLine(args)];
      if (response instanceof Error) throw response;
      assert.equal(command, "adb");
      return { stdout: response ?? "" };
    },
  };
}

test("incrementalInstallSupported requires both a >=30.0.1 binary and abb_exec", async () => {
  const { execute } = adbProbe({
    "version": binaryVersion("34.0.1"),
    "features": "abb_exec\nabb\n",
  });
  assert.equal(await incrementalInstallSupported({ ...device, execute }), true);
});

test("incrementalInstallSupported declines on older binaries even with abb_exec", async () => {
  const { execute } = adbProbe({
    "version": binaryVersion("29.0.6"),
    "features": "abb_exec\n",
  });
  assert.equal(await incrementalInstallSupported({ ...device, execute }), false);
});

test("incrementalInstallSupported declines when the device lacks abb_exec", async () => {
  const { execute } = adbProbe({
    "version": binaryVersion("34.0.1"),
    "features": "abb\n",
  });
  assert.equal(await incrementalInstallSupported({ ...device, execute }), false);
});

test("incrementalInstallSupported declines on unparseable versions", async () => {
  const { execute } = adbProbe({ "version": "Android Debug Bridge version 1.0.41\n" });
  assert.equal(await incrementalInstallSupported({ ...device, execute }), false);
});

test("installAppUnderTest replaces the package on the deterministic path", async () => {
  const { calls, execute } = adbProbe({
    "version": binaryVersion("34.0.1"),
    "features": "abb_exec",
    "shell pm path com.tanah.daily929": "package:/data/app/~~abc==/com.tanah.daily929-xyz==/base.apk\n",
    "uninstall com.tanah.daily929": "Success\n",
    "install --no-incremental -g /out/app.apk": "Performing Streamed Install\nSuccess\n",
  });
  const result = await installAppUnderTest({ ...device, execute });
  assert.deepEqual(calls.map(commandLine), [
    "shell pm path com.tanah.daily929",
    "uninstall com.tanah.daily929",
    "version",
    "features",
    "install --no-incremental -g /out/app.apk",
  ]);
  assert.equal(result.keepData, false);
});

test("installAppUnderTest skips uninstall when the package is absent", async () => {
  const { calls, execute } = adbProbe({
    "version": binaryVersion("34.0.1"),
    "features": "abb_exec",
    "install --no-incremental -g /out/app.apk": "Success\n",
  });
  await installAppUnderTest({ ...device, execute });
  assert.equal(calls.some((args) => args.includes("uninstall")), false);
});

test("installAppUnderTest keeps review data with -r", async () => {
  const { calls, execute } = adbProbe({
    "version": binaryVersion("34.0.1"),
    "features": "abb_exec",
    "install -r --no-incremental -g /out/app.apk": "Success\n",
  });
  const result = await installAppUnderTest({ ...device, keepData: true, execute });
  assert.deepEqual(calls.map(commandLine),
    ["version", "features", "install -r --no-incremental -g /out/app.apk"]);
  assert.equal(result.keepData, true);
});

test("installAppUnderTest omits the flag when the device cannot incremental-install", async () => {
  const { execute } = adbProbe({
    "version": binaryVersion("28.0.2"),
    "install -g /out/app.apk": "Success\n",
  });
  await installAppUnderTest({ ...device, execute });
});

test("installAppUnderTest fails the run when adb reports no Success", async () => {
  const { execute } = adbProbe({
    "version": binaryVersion("34.0.1"),
    "features": "abb_exec",
    "install --no-incremental -g /out/app.apk": "Performing Streamed Install\nFailure [INSTALL_FAILED_OLDER_SDK]\n",
  });
  await assert.rejects(installAppUnderTest({ ...device, execute }), /INSTALL_FAILED_OLDER_SDK/);
});
