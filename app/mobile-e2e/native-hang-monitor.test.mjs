import assert from 'node:assert/strict';
import { test } from 'node:test';
import { monitorNativeInteractions } from './native-hang-monitor.mjs';

function fixture() {
  const callbacks = new Map();
  const captures = [];
  const monitor = monitorNativeInteractions(command => captures.push(command), {
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

test('samples the first blocked interaction before cleanup, only once', async () => {
  const f = fixture();
  f.monitor.write('[HTTP] --> GET /session/id/ele');
  f.monitor.write('ment/cell/rect \n');
  f.trigger();
  f.monitor.write('[HTTP] --> GET /session/id/source \n');
  f.trigger();
  await f.monitor.stop();
  assert.deepEqual(f.captures, ['GET /session/id/element/cell/rect']);
});

test('stopping cancels pending sampling', async () => {
  const f = fixture();
  f.monitor.write('[HTTP] --> GET /session/id/source \n');
  await f.monitor.stop();
  f.trigger();
  assert.deepEqual(f.captures, []);
});

test('stopping waits for a capture already in flight', async () => {
  let trigger;
  let release;
  const capture = new Promise(resolve => { release = resolve; });
  const monitor = monitorNativeInteractions(() => capture, {
    schedule(callback) { trigger = callback; }, cancel() {},
  });
  monitor.write('[HTTP] --> GET /session/id/source \n');
  trigger();
  let stopped = false;
  const completion = monitor.stop().then(() => { stopped = true; });
  await Promise.resolve();
  assert.equal(stopped, false);
  release();
  await completion;
  assert.equal(stopped, true);
});

test('reports capture failures during cleanup without an unhandled rejection', async () => {
  let trigger;
  const monitor = monitorNativeInteractions(async () => { throw new Error('capture failed'); }, {
    schedule(callback) { trigger = callback; }, cancel() {},
  });
  monitor.write('[HTTP] --> GET /session/id/source \n');
  trigger();
  await assert.rejects(monitor.stop(), /capture failed/);
});
