// Observe the first command still pending at the pre-deadline threshold.
// The caller captures a live frame without attaching to a potentially healthy app.
export function monitorNativeInteractions(capture, {
  schedule = (callback) => setTimeout(callback, 25000), cancel = clearTimeout,
} = {}) {
  let partial = '';
  const pending = new Map();
  let captured = false;
  let stopped = false;
  let completion = Promise.resolve();
  let failure;
  function line(value) {
    const match = value.match(/\[HTTP\] (-->|<--) (GET|POST|DELETE|PUT|PATCH) (\/session\/[^ ]+)/);
    if (!match) return;
    const [, direction, method, route] = match;
    const key = method + ' ' + route;
    if (pending.has(key)) { cancel(pending.get(key)); pending.delete(key); }
    if (direction !== '-->' || captured || stopped) return;
    pending.set(key, schedule(() => {
      if (stopped || captured) return;
      captured = true;
      for (const timer of pending.values()) cancel(timer);
      pending.clear();
      completion = Promise.resolve().then(() => capture(key)).catch(error => { failure = error; });
    }));
  }
  return {
    write(chunk) {
      if (stopped || captured) return;
      const lines = (partial + chunk.toString()).split('\n');
      partial = lines.pop();
      for (const value of lines) line(value);
    },
    async stop() {
      stopped = true;
      for (const timer of pending.values()) cancel(timer);
      pending.clear();
      await completion;
      if (failure) throw failure;
    },
  };
}
