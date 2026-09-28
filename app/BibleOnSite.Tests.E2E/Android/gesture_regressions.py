"""Native swipe/selection regressions; requires the debug app in a running emulator."""
import argparse
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import xml.etree.ElementTree as element_tree

sys.stdout.reconfigure(encoding="utf-8")
sdk_root = (
    os.environ.get("ANDROID_HOME")
    or os.environ.get("ANDROID_SDK_ROOT")
    or str(Path(os.environ.get("LOCALAPPDATA", "")) / "Android" / "Sdk")
)
default_adb = Path(sdk_root) / "platform-tools" / ("adb.exe" if os.name == "nt" else "adb")
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--adb", default=str(default_adb))
parser.add_argument("--restart-only", action="store_true", help="Run only the first-swipe-after-restart checks")
parser.add_argument("--serial", help="Emulator serial (defaults to adb -e)")
args = parser.parse_args()
ADB = args.adb
DEVICE = ["-s", args.serial] if args.serial else ["-e"]


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def adb(*args):
    return subprocess.run([ADB, *DEVICE, *map(str, args)], check=True, capture_output=True, timeout=30).stdout


def bounds(node):
    return list(map(int, re.findall(r"-?\d+", node.get("bounds"))))


size = list(map(int, re.findall(r"(\d+)x(\d+)", adb("shell", "wm", "size").decode())[-1]))
WIDTH, HEIGHT = size


def snapshot():
    dump = adb("shell", "uiautomator", "dump", "/sdcard/window.xml")
    if b"dumped to:" not in dump:
        # uiautomator may return exit 0 with a null-root error during startup;
        # its previous XML file is then stale and cannot establish readiness.
        return None, 0, [], []
    nodes = list(element_tree.fromstring(adb("shell", "cat", "/sdcard/window.xml")).iter("node"))
    verses = [n for n in nodes if n.get("resource-id", "").endswith("/PasukText") and bounds(n)[2] - bounds(n)[0] > WIDTH * 0.5]
    headers = [
        n.get("text") for n in nodes
        if n.get("class") == "android.widget.TextView" and n.get("text")
        and n.get("resource-id", "").endswith("/PerekHeader")
        and bounds(n)[2] - bounds(n)[0] > WIDTH * 0.5
    ]
    count = next((int(n.get("text")) for n in nodes if n.get("resource-id", "").endswith("/SelectionCountLabel")), 0)
    loading = any(n.get("text") == "מתחבר לפרק..." and bounds(n)[2] - bounds(n)[0] > WIDTH * 0.1 for n in nodes)
    return headers[-1] if headers and not loading else None, count, verses, nodes


def raw_swipe(x1, y1, x2, y2, duration):
    adb("shell", "input", "swipe", round(x1 * WIDTH / 1080), round(y1 * HEIGHT / 2400), round(x2 * WIDTH / 1080), round(y2 * HEIGHT / 2400), duration)


def swipe(x1, y1, x2, y2, duration):
    raw_swipe(x1, y1, x2, y2, duration)
    time.sleep(0.8)


