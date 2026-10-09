import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { probeAppiumReadiness } from "./appium-readiness.mjs";

async function serve(t, handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  return server.address().port;
}

test("accepts only an HTTP 200 response with boolean readiness, preserving the response", async (t) => {
  const observations = [];
  const port = await serve(t, (request, response) => {
    assert.equal(request.url, "/status");
    response.end(JSON.stringify({ value: { ready: true, build: { version: "3.8.0" } } }));
  });
  assert.equal(await probeAppiumReadiness({ port, observe: (value) => observations.push(value) }), true);
  assert.equal(observations[0].status, 200);
  assert.equal(JSON.parse(observations[0].body).value.build.version, "3.8.0");
});

test("does not accept a string readiness value", async (t) => {
  const port = await serve(t, (_request, response) => response.end('{"value":{"ready":"true"}}'));
  assert.equal(await probeAppiumReadiness({ port }), false);
});

test("records a non-200 status and body without accepting it as ready", async (t) => {
  const observations = [];
  const port = await serve(t, (_request, response) => { response.writeHead(503); response.end("not ready"); });
  assert.equal(await probeAppiumReadiness({ port, observe: (value) => observations.push(value) }), false);
  assert.deepEqual(observations, [{ status: 503, ready: false, body: "not ready" }]);
});

test("keeps malformed successful responses fatal and records their original body", async (t) => {
  const observations = [];
  const port = await serve(t, (_request, response) => response.end('{"value":'));
  await assert.rejects(probeAppiumReadiness({ port, observe: (value) => observations.push(value) }), SyntaxError);
  assert.equal(observations[0].body, '{"value":');
});

test("records connection resets while waiting for a server to finish loading", async (t) => {
  const observations = [];
  const port = await serve(t, (request) => request.socket.destroy());
  assert.equal(await probeAppiumReadiness({ port, observe: (value) => observations.push(value) }), false);
  assert.equal(observations[0].code, "ECONNRESET");
});

test("bounds an unresponsive endpoint and preserves the timeout error", async (t) => {
  const observations = [];
  const port = await serve(t, () => {});
  assert.equal(await probeAppiumReadiness({ port, timeout: 100, observe: (value) => observations.push(value) }), false);
  assert.equal(observations[0].code, "ETIMEDOUT");
});
