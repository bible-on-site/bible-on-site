"""Android regressions for scroll-to-hold, cold swipes, and first-pass scrolling."""
import argparse
import math
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import xml.etree.ElementTree as element_tree

sys.stdout.reconfigure(encoding="utf-8")
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--case", choices=["all", "hold", "fling-hold", "cold-swipe", "cold-series", "scroll-frames", "scroll-through", "scroll-burst", "cross-gesture"], default="all")
parser.add_argument("--adb")
parser.add_argument("--serial")
parser.add_argument("--package", default="com.tanah.daily929")
parser.add_argument("--settle", type=float, default=0, help="Diagnostic pause before the first measured swipe")
args = parser.parse_args()
sdk_root = os.environ.get("ANDROID_HOME") or os.environ.get("ANDROID_SDK_ROOT") or str(Path(os.environ.get("LOCALAPPDATA", "")) / "Android" / "Sdk")
adb_path = args.adb or str(Path(sdk_root) / "platform-tools" / ("adb.exe" if os.name == "nt" else "adb"))
device = ["-s", args.serial] if args.serial else ["-e"]
package = args.package


def adb(*parts):
    return subprocess.run([adb_path, *device, *map(str, parts)], check=True, capture_output=True, timeout=30).stdout


def require(condition, message):
    if not condition:
        raise AssertionError(message)


size = list(map(int, re.findall(r"(\d+)x(\d+)", adb("shell", "wm", "size").decode())[-1]))
width, height = size


def display_refresh_hz():
    display = adb("shell", "dumpsys", "display").decode(errors="replace")
    active = re.search(r"mActiveSfDisplayMode=.*?vsyncRate=([\d.]+)", display)
    return float(active.group(1)) if active else 60.0


def scale(x, y):
    return round(x * width / 1080), round(y * height / 2400)


def drag(x1, y1, x2, y2, duration):
    start = scale(x1, y1)
    end = scale(x2, y2)
    adb("shell", "input", "swipe", *start, *end, duration)


