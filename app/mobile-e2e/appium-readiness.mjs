import { get } from "node:http";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";

// A cold XCUITest server has taken over three minutes to load on CI. Keep
// startup bounded independently of the one-second individual HTTP probes.
export async function waitForAppiumReadiness({ timeout = 300000, observe = () => {},
  exited = () => undefined, probe = probeAppiumReadiness, now = () => performance.now(), wait = delay } = {}) {
  const deadline = now() + timeout;
  while (now() < deadline) {
    const remaining = deadline - now();
    if (remaining <= 0) return false;
    const exit = exited();
    if (exit) throw new Error(`Appium exited (${exit}).`);
    const ready = await probe({ timeout: Math.min(1000, remaining), observe });
    if (ready) return now() < deadline;
    await wait(Math.max(0, Math.min(250, deadline - now())));
  }
  return false;
}

// Keep the same readiness predicate and network deadline while preserving the
// response/error that explains why an owned server could not become ready.
export function probeAppiumReadiness({ port = 4723, timeout = 1000, observe = () => {} } = {}) {
  return new Promise((resolveReady, reject) => {
    const request = get({ hostname: "127.0.0.1", port, path: "/status", timeout }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("error", reject);
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => {
        try {
          const ready = response.statusCode === 200 && JSON.parse(body).value?.ready === true;
          observe({ status: response.statusCode, ready, body: body.slice(0, 4096) });
          resolveReady(ready);
        } catch (error) {
          observe({ status: response.statusCode, error: String(error), body: body.slice(0, 4096) });
          reject(error);
        }
      });
    });
    request.on("timeout", () => request.destroy(Object.assign(new Error("Appium readiness timed out"), { code: "ETIMEDOUT" })));
    request.on("error", (error) => {
      observe({ code: error.code, error: String(error) });
      if (["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT"].includes(error.code)) {
        resolveReady(false);
      } else {
        reject(error);
      }
    });
  });
}
