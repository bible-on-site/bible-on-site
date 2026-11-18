import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { bundleDigest, executeIosCommand, iosNodeEnvironment, prepareIosApp, verifyNodeInterpreter } from "./ios-install.mjs";
import { iosBootDiagnosticOutput } from "./ios-boot-diagnostics.mjs";

const udid = "4AD2086B-7B8F-4608-A742-AA422A0B8D74";
const bundleId = "com.tanah.daily929";
const nonce = "50a16675077e44749d1e4eb503c1ea67";
const info = { CFBundleIdentifier: bundleId, CFBundleExecutable: "BibleOnSite",
  CFBundleSupportedPlatforms: ["iPhoneSimulator"] };

test("the production executor sends stdin and closes it for real child processes", async () => {
  const { stdout } = await executeIosCommand(process.execPath,
    ["-e", "process.stdin.pipe(process.stdout)"], { input: "exact installed-app listing", encoding: "utf8", timeout: 5000 });
  assert.equal(stdout, "exact installed-app listing");
  assert.equal((await executeIosCommand(process.execPath,
    ["-e", "process.stdin.on('end',()=>process.stdout.write('closed'));process.stdin.resume()"],
    { encoding: "utf8", timeout: 5000 })).stdout, "closed");
});

test("early child failure retains its exit status and stderr when stdin closes", async () => {
  await assert.rejects(executeIosCommand(process.execPath,
    ["-e", "process.stderr.write('controlled failure');process.exit(7)"],
    { input: "x".repeat(1024 * 1024), encoding: "utf8", timeout: 5000 }),
    error => error.code === 7 && error.stderr.includes("controlled failure"));
});

test("boot-phase output is observed live before a real native child reaches its deadline", { timeout: 5000 }, async () => {
  const output = [];
  await assert.rejects(executeIosCommand(process.execPath,
    ["-e", "process.stdout.write('Waiting on data migration');process.stderr.write('phase detail');setInterval(()=>{},1000)"],
    { encoding: "utf8", timeout: 500, killSignal: "SIGKILL", onOutput: (stream, chunk) => output.push([stream, String(chunk)]) }),
    error => error.signal === "SIGKILL");
  assert(output.some(([stream, text]) => stream === "stdout" && text.includes("Waiting on data migration")));
  assert(output.some(([stream, text]) => stream === "stderr" && text.includes("phase detail")));
});

test("the executor keeps draining boot output after its diagnostic prefix is full", { timeout: 5000 }, async () => {
  const records = [];
  const output = iosBootDiagnosticOutput({ udid, nonce, deadlineMs: Date.now() + 4000,
    write: line => records.push(JSON.parse(line)) });
  const result = await executeIosCommand(process.execPath, ["-e", "process.stdout.write('x'.repeat(1048576))"],
    { encoding: "utf8", timeout: 4000, onOutput: output.bootstatus });
  assert.equal(result.stdout.length, 1048576);
  assert.equal(records.at(-1).retainedBytes, 65536);
  assert.equal(records.filter(record => record.truncated).length, 1);
});

test("observed command failure preserves its cause when output retention also fails", { timeout: 5000 }, async () => {
  const retention = new Error("controlled output failure");
  await assert.rejects(executeIosCommand(process.execPath, ["-e", "process.stdout.write('phase');process.exitCode=7"],
    { encoding: "utf8", timeout: 4000, onOutput: () => { throw retention; } }),
    error => error instanceof AggregateError && error.errors[0].code === 7 && error.errors[1] === retention);
});

test("a fixed node command selects the exact parent interpreter ahead of inherited PATH", async () => {
  const env = iosNodeEnvironment(process.env, process.execPath);
  const { stdout } = await executeIosCommand("node", ["-p", "process.execPath"],
    { env, encoding: "utf8", timeout: 5000 });
  assert.equal(await realpath(stdout.trim()), await realpath(process.execPath));
  assert.equal(env.MOBILE_NODE_EXECUTABLE, process.execPath);
  await verifyNodeInterpreter(env.MOBILE_NODE_EXECUTABLE);
});

test("interpreter pinning removes duplicate Windows PATH keys and retains other environment", () => {
  const env = iosNodeEnvironment({ Path: "old-node", PATH: "ambiguous-node", KEEP: "original" }, process.execPath);
  assert.deepEqual(Object.keys(env).filter(key => key.toLowerCase() === "path"), ["PATH"]);
  assert.equal(env.PATH, `${dirname(process.execPath)}${delimiter}old-node`);
  assert.equal(env.KEEP, "original");
});

