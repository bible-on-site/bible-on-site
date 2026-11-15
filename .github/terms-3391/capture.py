"""Capture matching release APKs on the same temporary GitHub-hosted Android device."""
import hashlib
import os
from pathlib import Path
import re
import subprocess
import time
import xml.etree.ElementTree as ET

ROOT = Path.cwd()
OUT = ROOT / "terms-frames"
OUT.mkdir(exist_ok=True)
APP = "com.tanah.daily929"

def adb(*args, timeout=20):
    return subprocess.check_output(["adb", "-s", "emulator-5554", *map(str, args)], timeout=timeout)

def dump():
    adb("shell", "uiautomator", "dump", "/sdcard/terms-evidence.xml")
    return ET.fromstring(adb("exec-out", "cat", "/sdcard/terms-evidence.xml"))

def values(node):
    return (node.get("text", ""), node.get("content-desc", ""), node.get("resource-id", "").split("/")[-1])

def rect(node):
    return list(map(int, re.findall(r"-?\d+", node.get("bounds", ""))))

def find(root, predicate):
    for node in root.iter("node"):
        coords = rect(node)
        if len(coords) == 4 and coords[2] > coords[0] and coords[3] > coords[1] and predicate(values(node)):
            return node
    return None

def tap(node):
    x1, y1, x2, y2 = rect(node)
    adb("shell", "input", "tap", (x1+x2)//2, (y1+y2)//2)

def swipe(amount):
    x = width // 2
    anchor = int(height * .74) if amount > 0 else int(height * .26)
    end = min(int(height*.90),max(int(height*.15), anchor-amount))
    adb("shell", "input", "swipe", x, anchor, x, end, 550)

def seek(predicate, swipe_until=False):
    last = None
    for _ in range(10):
        last = dump()
        node = find(last, predicate)
        if node is not None:
            return node
        if swipe_until:
            swipe(int(height * .35))
    raise RuntimeError("Visible Android hierarchy: " + str([(v[0][:65], v[1][:65], v[2]) for n in last.iter('node') if any(v:=values(n))]))

def has(*options):
    return lambda props: any(target == prop for prop in props for target in options)

display = adb("shell", "wm", "size").decode()
width, height = map(int, re.findall(r"(\d+)x(\d+)", display)[-1])
adb("shell", "settings", "put", "system", "font_scale", "1.0")
for side, expected_sha, target in (
    ("before", "e7d8bc0452ec00ab58a3396b0be0d40a21081823d45e6c69efcc33c6f276d01d", "תנכפדיה"),
    ("after", "6429bf947b4d7090565d5fbe754441c78357e0c8e8ac5464d0c15fae7ddb0f05", "גופן המיתוג"),
):
    apk, = (ROOT / (side + "-apk")).rglob("app-release-smoke.apk")
    assert hashlib.file_digest(apk.open("rb"), "sha256").hexdigest() == expected_sha
    adb("install", "-r", "-g", apk, timeout=60)
    adb("shell", "pm", "clear", APP)
    adb("shell", "monkey", "-p", APP, "-c", "android.intent.category.LAUNCHER", "1")
    try:
        menu = seek(lambda p: "פתיחת תפריט הניווט" in p or any(s.endswith("NavigationButton") for s in p))
        tap(menu)
        row = seek(lambda p: any(s == "FlyoutTerms" or s.startswith("תנאי שימוש") for s in p), swipe_until=True)
        tap(row)
        seek(has("TosMenuButton", "מדיניות פרטיות"))
        header = seek(has(target), swipe_until=True)
        # The section following accessibility is the matching anchor in both APKs.
        for _ in range(4):
            error = rect(header)[1] - int(height * .23)
            if abs(error) <= height * .07:
                break
            swipe(error)
            header = seek(has(target))
        if side == "after":
            seek(lambda p: any("Al Heperek Font" in s for s in p))
            seek(lambda p: any("רישיון גופן על הפרק" in s for s in p))
        hierarchy = dump()
        (OUT / (side+".xml")).write_bytes(ET.tostring(hierarchy, encoding="utf-8"))
        (OUT / (side+".png")).write_bytes(adb("exec-out", "screencap", "-p"))
    except Exception:
        (OUT / (side+"-failure.png")).write_bytes(adb("exec-out", "screencap", "-p"))
        raise

