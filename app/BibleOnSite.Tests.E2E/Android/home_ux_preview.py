"""Native home UX checks for an installed HomeUxPreview Debug build."""

import argparse
from collections import Counter
import io
import json
import os
from pathlib import Path
import re
import subprocess  # nosec B404: validated Android SDK executable, argv only.
import sys
from threading import Event
import time
import unittest

from defusedxml import ElementTree
from PIL import Image


# Shared palette sampled on device (AppButtonStyles.cs, HomePage.xaml).
WHITE = (255, 255, 255)
PRIMARY_BLUE = (21, 82, 172)  # #1552AC - filled primary action
TILE_BLUE = (40, 102, 231)  # #2866E7 - alternating home tile
SECONDARY_DARK = (36, 60, 93)  # #243C5D - secondary surface in dark mode
COOLDOWN_MS = 1800  # ReaderChromeIdleState.CooldownMilliseconds


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


def dominant(image, rect, inset=6):
    """Most common pixel inside a node's bounds, away from rounded edges."""
    x1, y1, x2, y2 = rect
    region = image.crop((x1 + inset, y1 + inset, x2 - inset, y2 - inset))
    return Counter(region.get_flattened_data()).most_common(1)[0][0]


def is_color(rgb, target, tolerance=24):
    return all(abs(channel - expected) <= tolerance
               for channel, expected in zip(rgb, target))