def tap(node):
    x1, y1, x2, y2 = bounds(node)
    adb("shell", "input", "tap", (x1+x2)//2, (y1+y2)//2)
    time.sleep(0.4)


def wait_for_swipe(before, timeout=10):
    deadline = time.monotonic() + timeout
    while True:
        after, count, verses, nodes = snapshot()
        require(count == 0, f"Swipe selected {count} verse(s)")
        if after is not None and verses:
            header = next(
                n for n in nodes
                if n.get("resource-id", "").endswith("/PerekHeader") and n.get("text") == after
                and bounds(n)[2] - bounds(n)[0] > WIDTH * 0.5
            )
            left, _, right, _ = bounds(header)
            if after != before and left <= WIDTH * 0.01 and right >= WIDTH * 0.99:
                return after, count, verses, nodes
        require(time.monotonic() < deadline, "Swipe did not change chapter and fully snap within 10 seconds")
        time.sleep(0.2)


if not args.restart_only:
    header, count, verses, nodes = snapshot()
    require(header is not None and verses, "Start with a settled, loaded chapter")
    if count:
        tap(next(n for n in nodes if n.get("resource-id", "").endswith("/SelectionBackButton")))
    for duration, x1, x2 in [(100, 850, 200), (100, 200, 850)] * 3 + [(900, 850, 200), (900, 200, 850)]:
        before, _, _, _ = snapshot()
        swipe(x1, 1000, x2, 1000, duration)
        wait_for_swipe(before)
        print(f"PASS: {duration}ms swipe {x1}->{x2}: chapter changed, selection stayed empty", flush=True)

    before, _, verses, _ = snapshot()
    first = verses[0].get("text")
    swipe(600, 1800, 800, 650, 400)
    after, count, verses, _ = snapshot()
    require(after == before and count == 0, "Primarily vertical scroll navigated or selected a verse")
    require(verses[0].get("text") != first, "Vertical scroll did not move the verse list")
    print("PASS: primarily vertical diagonal scroll moved the list without navigation or selection", flush=True)

    # Reverse the scroll, then confirm intentional selection still works.
    swipe(600, 650, 600, 1850, 400)
    _, _, verses, _ = snapshot()
    x1, y1, x2, y2 = bounds(verses[0])
    x, y = (x1+x2)//2, (y1+y2)//2
    adb("shell", "input", "swipe", x, y, x, y, 900)
    time.sleep(0.8)
    _, count, verses, _ = snapshot()
    require(count == 1, f"Deliberate long press selected {count} verses")
    print("PASS: intentional long press selected one verse", flush=True)
    tap(verses[1])
    _, count, _, _ = snapshot()
    require(count == 2, f"Tap to multi-select left {count} verses selected")
    print("PASS: intentional tap added the second verse", flush=True)
    swipe(600, 1800, 600, 650, 400)
    _, count, _, nodes = snapshot()
    require(count == 2, f"Scroll altered existing selection: {count}")
    print("PASS: scrolling preserved the two deliberate selections", flush=True)
    tap(next(n for n in nodes if n.get("resource-id", "").endswith("/SelectionBackButton")))
    _, count, verses, _ = snapshot()
    require(count == 0, "Gesture regression failed")
    print("PASS: selection exit cleared the selection; emulator ready", flush=True)

    # No dump or preliminary tap between vertical movement and the next hold.
    # A previous scroll cooldown used to reject this first stationary press.
    # Aim inside a visible verse; fixed screen coordinates can land in a verse gap.
    target = max(
        (v for v in verses if 450 < bounds(v)[1] and bounds(v)[3] < 1900),
        key=lambda v: bounds(v)[3] - bounds(v)[1],
    )
    left, top, right, bottom = bounds(target)
    hold_x, hold_y = (left + right) // 2, (top + bottom) // 2 - 80
    raw_swipe(500, 1700, 500, 1620, 650)
    adb("shell", "input", "swipe", hold_x, hold_y, hold_x, hold_y, 900)
    _, count, _, nodes = snapshot()
    require(count == 1, f"First hold after scrolling selected {count} verses")
    print("PASS: first hold after vertical scroll entered multi-selection", flush=True)
    tap(next(n for n in nodes if n.get("resource-id", "").endswith("/SelectionBackButton")))
    require(snapshot()[1] == 0, "Selection exit after post-scroll hold failed")

    # A fast scroll can still be settling when the next stationary hold begins.
    # Check several points because the verse rows move and have gaps between them.
    valid_fling_holds = 0
    for hold_y in (780, 900, 1000, 1200, 1500):
        adb("shell", "am", "force-stop", "com.tanah.daily929")
        adb("shell", "monkey", "-p", "com.tanah.daily929", "-c", "android.intent.category.LAUNCHER", 1)
        deadline = time.monotonic() + 20
        while True:
            before, count, verses, nodes = snapshot()
            if before is not None and verses:
                break
            require(time.monotonic() < deadline, "Chapter was not ready for fling-hold test")
            time.sleep(0.2)
        if count:
            tap(next(n for n in nodes if n.get("resource-id", "").endswith("/SelectionBackButton")))
        swipe(500, 550, 500, 1850, 700)
        before, _, verses, _ = snapshot()
        first_verse = verses[0].get("text")
        raw_swipe(500, 1850, 500, 550, 120)
        raw_swipe(500, hold_y, 500, hold_y, 900)
        after, count, verses, _ = snapshot()
        if after != before or not verses or verses[0].get("text") == first_verse:
            continue
        x, y = round(500 * WIDTH / 1080), round(hold_y * HEIGHT / 2400)
        if not any(left < x < right and top < y < bottom
                   for verse in verses for left, top, right, bottom in [bounds(verse)]):
            continue
        if count == 0:
            raw_swipe(500, hold_y, 500, hold_y, 900)
            if snapshot()[1] == 1:
                raise AssertionError(f"First hold after fling was swallowed at y={hold_y}")
            continue
        require(count == 1, f"First hold after fling selected {count} verses")
        valid_fling_holds += 1
    require(valid_fling_holds > 0, "No fling-hold attempt landed inside a verse")
    print(f"PASS: first hold during fling selected in {valid_fling_holds} valid attempts", flush=True)

# Recreate the first-touch lag case, including both directions after a restart.
for x1, x2 in [(850, 200), (200, 850)]:
    adb("shell", "am", "force-stop", "com.tanah.daily929")
    adb("shell", "monkey", "-p", "com.tanah.daily929", "-c", "android.intent.category.LAUNCHER", 1)
    deadline = time.monotonic() + 20
    while True:
        try:
            before, count, verses, _ = snapshot()
            require(before is not None and verses, "Chapter is not ready")
            break
        except AssertionError:
            if time.monotonic() >= deadline:
                raise
            time.sleep(0.2)
    require(count == 0, "Gesture regression failed")
    print(f"Ready after restart: first swipe {x1}->{x2}", flush=True)
    swipe(x1, 1000, x2, 1000, 100)
    wait_for_swipe(before)
    print(f"PASS: first swipe after restart {x1}->{x2}: changed chapter, fully snapped, no selection", flush=True)
