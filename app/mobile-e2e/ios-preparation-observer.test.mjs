import assert from "node:assert/strict";
import http from "node:http";
import { setImmediate as tick } from "node:timers/promises";
import { test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { observeIosPreparations } from "./ios-preparation-observer.mjs";
import { requestIosPreparation } from "./ios-install.mjs";
import { startNativeLog } from "./native-logs.mjs";
import { resolveMobileAppPath } from "./app-path.mjs";

const udid = "4AD2086B-7B8F-4608-A742-AA422A0B8D74";
const hash = "a".repeat(64);
const nonce = "b".repeat(32);
const nextNonce = "c".repeat(32);

// The listener owns an ephemeral port; its HTTP host is always loopback.
function observerRequest(environment, path, options = {}) {
  return new Promise((accept, reject) => {
    const request = http.request({
      hostname: "127.0.0.1", port: environment.MOBILE_IOS_PREPARATION_PORT, path,
      method: options.method ?? "GET", headers: options.headers, signal: options.signal,
    }, response => {
      const chunks = [];
      response.on("data", chunk => chunks.push(chunk));
      response.on("error", reject);
      response.on("end", () => accept(new Response(Buffer.concat(chunks), { status: response.statusCode })));
    });
    request.on("error", reject);
    request.end(options.body);
  });
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

async function fixture(t, options = {}) {
  const readers = [], reports = [], started = deferred(), stopped = deferred();
  let hashReads = 0;
  const factories = [0, 1].map(index => onOutput => {
    if (index === options.failFactory) throw new Error("controlled reader creation failure");
    const completion = deferred();
    const reader = { completion: completion.promise, emit: onOutput, stops: 0, kills: 0,
      exit: () => completion.resolve(),
      kill() { this.kills++; completion.resolve(); },
      async stop() {
        this.stops++; completion.resolve();
        if (readers.every(value => value.stops > 0)) stopped.resolve();
        if (options.failStop) throw new Error("controlled reader stop failure");
      },
    };
    readers.push(reader);
    if (options.markers !== false) onOutput(Buffer.from('Filtering the log data using "owned filter"\n'));
    if (readers.length === 2) started.resolve();
    return reader;
  });
  const observer = await observeIosPreparations({ udid, readerFactories: factories, report: value => reports.push(value),
    appPath: options.appPath ?? "/owned/BibleOnSite.app", keepData: false,
    installer: options.installer ? request => options.installer(request, (phase, value) => call(phase, value)) : undefined,
    expectedBundleSha256: async signal => { hashReads++; return options.hash ? options.hash(signal) : hash; } });
  t.after(async () => { try { await observer.stop(); } catch {} });
  const identity = (overrides = {}) => ({ udid, nonce, bundleId: "com.tanah.daily929", bundleSha256: hash,
    deadlineMs: Date.now() + 5000, state: "Shutdown", ...overrides });
  const call = (phase, value, extra = {}) => requestIosPreparation(phase, value,
    { environment: observer.environment, ...extra });
  const install = async (value, overrides = {}, requestOptions = {}) => {
    const response = await fetch(`http://127.0.0.1:${observer.environment.MOBILE_IOS_PREPARATION_PORT}/prepare`, {
      method: "POST", ...requestOptions,
      headers: { authorization: `Bearer ${observer.environment.MOBILE_IOS_PREPARATION_TOKEN}`,
        "x-ios-preparation-deadline": String(value.deadlineMs) },
      body: JSON.stringify({ kind: "ios-install-request/1", phase: "install", udid: value.udid,
        nonce: value.nonce, deadlineMs: value.deadlineMs, keepData: false, ...overrides }),
    });
    if (response.status !== 200) throw new Error(`Installation rejected (${response.status})`);
    return response.json();
  };
  return { observer, readers, reports, started, stopped, identity, call, install, hashReads: () => hashReads };
}

async function verifiedInstaller(request, call) {
  const identity = { udid, nonce: request.nonce, deadlineMs: request.deadlineMs,
    bundleId: "com.tanah.daily929", bundleSha256: hash, state: "Shutdown" };
  await call("reserve", identity);
  await call("ready", { ...identity, state: "Booted" });
  return JSON.stringify({ kind: "ios-verified-install/1", udid, nonce: request.nonce,
    appPath: "/owned/BibleOnSite.app", bundleId: identity.bundleId, bundleSha256: hash,
    keepData: false, observerAcknowledged: true });
}

test("a bounded install request returns only a current hash-bound reader-acknowledged receipt", async t => {
  const f = await fixture(t, { installer: verifiedInstaller });
  const value = f.identity();
  const receipt = await f.install(value);
  assert.equal(receipt.nonce, value.nonce);
  assert.equal(receipt.bundleSha256, hash);
  assert.equal(f.readers.length, 2);
  await assert.rejects(f.install(value), /rejected \(409\)/);
});

test("absolute overrides with dot segments share the helper's receipt identity without resolving symlink aliases", async t => {
  const raw = `${resolve("/requested-alias/app/mobile-e2e")}/../BibleOnSite.app`;
  const selected = resolveMobileAppPath(resolve("/checkout/app/mobile-e2e"), "ios", raw);
  assert.equal(selected, resolve("/requested-alias/app/BibleOnSite.app"));
  assert.notEqual(selected, raw);
  const f = await fixture(t, { appPath: selected, installer: async (...args) =>
    JSON.stringify({ ...JSON.parse(await verifiedInstaller(...args)), appPath: resolve(raw) }) });
  assert.equal((await f.install(f.identity())).appPath, selected);
});

test("installation endpoint never accepts paths, commands, modes or another device", async t => {
  let launches = 0;
  const f = await fixture(t, { installer: (...args) => { launches++; return verifiedInstaller(...args); } });
  for (const override of [{ appPath: "/another/app" }, { command: "untrusted" }, { keepData: true },
    { udid: "00000000-0000-4000-A000-000000000000" }, { nonce: "invalid" }]) {
    await assert.rejects(f.install(f.identity(), override), /rejected \(400\)/);
  }
  assert.equal(launches, 0);
  await assert.rejects(f.call("reserve", f.identity()), /rejected \(409\)/);
  await f.install(f.identity());
  assert.equal(launches, 1);
});

test("overlapping install requests cannot launch a second helper", async t => {
  const entered = deferred(), release = deferred();
  let launches = 0;
  const f = await fixture(t, { installer: async (...args) => {
    launches++; entered.resolve(); await release.promise; return verifiedInstaller(...args);
  } });
  const first = f.install(f.identity());
  await entered.promise;
  await assert.rejects(f.install(f.identity({ nonce: nextNonce })), /rejected \(409\)/);
  release.resolve();
  await first;
  assert.equal(launches, 1);
});

test("missing reader acknowledgement and mismatched receipts latch without another launch", async t => {
  for (const change of [{ nonce: nextNonce }, { appPath: "/another/app" }, { bundleSha256: "d".repeat(64) },
    { observerAcknowledged: false }, { keepData: true }, "omit-ack"]) {
    let launches = 0;
    const f = await fixture(t, { installer: async (...args) => {
      launches++;
      if (change === "omit-ack") return "{}";
      return JSON.stringify({ ...JSON.parse(await verifiedInstaller(...args)), ...change });
    } });
    await assert.rejects(f.install(f.identity()), /rejected \(500\)/);
    await assert.rejects(f.install(f.identity({ nonce: nextNonce })), /rejected \(500\)/);
    assert.equal(launches, 1);
  }
});

test("client cancellation joins installer cleanup before the observer can stop", { timeout: 5000 }, async t => {
  const entered = deferred(), aborted = deferred(), release = deferred();
  const client = new AbortController();
  const f = await fixture(t, { installer: async ({ signal }) => {
    entered.resolve();
    await new Promise(resolve => signal.addEventListener("abort", () => { aborted.resolve(); resolve(); }, { once: true }));
    await release.promise;
    throw signal.reason;
  } });
  const pending = f.install(f.identity(), {}, { signal: client.signal });
  const rejected = assert.rejects(pending);
  await entered.promise;
  client.abort();
  await rejected;
  await aborted.promise;
  let stopped = false;
  const stopping = f.observer.stop().then(() => { stopped = true; });
  await tick();
  assert.equal(stopped, false);
  release.resolve();
  await stopping;
  assert.equal(stopped, true);
});

test("uncertain installer cleanup remains an explicit observer shutdown failure", async t => {
  const failure = Object.assign(new Error("controlled unresolved owned group"),
    { cleanupUncertain: true, processGroupId: 12345, joined: false });
  const f = await fixture(t, { installer: async () => { throw failure; } });
  await assert.rejects(f.install(f.identity()));
  await assert.rejects(f.observer.stop(), error => error instanceof AggregateError && error.errors.includes(failure));
});

test("one run reserves normal boot once and attaches both readers before acknowledging launch", async t => {
  const f = await fixture(t);
  const first = f.identity();
  assert.equal((await f.call("reserve", first)).transitionAllowed, true);
  assert.equal(f.readers.length, 0);
  await f.call("ready", { ...first, state: "Booted" });
  assert.equal(f.readers.length, 2);
  const next = f.identity({ nonce: nextNonce, state: "Booted" });
  assert.equal((await f.call("reserve", next)).transitionAllowed, false);
  await f.call("ready", next);
  assert.equal(f.readers.length, 2);
  assert.equal(f.hashReads(), 1);
  assert(!JSON.stringify(f.reports).includes(f.observer.environment.MOBILE_IOS_PREPARATION_TOKEN));
  await f.observer.stop();
  assert(f.readers.every(reader => reader.stops === 1));
});

test("reader spawn alone and one pipe's marker cannot acknowledge the session", async t => {
  const f = await fixture(t, { markers: false });
  const value = f.identity();
  await f.call("reserve", value);
  let accepted = false;
  const pending = f.call("ready", { ...value, state: "Booted" }).then(result => { accepted = true; return result; });
  await f.started.promise;
  await tick();
  assert.equal(accepted, false);
  f.readers[0].emit(Buffer.from("Filtering the log data using "));
  await tick();
  assert.equal(accepted, false);
  f.readers[1].emit(Buffer.from("Filtering the log data using "));
  await pending;
  assert.equal(accepted, true);
});

test("concurrent ready requests cannot share an acknowledgement while readers attach", async t => {
  const f = await fixture(t, { markers: false });
  const value = f.identity();
  await f.call("reserve", value);
  const pending = f.call("ready", { ...value, state: "Booted" });
  await f.started.promise;
  await assert.rejects(f.call("ready", { ...value, state: "Booted" }), /rejected \(409\)/);
  assert.equal(f.reports.filter(report => report.phase === "ready").length, 0);
  for (const reader of f.readers) reader.emit(Buffer.from("Filtering the log data using "));
  await pending;
  assert.equal(f.reports.filter(report => report.phase === "ready").length, 1);
  assert.equal(f.readers.length, 2);
});

test("fresh installer nonces cannot recover later Shutdown or Booting in the same run", async t => {
  const f = await fixture(t);
  const first = f.identity();
  await f.call("reserve", first);
  await f.call("ready", { ...first, state: "Booted" });
  for (const state of ["Shutdown", "Booting"]) {
    await assert.rejects(f.call("reserve", f.identity({ nonce: nextNonce, state })), /rejected \(409\)/);
  }
  assert.equal(f.readers.length, 2);
});

test("duplicate nonce, overlapping preparation and ready without a reservation are rejected", async t => {
  const f = await fixture(t);
  const value = f.identity();
  await assert.rejects(f.call("ready", { ...value, state: "Booted" }), /rejected \(409\)/);
  await f.call("reserve", value);
  await assert.rejects(f.call("reserve", f.identity({ nonce: nextNonce })), /rejected \(409\)/);
  await f.call("ready", { ...value, state: "Booted" });
  await assert.rejects(f.call("reserve", value), /rejected \(409\)/);
  await assert.rejects(f.call("ready", { ...value, state: "Booted" }), /rejected \(409\)/);
});

test("wrong device, bundle, state, token and route cannot reserve a transition", async t => {
  const f = await fixture(t);
  for (const overrides of [{ udid: "00000000-0000-4000-A000-000000000000" }, { bundleId: "com.other.app" },
    { nonce: "malformed" }, { state: "Shutting Down" }]) {
    await assert.rejects(f.call("reserve", f.identity(overrides)), /rejected \((400|409)\)/);
  }
  await assert.rejects(f.call("reserve", f.identity(), { environment: { ...f.observer.environment,
    MOBILE_IOS_PREPARATION_TOKEN: "0".repeat(64) } }), /rejected \(401\)/);
  assert.equal((await observerRequest(f.observer.environment, "/other")).status, 404);
  assert.equal((await observerRequest(f.observer.environment, "/prepare")).status, 404);
  assert.equal(f.readers.length, 0);
  assert.equal((await f.call("reserve", f.identity())).transitionAllowed, true);
});

test("a wrong source hash fails before boot permission and latches parent ownership", async t => {
  const f = await fixture(t);
  await assert.rejects(f.call("reserve", f.identity({ bundleSha256: "d".repeat(64) })), /rejected \(500\)/);
  await assert.rejects(f.call("reserve", f.identity({ nonce: nextNonce })), /rejected \(500\)/);
  assert.equal(f.readers.length, 0);
});

test("ready identity must match the reserved bundle, nonce and original deadline", async t => {
  for (const changed of [{ bundleSha256: "d".repeat(64) }, { nonce: nextNonce }, { deadlineMs: Date.now() + 4000 }]) {
    const f = await fixture(t);
    const value = f.identity();
    await f.call("reserve", value);
    await assert.rejects(f.call("ready", { ...value, state: "Booted", ...changed }), /rejected \(409\)/);
    assert.equal(f.readers.length, 0);
  }
});

test("partial reader creation failure joins the first reader and never retries attachment", async t => {
  const f = await fixture(t, { failFactory: 1 });
  const value = f.identity();
  await f.call("reserve", value);
  await assert.rejects(f.call("ready", { ...value, state: "Booted" }), /rejected \(500\)|fetch failed/);
  await f.observer.stop();
  assert.equal(f.readers.length, 1);
  assert.equal(f.readers[0].stops, 1);
});

test("loss of an original reader prevents acknowledgement for a later nonce", async t => {
  const f = await fixture(t);
  const value = f.identity();
  await f.call("reserve", value);
  await f.call("ready", { ...value, state: "Booted" });
  f.readers[0].exit();
  await tick();
  await assert.rejects(f.call("reserve", f.identity({ nonce: nextNonce, state: "Booted" })), /rejected \(500\)|fetch failed/);
  assert.equal(f.readers.length, 2);
});

test("the original deadline cancels reader startup and joins both owned readers", { timeout: 5000 }, async t => {
  const f = await fixture(t, { markers: false });
  const value = f.identity({ deadlineMs: Date.now() + 500 });
  await f.call("reserve", value);
  await assert.rejects(f.call("ready", { ...value, state: "Booted" }));
  await f.stopped.promise;
  await f.observer.stop();
  assert.equal(f.readers.length, 2);
  assert(f.readers.every(reader => reader.stops === 1));
});

test("client disconnection aborts the source verification and cannot obtain a boot reservation", async t => {
  const entered = deferred(), cancelled = deferred(), client = new AbortController();
  const f = await fixture(t, { hash: signal => new Promise((resolve, reject) => {
    entered.resolve();
    signal.addEventListener("abort", () => { cancelled.resolve(); reject(signal.reason); }, { once: true });
  }) });
  const pending = f.call("reserve", f.identity(), { request: (url, options) => {
    const port = f.observer.environment.MOBILE_IOS_PREPARATION_PORT;
    assert.equal(url, `http://127.0.0.1:${port}/prepare`);
    return observerRequest(f.observer.environment, "/prepare",
      { ...options, signal: AbortSignal.any([options.signal, client.signal]) });
  } });
  const rejected = assert.rejects(pending);
  await entered.promise;
  client.abort();
  await rejected;
  await cancelled.promise;
  await f.observer.stop();
  assert.equal(f.readers.length, 0);
});

test("stop closes the listener and joins every reader even when both disposals fail", async t => {
  const f = await fixture(t, { failStop: true });
  const value = f.identity();
  await f.call("reserve", value);
  await f.call("ready", { ...value, state: "Booted" });
  await assert.rejects(f.observer.stop(), AggregateError);
  assert(f.readers.every(reader => reader.stops === 1));
  await assert.rejects(f.call("reserve", f.identity({ nonce: nextNonce, state: "Booted" })));
});

test("real child log pipes must attach and are joined by their parent before cleanup", { timeout: 5000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), "ios-ready-readers-"));
  t.after(async () => { assert(!relative(tmpdir(), directory).startsWith("..")); await rm(directory, { recursive: true, force: true }); });
  const observer = await observeIosPreparations({ udid, expectedBundleSha256: async () => hash,
    readerFactories: [0, 1].map(index => onOutput => startNativeLog(process.execPath,
      ["-e", "process.stdout.write('Filtering the log data using controlled fixture\\n');setInterval(()=>{},1000)"],
      join(directory, `reader-${index}.log`), { onOutput })) });
  t.after(() => observer.stop());
  const value = { kind: "ios-preparation/1", udid, nonce, bundleId: "com.tanah.daily929", bundleSha256: hash,
    deadlineMs: Date.now() + 4000, state: "Shutdown" };
  const options = { environment: observer.environment };
  await requestIosPreparation("reserve", value, options);
  await requestIosPreparation("ready", { ...value, state: "Booted" }, options);
  await observer.stop();
  for (const index of [0, 1]) assert.match(await readFile(join(directory, `reader-${index}.log`), "utf8"), /Filtering the log data/);
});
