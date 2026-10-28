import { watch as watchDirectory } from "node:fs";
import { lstat, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const REQUEST_SUFFIX = ".request.json";
const CAPTURE_LIMIT_MS = 15000;
class ScenarioDeadlineError extends Error {}

function requestId(name) {
  if (name.length !== 32 + REQUEST_SUFFIX.length || !name.endsWith(REQUEST_SUFFIX)) return;
  const id = name.slice(0, 32);
  for (const character of id) {
    const code = character.charCodeAt(0);
    if (!(code >= 48 && code <= 57) && !(code >= 97 && code <= 102)) return;
  }
  return id;
}

function containsControlCharacter(value) {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

function validSessionId(value) {
  if (typeof value !== "string" || value.length < 1 || value.length > 128) return false;
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code !== 45 && !(code >= 48 && code <= 57) && !(code >= 65 && code <= 90) && !(code >= 97 && code <= 122)) return false;
  }
  return true;
}

function utcInstant(value) {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,7})?(?:Z|\+00:00)$/.test(value)) return NaN;
  const instant = Date.parse(value);
  return Number.isFinite(instant) && new Date(instant).toISOString().slice(0, 19) === value.slice(0, 19) ? instant : NaN;
}

function validateRequest(request, id, now) {
  const failed = utcInstant(request?.failedAtUtc);
  const deadline = utcInstant(request?.deadlineUtc);
  if (request?.id !== id || typeof request.test !== "string" || !request.test.trim() ||
    request.test.length > 2048 || containsControlCharacter(request.test) ||
    !(request.sessionId === null || validSessionId(request.sessionId)) ||
    !Number.isFinite(failed) || !Number.isFinite(deadline) || failed > now ||
    deadline <= failed || deadline - failed > CAPTURE_LIMIT_MS) {
    throw new Error(`Invalid scenario failure request: ${id}`);
  }
  return deadline;
}

function beforeDeadline(operation, deadline, now) {
  return new Promise((resolveResult, reject) => {
    const remaining = deadline - now();
    if (remaining <= 0) { reject(new ScenarioDeadlineError("Scenario diagnostics deadline expired")); return; }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const error = new ScenarioDeadlineError("Scenario diagnostics deadline expired");
      controller.abort(error);
      reject(error);
    }, remaining);
    // Both handlers stay attached even if the deadline wins: late capture
    // failures must never become unhandled promise rejections.
    Promise.resolve().then(() => operation({ signal: controller.signal })).then(
      value => { clearTimeout(timer); resolveResult(value); },
      error => { clearTimeout(timer); reject(error); },
    );
  });
}

/** Observe atomic C# failure requests without polling or creating a driver session. */
export function watchScenarioFailures(directory, capture, {
  watch = watchDirectory, now = Date.now, observe = () => {},
} = {}) {
  const root = resolve(directory);
  const seen = new Set();
  const received = new Set();
  const pending = new Map();
  const scans = new Map();
  const failures = [];
  let stopped = false;
  let stopResult;

  async function acknowledge(id, result) {
    const temporary = join(root, `${id}.ack.json.tmp-${process.pid}`);
    await writeFile(temporary, JSON.stringify({ ...result, id }), { flag: "wx" });
    await rename(temporary, join(root, `${id}.ack.json`));
    return { id, status: result.status };
  }

  async function processRequest(name, id, record) {
    const path = resolve(root, name);
    if (dirname(path) !== root) throw new Error("Scenario request escapes its directory");
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 16384) throw new Error(`Invalid scenario request file: ${name}`);
    const request = JSON.parse(await readFile(path, "utf8"));
    record.deadline = Math.min(record.deadline, validateRequest(request, id, now()));
    try {
      const ack = await lstat(join(root, `${id}.ack.json`));
      if (!ack.isFile() || ack.isSymbolicLink()) throw new Error(`Invalid scenario acknowledgement: ${id}`);
      return;
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    if (record.deadline <= now()) return acknowledge(id, { status: "expired" });
    if (request.sessionId === null) return acknowledge(id, { status: "unknown" });
    let result;
    try {
      result = await beforeDeadline(options => capture(request, options), record.deadline, now);
      if (!result || !["captured", "exited", "unknown", "expired", "error"].includes(result.status)) throw new Error("Invalid scenario capture result");
      if (result.status === "error") failures.push(new Error(String(result.error?.message ?? result.error ?? "Scenario capture failed")));
    } catch (error) {
      failures.push(error);
      // Aborting requests cancellation; it does not prove native sampling has
      // stopped. Leave the ack absent on our deadline. C# has the same fixed
      // deadline and releases the failed test itself, without a premature ack.
      if (error instanceof ScenarioDeadlineError) return;
      result = { status: "error", error: String(error?.message ?? error) };
    }
    return acknowledge(id, result);
  }

  function enqueue(filename, queuedDeadline) {
    if (stopped && queuedDeadline === undefined) return;
    const name = filename.toString();
    if (name.endsWith(REQUEST_SUFFIX)) received.add(name);
    const id = requestId(name);
    if (!id) {
      if (name.endsWith(REQUEST_SUFFIX)) failures.push(new Error(`Invalid scenario request filename: ${name}`));
      return;
    }
    if (seen.has(id)) return;
    seen.add(id);
    const record = { deadline: queuedDeadline ?? now() + CAPTURE_LIMIT_MS };
    const task = (async () => {
      let acknowledgement;
      try { acknowledgement = await processRequest(name, id, record); }
      catch (error) { failures.push(error); }
      finally { pending.delete(task); }
      if (acknowledgement) {
        try { observe(acknowledgement); }
        catch (error) { failures.push(error); }
      }
    })();
    pending.set(task, record);
  }

  function scan(receiptsOnly = false) {
    const deadline = now() + CAPTURE_LIMIT_MS;
    const task = readdir(root).then(names => {
      for (const name of names) {
        if (receiptsOnly) {
          if (name.endsWith(REQUEST_SUFFIX)) received.add(name);
        } else enqueue(name, deadline);
      }
    })
      .catch(error => { failures.push(error); }).finally(() => { scans.delete(task); });
    scans.set(task, deadline);
    return task;
  }

  // Install the watcher first so an atomic rename cannot fall between the
  // startup scan and subscription. A missing filename triggers a single scan.
  const watcher = watch(root, (_event, filename) => {
    if (filename == null) { if (!stopped) void scan(); }
    else enqueue(filename);
  });
  watcher.on("error", error => { failures.push(error); });
  void scan();
  return {
    get received() { return received.size; },
    stop() {
      if (stopResult) return stopResult;
      stopped = true;
      watcher.close();
      // fs.watch is advisory. After the producer exits, count any published
      // receipt whose notification was lost without starting late sampling.
      void scan(true);
      const deadline = Math.max(now(), ...scans.values(),
        ...Array.from(pending.values(), record => record.deadline));
      // A directory observation queued before stop may still discover a
      // request. Drain those scans before taking the final work snapshot.
      const completion = (async () => {
        await Promise.allSettled([...scans.keys()]);
        await Promise.allSettled([...pending.keys()]);
      })();
      stopResult = (async () => {
        if (pending.size || scans.size) {
          try { await beforeDeadline(() => completion, deadline, now); }
          catch (error) { failures.push(error); }
        }
        if (failures.length) throw new AggregateError(failures, "Scenario failure diagnostics failed");
      })();
      return stopResult;
    },
  };
}