test("the installer CLI rejects a different interpreter identity before device preparation", async t => {
  const { appPath } = await fixture(t);
  await assert.rejects(executeIosCommand(process.execPath,
    [fileURLToPath(new URL("./ios-install.mjs", import.meta.url)), appPath, udid, nonce,
      "reset", String(Date.now() + 300000), appPath], { encoding: "utf8", timeout: 5000 }),
    error => error.stderr.includes("exact parent Node interpreter"));
});

function executable({ cpu = 0x100000c, platform = 7, commandBytes = 24 } = {}) {
  const buffer = Buffer.alloc(56);
  buffer.writeUInt32LE(0xfeedfacf, 0);
  buffer.writeUInt32LE(cpu, 4);
  buffer.writeUInt32LE(2, 12);
  buffer.writeUInt32LE(1, 16);
  buffer.writeUInt32LE(24, 20);
  buffer.writeUInt32LE(0x32, 32);
  buffer.writeUInt32LE(commandBytes, 36);
  buffer.writeUInt32LE(platform, 40);
  return buffer;
}

async function fixture(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), "ios-install-"));
  t.after(async () => {
    assert.ok(!relative(tmpdir(), root).startsWith(".."));
    await rm(root, { recursive: true, force: true });
  });
  const appPath = join(root, "input", "BibleOnSite.app");
  const devicesRoot = join(root, "Devices");
  const container = join(devicesRoot, udid, "data/Containers/Bundle/Application",
    "A1B2C3D4-0000-4000-A000-123456789ABC", "BibleOnSite.app");
  await mkdir(appPath, { recursive: true });
  await mkdir(dirname(container), { recursive: true });
  await writeFile(join(appPath, "BibleOnSite"), executable(options));
  await writeFile(join(appPath, "Info.plist"), "original plist bytes");
  await writeFile(join(appPath, "BibleOnSite.dll"), "exact woven IL");
  await writeFile(join(appPath, "AltCover.Recorder.g.dll"), "exact recorder bytes");
  let installed = options.installed ?? true;
  let clock = 1000;
  const calls = [];
  const observations = [];
  const device = { udid, state: "Booted", isAvailable: true, ...options.device };
  let listCalls = 0;
  const execute = async (command, args, execution) => {
    calls.push({ command, args, timeout: execution.timeout });
    assert.ok(execution.timeout > 0 && execution.timeout <= 300000);
    const key = args.slice(0, 2).join(" ");
    if (options.fail === key) throw new Error(`failed ${key}`);
    let stdout = "";
    if (command === "plutil") stdout = args.at(-1) === "-" ? execution.input : JSON.stringify({ ...info, ...options.info });
    else if (key === "simctl list") {
      listCalls++;
      if (options.raceAfterBoot && listCalls > 1) device.udid = "00000000-0000-4000-A000-000000000000";
      stdout = JSON.stringify({ devices: {
        [options.runtime ?? "com.apple.CoreSimulator.SimRuntime.iOS-27-2"]: options.duplicateDevice ? [device, { ...device }] : [device],
      } });
    }
    else if (key === "simctl boot") { device.state = "Booting"; if (options.expireOnBoot) clock = 301000; }
    else if (key === "simctl bootstatus") device.state = options.postBootState ?? "Booted";
    else if (key === "simctl spawn") stdout = "PID Status Label\n1 0 launchd_sim\n";
    else if (key === "simctl listapps") stdout = JSON.stringify(installed ? { [bundleId]: {} } : {});
    else if (key === "simctl uninstall") { if (!options.stuckReset) installed = false; }
    else if (key === "simctl terminate") { if (options.terminationError) throw options.terminationError; }
    else if (key === "simctl install") {
      await cp(appPath, container, { recursive: true });
      installed = !options.unregistered;
      if (options.changedInstalled) await writeFile(join(container, options.changedInstalled), "different bytes");
      if (options.changedSource) await writeFile(join(appPath, "BibleOnSite.dll"), "source changed during install");
      if (options.expireOnInstall) clock = 301000;
    } else if (key === "simctl get_app_container") stdout = options.container ?? container;
    else assert.fail(`Unexpected command: ${command} ${args.join(" ")}`);
    clock += options.commandMs ?? 0;
    return { stdout };
  };
  const config = { appPath, udid, nonce, devicesRoot, platform: "darwin", execute,
    reserveTransition: async identity => {
      observations.push({ phase: "reserve", identity });
      clock += options.reserveMs ?? 0;
      return { transitionAllowed: options.transitionAllowed ?? true };
    },
    confirmReady: async identity => {
      observations.push({ phase: "ready", identity });
      if (options.observerFailure) throw new Error("parent reader acknowledgement failed");
      if (options.expireDuringAck) clock = 301000;
    },
    now: () => clock, deadlineMs: 301000, ...options.configuration };
  return { root, appPath, container, calls, config, observations };
}