def count_pixels(image, rect, predicate):
    x1, y1, x2, y2 = rect
    return sum(1 for pixel in image.crop((x1, y1, x2, y2)).get_flattened_data()
               if predicate(pixel))


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
        self.evidence = {}
        self.skipped = []
        self.system_anrs = set()
        self.app_start_anrs = 0
        dimensions = re.findall(r"(\d+)x(\d+)", self.adb("shell", "wm", "size").decode())
        self.width, self.height = map(int, dimensions[-1])

    def adb(self, *parts):
        return subprocess.check_output(self.base + list(map(str, parts)), timeout=40)  # nosec B603: validated SDK argv, no shell.  # nosemgrep

    def nodes(self):
        """Dump the live hierarchy; a transient bridge failure yields []."""
        try:
            response = self.adb("shell", "uiautomator", "dump", "/sdcard/home-ux.xml")
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
            # The UiAutomation bridge returns a null root / is killed while the
            # keyguard or an ANR owns the screen. Retry on the next poll.
            return []
        if b"dumped to:" not in response:
            return []
        try:
            raw = self.adb("shell", "cat", "/sdcard/home-ux.xml")
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
            return []
        (self.artifacts / "last.xml").write_bytes(raw)
        return list(ElementTree.fromstring(raw).iter("node"))

    def _anr_offender(self, items):
        """Return the offending app label/package for a visible ANR dialog."""
        if find(items, "aerr_close") is None:
            return None
        title = find(items, "alertTitle")
        text = (title.get("text") if title is not None else "") or ""
        if text:
            return text
        # Some builds leave the title empty; the window dump names the owner.
        # dumpsys is best-effort: the dialog itself is already proof of an ANR.
        try:
            windows = self.adb("shell", "dumpsys", "window").decode("utf-8", "replace")
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
            windows = ""
        match = re.search(r"Not Responding: ([\w.]+)", windows)
        if match:
            return match.group(1)
        return "Android application"

    def _is_app_anr(self, title):
        # Our label is "929 - תנ\"ך על הפרק" / package com.tanah.daily929.
        lowered = title.lower()
        return any(marker in lowered for marker in ("929", "daily929", "tanah"))

    def _raise_on_app_anr(self, items, description):
        """Abort on our app's ANR; dismiss stale system/keyboard ANRs instead.

        Emulator cold boots frequently surface System UI or IME "isn't
        responding" dialogs. Those are environment noise, not a regression in
        this app, so they are recorded, dismissed, and the poll continues.
        """
        offender = self._anr_offender(items)
        if offender is None:
            return
        if self._is_app_anr(offender):
            self.capture("application-not-responding")
            raise AssertionError(f"App ANR while {description}: {offender}")
        self.system_anrs.add(offender)
        self._dismiss_anr(items)

    def _dismiss_anr(self, items):
        dismiss = find(items, "aerr_wait")
        if dismiss is None:
            dismiss = find(items, "aerr_close")
        if dismiss is not None:
            self.tap_node(dismiss)

    def unlock(self):
        """Wake the device and dismiss the keyguard so the app can foreground."""
        self.adb("shell", "input", "keyevent", "KEYCODE_WAKEUP")
        self.adb("shell", "wm", "dismiss-keyguard")

    def settle_launch(self):
        """Wait out a slow cold start; a startup ANR is waited, not fatal.

        A first launch on a freshly booted or loaded emulator can trip a
        "failed to complete startup" ANR while ART/MAUI warm up. The process
        does finish starting, so that dialog is dismissed with "Wait" and the
        home screen is given the full budget. An app ANR during interactive
        scenarios still aborts via wait()/hold().
        """
        self.unlock()
        deadline = time.monotonic() + 120
        while time.monotonic() < deadline:
            items = self.nodes()
            if find(items, "HomeGlobalSearch") is not None:
                return
            if not items:
                # Screen off or a held keyguard blocked the accessibility dump.
                self.unlock()
                self.poll_interval.wait(0.3)
                continue
            offender = self._anr_offender(items)
            if offender is not None:
                if self._is_app_anr(offender):
                    self.app_start_anrs += 1
                else:
                    self.system_anrs.add(offender)
                self._dismiss_anr(items)
                continue
            self.poll_interval.wait(0.3)

    def wait(self, predicate, description):
        deadline = time.monotonic() + 90
        while time.monotonic() < deadline:
            items = self.nodes()
            self._raise_on_app_anr(items, f"waiting for {description}")
            if predicate(items):
                return items
            self.poll_interval.wait(0.3)
        raise AssertionError(description)

    def hold(self, predicate, description, milliseconds):
        """Keep polling while a state must remain true (e.g. no idle timer arms)."""
        deadline = time.monotonic() + milliseconds / 1000
        items = []
        while time.monotonic() < deadline:
            items = self.nodes()
            self._raise_on_app_anr(items, f"holding {description}")
            if not predicate(items):
                self.capture("hold-violation")
                raise AssertionError(f"State did not hold: {description}")
            self.poll_interval.wait(0.3)
        return items

    def screen_image(self):
        return Image.open(io.BytesIO(self.adb("exec-out", "screencap", "-p"))).convert("RGB")

    def tap_point(self, x, y):
        self.adb("shell", "input", "tap", x, y)

    def record(self, key, value):
        self.evidence[key] = value

    def skip(self, check_name, reason):
        self.skipped.append({"check": check_name, "reason": reason})
        print(f"SKIP {check_name}: {reason}", flush=True)

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

    def to_home(self):
        """Return to the home page wherever a cold start resumed.

        The app restores the last-open perek into the reader on relaunch, so
        the suite can start on the reader (or with a flyout/overlay) instead
        of the home page. Prefer the reader's own home action; otherwise back.
        """
        for _ in range(12):
            items = self.nodes()
            if find(items, "HomeGlobalSearch") is not None:
                return
            self._raise_on_app_anr(items, "navigating to home")
            home_button = find(items, "TopBarHomeButton")
            if home_button is not None:
                self.tap_node(home_button)
            else:
                self.back()
            self.poll_interval.wait(0.3)
        raise AssertionError("Could not navigate back to the home page")

    def home(self):
        self.to_home()
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

    def scroll_into_view(self, *selectors):
        """Scroll the current page until a control is inside the window."""
        for _ in range(8):
            items = self.nodes()
            for selector in selectors:
                node = find(items, selector)
                if node is not None:
                    _, top, _, bottom = bounds(node)
                    if top >= 0 and bottom <= self.height:
                        return items, node
            self.swipe(0.5, 0.8, 0.5, 0.4)
        raise AssertionError(f"Control is not reachable: {selectors}")

    def back(self):
        self.adb("shell", "input", "keyevent", 4)


