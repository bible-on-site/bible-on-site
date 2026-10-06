import { get } from "node:http";

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