test("command milestones retain the exact boot boundary and debit the original deadline", async t => {
  const { config } = await fixture(t, { device: { state: "Shutdown" }, commandMs: 10 });
  const events = [];
  await prepareIosApp({ ...config, report: event => events.push(event) });
  const boot = events.filter(event => event.argv[1] === "boot" || event.argv[1] === "bootstatus");
  assert.deepEqual(boot.map(event => [event.phase, event.argv[1]]),
    [["command-start", "boot"], ["command-end", "boot"], ["command-start", "bootstatus"], ["command-end", "bootstatus"]]);
  assert(boot.every(event => event.argv[2] === udid && event.remainingMs <= 300000));
  assert.equal(boot[1].commandMs, 10);
  assert.equal(boot[3].remainingMs, boot[0].remainingMs - 20);
});

test("only fixed bootstatus output reaches diagnostics and sampler cleanup consumes the original deadline", async t => {
  const { config } = await fixture(t, { device: { state: "Shutdown" } });
  const output = () => {};
  let clock = 1000, stopped = 0;
  const execute = (command, args, options) => {
    assert.equal(options.onOutput, args[1] === "bootstatus" ? output : undefined);
    return config.execute(command, args, options);
  };
  await assert.rejects(prepareIosApp({ ...config, execute, now: () => clock, bootOutput: output,
    startResources: () => ({ stop: async () => { stopped++; clock = config.deadlineMs; } }) }), /300 second session deadline/);
  assert.equal(stopped, 1);
});

test("failed-command tracing preserves the original cause and never retains child output", async t => {
  const { config } = await fixture(t, { device: { state: "Shutdown" } });
  const failure = Object.assign(new Error("controlled bootstatus failure"),
    { code: 7, stderr: "controlled secret output", stdout: "controlled secret response" });
  const events = [];
  const execute = (command, args, options) => args[1] === "bootstatus" ? Promise.reject(failure) : config.execute(command, args, options);
  await assert.rejects(prepareIosApp({ ...config, execute, report: event => events.push(event) }), error => error === failure);
  assert.equal(events.at(-1).argv[1], "bootstatus");
  assert.equal(events.at(-1).success, false);
  assert.equal(events.at(-1).code, 7);
  assert(!JSON.stringify(events).includes("controlled secret"));
  const traceFailure = new Error("controlled trace write failure");
  await assert.rejects(prepareIosApp({ ...config, execute, report: event => {
    if (event.phase === "command-end" && event.success === false) throw traceFailure;
  } }), error => error instanceof AggregateError && error.errors[0] === failure && error.errors[1] === traceFailure);
});

test("milestone retention cannot start a command after consuming its remaining deadline", async t => {
  const { config, calls } = await fixture(t);
  let clock = 1000;
  await assert.rejects(prepareIosApp({ ...config, now: () => clock,
    report: () => { clock = config.deadlineMs; } }), /300 second session deadline/);
  assert.equal(calls.length, 0);
});

test("normal preparation proves reset, exact installed payload and session identity before reuse", async t => {
  const { config, calls, appPath } = await fixture(t, { commandMs: 10 });
  const result = await prepareIosApp(config);
  assert.equal(result.kind, "ios-verified-install/1");
  assert.equal(result.udid, udid);
  assert.equal(result.nonce, nonce);
  assert.equal(result.appPath, appPath);
  assert.equal(result.bundleSha256, await bundleDigest(appPath));
  assert.equal(result.keepData, false);
  assert.equal(result.installMs, 10);
  assert.ok(result.preparationMs >= result.installMs);
  const operations = calls.filter(call => call.command === "xcrun").map(call => call.args[1]);
  assert.deepEqual(operations, ["list", "listapps", "uninstall", "listapps", "install", "listapps", "get_app_container", "spawn"]);
  for (const { command, args } of calls) {
    assert.ok(!["lipo", "uname", "codesign", "dotnet"].includes(command));
    if (command === "xcrun" && args[1] !== "list") assert.equal(args[2], udid);
    assert.ok(!args.includes("erase") && !args.includes("shutdown"));
  }
  assert.ok(calls.at(-1).timeout < calls[0].timeout);
});

