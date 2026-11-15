"""Native home UX checks for an installed HomeUxPreview Debug build."""

import argparse
import json
import os
from pathlib import Path
import re
import subprocess  # nosec B404: validated Android SDK executable, argv only.
from threading import Event
import time
import unittest

from defusedxml import ElementTree


def find(items, selector):
    return next((n for n in items if (
        n.get("resource-id", "").endswith("/" + selector)
        or n.get("text") == selector
    ) and len(bounds(n)) == 4 and bounds(n)[2] > bounds(n)[0]
        and bounds(n)[3] > bounds(n)[1]), None)


def bounds(node):
    return list(map(int, re.findall(r"-?\d+", node.get("bounds", ""))))


def source(items):
    value = find(items, "PerekSource")
    return value.get("text", "") if value is not None else ""


class NativeDevice:
    def __init__(self, args):
        """Validate the target emulator and prepare its evidence directory."""
        executable = Path(args.adb).resolve(strict=True)
        if executable.name.lower() not in ("adb", "adb.exe"):
            raise ValueError("Expected an Android SDK adb executable")
        if not re.fullmatch(r"[A-Za-z0-9_.:-]+", args.serial):
            raise ValueError("Expected an emulator serial")
        self.base = [str(executable), "-s", args.serial]
        self.artifacts = args.artifacts
        self.artifacts.mkdir(parents=True, exist_ok=True)
        self.poll_interval = Event()
        dimensions = re.findall(r"(\d+)x(\d+)", self.adb("shell", "wm", "size").decode())
        self.width, self.height = map(int, dimensions[-1])

    def adb(self, *parts):
        return subprocess.check_output(self.base + list(map(str, parts)), timeout=40)  # nosec B603: validated SDK argv, no shell.  # nosemgrep

    def nodes(self):
        response = self.adb("shell", "uiautomator", "dump", "/sdcard/home-ux.xml")
        if b"dumped to:" not in response:
            return []
        raw = self.adb("shell", "cat", "/sdcard/home-ux.xml")
        (self.artifacts / "last.xml").write_bytes(raw)
        return list(ElementTree.fromstring(raw).iter("node"))

    def wait(self, predicate, description):
        deadline = time.monotonic() + 90
        while time.monotonic() < deadline:
            items = self.nodes()
            if find(items, "aerr_close") is not None:
                self.capture("application-not-responding")
                raise AssertionError(f"Android ANR while waiting for {description}")
            if predicate(items):
                return items
            self.poll_interval.wait(0.3)
        raise AssertionError(description)

    def tap(self, selector):
        items = self.wait(lambda ns: find(ns, selector) is not None, selector)
        self.tap_node(find(items, selector))

    def tap_node(self, node):
        """Tap an observed stable control without waiting through its idle timeout."""
        x1, y1, x2, y2 = bounds(node)
        self.adb("shell", "input", "tap", (x1 + x2) // 2, (y1 + y2) // 2)

    def verses(self, items):
        return [n for n in items if (
            n.get("resource-id", "").endswith("/PasukText")
            and bounds(n)[2] - bounds(n)[0] > self.width / 2
        )]

    def capture(self, name):
        self.adb("shell", "screencap", "-p", "/sdcard/home-ux.png")
        self.adb("pull", "/sdcard/home-ux.png", self.artifacts / f"{name}.png")
        (self.artifacts / f"{name}.xml").write_bytes(
            self.adb("shell", "cat", "/sdcard/home-ux.xml")
        )

    def swipe(self, x1, y1, x2, y2):
        self.adb("shell", "input", "swipe", round(x1 * self.width),
                 round(y1 * self.height), round(x2 * self.width),
                 round(y2 * self.height), 600)

    def home(self):
        self.wait(lambda ns: find(ns, "HomeGlobalSearch") is not None, "Home search header")
        self.scroll_to("HomeDailyPerek", upward=True)
        return self.wait(lambda ns: find(ns, "HomeDailySource") is not None
                         and find(ns, "HomeDailySource").get("text")
                         not in ("", "טוען את הפרק..."), "Expected home")

    def scroll_to(self, selector, upward=False):
        """Find a fully usable home tile in the scrollable layout."""
        for _ in range(6):
            items = self.nodes()
            node = find(items, selector)
            if node is not None:
                _, top, _, bottom = bounds(node)
                if top >= self.height * 0.24 and bottom <= self.height * 0.97:
                    return node
            start, end = (0.35, 0.85) if upward else (0.8, 0.4)
            self.swipe(0.5, start, 0.5, end)
        raise AssertionError(f"Home tile is not reachable: {selector}")

    def back(self):
        self.adb("shell", "input", "keyevent", 4)


def check_home_and_daily(device, check):
    package = "com.tanah.daily929"
    device.adb("shell", "am", "force-stop", package)
    device.adb("shell", "monkey", "-p", package,
               "-c", "android.intent.category.LAUNCHER", 1)
    items = device.home()
    daily_source = find(items, "HomeDailySource").get("text")
    check.assertTrue(daily_source)
    check.assertIsNotNone(find(items, "HomeGlobalSearch"), "Global search missing at top")
    check.assertIn("פסוקים", find(items, "HomeVerseCount").get("text", ""))
    device.capture("home")
    device.tap("HomeDailyPerek")
    device.wait(lambda ns: source(ns) == daily_source and device.verses(ns),
                "Daily reader")
    device.capture("daily-reader")
    device.back()
    device.home()


def check_index(device, check):
    device.tap("HomeIndex")
    device.wait(lambda ns: find(ns, "PerekPickerConfirm") is not None, "Index")
    device.capture("index")
    device.back()
    device.wait(lambda ns: find(ns, "PerekPickerConfirm") is None, "Dismiss index")
    device.home()
    device.tap("HomeIndex")
    for label in ("תורה", "בראשית", "א", "PerekPickerConfirm"):
        device.tap(label)
    items = device.wait(lambda ns: source(ns) == "בראשית א" and device.verses(ns),
                        "Index reader")
    check.assertIsNotNone(find(items, "ReaderMenuButton"), "Reader menu clipped")
    check.assertIsNotNone(find(items, "TopBarHomeButton"), "Home action clipped")


def check_scroll_and_swipe(device, check):
    initial = device.nodes()
    viewport = bounds(find(initial, "PasukimCollection"))
    menu = find(initial, "ReaderMenuButton")
    articles = find(initial, "ArticlesButton")
    home = find(initial, "TopBarHomeButton")
    device.swipe(0.5, 0.76, 0.5, 0.34)
    items = device.wait(
        lambda ns: find(ns, "TopBarHomeButton") is None and find(ns, "TextButton") is None and device.verses(ns),
        "Both controls did not hide after the drag cooldown")
    check.assertEqual(bounds(find(items, "PasukimCollection")), viewport,
                      "Hiding the toolbar resized the reading viewport")
    check.assertNotEqual(device.verses(items)[0].get("text", "").split(" ", 1)[0],
                         "א", "Downward scroll did not advance the text")
    device.capture("reader-toolbar-hidden")
    device.swipe(0.5, 0.50, 0.5, 0.55)
    # The menu holds the revealed controls while UiAutomator waits for idle.
    # Coordinates came from this same fixed overlay before the drag.
    device.tap_node(menu)
    items = device.wait(
        lambda ns: find(ns, "ReaderGlobalSearch") is not None and find(ns, "TextButton") is not None and device.verses(ns),
        "The next drag did not restore both controls")
    check.assertEqual(bounds(find(items, "PasukimCollection")), viewport,
                      "Revealing the toolbar resized the reading viewport")
    check.assertNotEqual(device.verses(items)[0].get("text", "").split(" ", 1)[0],
                         "א", "Header reveal jumped to chapter start")
    device.capture("reader-toolbar-restored")
    device.back()
    device.swipe(0.2, 0.55, 0.8, 0.55)
    device.tap_node(menu)
    device.wait(lambda ns: source(ns) == "בראשית ב" and device.verses(ns),
                "Chapter swipe")
    device.back()
    device.tap_node(articles)
    device.wait(lambda ns: find(ns, "TopBarHomeButton") is not None and not device.verses(ns),
                "Articles restore reader navigation")
    device.capture("articles-with-navigation")
    device.tap("TextButton")
    device.tap_node(home)
    device.home()


def check_stacked_reader_links(device, check):
    daily_source = find(device.home(), "HomeDailySource").get("text")
    device.tap("HomeDailyPerek")
    device.wait(lambda ns: source(ns) == daily_source and device.verses(ns), "Daily reader")
    device.tap("ReaderMenuButton")
    device.tap("ReaderGlobalSearch")
    device.tap("PerekSearchInput")
    device.adb("shell", "input", "text", "1")
    device.wait(lambda ns: find(ns, "SearchResultTitle") is not None, "Reader search results")
    device.tap("SearchResultTitle")
    device.wait(lambda ns: source(ns) == "בראשית א" and device.verses(ns), "Nested search reader")
    device.adb("shell", "am", "start", "-W", "-a", "android.intent.action.VIEW", "-d",
               "https://xn--febl3a.co.il/929/2", "-p", "com.tanah.daily929")
    items = device.wait(lambda ns: source(ns) == "בראשית ב" and device.verses(ns),
                        "App link targets the visible nested reader")
    check.assertEqual(source(items), "בראשית ב")
    device.capture("nested-reader-app-link")
    device.back()
    device.wait(lambda ns: find(ns, "SearchNavigationButton") is not None,
                "Underlying reader retains search history")
    device.tap("SearchNavigationButton")
    device.wait(lambda ns: source(ns) == daily_source and device.verses(ns),
                "App link did not change the hidden daily reader")
    device.tap("TopBarHomeButton")
    device.home()


def check_destinations(device):
    device.tap("HomeCalendar")
    device.wait(lambda ns: find(ns, "MonthWeek") is not None, "Populated calendar")
    device.capture("calendar")
    device.back()
    device.home()
    device.tap_node(device.scroll_to("HomeAuthors"))
    device.wait(lambda ns: find(ns, "TopBarHomeButton") is not None,
                "Authors screen")
    device.capture("authors")
    device.back()
    device.home()


def check_global_search(device, check):
    device.tap("HomeGlobalSearch")
    device.wait(lambda ns: find(ns, "PerekSearchInput") is not None
                and find(ns, "PerekSearchInput").get("focused") == "true", "Focused global search")
    device.tap("SearchKindsTab")
    items = device.wait(lambda ns: find(ns, "SearchKindScreen") is not None, "Screen kind in the existing search")
    check.assertEqual(find(items, "SearchKindScreen").get("checked"), "true")
    device.capture("screen-search-kind")
    device.tap("SearchSheetDismissButton")
    device.tap("PerekSearchInput")
    device.adb("shell", "input", "text", "calendar")
    items = device.wait(lambda ns: find(ns, "לוח שנה") is not None,
                        "Navigation result for calendar")
    check.assertIsNotNone(find(items, "SearchResultTitle"))
    check.assertIsNotNone(find(items, "מסך"))
    device.capture("navigation-search")
    device.tap("לוח שנה")
    device.wait(lambda ns: find(ns, "MonthWeek") is not None,
                "Navigation search opens calendar")
    device.back()
    device.wait(lambda ns: find(ns, "PerekSearchInput") is not None, "Search history")
    device.tap("ClearSearchButton")
    device.tap("PerekSearchInput")
    device.adb("shell", "input", "text", "1")
    device.wait(lambda ns: find(ns, "SearchResultTitle") is not None,
                "Global content search returns chapter hits")
    device.capture("content-search")
    device.tap("SearchResultTitle")
    device.wait(lambda ns: source(ns) and device.verses(ns), "Content search reader")
    device.tap("TopBarHomeButton")
    device.home()


def check_screen_navigation(device, check):
    device.tap("HomeGlobalSearch")
    device.wait(lambda ns: find(ns, "PerekSearchInput") is not None, "Shared search")
    device.tap("PerekSearchInput")
    device.adb("shell", "input", "text", "index")
    device.wait(lambda ns: find(ns, 'ניווט בתנ"ך') is not None, "Bible navigation screen result")
    device.tap('ניווט בתנ"ך')
    device.wait(lambda ns: find(ns, "PerekPickerConfirm") is not None, "Bible navigation picker")
    device.capture("screen-navigation-picker")
    for label in ("תורה", "בראשית", "א", "PerekPickerConfirm"):
        device.tap(label)
    items = device.wait(lambda ns: source(ns) == "בראשית א" and device.verses(ns), "Navigation result reader")
    check.assertEqual(source(items), "בראשית א")
    device.tap("TopBarHomeButton")
    device.home()


def check_reading_options(device, check):
    device.tap("HomeDailyPerek")
    items = device.wait(lambda ns: source(ns) and device.verses(ns), "Daily reader")
    check.assertEqual(find(items, "TextButton").get("text").replace("\n", " "), "תצוגת הטקסט")
    check.assertEqual(find(items, "PerushimChevronButton").get("text").replace("\n", " "), "בחירת פירושים")
    check.assertEqual(find(items, "ArticlesButton").get("text").replace("\n", " "), "מאמרי הפרק")
    device.tap("TextButton")
    device.wait(lambda ns: find(ns, "FontPreviewText") is not None,
                "Text appearance action opens actual rendering preferences")
    device.capture("display-options")
    device.back()
    device.wait(lambda ns: source(ns) and device.verses(ns), "Return to reader")
    device.tap("PerushimChevronButton")
    items = device.wait(lambda ns: find(ns, "בחרו אילו פירושים יוצגו לצד הפסוקים") is not None,
                "Commentary picker explains its rendering effect")
    check.assertLessEqual(bounds(find(items, "PerushimContentViewport"))[3], bounds(find(items, "TextButton"))[1])
    device.capture("commentary")
    device.back()
    device.tap("ArticlesButton")
    items = device.wait(lambda ns: find(ns, "TextButton") is not None and not device.verses(ns), "Articles")
    check.assertEqual(find(items, "TextButton").get("text").replace("\n", " "), "חזרה לפסוקים")
    device.tap("TextButton")
    items = device.wait(device.verses, "Return to chapter text")
    check.assertEqual(find(items, "TextButton").get("text").replace("\n", " "), "תצוגת הטקסט")
    device.tap("TopBarHomeButton")
    device.home()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sdk = os.environ.get("ANDROID_HOME") or os.environ.get("ANDROID_SDK_ROOT")
    sdk = Path(sdk or Path(os.environ.get("LOCALAPPDATA", "")) / "Android/Sdk")
    executable = "adb.exe" if os.name == "nt" else "adb"
    parser.add_argument("--adb", default=str(sdk / "platform-tools" / executable))
    parser.add_argument("--serial", required=True)
    parser.add_argument("--artifacts", required=True, type=Path)
    args = parser.parse_args()
    device = NativeDevice(args)
    check = unittest.TestCase()
    checks = []
    for scenario in (check_home_and_daily, check_index, check_scroll_and_swipe, check_stacked_reader_links):
        scenario(device, check)
        checks.append(scenario.__name__)
        print(f"PASS {scenario.__name__}", flush=True)
    check_destinations(device)
    checks.append("check_destinations")
    check_global_search(device, check)
    checks.append("check_global_search")
    check_screen_navigation(device, check)
    checks.append("check_screen_navigation")
    check_reading_options(device, check)
    checks.append("check_reading_options")
    result = {"serial": args.serial, "passed": checks}
    (args.artifacts / "results.json").write_text(
        json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=True), flush=True)


if __name__ == "__main__":
    main()
