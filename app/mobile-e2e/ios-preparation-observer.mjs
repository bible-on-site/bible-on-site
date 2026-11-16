import assert from "node:assert/strict";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { stopNativeLogStreams } from "./native-logs.mjs";
import { observeIosHostLog } from "./verify-ios-host-log.mjs";

const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const noncePattern = /^[0-9a-f]{32}$/i;
const keys = new Set(["kind", "phase", "udid", "nonce", "bundleId", "bundleSha256", "deadlineMs", "state"]);

// One parent owns the run's normal simulator transition and device readers.
// A later lost simulator cannot obtain another boot by creating a fresh child.
export async function observeIosPreparations({ udid, expectedBundleSha256, readerFactories, report = () => {} }) {
  assert(uuid.test(udid ?? ""), "An exact simulator UUID is required.");
  assert.equal(typeof expectedBundleSha256, "function");
  assert(Array.isArray(readerFactories) && readerFactories.length > 0);
  const token = randomBytes(32).toString("hex");
  const readers = [], sockets = new Set(), seen = new Set(), handlers = new Set();
  const lifetime = new AbortController();
  const readerState = observeIosHostLog(udid, { startupSources: readerFactories.map((_, index) => String(index)) });
  let closing = false, failure, stopped, readerStop, startup, bundleHash, claimed = false, reserved;
  const killFailures = [];
  const stopReaders = () => readerStop ??= stopNativeLogStreams(readers);
  const reply = (response, status, value) => {
    if (!response.destroyed) response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(value));
  };
  const attachReaders = signal => startup ??= (async () => {
    try {
      signal.throwIfAborted();
      for (const [index, factory] of readerFactories.entries()) {
        const reader = factory(chunk => readerState.write(chunk, String(index)));
        readers.push(reader);
        reader.completion.then(() => {
          if (!closing) { failure ??= new Error("An owned iOS reader exited."); lifetime.abort(failure); }
        }, error => { failure ??= error; lifetime.abort(failure); });
      }
      // Both pipes share this one reader cap and the original session deadline.
      await readerState.waitFor("startup", AbortSignal.any([signal, AbortSignal.timeout(45000)]));
      signal.throwIfAborted();
      if (failure) throw failure;
    } catch (error) { failure ??= error; await stopReaders(); throw error; }
  })();

  const handle = async (request, response) => {
    const supplied = request.headers.authorization;
    if (closing || request.method !== "POST" || request.url !== "/prepare") return reply(response, 404, { error: "NOT_FOUND" });
    if (typeof supplied !== "string" || !/^Bearer [0-9a-f]{64}$/.test(supplied) ||
      !timingSafeEqual(Buffer.from(supplied), Buffer.from(`Bearer ${token}`))) return reply(response, 401, { error: "UNAUTHORIZED" });
    const deadline = Number(request.headers["x-ios-preparation-deadline"]);
    const remaining = deadline - Date.now();
    if (!Number.isFinite(deadline) || remaining <= 0 || remaining > 300000) return reply(response, 400, { error: "INVALID_DEADLINE" });
    const disconnected = new AbortController();
    const cancelled = () => { if (!response.writableFinished) disconnected.abort(new Error("Installer disconnected before acknowledgement.")); };
    const elapsed = setTimeout(() => disconnected.abort(new Error("Original preparation deadline expired.")), remaining);
    const signal = AbortSignal.any([lifetime.signal, disconnected.signal]);
    const abortRequest = () => request.destroy(signal.reason);
    signal.addEventListener("abort", abortRequest, { once: true });
    response.once("close", cancelled);
    request.setTimeout(remaining, () => request.destroy());
    try {
      const chunks = []; let bytes = 0;
      for await (const chunk of request) {
        bytes += chunk.length;
        if (bytes > 2048) { reply(response, 413, { error: "TOO_LARGE" }); return; }
        chunks.push(chunk);
      }
      const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !keys.has(key)) ||
        value.kind !== "ios-preparation/1" || !["reserve", "ready"].includes(value.phase) || value.udid !== udid ||
        value.bundleId !== "com.tanah.daily929" || !noncePattern.test(value.nonce ?? "") ||
        !/^[0-9a-f]{64}$/.test(value.bundleSha256 ?? "") || value.deadlineMs !== deadline) {
        return reply(response, 400, { error: "INVALID_IDENTITY" });
      }
      signal.throwIfAborted();
      if (failure) throw failure;
      if (value.phase === "reserve") {
        if (reserved || seen.has(value.nonce) || !["Shutdown", "Booting", "Booted"].includes(value.state) ||
          (claimed && value.state !== "Booted")) return reply(response, 409, { error: "TRANSITION_NOT_AVAILABLE" });
        seen.add(value.nonce);
        const transitionAllowed = !claimed;
        claimed = true;
        reserved = { nonce: value.nonce, deadline, hash: value.bundleSha256 };
        bundleHash ??= await expectedBundleSha256(signal);
        signal.throwIfAborted();
        if (bundleHash !== value.bundleSha256) throw new Error("Installer bundle differs from the parent's exact source.");
        report({ phase: "reserved", udid, nonce: value.nonce, state: value.state, transitionAllowed, at: new Date().toISOString() });
        return reply(response, 200, { kind: "ios-preparation-reservation/1", udid, nonce: value.nonce, transitionAllowed });
      }
      if (!reserved || reserved.ready || reserved.nonce !== value.nonce || reserved.hash !== value.bundleSha256 ||
        reserved.deadline !== deadline || value.state !== "Booted") return reply(response, 409, { error: "NO_CURRENT_RESERVATION" });
      // Consume synchronously: a second request cannot share an in-flight ACK.
      reserved.ready = true;
      await attachReaders(signal);
      signal.throwIfAborted();
      if (failure) throw failure;
      reserved = undefined;
      report({ phase: "ready", udid, nonce: value.nonce, bundleSha256: bundleHash, at: new Date().toISOString() });
      reply(response, 200, { kind: "ios-preparation-ack/1", udid, nonce: value.nonce });
    } catch (error) {
      failure ??= error;
      // Aborted startup must join its owned readers before a later phase can run.
      if (startup) { try { await startup; } catch {} }
      reply(response, 500, { error: "PREPARATION_OBSERVER_FAILED" });
    } finally {
      clearTimeout(elapsed);
      response.removeListener("close", cancelled);
      signal.removeEventListener("abort", abortRequest);
      request.setTimeout(0);
    }
  };
  const server = createServer((request, response) => {
    const task = handle(request, response);
    handlers.add(task);
    task.finally(() => handlers.delete(task)).catch(() => {});
  });
  server.on("connection", socket => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const closed = new Promise(resolve => server.once("close", resolve));
  const kill = () => {
    if (!closing) { closing = true; lifetime.abort(new Error("Parent observer stopped.")); server.close(); }
    for (const socket of sockets) socket.destroy();
    for (const reader of readers) {
      try { reader.kill(); } catch (error) { killFailures.push(error); }
    }
  };
  return {
    environment: { MOBILE_IOS_PREPARATION_PORT: String(server.address().port), MOBILE_IOS_PREPARATION_TOKEN: token },
    kill,
    stop() {
      return stopped ??= (async () => {
        kill();
        const joined = await Promise.allSettled([closed, ...handlers, stopReaders()]);
        const errors = [...killFailures, ...joined.filter(result => result.status === "rejected").map(result => result.reason)];
        if (errors.length) throw new AggregateError(errors, "Could not stop owned iOS preparation observers.");
      })();
    },
  };
}