def tap_bounds(bounds):
    coordinates = list(map(int, re.findall(r"\d+", bounds)))
    adb("shell", "input", "tap", (coordinates[0]+coordinates[2])//2, (coordinates[1]+coordinates[3])//2)


def snapshot():
    response = adb("shell", "uiautomator", "dump", "/sdcard/gesture-followup.xml")
    if b"dumped to:" not in response:
        return None, 0, [], []
    nodes = list(element_tree.fromstring(adb("shell", "cat", "/sdcard/gesture-followup.xml")).iter("node"))
    def bounds(node):
        return list(map(int, re.findall(r"-?\d+", node.get("bounds", ""))))
    def centered(node):
        box = bounds(node)
        return len(box) == 4 and box[0] <= width * 0.05 and box[2] >= width * 0.95
    def visible_verse(node):
        box = bounds(node)
        return len(box) == 4 and box[2]-box[0] > width * 0.5 and box[0] < width // 2 < box[2]
    headers = [n for n in nodes if n.get("resource-id", "").endswith("/PerekHeader") and n.get("text") and centered(n)]
    verses = [n for n in nodes if n.get("resource-id", "").endswith("/PasukText") and visible_verse(n)]
    count = next((int(n.get("text")) for n in nodes if n.get("resource-id", "").endswith("/SelectionCountLabel")), 0)
    loading = any(n.get("text") == "מתחבר לפרק..." and len(bounds(n)) == 4
                  and bounds(n)[2]-bounds(n)[0] > width * 0.1 for n in nodes)
    return (headers[-1].get("text") if headers and not loading else None), count, verses, nodes


def ready(restart=False):
    if restart:
        adb("shell", "am", "force-stop", package)
        adb("shell", "monkey", "-p", package, "-c", "android.intent.category.LAUNCHER", 1)
    deadline = time.monotonic() + 90
    while True:
        chapter, count, verses, nodes = snapshot()
        if chapter is not None and verses:
            return chapter, count, verses, nodes
        require(time.monotonic() < deadline, "Chapter did not become ready within 90 seconds")
        time.sleep(0.2)


def clear_selection(nodes):
    buttons = [n for n in nodes if n.get("resource-id", "").endswith("/SelectionBackButton")]
    if buttons:
        tap_bounds(buttons[0].get("bounds"))
        require(snapshot()[1] == 0, "Selection did not clear")


def frames():
    output = adb("shell", "dumpsys", "gfxinfo", package, "framestats").decode(errors="replace")
    elapsed = []
    worst = None
    for block in output.split("---PROFILEDATA---")[1::2]:
        lines = [line.strip() for line in block.splitlines() if line.strip()]
        if not lines or not lines[0].startswith("Flags,"):
            continue
        columns = lines[0].split(",")
        intended = columns.index("IntendedVsync")
        completed = columns.index("FrameCompleted")
        for row in lines[1:]:
            values = row.split(",")
            if values[0] != "0":
                continue
            elapsed_ms = (int(values[completed]) - int(values[intended])) / 1_000_000
            if 0 < elapsed_ms < 5000:
                elapsed.append(elapsed_ms)
                if worst is None or elapsed_ms > worst[0]:
                    stamps = {name: int(values[index]) for index, name in enumerate(columns)
                              if name in ("IntendedVsync", "HandleInputStart", "AnimationStart",
                                          "PerformTraversalsStart", "DrawStart", "SyncQueued", "FrameCompleted")}
                    worst = (elapsed_ms, stamps)
    require(elapsed, "No rendered frames were captured")
    elapsed.sort()
    if worst and worst[0] > 100:
        stamps = worst[1]
        phase_names = list(stamps)
        phases = {f"{phase_names[i]}→{phase_names[i+1]}":
                  round((stamps[phase_names[i+1]] - stamps[phase_names[i]]) / 1_000_000, 1)
                  for i in range(len(phase_names)-1)}
        print(f"Worst frame phases (ms): {phases}", flush=True)
    return len(elapsed), elapsed[math.ceil(len(elapsed) * 0.90) - 1], elapsed[-1]


def measured_drag(x1, y1, x2, y2, duration):
    adb("shell", "dumpsys", "gfxinfo", package, "reset")
    drag(x1, y1, x2, y2, duration)
    time.sleep(2.0)
    return frames()


def check_hold_after_scroll():
    _, count, verses, nodes = ready(restart=True)
    if count:
        clear_selection(nodes)
    targets = []
    for verse in verses:
        left, top, right, bottom = map(int, re.findall(r"\d+", verse.get("bounds")))
        if 500 < top < 1750 and bottom < 1950:
            targets.append((bottom - top, (top + bottom) // 2 - 80))
    require(targets, "No visible verse can be held after a small scroll")
    hold_y = max(targets)[1]
    # No UI dump or preliminary tap between the drag and the first hold.
    drag(500, 1700, 500, 1620, 650)
    adb("shell", "input", "swipe", width // 2, hold_y, width // 2, hold_y, 900)
    _, count, _, nodes = snapshot()
    print(f"Immediate post-scroll hold: selected={count}", flush=True)
    require(count == 1, "First hold immediately after vertical scrolling did not select a verse")
    clear_selection(nodes)
    print("PASS: first post-scroll hold enters selection", flush=True)


def check_hold_during_fling():
    # A fast, long vertical drag keeps RecyclerView settling after release.
    # Send the hold immediately; a UI dump here would stop the fling and hide
    # the lost-first-touch failure. Inspect bounds only afterward because a
    # fixed point can land in the gap between verses.
    valid_attempts = 0
    failures = []
    for hold_y in (780, 900, 1000, 1200, 1500):
        chapter, count, verses, nodes = ready(restart=True)
        if count:
            clear_selection(nodes)
        drag(500, 550, 500, 1850, 700)
        time.sleep(0.8)
        chapter, count, verses, nodes = snapshot()
        first_verse = verses[0].get("text")
        drag(500, 1850, 500, 550, 120)
        drag(500, hold_y, 500, hold_y, 900)
        after, selected, visible, _ = snapshot()
        if after != chapter or not visible or visible[0].get("text") == first_verse:
            print(f"Inconclusive hold at y={hold_y}: list did not move", flush=True)
            continue
        target_x, target_y = scale(500, hold_y)
        hit_verse = any(
            (box := list(map(int, re.findall(r"-?\d+", verse.get("bounds")))))
            and box[0] < target_x < box[2] and box[1] < target_y < box[3]
            for verse in visible
        )
        if not hit_verse:
            print(f"Inconclusive hold at y={hold_y}: verse gap", flush=True)
            continue
        valid_attempts += 1
        print(f"First hold while vertical scroll settles at y={hold_y}: selected={selected}", flush=True)
        if selected != 1:
            drag(500, hold_y, 500, hold_y, 900)
            second = snapshot()[1]
            print(f"Second hold at the same point: selected={second}", flush=True)
            if second == 1:
                failures.append(hold_y)
    require(valid_attempts > 0, "No fling-hold attempt landed inside a verse")
    require(not failures, f"First hold after a real fling was swallowed at y={failures}")
    print(f"PASS: first hold during scroll settling entered selection in {valid_attempts} valid attempts", flush=True)


def check_cold_swipe():
    before, count, _, nodes = ready(restart=True)
    if count:
        clear_selection(nodes)
    if args.settle:
        time.sleep(args.settle)
    cold = measured_drag(850, 1000, 200, 1000, 100)
    after, count, verses, _ = snapshot()
    require(after != before and count == 0 and verses, "Cold swipe failed to navigate cleanly")
    drag(200, 1000, 850, 1000, 100)
    time.sleep(0.5)
    warm = measured_drag(850, 1000, 200, 1000, 100)
    after_warm, count, verses, _ = snapshot()
    require(after_warm == after and count == 0 and verses, "Warm swipe did not return to the same chapter")
    print(f"Chapter swipe frames (count, p90, max ms): cold={cold}, warm={warm}", flush=True)
    require(warm[1] <= 33.4, "Previously rendered swipe exceeded two display frames at p90")
    require(cold[0] >= 12 and cold[1] <= 33.4 and cold[2] <= 100,
            "First render of a buffered adjacent chapter stuttered")
    print("PASS: cold and warm chapter swipes stay within the frame budget", flush=True)


def check_cold_series():
    before, count, _, nodes = ready(restart=True)
    if count:
        clear_selection(nodes)
    samples = []
    for index in range(8):
        sample = measured_drag(850, 1000, 200, 1000, 100)
        after, count, verses, _ = snapshot()
        require(after != before and count == 0 and verses,
                f"New chapter {index + 1} failed to navigate cleanly")
        samples.append(sample)
        before = after
    print(f"Consecutive new-chapter swipe frames (count, p90, max ms): {samples}", flush=True)
    refresh_hz = display_refresh_hz()
    require(all(count >= 12 and p90 <= 2000 / refresh_hz and maximum <= 6000 / refresh_hz
                for count, p90, maximum in samples),
            f"At least one newly visited chapter stuttered at {refresh_hz:g} Hz")
    print("PASS: eight newly visited chapters stay within the frame budget", flush=True)


def check_scroll_frames():
    samples = []
    for attempt in range(3):
        before, count, verses, nodes = ready(restart=True)
        if count:
            clear_selection(nodes)
        first = verses[0].get("text")
        cold = measured_drag(600, 1850, 600, 550, 700)
        after, count, verses, _ = snapshot()
        require(after == before and count == 0 and verses[0].get("text") != first,
                "First vertical scroll did not move the verse list cleanly")
        drag(600, 550, 600, 1850, 700)
        time.sleep(0.5)
        warm = measured_drag(600, 1850, 600, 550, 700)
        after_warm, count, _, _ = snapshot()
        require(after_warm == before and count == 0, "Repeated vertical scroll navigated or selected")
        samples.append((cold, warm))
        print(f"Verse scroll attempt {attempt + 1} (count, p90, max ms): "
              f"first={cold}, repeated={warm}", flush=True)
    refresh_hz = display_refresh_hz()
    p90_budget = 1200 / refresh_hz
    max_budget = 6000 / refresh_hz
    require(all(warm[0] >= 12 and warm[1] <= p90_budget and warm[2] <= max_budget
                for _, warm in samples),
            f"Repeated vertical scroll stuttered at {refresh_hz:g} Hz")
    require(all(cold[0] >= 12 and cold[1] <= p90_budget and cold[2] <= max_budget
                for cold, _ in samples),
            f"First-pass vertical scroll stuttered at {refresh_hz:g} Hz")
    print("PASS: first-pass and repeated vertical scroll stay within the frame budget", flush=True)


def check_scroll_through():
    chapter, count, verses, nodes = ready(restart=True)
    if count:
        clear_selection(nodes)
    first = verses[0].get("text")
    samples = []
    for attempt in range(5):
        sample = measured_drag(600, 1850, 600, 550, 450)
        after, count, verses, _ = snapshot()
        require(after == chapter and count == 0 and verses,
                "A vertical scroll navigated or selected instead of scrolling")
        if verses[0].get("text") == first:
            break
        first = verses[0].get("text")
        samples.append(sample)
        print(f"Scroll {attempt + 1} toward bottom (count, p90, max ms): {sample}", flush=True)
    require(len(samples) >= 3, "The chapter ended before three vertical scrolls")
    refresh_hz = display_refresh_hz()
    require(all(count >= 12 and p90 <= 2000 / refresh_hz and maximum <= 6000 / refresh_hz
                for count, p90, maximum in samples),
            f"One of {len(samples)} consecutive vertical scrolls stuttered at {refresh_hz:g} Hz")
    print("PASS: consecutive vertical scrolls remain within the frame budget", flush=True)


def check_scroll_burst():
    chapter, count, verses, nodes = ready(restart=True)
    if count:
        clear_selection(nodes)
    first = verses[0].get("text")
    print(f"Rapid vertical-scroll chapter: {chapter}", flush=True)
    adb("shell", "dumpsys", "gfxinfo", package, "reset")
    for attempt in range(5):
        drag(600, 1900, 600, 500, 120)
        print(f"Finished rapid scroll {attempt + 1}", flush=True)
    time.sleep(2)
    sample = frames()
    after, count, verses, _ = snapshot()
    require(after == chapter and count == 0 and verses and verses[0].get("text") != first,
            "The rapid vertical-scroll burst did not move cleanly")
    print(f"Five consecutive fast scrolls (count, p90, max ms): {sample}", flush=True)
    refresh_hz = display_refresh_hz()
    require(sample[0] >= 30 and sample[1] <= 2000 / refresh_hz and sample[2] <= 6000 / refresh_hz,
            f"Rapid vertical scrolling stalled at {refresh_hz:g} Hz")
    print("PASS: rapid consecutive vertical scrolls stay within the frame budget", flush=True)


def check_cross_gesture():
    before, count, verses, nodes = ready()
    if count:
        clear_selection(nodes)
    # Deliberate selection, then a vertical drag must keep it; a horizontal
    # chapter swipe must clear it without selecting a verse at its release.
    x1, y1, x2, y2 = map(int, re.findall(r"\d+", verses[2].get("bounds")))
    adb("shell", "input", "swipe", (x1+x2)//2, (y1+y2)//2, (x1+x2)//2, (y1+y2)//2, 900)
    _, count, verses, _ = snapshot()
    require(count == 1, "Deliberate hold did not select one verse")
    tap_bounds(verses[1].get("bounds"))
    _, count, _, _ = snapshot()
    require(count == 2, "Deliberate tap did not add a verse")
    drag(600, 1800, 600, 650, 400)
    _, count, _, _ = snapshot()
    require(count == 2, "Vertical scroll changed selection")
    drag(850, 1000, 200, 1000, 100)
    time.sleep(0.8)
    after, count, verses, _ = snapshot()
    require(after != before and count == 0 and verses, "Chapter swipe did not clear selection cleanly")
    print("PASS: hold, tap, vertical scroll, and chapter swipe preserve gesture boundaries", flush=True)


cases = {
    "hold": check_hold_after_scroll,
    "fling-hold": check_hold_during_fling,
    "cold-swipe": check_cold_swipe,
    "cold-series": check_cold_series,
    "scroll-frames": check_scroll_frames,
    "scroll-through": check_scroll_through,
    "scroll-burst": check_scroll_burst,
    "cross-gesture": check_cross_gesture,
}
for name, check in cases.items():
    if args.case in ("all", name):
        check()