def check_home_and_daily(device, check):
    package = "com.tanah.daily929"
    device.unlock()
    device.adb("shell", "am", "force-stop", package)
    device.adb("shell", "monkey", "-p", package,
               "-c", "android.intent.category.LAUNCHER", 1)
    device.settle_launch()
    items = device.home()
    daily_source = find(items, "HomeDailySource").get("text")
    check.assertTrue(daily_source)
    check.assertIsNotNone(find(items, "HomeGlobalSearch"), "Global search missing at top")
    check.assertIn("פסוקים", find(items, "HomeVerseCount").get("text", ""))
    device.capture("home")
    device.tap("HomeDailyPerek")
    items = device.wait(lambda ns: source(ns) == daily_source and device.verses(ns),
                        "Daily reader")
    # First entry leaves both bars visible; loading must not arm the idle timer.
    top = find(items, "TopBarHomeButton")
    dock = find(items, "TextButton")
    check.assertIsNotNone(top, "Top bar must be visible on first entry")
    check.assertIsNotNone(dock, "Dock must be visible on first entry")
    top_bounds, dock_bounds = bounds(top), bounds(dock)
    viewport = bounds(find(items, "PasukimCollection"))
    held = device.hold(lambda ns: find(ns, "TopBarHomeButton") is not None
                       and find(ns, "TextButton") is not None,
                       "entry idle visibility", COOLDOWN_MS + 900)
    check.assertEqual(bounds(find(held, "TopBarHomeButton")), top_bounds,
                      "Top bar moved without any drag")
    check.assertEqual(bounds(find(held, "PasukimCollection")), viewport,
                      "Reading viewport resized while idle after loading")
    device.record("idle_entry", {"held_ms": COOLDOWN_MS + 900,
                                 "top_bounds": top_bounds, "dock_bounds": dock_bounds,
                                 "viewport": viewport})
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
    # Coordinates came from this same fixed overlay before the drag. Opening it
    # proves the shadowless top bar stays clickable above scrolled scripture.
    device.tap_node(menu)
    items = device.wait(
        lambda ns: find(ns, "ReaderGlobalSearch") is not None and find(ns, "TextButton") is not None and device.verses(ns),
        "The next drag did not restore both controls")
    check.assertEqual(bounds(find(items, "PasukimCollection")), viewport,
                      "Revealing the toolbar resized the reading viewport")
    check.assertNotEqual(device.verses(items)[0].get("text", "").split(" ", 1)[0],
                         "א", "Header reveal jumped to chapter start")
    # The revealed top band stays white over the scrolled text.
    image = device.screen_image()
    home_button = bounds(find(items, "TopBarHomeButton"))
    menu_button = bounds(find(items, "ReaderMenuButton"))
    strip = [min(home_button[2], menu_button[2]),
             max(home_button[1], menu_button[1]),
             max(home_button[0], menu_button[0]),
             min(home_button[3], menu_button[3])]
    check.assertGreater(strip[2] - strip[0], 8,
                        "No measurable band between the top bar actions")
    band = dominant(image, strip)
    check.assertTrue(is_color(band, WHITE),
                     f"Top band is not white over scripture: {band}")
    device.capture("reader-toolbar-restored")
    device.back()
    # The cooldown is repeatable: the controls hide again, and an upward drag
    # reveals them without moving the viewport.
    items = device.wait(
        lambda ns: find(ns, "TopBarHomeButton") is None and find(ns, "TextButton") is None and device.verses(ns),
        "Controls did not hide again after a second idle cooldown")
    check.assertEqual(bounds(find(items, "PasukimCollection")), viewport,
                      "The second hide resized the reading viewport")
    device.swipe(0.5, 0.50, 0.5, 0.44)
    items = device.wait(
        lambda ns: find(ns, "TopBarHomeButton") is not None and find(ns, "TextButton") is not None,
        "An upward drag did not reveal both controls")
    check.assertEqual(bounds(find(items, "TopBarHomeButton")), bounds(home),
                      "Revealed top bar moved from its fixed position")
    device.record("idle_cycle", {
        "hidden_viewport": viewport, "white_band_rgb": list(band),
        "repeat_hide_and_reveal": True, "top_bar_clickable_over_scroll": True})
    device.swipe(0.2, 0.55, 0.8, 0.55)
    device.tap_node(menu)
    device.wait(lambda ns: source(ns) == "בראשית ב" and device.verses(ns),
                "Chapter swipe")
    device.back()
    device.swipe(0.8, 0.55, 0.2, 0.55)
    items = device.wait(lambda ns: source(ns) == "בראשית א" and device.verses(ns),
                        "Reverse chapter swipe")
    check.assertEqual(source(items), "בראשית א")
    device.tap_node(articles)
    device.wait(lambda ns: find(ns, "TopBarHomeButton") is not None and not device.verses(ns),
                "Articles restore reader navigation")
    device.capture("articles-with-navigation")
    device.tap("ArticlesButton")
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