test("a confirmed absent app needs no uninstall", async t => {
  const { config, calls } = await fixture(t, { installed: false });
  await prepareIosApp(config);
  assert.equal(calls.some(call => call.args[1] === "uninstall"), false);
});

test("a symlinked checkout keeps the requested path identity while verifying canonical bytes", async t => {
  const { config, root, appPath } = await fixture(t);
  const link = join(root, "linked-input");
  await symlink(dirname(appPath), link, process.platform === "win32" ? "junction" : "dir");
  const requested = join(link, "BibleOnSite.app");
  const result = await prepareIosApp({ ...config, appPath: requested });
  assert.equal(result.appPath, requested);
  assert.equal(result.canonicalAppPath, await realpath(appPath));
});

test("explicit review mode terminates the old process and preserves its data", async t => {
  const { config, calls } = await fixture(t);
  assert.equal((await prepareIosApp({ ...config, keepData: true })).keepData, true);
  assert.ok(calls.some(call => call.args[1] === "terminate"));
  assert.equal(calls.some(call => call.args[1] === "uninstall"), false);
});

test("review mode accepts only the exact already-stopped simctl failure", async t => {
  const terminationError = Object.assign(new Error("already stopped"), { code: 3,
    stderr: "An error was encountered processing the command (domain=NSPOSIXErrorDomain, code=3):\nfound nothing to terminate" });
  const { config } = await fixture(t, { terminationError });
  await prepareIosApp({ ...config, keepData: true });
});

for (const [name, options, message] of [
  ["wrong bundle", { info: { CFBundleIdentifier: "com.other" } }, /bundle\/platform/],
  ["device build", { info: { CFBundleSupportedPlatforms: ["iPhoneOS"] } }, /bundle\/platform/],
  ["array-like platform object", { info: { CFBundleSupportedPlatforms: { 0: "iPhoneSimulator", length: 1 } } }, /bundle\/platform/],
  ["executable traversal", { info: { CFBundleExecutable: "../BibleOnSite" } }, /bundle\/platform/],
  ["wrong architecture", { cpu: 0x1000007 }, /thin arm64/],
  ["arm64 device Mach-O", { platform: 2 }, /iPhoneSimulator/],
  ["invalid load command", { commandBytes: 4096 }, /load command size/],
  ["wrong UDID", { device: { udid: "A1B2C3D4-0000-4000-A000-123456789ABC" } }, /uniquely available/],
  ["ambiguous simulator", { duplicateDevice: true }, /uniquely available/],
  ["shutting-down simulator", { device: { state: "Shutting Down" } }, /uniquely available/],
  ["unavailable simulator", { device: { isAvailable: false } }, /uniquely available/],
  ["wrong runtime", { runtime: "com.apple.CoreSimulator.SimRuntime.tvOS-27-2" }, /uniquely available/],
  ["failed reset", { fail: "simctl uninstall" }, /failed simctl uninstall/],
  ["reset without absence", { stuckReset: true }, /reset left/],
  ["failed install", { fail: "simctl install" }, /failed simctl install/],
  ["unregistered install", { unregistered: true }, /did not register/],
  ["different native payload", { changedInstalled: "BibleOnSite" }, /bytes differ/],
  ["different woven IL", { changedInstalled: "BibleOnSite.dll" }, /bytes differ/],
  ["different recorder", { changedInstalled: "AltCover.Recorder.g.dll" }, /bytes differ/],
  ["source mutation during install", { changedSource: true }, /bytes differ/],
  ["expired combined budget", { expireOnInstall: true }, /300 second/],
  ["inherited invalid session identity", { configuration: { nonce: "stale" } }, /session identity/],
  ["larger session deadline", { configuration: { deadlineMs: 301001 } }, /existing 300/],
]) test(`preparation fails closed for ${name}`, async t => {
  const { config } = await fixture(t, options);
  await assert.rejects(prepareIosApp(config), message);
});

