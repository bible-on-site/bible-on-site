import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));

/**
 * Runs `spawn` until `isComplete` reports the artifact landed, up to
 * `attempts` times, calling `reset` before each try. A stalled download
 * holds the socket until the child timeout fires, and a half-extracted
 * bundle would satisfy a directory check while missing its marker file —
 * so each attempt starts from a clean destination and `isComplete` is the
 * only honest completion signal.
 */
export function runUntilComplete(spawn, isComplete, reset, attempts = 3) {
  let failure;
  for (let attempt = 1; attempt <= attempts && !isComplete(); attempt++) {
    try {
      // A timed-out child keeps running briefly as an orphan, so `reset` can
      // itself fail on a directory the orphan is still writing — that is a
      // failed attempt, not a reason to abort the remaining retries.
      reset();
      spawn();
      failure = undefined;
    } catch (error) {
      failure = error;
      if (attempt < attempts) {
        console.warn(`download-wda attempt ${attempt} failed; retrying:`, error);
      }
    }
  }
  if (!isComplete()) {
    throw failure ?? new Error("the work never completed");
  }
}

export function prepareWda() {
  // Appium's downloader selects the agent version bundled with our locked driver.
  const metadata = JSON.parse(readFileSync(resolve(directory,
    "node_modules/appium-xcuitest-driver/node_modules/appium-webdriveragent/package.json"), "utf8"));
  const cache = resolve(directory, "../.artifacts/mobile-wda");
  const destination = resolve(cache, `${metadata.version}-${process.arch}`);
  const app = resolve(destination, "WebDriverAgentRunner-Runner.app");
  const marker = resolve(app, "Info.plist");
  mkdirSync(cache, { recursive: true });
  runUntilComplete(
    () => execFileSync(process.execPath, [resolve(directory, "node_modules/appium/index.js"),
      "driver", "run", "xcuitest", "download-wda", "--", `--outdir=${destination}`,
      "--kind=sim", "--platform=iOS"], { cwd: directory, stdio: "inherit", timeout: 300000, windowsHide: true }),
    () => existsSync(marker),
    // Bounded rm retries bridge the window where a timed-out child is still
    // finishing/cleaning its half-extraction (ENOTEMPTY while it writes —
    // observed ~3s on the iOS shards). Linear backoff caps this at ~11s per
    // reset; beyond that the attempt fails honestly instead of stalling.
    () => rmSync(destination, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  if (!existsSync(marker)) {
    throw new Error(`The prebuilt iOS simulator agent is missing: ${app}`);
  }
  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const app = prepareWda();
  if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, `MOBILE_WDA_PATH=${app}\n`);
  console.log(`MOBILE_WDA_PATH=${app}`);
}