def check_destinations(device, check):
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
    device.tap("SearchBooksTab")
    items = device.wait(lambda ns: find(ns, "SearchBooksSelectAll") is not None,
                        "Book filter sheet")
    check.assertIsNotNone(find(items, "בראשית"), "Book filter lost its sefer rows")
    device.record("book_filter", {"sheet": "SearchBooksTab", "select_all": True})
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
    check.assertEqual(find(items, "TextButton").get("text").replace("\n", " "), 'ניווט בתנ"ך')
    check.assertEqual(find(items, "PerushimChevronButton").get("text").replace("\n", " "), "בחירת פירושים")
    check.assertEqual(find(items, "ArticlesButton").get("text").replace("\n", " "), "מאמרי הפרק")
    device.tap("TextButton")
    items = device.wait(lambda ns: find(ns, "PerekPickerConfirm") is not None, "Dock opens Bible navigation")
    device.capture("reader-navigation")
    # The picker heading band is white in the preview; the selected row is a
    # filled primary surface with readable white text.
    heading = find(items, "בחירת פרק")
    check.assertIsNotNone(heading, "Picker heading missing")
    image = device.screen_image()
    check.assertTrue(is_color(dominant(image, bounds(heading)), WHITE),
                     "Chapter picker heading band is not white")
    for label in ("תורה", "בראשית", "ג"):
        device.tap(label)
    items = device.nodes()
    selected = next((n for n in items if n.get("text") == "ג"
                     and n.get("resource-id", "").endswith("/PickerPerekItem")), None)
    check.assertIsNotNone(selected, "Selected perek row not found")
    row = bounds(selected)
    image = device.screen_image()
    check.assertTrue(is_color(dominant(image, row), PRIMARY_BLUE),
                     "Selected picker row is not the primary fill")
    check.assertGreater(
        count_pixels(image, row, lambda px: all(channel > 225 for channel in px)), 6,
        "Selected picker row text is not readable white")
    device.record("picker", {"selected_row_bounds": row,
                             "selected_row_white_text": True,
                             "white_heading": True})
    device.tap("PerekPickerConfirm")
    device.wait(lambda ns: source(ns) == "בראשית ג" and device.verses(ns),
                "Dock picker navigates to the selected chapter")
    device.capture("reader-navigation")
    items = device.nodes()
    dock = bounds(find(items, "TextButton"))
    device.tap("PerushimChevronButton")
    items = device.wait(lambda ns: find(ns, "בחרו אילו פירושים יוצגו לצד הפסוקים") is not None,
                "Commentary picker explains its rendering effect")
    sheet_node = find(items, "PerushimContentViewport")
    sheet = bounds(sheet_node)
    check.assertGreaterEqual(sheet[3], dock[3])
    # The sheet must also intercept a real tap inside the covered dock area; a
    # bounds/Z-order check alone cannot prove touch coverage. Land the tap on
    # the dock's navigation action while avoiding the sheet's own children.
    sheet_children = {id(node) for node in sheet_node.iter("node")}
    blocked = [bounds(n) for n in items
               if n.get("clickable") == "true" and id(n) in sheet_children]
    tap_at = None
    for y in range(min(sheet[3], dock[3]) - 6, max(sheet[1], dock[1]) + 6, -4):
        for x in range(dock[0] + 6, dock[2] - 6, 4):
            if not any(b[0] <= x <= b[2] and b[1] <= y <= b[3] for b in blocked):
                tap_at = (x, y)
                break
        if tap_at is not None:
            break
    check.assertIsNotNone(tap_at, "No safe tap point inside the covered dock")
    device.tap_point(*tap_at)
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        if find(device.nodes(), "PerekPickerConfirm") is not None:
            raise AssertionError(
                "A tap inside the covered dock reached the hidden navigation action")
        device.poll_interval.wait(0.3)
    items = device.nodes()
    check.assertIsNotNone(find(items, "PerushimContentViewport"),
                          "The overlap tap dismissed the commentary sheet")
    device.record("commentary_overlap", {"dock_bounds": dock, "sheet_bounds": sheet,
                                         "intercepted_tap": list(tap_at)})
    device.capture("commentary")
    device.back()
    device.tap("ArticlesButton")
    items = device.wait(lambda ns: find(ns, "TextButton") is not None and not device.verses(ns), "Articles")
    check.assertEqual(find(items, "TextButton").get("text").replace("\n", " "), 'ניווט בתנ"ך')
    check.assertEqual(find(items, "ArticlesButton").get("text").replace("\n", " "), "חזרה לפרק")
    device.tap("TextButton")
    device.wait(lambda ns: find(ns, "PerekPickerConfirm") is not None, "Navigation stays available from articles")
    device.back()
    device.tap("ArticlesButton")
    items = device.wait(device.verses, "Return to chapter text")
    check.assertEqual(find(items, "ArticlesButton").get("text").replace("\n", " "), "מאמרי הפרק")
    device.tap("TopBarHomeButton")
    device.home()


