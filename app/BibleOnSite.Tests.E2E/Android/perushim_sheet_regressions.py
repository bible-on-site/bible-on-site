"""Verify commentary visibility and the native download-and-return flow."""
import argparse
import io
import json
import os
from pathlib import Path
import re
import subprocess  # nosec B404: Android SDK executable, validated path and argv, never a shell.
import sys
import time
from threading import Event
from defusedxml import ElementTree
import unittest
from PIL import Image

sys.stdout.reconfigure(encoding="utf-8")
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--adb", default=str(Path(os.environ.get("ANDROID_HOME", "")) / "platform-tools/adb.exe"))
parser.add_argument("--serial", required=True)
parser.add_argument("--artifacts", type=Path, required=True)
args = parser.parse_args()
args.artifacts.mkdir(parents=True, exist_ok=True)
base = [args.adb, "-s", args.serial]
report = {}
check = unittest.TestCase()
# Each sample below has an explicit finite timeout; the 45-second deadline is unchanged.
native_interval = Event()
adb_path = Path(args.adb).resolve(strict=True)
if adb_path.name.lower() not in ("adb", "adb.exe") or not re.fullmatch(r"[A-Za-z0-9_.:-]+", args.serial):
    raise ValueError("Expected an Android SDK adb path and a device serial")
base[0] = str(adb_path)


def adb(*parts):
    return subprocess.check_output(base + list(map(str, parts)), timeout=30)  # nosec B603: validated SDK argv, no shell.  # nosemgrep


def snapshot():
    status = adb("shell", "uiautomator", "dump", "/sdcard/perushim-regression.xml")
    if b"dumped to:" not in status:
        return [], b""
    raw = adb("shell", "cat", "/sdcard/perushim-regression.xml")
    return list(ElementTree.fromstring(raw).iter("node")), raw


def find(nodes, name):
    return next((n for n in nodes if n.get("resource-id", "").endswith("/" + name)), None)


def bounds(node):
    return tuple(map(int, re.findall(r"-?\d+", node.get("bounds", ""))))