test("a different simulator container cannot provide a proof even with identical bytes", async t => {
  const { config, container } = await fixture(t);
  const wrongDevice = container.replace(udid, "A1B2C3D4-0000-4000-A000-123456789ABC");
  await mkdir(dirname(wrongDevice), { recursive: true });
  await cp(config.appPath, wrongDevice, { recursive: true });
  const execute = async (command, args, execution) => args[1] === "get_app_container"
    ? { stdout: wrongDevice } : config.execute(command, args, execution);
  await assert.rejects(prepareIosApp({ ...config, execute }), /this simulator's exact AUT/);
});

test("review mode fails rather than accepting an ambiguous termination error", async t => {
  const { config } = await fixture(t, { terminationError: Object.assign(new Error("transport failed"),
    { code: 70, stderr: "found nothing to terminate" }) });
  await assert.rejects(prepareIosApp({ ...config, keepData: true }), /transport failed/);
});

test("whole-bundle digest includes managed content and rejects external symlinks", { skip: process.platform === "win32" }, async t => {
  const { appPath, root } = await fixture(t);
  const original = await bundleDigest(appPath);
  await writeFile(join(appPath, "BibleOnSite.dll"), "another woven build");
  assert.notEqual(await bundleDigest(appPath), original);
  const outside = join(root, "outside");
  await writeFile(outside, "outside");
  await symlink(outside, join(appPath, "external"));
  await assert.rejects(bundleDigest(appPath), /escapes its app/);
  assert.equal(await readFile(outside, "utf8"), "outside");
});

for (const state of ["Shutdown", "Booting"]) {
  test(`the first parent-reserved ${state} transition is established once inside preparation`, async t => {
    const { config, calls, observations } = await fixture(t, { device: { state }, commandMs: 10, reserveMs: 20 });
    const proof = await prepareIosApp(config);
    const commands = calls.filter(call => call.command === "xcrun").map(call => call.args[1]);
    assert.equal(commands.filter(command => command === "boot").length, state === "Shutdown" ? 1 : 0);
    assert.equal(commands.filter(command => command === "bootstatus").length, 1);
    assert.equal(proof.initialState, state);
    assert.equal(proof.bootMs, state === "Shutdown" ? 30 : 20);
    assert.equal(proof.observerAcknowledged, true);
    assert.deepEqual(observations.map(value => value.phase), ["reserve", "ready"]);
    assert.equal(observations[1].identity.state, "Booted");
    assert.equal(observations[1].identity.deadlineMs, config.deadlineMs);
    assert(calls.at(-1).timeout < calls[0].timeout - 20);
  });
}

for (const [name, options, message] of [
  ["later lost readiness", { device: { state: "Shutdown" }, transitionAllowed: false }, /already claimed/],
  ["failed normal boot", { device: { state: "Shutdown" }, fail: "simctl boot" }, /failed simctl boot/],
  ["failed bootstatus", { device: { state: "Shutdown" }, fail: "simctl bootstatus" }, /failed simctl bootstatus/],
  ["still booting", { device: { state: "Shutdown" }, postBootState: "Booting" }, /did not establish readiness/],
  ["identity changed during boot", { device: { state: "Shutdown" }, raceAfterBoot: true }, /uniquely available/],
  ["original deadline during boot", { device: { state: "Shutdown" }, expireOnBoot: true }, /300 second/],
  ["reservation consumed the deadline", { device: { state: "Shutdown" }, reserveMs: 300000 }, /300 second/],
]) {
  test(`${name} cannot retry or install the app`, async t => {
    const { config, calls, observations } = await fixture(t, options);
    await assert.rejects(prepareIosApp(config), message);
    assert(calls.filter(call => call.args[1] === "boot").length <= 1);
    assert(!calls.some(call => call.args[1] === "install" || call.args[1] === "uninstall"));
    assert(!observations.some(value => value.phase === "ready"));
  });
}

test("a stale launchd session or failed reader acknowledgement cannot produce a driver receipt", async t => {
  for (const options of [{ fail: "simctl spawn" }, { observerFailure: true }, { expireDuringAck: true }]) {
    const { config } = await fixture(t, options);
    await assert.rejects(prepareIosApp(config), /failed simctl spawn|reader acknowledgement|300 second/);
  }
});

test("an installer cannot create its own run-scoped ownership or omit the parent acknowledgement", async t => {
  const { config, calls } = await fixture(t);
  await assert.rejects(prepareIosApp({ ...config, reserveTransition: undefined }), /run-scoped/);
  await assert.rejects(prepareIosApp({ ...config, confirmReady: undefined }), /run-scoped/);
  assert.equal(calls.length, 0);
});
