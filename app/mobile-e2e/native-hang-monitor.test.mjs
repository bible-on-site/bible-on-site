import assert from 'node:assert/strict';
import { test } from 'node:test';
import { monitorNativeInteractions } from './native-hang-monitor.mjs';

function fixture(capture) {
  const callbacks = new Map();
  const captures = [];
  const monitor = monitorNativeInteractions(capture ?? ((command, info) => captures.push({ command, info })), {
    schedule(callback) { const id = Symbol(); callbacks.set(id, callback); return id; },
    cancel(id) { callbacks.delete(id); },
  });
  return { monitor, captures, callbacks, trigger() { for (const callback of [...callbacks.values()]) callback(); } };
}

test('completed interactions and cold session creation do not sample a healthy app', async () => {
  const f = fixture();
  f.monitor.write('[HTTP] --> POST /session {}\n');
  f.monitor.write('[HTTP] --> GET /session/id/element/cell/rect \n');
  f.monitor.write('[HTTP] <-- GET /session/id/element/cell/rect 200 10 ms\n');
  f.trigger();
  await f.monitor.stop();
  assert.deepEqual(f.captures, []);
});

test('a completed slow calendar request does not consume the later preferences capture', async () => {
  const f = fixture();
  f.monitor.write('[HTTP] --> POST /session/id/ele');
  f.monitor.write('ments {"value":"CalendarYear"}\n');
  f.trigger();
  await Promise.resolve();
  f.monitor.write('[HTTP] <-- POST /session/id/elements 200 35000 ms\n');
  f.monitor.write('[HTTP] --> POST /session/id/elements {"value":"SettingsDisplayRow"}\n');
  f.trigger();
  await f.monitor.stop();
  assert.equal(f.captures.length, 2);
  assert.deepEqual(f.captures.map(x => x.info.sequence), [1, 2]);
  assert.equal(f.captures[0].info.status, 200);
  assert.equal(f.captures[0].info.request, '{"value":"CalendarYear"}');
  assert.equal(f.captures[1].info.request, '{"value":"SettingsDisplayRow"}');
  assert.equal(f.captures[1].info.sessionId, 'id');
});

test('a stale timer cannot capture a completed generation of the same route', async () => {
  const f = fixture();
  f.monitor.write('[HTTP] --> GET /session/id/source \n');
  const stale = [...f.callbacks.values()][0];
  f.monitor.write('[HTTP] <-- GET /session/id/source 200 10 ms\n');
  f.monitor.write('[HTTP] --> GET /session/id/source \n');
  stale();
  f.trigger();
  f.trigger();
  await f.monitor.stop();
  assert.deepEqual(f.captures.map(x => x.info.sequence), [2]);
});

test('same-route responses cancel only the matching oldest pending request', async () => {
  const f = fixture();
  f.monitor.write('[HTTP] --> POST /session/id/elements {"value":"first"}\n');
  const first = [...f.callbacks.values()][0];
  f.monitor.write('[HTTP] --> POST /session/id/elements {"value":"second"}\n');
  f.monitor.write('[HTTP] <-- POST /session/id/elements 200 10 ms\n');
  first();
  f.trigger();
  await Promise.resolve();
  f.monitor.write('[HTTP] <-- POST /session/id/elements 500 120000 ms\n');
  await f.monitor.stop();
  assert.deepEqual(f.captures.map(x => x.info.sequence), [2]);
  assert.equal(f.captures[0].info.status, 500);
  assert.equal(f.captures[0].info.pending, false);
});

test('stopping cancels pending captures and ignores later output', async () => {
  const f = fixture();
  f.monitor.write('[HTTP] --> GET /session/id/source \n');
  const stale = [...f.callbacks.values()][0];
  await f.monitor.stop();
  stale();
  f.monitor.write('[HTTP] --> GET /session/id/source \n');
  f.trigger();
  assert.deepEqual(f.captures, []);
  assert.equal(f.callbacks.size, 0);
});

test('stopping waits for every capture already in flight', async () => {
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  const f = fixture(() => waiting);
  f.monitor.write('[HTTP] --> GET /session/id/source \n');
  f.trigger();
  let stopped = false;
  const completion = f.monitor.stop().then(() => { stopped = true; });
  await Promise.resolve();
  assert.equal(stopped, false);
  release();
  await completion;
  assert.equal(stopped, true);
});

test('capture failures are retained while later interactions remain observable', async () => {
  const f = fixture(async () => { throw new Error('capture failed'); });
  f.monitor.write('[HTTP] --> GET /session/id/source \n');
  f.trigger();
  await Promise.resolve();
  f.monitor.write('[HTTP] <-- GET /session/id/source 200 35000 ms\n');
  f.monitor.write('[HTTP] --> POST /session/id/elements {}\n');
  f.trigger();
  await assert.rejects(f.monitor.stop(), /capture failed/);
  assert.equal(f.callbacks.size, 0);
});
