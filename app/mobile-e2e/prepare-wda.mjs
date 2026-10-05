import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));

export function prepareWda() {
  // Appium's downloader selects the agent version bundled with our locked driver.
  const metadata = JSON.parse(readFileSync(resolve(directory,
    "node_modules/appium-xcuitest-driver/node_modules/appium-webdriveragent/package.json"), "utf8"));
  const cache = resolve(directory, "../.artifacts/mobile-wda");
  const destination = resolve(cache, `${metadata.version}-${process.arch}`);
  const app = resolve(destination, "WebDriverAgentRunner-Runner.app");
  mkdirSync(cache, { recursive: true });
  if (!existsSync(app)) {
    execFileSync(process.execPath, [resolve(directory, "node_modules/appium/index.js"),
      "driver", "run", "xcuitest", "download-wda", "--", `--outdir=${destination}`,
      "--kind=sim", "--platform=iOS"], { cwd: directory, stdio: "inherit", timeout: 300000, windowsHide: true });
  }
  if (!existsSync(resolve(app, "Info.plist"))) {
    throw new Error(`The prebuilt iOS simulator agent is missing: ${app}`);
  }
  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const app = prepareWda();
  if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, `MOBILE_WDA_PATH=${app}\n`);
  console.log(`MOBILE_WDA_PATH=${app}`);
}
