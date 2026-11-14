"""Verify commentary visibility and the native download-and-return flow."""
import argparse
from collections import Counter
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
parser.add_argument("--back-source", choices=("emulator", "injected"), default="emulator")
parser.add_argument("--emulator-grpc-port", type=int, default=8554)
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


def wait_for(name, stable_bounds=False):
    deadline = time.monotonic() + 45
    previous_bounds = None
    while time.monotonic() < deadline:
        nodes, raw = snapshot()
        node = find(nodes, name)
        if node is not None:
            current_bounds = bounds(node)
            if not stable_bounds or current_bounds == previous_bounds:
                return nodes, raw
            previous_bounds = current_bounds
        native_interval.wait(timeout=0.3)
    (args.artifacts / "failure.png").write_bytes(adb("exec-out", "screencap", "-p"))
    (args.artifacts / "failure.xml").write_bytes(raw)
    report["failure"] = {"expectedControl": name, "backSource": args.back_source}
    (args.artifacts / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    raise AssertionError(f"Native control did not become visible: {name}")


def dominant_color(png):
    return Counter(Image.open(io.BytesIO(png)).convert("RGB").get_flattened_data()).most_common(1)[0][0]


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
    data = {"booksPixels": rendered_books_pixels(png), "backgroundRgb": dominant_color(png)}
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
# Measure the drag origin after the opening layout settles, within the same deadline.
wait_for("PerushimEmptyIcon", stable_bounds=True)
nodes, initial = capture("default")
view_top = initial["viewport"][1]
x = sum(initial["viewport"][::2]) // 2
start_y = view_top + 6
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
        report[name] = {"booksPixels": count, "backgroundRgb": dominant_color(png)}
        check.assertEqual(report[name]["backgroundRgb"], initial["backgroundRgb"], "Dragging left a gray overlay")
        check.assertTrue(count >= initial["booksPixels"] * 0.9, f"White cover obscured books during drag: {count}")
finally:
    process.communicate(timeout=15)
native_interval.wait(timeout=0.5)
nodes, expanded = capture("expanded")
check.assertTrue(expanded["viewport"][1] < view_top - 100, "Top-edge drag did not expand the sheet")
report["top-edge-drag"] = {"sheetTop": view_top, "start": [x, start_y], "expanded": True}
check.assertTrue(expanded["booksPixels"] >= initial["booksPixels"] * 0.9, "Rendered books changed after expansion")

# Both actions must receive real native taps, not just have accessible bounds.
tap(find(nodes, "ExportPerushimLogsButton"))
for _ in range(12):
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
check.assertIsNone(find(nodes, "TopBarBackButton"), "Android default must hide the optional in-app Back button")
check.assertTrue(any(n.get("text") == "העדפות - חבילות הרחבה" for n in nodes),
                 "Download shortcut must open the regular preferences at extension packs")
tap(find(nodes, "DownloadPerushimButton"))
wait_for("RemovePerushimButton")
capture("download-complete", verify=False)
if args.back_source == "emulator":
    import grpc
    # SDK emulator_controller.proto KeyboardEvent: Evdev, keypress, KEY_BACK (158).
    # The console's generic EV_KEY command takes a different path from toolbar keys.
    with grpc.insecure_channel(f"127.0.0.1:{args.emulator_grpc_port}") as channel:
        send_key = channel.unary_unary("/android.emulation.control.EmulatorController/sendKey")
        send_key(b"\x08\x01\x10\x02\x18\x9e\x01", timeout=5)
else:
    adb("shell", "input", "keyevent", "4")
nodes, _ = wait_for("PerushimChevronButton")
check.assertIsNone(find(nodes, "DownloadPerushimButton"), "One Back must leave preferences")
check.assertIsNone(find(nodes, "PerushimEmptyIcon"), "Installed commentary must replace the empty state")
check.assertTrue(any(n.get("class") == "android.widget.CheckBox" for n in nodes),
                 "Downloaded commentary choices must be usable after returning")
report["download-flow"] = {"entry": "perushim-dialog", "preferencesSection": "packs",
                           "sharedTopBar": True, "inAppBackVisible": False,
                           "downloadInstalled": True, "oneSystemBackReturnedToReader": True, "backSource": args.back_source}

nodes, expanded = capture("returned", verify=False)
expanded["viewport"] = bounds(find(nodes, "PerushimContentViewport"))
menu_bounds = bounds(find(nodes, "CircularMenuButton"))
check.assertGreaterEqual(expanded["viewport"][3], menu_bounds[3],
                         "A rectangular viewport clip must not cover text through the transparent bar notch")
report["populated-notch"] = {"viewportBottom": expanded["viewport"][3], "centralButtonBottom": menu_bounds[3]}
# A name tap and a checkbox tap each toggle exactly once, then restore state.
checkboxes = [n for n in nodes if n.get("class") == "android.widget.CheckBox" and n.get("enabled") == "true"]
check.assertTrue(checkboxes, "No enabled commentary checkbox is available")
checkbox = checkboxes[0]
checkbox_index = [n for n in nodes if n.get("class") == "android.widget.CheckBox"].index(checkbox)
initial_checked = checkbox.get("checked") == "true"
checkbox_rect = bounds(checkbox)
name_node = next(n for n in nodes if n.get("class") == "android.widget.TextView" and n.get("text")
                 and abs(sum(bounds(n)[1::2]) - sum(checkbox_rect[1::2])) <= 24)
perush_name = name_node.get("text")
for target, expected in ((name_node, not initial_checked), (name_node, initial_checked),
                         (checkbox, not initial_checked), (checkbox, initial_checked)):
    tap(target)
    nodes, _ = snapshot()
    current_boxes = [n for n in nodes if n.get("class") == "android.widget.CheckBox"]
    check.assertEqual(current_boxes[checkbox_index].get("checked") == "true", expected,
                      "Perush name and checkbox taps must each toggle once")
report["row-selection"] = {"perush": perush_name, "nameTapTogglesOnce": True, "checkboxTapTogglesOnce": True}
# Sample populated rows crossing the notch during the same sheet drag.
gesture_argv = base + ["shell", "input", "swipe", str(x), str(expanded["viewport"][1] + 80),
                       str(x), str(start_y), "6000"]
process = subprocess.Popen(gesture_argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE)  # nosec B603: validated SDK argv, no shell.  # nosemgrep
try:
    for index in range(3):
        native_interval.wait(timeout=1.1)
        png = adb("exec-out", "screencap", "-p")
        name = f"populated-drag-{index + 1}"
        (args.artifacts / (name + ".png")).write_bytes(png)
        report[name] = {"backgroundRgb": dominant_color(png)}
        check.assertEqual(report[name]["backgroundRgb"], expanded["backgroundRgb"], "Populated sheet drag left a gray overlay")
finally:
    process.communicate(timeout=15)
native_interval.wait(timeout=0.7)
_, collapsed = capture("collapsed", verify=False)
check.assertEqual(collapsed["backgroundRgb"], initial["backgroundRgb"], "Sheet collapse left a gray overlay")

# Articles closes the sheet and disables its launcher; text mode restores it.
nodes, _ = snapshot()
tap(find(nodes, "ArticlesButton"))
nodes, _ = wait_for("PerushimChevronButton")
check.assertIsNone(find(nodes, "PerushimContentViewport"), "Articles must close the commentary sheet")
check.assertEqual(find(nodes, "PerushimChevronButton").get("enabled"), "false", "Articles must disable the commentary launcher")
tap(find(nodes, "PerushimChevronButton"))
nodes, _ = snapshot()
check.assertIsNone(find(nodes, "PerushimContentViewport"), "Disabled chevron must not reopen the sheet")
capture("articles-mode", verify=False)
tap(find(nodes, "TextButton"))
nodes, _ = wait_for("PerushimChevronButton")
check.assertEqual(find(nodes, "PerushimChevronButton").get("enabled"), "true", "Text mode must restore the commentary launcher")
tap(find(nodes, "PerushimChevronButton"))
nodes, _ = wait_for("PerushimContentViewport")
tap(find(nodes, "PerushimChevronButton"))
report["articles-mode"] = {"sheetClosed": True, "chevronDisabled": True, "restoredOnTextView": True}
# Root Back opens the real exit popup. Its entire card and actions must fit.
if args.back_source == "emulator":
    with grpc.insecure_channel(f"127.0.0.1:{args.emulator_grpc_port}") as channel:
        channel.unary_unary("/android.emulation.control.EmulatorController/sendKey")(
            bytes([8, 1, 16, 2, 24, 158, 1]), timeout=5)
else:
    adb("shell", "input", "keyevent", "4")
nodes, _ = wait_for("ExitConfirmationStay")
capture("exit-confirmation", verify=False)
card = bounds(find(nodes, "ExitConfirmationCard"))
screen = Image.open(io.BytesIO(adb("exec-out", "screencap", "-p"))).size
check.assertTrue(24 <= card[0] < card[2] <= screen[0] - 24, "Exit card extends beyond the screen margin")
for control in ("ExitConfirmationTitle", "ExitConfirmationMessage", "ExitConfirmationStay", "ExitConfirmationExit"):
    rect = bounds(find(nodes, control))
    check.assertTrue(card[0] <= rect[0] < rect[2] <= card[2] and card[1] <= rect[1] < rect[3] <= card[3],
                     f"Exit prompt content is clipped: {control}")
stay_rect = bounds(find(nodes, "ExitConfirmationStay"))
stay_image = Image.open(io.BytesIO(adb("exec-out", "screencap", "-p"))).convert("RGB").crop(stay_rect)
ink_rows = [y for y in range(stay_image.height)
            if sum(b > 80 and b > r * 1.5 and b > g * 1.1
                   for r, g, b in (stay_image.getpixel((x, y)) for x in range(stay_image.width))) > 2]
ink_bands = sum(index == 0 or y - ink_rows[index - 1] > 4 for index, y in enumerate(ink_rows))
check.assertEqual(ink_bands, 1, "The Stay action must fit on one text line at the reproduction's font scale")
report["exit-action"] = {"stayTextLines": ink_bands}
tap(find(nodes, "ExitConfirmationStay"))
wait_for("PerushimChevronButton")
_, dismissed = capture("exit-dismissed", verify=False)
check.assertEqual(dismissed["backgroundRgb"], initial["backgroundRgb"], "Dismissing exit left a gray overlay")
report["exit-prompt"] = {"card": card, "screen": screen, "allControlsWithinCard": True, "dismissClearedOverlay": True}

# The reported long name must paint through the notch, beyond the old clip line.
nodes, _ = wait_for("PerushimChevronButton")
tap(find(nodes, "PerushimChevronButton"))
nodes, _ = wait_for("PerushimContentViewport")
menu_rect = bounds(find(nodes, "CircularMenuButton"))
scale = (menu_rect[2] - menu_rect[0]) / 56
old_clip_line = menu_rect[1] - round(scale)
touch_slop = 0
for _ in range(10):
    name_node = next((n for n in nodes if n.get("text") == "מראות הצובאות"), None)
    before_top = bounds(name_node)[1] if name_node is not None else None
    if before_top is not None and abs(before_top - old_clip_line) <= 4:
        break
    delta = before_top - old_clip_line if before_top is not None else 50 * scale
    distance = min(50 * scale, abs(delta) + touch_slop) * (1 if delta > 0 else -1)
    start = menu_rect[1] - round(9 * scale)
    adb("shell", "input", "swipe", round(screen[0] * 0.7), start,
        round(screen[0] * 0.7), round(start - distance), "1000")
    nodes, _ = snapshot()
    after_name = next((n for n in nodes if n.get("text") == "מראות הצובאות"), None)
    if before_top is not None and after_name is not None:
        moved = abs(bounds(after_name)[1] - before_top)
        if 0 < moved < abs(distance):
            touch_slop = abs(distance) - moved
else:
    raise AssertionError("Reported commentary row could not reach the transparent notch")
capture("populated-notch-proof", verify=False)
notch_gap = (menu_rect[2] + round(2 * scale), menu_rect[1] + round(5 * scale),
             menu_rect[2] + round(10 * scale), menu_rect[1] + round(15 * scale))
notch_image = Image.open(io.BytesIO(adb("exec-out", "screencap", "-p"))).convert("RGB").crop(notch_gap)
ink_pixels = sum(r < 80 and g < 80 and b < 80 for r, g, b in notch_image.get_flattened_data())
check.assertGreater(ink_pixels, 20, "White cover hides commentary ink through the transparent notch")
report["populated-notch-pixels"] = {"perush": name_node.get("text"), "textBounds": bounds(name_node),
                                     "formerClipLine": old_clip_line, "notchGap": notch_gap, "blackTextPixels": ink_pixels}
(args.artifacts / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
print("PASS: commentary ink stays visible; top-edge dragging, row taps, download/Back, Articles and exit prompt checks pass", flush=True)
