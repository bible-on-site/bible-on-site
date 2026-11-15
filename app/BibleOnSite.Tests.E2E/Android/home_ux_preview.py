"""Native home UX smoke checks for an installed HomeUxPreview Debug build."""

import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import time
import xml.etree.ElementTree as ET


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sdk = os.environ.get("ANDROID_HOME") or os.environ.get("ANDROID_SDK_ROOT")
    sdk = Path(sdk or Path(os.environ.get("LOCALAPPDATA", "")) / "Android/Sdk")
    executable = "adb.exe" if os.name == "nt" else "adb"
    parser.add_argument("--adb", default=str(sdk / "platform-tools" / executable))
    parser.add_argument("--serial", required=True)
    parser.add_argument("--artifacts", required=True, type=Path)
    args = parser.parse_args()
    args.artifacts.mkdir(parents=True, exist_ok=True)
    device = [args.adb, "-s", args.serial]
    package = "com.tanah.daily929"
    checks = []

    def adb(*parts):
        return subprocess.run(
            [*device, *map(str, parts)], check=True, capture_output=True,
            timeout=40,
        ).stdout

    dimensions = re.findall(r"(\d+)x(\d+)", adb("shell", "wm", "size").decode())
    width, height = map(int, dimensions[-1])

    def bounds(node):
        return list(map(int, re.findall(r"-?\d+", node.get("bounds", ""))))

    def nodes():
        response = adb("shell", "uiautomator", "dump", "/sdcard/home-ux.xml")
        if b"dumped to:" not in response:
            return []
        raw = adb("shell", "cat", "/sdcard/home-ux.xml")
        (args.artifacts / "last.xml").write_bytes(raw)
        return list(ET.fromstring(raw).iter("node"))

    def find(items, selector):
        return next((n for n in items if (
            n.get("resource-id", "").endswith("/" + selector)
            or n.get("text") == selector
        )), None)

    def wait(predicate, description):
        deadline = time.monotonic() + 90
        while time.monotonic() < deadline:
            items = nodes()
            if predicate(items):
                return items
            time.sleep(0.3)
        raise AssertionError(description)

    def tap(selector):
        items = wait(lambda ns: find(ns, selector) is not None, selector)
        x1, y1, x2, y2 = bounds(find(items, selector))
        adb("shell", "input", "tap", (x1 + x2) // 2, (y1 + y2) // 2)

    def source(items):
        value = find(items, "PerekSource")
        return value.get("text", "") if value is not None else ""

    def verses(items):
        return [n for n in items if (
            n.get("resource-id", "").endswith("/PasukText")
            and bounds(n)[2] - bounds(n)[0] > width / 2
        )]

    def capture(name):
        adb("shell", "screencap", "-p", "/sdcard/home-ux.png")
        adb("pull", "/sdcard/home-ux.png", args.artifacts / f"{name}.png")
        (args.artifacts / f"{name}.xml").write_bytes(
            adb("shell", "cat", "/sdcard/home-ux.xml")
        )

    def swipe(x1, y1, x2, y2):
        adb("shell", "input", "swipe", round(x1 * width), round(y1 * height),
            round(x2 * width), round(y2 * height), 600)

    def passed(name):
        checks.append(name)
        print(f"PASS {name}", flush=True)

    def home():
        return wait(lambda ns: find(ns, "HomeDailySource") is not None
                    and find(ns, "HomeDailySource").get("text")
                    not in ("", "טוען את הפרק..."),
                    "Expected home after Back")

    adb("shell", "am", "force-stop", package)
    adb("shell", "monkey", "-p", package,
        "-c", "android.intent.category.LAUNCHER", 1)
    items = home()
    daily_source = find(items, "HomeDailySource").get("text")
    assert daily_source and daily_source != "טוען את הפרק..."
    assert "פסוקים" in find(items, "HomeVerseCount").get("text", "")
    capture("home")
    passed("native home with daily source and real counters")

    tap("HomeDailyPerek")
    wait(lambda ns: source(ns) == daily_source and verses(ns), "Daily reader")
    capture("daily-reader")
    adb("shell", "input", "keyevent", 4)
    home()
    passed("daily chapter opens and system Back returns home")

    tap("HomeIndex")
    wait(lambda ns: find(ns, "PerekPickerConfirm") is not None, "Index")
    capture("index")
    adb("shell", "input", "keyevent", 4)
    wait(lambda ns: find(ns, "PerekPickerConfirm") is None, "Dismiss index")
    home()
    passed("system Back dismisses the index before leaving home")

    tap("HomeIndex")
    tap("תורה")
    tap("בראשית")
    tap("א")
    tap("PerekPickerConfirm")
    items = wait(lambda ns: source(ns) == "בראשית א" and verses(ns), "Index reader")
    assert find(items, "ReaderMenuButton") is not None, "Reader menu clipped"
    assert find(items, "ReaderHomeButton") is not None, "Home action clipped"
    passed("index opens chosen chapter and both toolbar actions fit")

    swipe(0.5, 0.76, 0.5, 0.34)
    items = wait(lambda ns: find(ns, "ReaderHomeButton") is None and verses(ns),
                 "Toolbar did not hide during downward scroll")
    first_before = verses(items)[0].get("text", "").split(" ", 1)[0]
    assert first_before != "א", "Downward scroll did not advance the text"
    capture("reader-toolbar-hidden")
    swipe(0.5, 0.50, 0.5, 0.55)
    items = wait(lambda ns: find(ns, "ReaderHomeButton") is not None and verses(ns),
                 "Toolbar did not return on small upward movement")
    first_after = verses(items)[0].get("text", "").split(" ", 1)[0]
    assert first_after != "א", "Header reveal jumped to chapter start"
    capture("reader-toolbar-restored")
    passed("toolbar hides and returns mid-chapter without a jump to the start")

    swipe(0.8, 0.55, 0.2, 0.55)
    items = nodes()
    if source(items) == "בראשית א":
        swipe(0.2, 0.55, 0.8, 0.55)
    wait(lambda ns: source(ns) == "בראשית ב" and verses(ns), "Chapter swipe")
    passed("horizontal chapter swipe remains available")
    tap("ReaderHomeButton")
    home()
    passed("labelled home action returns home")

    tap("HomeCalendar")
    wait(lambda ns: find(ns, "CalendarViewMonth") is not None, "Calendar")
    capture("calendar")
    adb("shell", "input", "keyevent", 4)
    home()
    tap("HomeAuthors")
    wait(lambda ns: find(ns, "HomeScrollView") is None, "Authors screen")
    capture("authors")
    adb("shell", "input", "keyevent", 4)
    home()
    passed("calendar and authors reuse native destinations and return home")

    result = {"serial": args.serial, "passed": checks}
    (args.artifacts / "results.json").write_text(
        json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    print(json.dumps(result, ensure_ascii=True), flush=True)


if __name__ == "__main__":
    main()