def check_home_tile_fills(device, check):
    """Small home tiles alternate white and blue; sampling proves it visually."""
    expected = {
        "HomeIndex": WHITE, "HomeCalendar": TILE_BLUE, "HomeTanahpedia": TILE_BLUE,
        "HomeMasora": WHITE, "HomeAuthors": WHITE, "HomeBulletin": TILE_BLUE,
        "HomeContact": TILE_BLUE, "HomeDonations": WHITE, "HomeTerms": WHITE,
    }
    fills = {}
    for tile, color in expected.items():
        node = device.scroll_to(tile)
        rgb = dominant(device.screen_image(), bounds(node), inset=10)
        fills[tile] = list(rgb)
        check.assertTrue(is_color(rgb, color),
                         f"{tile} fill sampled as {rgb}, expected {color}")
    device.record("home_tile_fills", fills)
    # The holiday tile keeps its Hebrew day glyph.
    device.scroll_to("HomeMoadim", upward=True)
    items = device.nodes()
    check.assertIsNotNone(find(items, 'ט"ו'),
                          "Holiday tile lost its Hebrew day glyph")
    device.scroll_to("HomeDailyPerek", upward=True)


def check_search_layout(device, check):
    """Prove the authors search pill fills the remaining top-bar width.

    A hidden trailing clear action must not reserve space.
    """
    device.tap_node(device.scroll_to("HomeAuthors"))
    items = device.wait(lambda ns: find(ns, "AuthorsSearchInput") is not None,
                        "Authors screen")
    box = bounds(find(items, "AuthorsSearchInput"))
    actions = {name: bounds(find(items, name))
               for name in ("TopBarHomeButton", "TopBarBackButton")
               if find(items, name) is not None}
    check.assertTrue(actions, "Top actions missing on the authors screen")
    check.assertTrue(any(box[1] < b[3] and box[3] > b[1] for b in actions.values()),
                     "Search input is not in the top actions row")
    right_gap = min(b[0] - box[2] for b in actions.values() if b[0] >= box[2])
    check.assertTrue(0 <= right_gap <= 48,
                     f"Hidden clear action reserves trailing space: {right_gap}px")
    check.assertIsNone(find(items, "ClearAuthorsSearchButton"),
                       "Clear action should be hidden while the field is empty")
    device.tap("AuthorsSearchInput")
    device.adb("shell", "input", "text", "a")
    items = device.wait(lambda ns: find(ns, "ClearAuthorsSearchButton") is not None,
                        "Clear action while typing")
    shrunk = bounds(find(items, "AuthorsSearchInput"))
    check.assertGreater(box[2] - shrunk[2], 12,
                        "Revealed clear action did not take layout space")
    device.tap_node(find(items, "ClearAuthorsSearchButton"))
    items = device.wait(lambda ns: find(ns, "ClearAuthorsSearchButton") is None,
                        "Clear action hides again")
    check.assertEqual(bounds(find(items, "AuthorsSearchInput")), box,
                      "Search input did not reclaim the cleared width")
    device.record("authors_search", {"input_bounds": box, "action_bounds": actions,
                                     "right_gap_px": right_gap})
    device.back()
    device.home()


