// Keep the Pixel 7's logical layout while reducing software-rendered pixels.
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function configureDisplay(config, width = 540, height = 1200, density = 210) {
  if (![width, height, density].every(value => Number.isInteger(value) && value > 0)) {
    throw new Error("AVD display dimensions and density must be positive integers.");
  }
  const values = new Map([
    ["hw.lcd.width", width], ["hw.lcd.height", height], ["hw.lcd.density", density],
    ["skin.name", `${width}x${height}`], ["skin.path", `${width}x${height}`],
    ["showDeviceFrame", "no"]
  ]);
  const lines = config.replace(/\r\n/g, "\n").split("\n")
    .filter(line => !values.has(line.split("=", 1)[0].trim()));
  return `${lines.join("\n").trimEnd()}\n${[...values].map(([key, value]) => `${key}=${value}`).join("\n")}\n`;
}

if (resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const name = process.env.AVD_NAME ?? "mobile_e2e";
  if (!/^[A-Za-z0-9_-]+$/.test(name)) throw new Error("Invalid task AVD name.");
  const avdHome = process.env.ANDROID_AVD_HOME ?? join(homedir(), ".android", "avd");
  const config = join(avdHome, `${name}.avd`, "config.ini");
  writeFileSync(config, configureDisplay(readFileSync(config, "utf8")));
  console.log("AVD framebuffer: 540x1200 at 210 dpi; Pixel 7 logical size is unchanged.");
}
