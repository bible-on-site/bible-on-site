import assert from "node:assert/strict";
import { test } from "node:test";
import { configureDisplay } from "./configure-avd-display.mjs";

test("quarters rendered pixels while preserving both logical dimensions", () => {
  assert.equal(540 * 1200 / (1080 * 2400), 0.25);
  assert.equal(540 / 210, 1080 / 420);
  assert.equal(1200 / 210, 2400 / 420);
  const result = configureDisplay("image.sysdir.1=system-images/android-36/google_apis/x86_64/\nhw.lcd.width=1080\nhw.lcd.height=2400\nhw.lcd.density=420\n");
  assert.match(result, /^hw\.lcd\.width=540$/m);
  assert.match(result, /^hw\.lcd\.height=1200$/m);
  assert.match(result, /^hw\.lcd\.density=210$/m);
  assert.match(result, /^image\.sysdir\.1=system-images\/android-36\/google_apis\/x86_64\/$/m);
});

test("replaces duplicate display keys and preserves unrelated hardware settings", () => {
  const result = configureDisplay("hw.lcd.width=1080\r\nhw.lcd.width=720\r\nhw.cpu.ncore=2\r\nhw.ramSize=4096\r\n");
  assert.equal(result.match(/^hw\.lcd\.width=/gm).length, 1);
  assert.match(result, /^hw\.cpu\.ncore=2$/m);
  assert.match(result, /^hw\.ramSize=4096$/m);
  assert.equal(configureDisplay(result), result);
});

test("uses a matching frameless skin instead of the old full-resolution skin", () => {
  const result = configureDisplay("skin.name=pixel_7\nskin.path=/old/skins/pixel_7\nshowDeviceFrame=yes\n");
  assert.match(result, /^skin\.name=540x1200$/m);
  assert.match(result, /^skin\.path=540x1200$/m);
  assert.match(result, /^showDeviceFrame=no$/m);
});

test("rejects invalid framebuffer configuration", () => {
  for (const values of [[0, 1200, 210], [540, -1, 210], [540, 1200, Number.NaN]]) {
    assert.throws(() => configureDisplay("", ...values), /positive integers/);
  }
});