def check_shared_button_styles(device, check):
    """Sample real pixels for the shared button styles.

    Secondary actions are white, primary actions filled blue, and dark mode
    surfaces switch to navy.
    """
    fills = {}
    device.tap("HomePreferences")
    device.tap_node(device.scroll_into_view("SettingsDisplayRow")[1])
    items, node = device.scroll_into_view("ResetPasukFontPercentButton")
    rgb = dominant(device.screen_image(), bounds(node))
    check.assertTrue(is_color(rgb, WHITE),
                     f"Reset is not a white secondary action: {rgb}")
    fills["display-options:ResetPasukFontPercentButton"] = list(rgb)
    device.capture("display-options")
    device.back()
    device.tap_node(device.scroll_into_view("SettingsPacksRow")[1])
    items, node = device.scroll_into_view("DownloadPerushimButton",
                                          "RemovePerushimButton")
    if node.get("resource-id", "").endswith("/DownloadPerushimButton"):
        rgb = dominant(device.screen_image(), bounds(node))
        check.assertTrue(is_color(rgb, PRIMARY_BLUE),
                         f"Download is not a filled primary action: {rgb}")
        fills["extension-packs:DownloadPerushimButton"] = list(rgb)
    else:
        device.skip("extension-packs:DownloadPerushimButton",
                    "commentary pack already installed (RemovePerushimButton shown)")
    device.capture("extension-packs")
    device.back()
    device.tap_node(device.scroll_into_view("SettingsSupportRow")[1])
    items, node = device.scroll_into_view("ExportPerushimLogsButton")
    rgb = dominant(device.screen_image(), bounds(node))
    check.assertTrue(is_color(rgb, WHITE),
                     f"Export is not a white secondary action: {rgb}")
    fills["support:ExportPerushimLogsButton"] = list(rgb)
    device.capture("support")
    # Dark mode: the same secondary action switches to the navy surface.
    device.adb("shell", "cmd", "uimode", "night", "yes")
    try:
        deadline = time.monotonic() + 30
        rgb = None
        while time.monotonic() < deadline:
            node = find(device.nodes(), "ExportPerushimLogsButton")
            if node is not None:
                rgb = dominant(device.screen_image(), bounds(node))
                if is_color(rgb, SECONDARY_DARK):
                    break
            device.poll_interval.wait(0.5)
        check.assertIsNotNone(find(device.nodes(), "ExportPerushimLogsButton"),
                              "Support screen disappeared in dark mode")
        check.assertTrue(rgb is not None and is_color(rgb, SECONDARY_DARK),
                         f"Dark export is not the navy surface: {rgb}")
        fills["support-dark:ExportPerushimLogsButton"] = list(rgb)
        device.capture("support-dark")
    finally:
        device.adb("shell", "cmd", "uimode", "night", "no")
    device.back()
    device.back()
    device.home()
    # In the reader's empty commentary state both styles appear together.
    device.tap("HomeDailyPerek")
    device.wait(lambda ns: source(ns) and device.verses(ns), "Daily reader")
    device.tap("PerushimChevronButton")
    items = device.wait(lambda ns: find(ns, "PerushimContentViewport") is not None,
                        "Commentary sheet")
    if find(items, "PerushimEmptyIcon") is not None and \
            find(items, "GoToPerushimSettingsButton") is not None:
        image = device.screen_image()
        rgb = dominant(image, bounds(find(items, "GoToPerushimSettingsButton")))
        check.assertTrue(is_color(rgb, PRIMARY_BLUE),
                         f"Download action is not filled primary: {rgb}")
        fills["commentary:GoToPerushimSettingsButton"] = list(rgb)
        rgb = dominant(image, bounds(find(items, "ExportPerushimLogsButton")))
        check.assertTrue(is_color(rgb, WHITE),
                         f"Commentary export is not a white secondary: {rgb}")
        fills["commentary:ExportPerushimLogsButton"] = list(rgb)
        device.capture("commentary-buttons")
    else:
        device.skip("commentary button fills",
                    "commentary pack installed - the empty state is not shown")
    device.record("button_fills", fills)
    device.back()
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
    sys.stdout.reconfigure(encoding="utf-8")
    device = NativeDevice(args)
    check = unittest.TestCase()
    checks = []
    for scenario in (check_home_and_daily, check_index, check_scroll_and_swipe,
                     check_stacked_reader_links, check_destinations,
                     check_home_tile_fills, check_global_search,
                     check_search_layout, check_screen_navigation,
                     check_reading_options, check_shared_button_styles):
        scenario(device, check)
        checks.append(scenario.__name__)
        print(f"PASS {scenario.__name__}", flush=True)
    result = {
        "serial": args.serial,
        "passed": checks,
        "skipped": device.skipped,
        "dismissed_system_anrs": sorted(device.system_anrs),
        "startup_anrs_waited": device.app_start_anrs,
        "evidence": device.evidence,
        "requires": [
            "an Android emulator selected by --serial with the HomeUxPreview Debug build installed (com.tanah.daily929); no concurrent manual input",
            "commentary download-button sampling requires a fresh install without the perushim pack",
            "dark-mode sampling toggles `cmd uimode night` and restores light afterward",
            "live article counters need BibleOnSite/Resources/Raw/api-config.txt with the production API; otherwise packaged data and offline labels apply",
            "iOS is an unavailable platform on a Windows host; Android covers the native regressions",
        ],
    }
    (args.artifacts / "results.json").write_text(
        json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=True), flush=True)


if __name__ == "__main__":
    main()