def tap(node):
    x1, y1, x2, y2 = bounds(node)
    adb("shell", "input", "tap", (x1 + x2) // 2, (y1 + y2) // 2)


def wait_for(name):
    deadline = time.monotonic() + 45
    while time.monotonic() < deadline:
        nodes, raw = snapshot()
        if find(nodes, name) is not None:
            return nodes, raw
        native_interval.wait(timeout=0.3)
    raise AssertionError(f"Native control did not become visible: {name}")


def rendered_books_pixels(png):
    # Only the books glyph has red/green pixels in the middle fifth of this reader.
    # This catches a painted cover even when accessibility bounds still look correct.
    image = Image.open(io.BytesIO(png)).convert("RGB")
    strip = image.crop((int(image.width * 0.4), 0, int(image.width * 0.6), image.height))
    return sum((r > 120 and r > g * 1.35 and r > b * 1.12)
               or (g > 90 and g > r * 1.2 and g > b * 1.05)
               for r, g, b in strip.get_flattened_data())


def capture(name, verify=True):
    nodes, raw = snapshot()
    png = adb("exec-out", "screencap", "-p")
    (args.artifacts / (name + ".png")).write_bytes(png)
    (args.artifacts / (name + ".xml")).write_bytes(raw)
    data = {"booksPixels": rendered_books_pixels(png)}
    if verify:
        viewport_node = find(nodes, "PerushimContentViewport")
        check.assertTrue(viewport_node is not None, "Sheet content viewport is missing")
        viewport = bounds(viewport_node)
        data["viewport"] = viewport
        for control in ("PerushimEmptyIcon", "GoToPerushimSettingsButton", "ExportPerushimLogsButton"):
            node = find(nodes, control)
            check.assertTrue(node is not None, f"{control} is missing in {name}")
            rect = bounds(node)
            data[control] = rect
            check.assertTrue(viewport[0] <= rect[0] < rect[2] <= viewport[2], (name, control, rect, viewport))
            check.assertTrue(viewport[1] <= rect[1] < rect[3] <= viewport[3], (name, control, rect, viewport))
        check.assertTrue(data["booksPixels"] > 200, f"Books icon is painted over in {name}")
    report[name] = data
    print(name, json.dumps(data), flush=True)
    return nodes, data


nodes, _ = wait_for("PerushimChevronButton")
if find(nodes, "PerushimEmptyIcon") is None:
    tap(find(nodes, "PerushimChevronButton"))
wait_for("PerushimEmptyIcon")
native_interval.wait(timeout=0.4)
nodes, initial = capture("default")
view_top = initial["viewport"][1]
x = sum(initial["viewport"][::2]) // 2
start_y = view_top + 80
gesture_argv = base + ["shell", "input", "swipe", str(x), str(start_y),
                       str(x), str(max(180, start_y - 700)), "6000"]
process = subprocess.Popen(gesture_argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE)  # nosec B603: validated SDK argv, no shell.  # nosemgrep
try:
    for index in range(3):
        native_interval.wait(timeout=1.1)
        png = adb("exec-out", "screencap", "-p")
        name = f"drag-{index + 1}"
        (args.artifacts / (name + ".png")).write_bytes(png)
        count = rendered_books_pixels(png)
        report[name] = {"booksPixels": count}
        check.assertTrue(count >= initial["booksPixels"] * 0.9, f"White cover obscured books during drag: {count}")
finally:
    process.communicate(timeout=15)
native_interval.wait(timeout=0.5)
nodes, expanded = capture("expanded")
check.assertTrue(expanded["viewport"][1] < view_top - 100, "Upward drag did not expand the sheet")
check.assertTrue(expanded["booksPixels"] >= initial["booksPixels"] * 0.9, "Rendered books changed after expansion")

# Both actions must receive real native taps, not just have accessible bounds.
tap(find(nodes, "ExportPerushimLogsButton"))
for attempt in range(12):
    activity = adb("shell", "dumpsys", "activity", "activities").decode("utf-8", "replace")
    if "ChooserActivity" in activity:
        break
    native_interval.wait(timeout=0.5)
else:
    raise AssertionError("Export action did not open Android's share chooser")
capture("export-chooser", verify=False)
adb("shell", "input", "keyevent", "4")
nodes, _ = wait_for("GoToPerushimSettingsButton")
tap(find(nodes, "GoToPerushimSettingsButton"))
nodes, _ = wait_for("DownloadPerushimButton")
capture("download-settings", verify=False)
check.assertIsNotNone(find(nodes, "PreferencesNavigationButton"), "Preferences must retain the shared app top bar")
check.assertIsNone(find(nodes, "PreferencesBackButton"), "Android default must hide the optional in-app Back button")
check.assertTrue(any(n.get("text") == "העדפות - חבילות הרחבה" for n in nodes),
                 "Download shortcut must open the regular preferences at extension packs")
tap(find(nodes, "DownloadPerushimButton"))
wait_for("RemovePerushimButton")
capture("download-complete", verify=False)
adb("shell", "input", "keyevent", "4")
nodes, _ = wait_for("PerushimChevronButton")
check.assertIsNone(find(nodes, "DownloadPerushimButton"), "One Back must leave preferences")
check.assertIsNone(find(nodes, "PerushimEmptyIcon"), "Installed commentary must replace the empty state")
check.assertTrue(any(n.get("class") == "android.widget.CheckBox" for n in nodes),
                 "Downloaded commentary choices must be usable after returning")
report["download-flow"] = {"entry": "perushim-dialog", "preferencesSection": "packs",
                           "sharedTopBar": True, "inAppBackVisible": False,
                           "downloadInstalled": True, "oneSystemBackReturnedToReader": True}

nodes, expanded = capture("returned", verify=False)
expanded["viewport"] = bounds(find(nodes, "PerushimContentViewport"))
adb("shell", "input", "swipe", x, expanded["viewport"][1] + 80, x, start_y, "800")
native_interval.wait(timeout=0.7)
capture("collapsed", verify=False)
(args.artifacts / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
print("PASS: books stay rendered during upward drag; both actions work; pack installs and one Back returns to the populated reader", flush=True)
