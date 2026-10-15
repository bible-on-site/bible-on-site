import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { simulatorSigningTargets, signSimulatorApp } from "./sign-simulator-app.mjs";

function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), "simulator-signing-"));
  const app = join(root, "Reader with spaces.app");
  const framework = join(app, "Frameworks", "Native.framework");
  mkdirSync(framework, { recursive: true });
  writeFileSync(join(app, "Info.plist"), "fixture");
  writeFileSync(join(app, "BibleOnSite"), Buffer.from([0xcf, 0xfa, 0xed, 0xfe]));
  writeFileSync(join(framework, "Native"), Buffer.from([0xca, 0xfe, 0xba, 0xbe]));
  writeFileSync(join(app, "managed.dll"), "managed code");
  writeFileSync(join(app, "notes.sqlite"), "SQLite format 3");
  try { run(app, framework); } finally { rmSync(root, { recursive: true, force: true }); }
}

test("signs native dependencies before enclosing bundles and excludes data/managed assemblies", () => fixture((app, framework) => {
  const targets = simulatorSigningTargets(app);
  assert.ok(targets.indexOf(join(framework, "Native")) < targets.indexOf(framework));
  assert.ok(targets.indexOf(framework) < targets.indexOf(app));
  assert.equal(targets.at(-1), app);
  assert.ok(!targets.includes(join(app, "managed.dll")));
  assert.ok(!targets.includes(join(app, "notes.sqlite")));
}));

test("retains signing metadata, passes paths as literal arguments, and verifies the complete bundle", () => fixture((app) => {
  const calls = [];
  const count = signSimulatorApp(app, { platform: "darwin", execute(command, args) {
    calls.push({ command, args });
    return command === "plutil" ? '["iPhoneSimulator"]' : "";
  } });
  assert.equal(calls.filter(call => call.args.includes("--sign")).length, count);
  assert.ok(calls.filter(call => call.args.includes("--sign"))
    .every(call => call.args.includes("--preserve-metadata=identifier,entitlements,requirements,flags")));
  assert.deepEqual(calls.at(-1), { command: "codesign", args: ["--verify", "--deep", "--strict", app] });
}));

test("rejects device bundles before changing their signatures", () => fixture((app) => {
  const calls = [];
  assert.throws(() => signSimulatorApp(app, { platform: "darwin", execute(command) {
    calls.push(command); return '["iPhoneOS"]';
  } }), /restricted to an iPhoneSimulator/);
  assert.deepEqual(calls, ["plutil"]);
}));

test("preserves native signing failures instead of starting tests with invalid code", () => fixture((app) => {
  const failure = Object.assign(new Error("invalid native code"), { status: 1 });
  assert.throws(() => signSimulatorApp(app, { platform: "darwin", execute(command) {
    if (command === "plutil") return '["iPhoneSimulator"]';
    throw failure;
  } }), error => error === failure);
}));

test("propagates final bundle verification failures even when every signing command succeeded", () => fixture((app) => {
  const failure = Object.assign(new Error("invalid enclosing bundle"), { status: 1 });
  assert.throws(() => signSimulatorApp(app, { platform: "darwin", execute(command, args) {
    if (command === "plutil") return '["iPhoneSimulator"]';
    if (args.includes("--verify")) throw failure;
    return "";
  } }), error => error === failure);
}));
