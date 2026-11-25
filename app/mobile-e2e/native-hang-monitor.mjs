// Observe each distinct request that remains pending for the existing 25 seconds.
// A completed slow request must not consume evidence for a later failing test.
// Every issued request still gets its passive app identity pinned at issue
// time: a request that faults inside milliseconds never reaches the capture
// threshold, yet it is the command the failed scenario last sent.
export function monitorNativeInteractions(capture, {
  schedule = (callback) => setTimeout(callback, 25000), cancel = clearTimeout,
  now = () => new Date().toISOString(), pin = () => {},
} = {}) {
  let partial = '';
  const pending = new Map();
  const captures = new Set();
  let sequence = 0;
  let stopped = false;
  let failure;
  function line(value) {
    const match = value.trimEnd().match(/\[HTTP\] (-->|<--) (GET|POST|DELETE|PUT|PATCH) (\/session\/[^ ]+)(?: (.*))?$/);
    if (!match || stopped) return;
    const [, direction, method, route, detail = ''] = match;
    const key = method + ' ' + route;
    if (direction === '<--') {
      const requests = pending.get(key);
      const request = requests?.shift();
      if (!request) return;
      if (requests.length === 0) pending.delete(key);
      cancel(request.timer);
      request.info.pending = false;
      request.info.completedAt = now();
      const status = detail.match(/^(\d{3})(?:\s|$)/);
      request.info.status = status ? Number(status[1]) : null;
      return;
    }
    const info = {
      sequence: ++sequence, command: key, request: detail,
      sessionId: route.split('/')[2], startedAt: now(), pending: true,
    };
    try { pin(info); }
    catch (error) { failure ??= error; }
    const request = { info, timer: undefined };
    const requests = pending.get(key) ?? [];
    requests.push(request);
    pending.set(key, requests);
    request.timer = schedule(() => {
      if (stopped || !info.pending || info.capturedAt) return;
      cancel(request.timer);
      info.capturedAt = now();
      // Completion can update the live request before the queued capture runs.
      Object.defineProperty(info, 'capturedWhilePending', { value: true, enumerable: true });
      const completion = Promise.resolve().then(() => capture(key, info))
        .catch(error => { failure ??= error; })
        .finally(() => captures.delete(completion));
      captures.add(completion);
    });
  }
  return {
    write(chunk) {
      if (stopped) return;
      const lines = (partial + chunk.toString()).split('\n');
      partial = lines.pop();
      for (const value of lines) line(value);
    },
    async stop() {
      stopped = true;
      for (const requests of pending.values()) {
        for (const request of requests) {
          cancel(request.timer);
          request.info.pending = false;
        }
      }
      pending.clear();
      await Promise.all(captures);
      if (failure) throw failure;
    },
  };
}
