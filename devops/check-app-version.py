"""Keep the app's displayed version and platform build numbers aligned."""

import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path


PROJECT = Path("app/BibleOnSite/BibleOnSite.csproj")


def check_version(path: Path) -> list[str]:
    root = ET.parse(path).getroot()
    display_versions = [element.text for element in root.iter("ApplicationDisplayVersion")]
    if len(display_versions) != 1 or not display_versions[0]:
        return ["Expected exactly one ApplicationDisplayVersion"]

    match = re.fullmatch(r"(\d+)\.(\d+)\.(\d+)", display_versions[0])
    if not match:
        return [f"Invalid ApplicationDisplayVersion: {display_versions[0]}"]

    major, minor, patch = map(int, match.groups())
    if minor >= 100 or patch >= 100_000:
        return ["Version minor must be below 100 and patch below 100000"]

    expected = {
        "android": major * 10_000_000 + minor * 100_000 + patch,
        "other platforms": patch,
    }
    actual = {}
    for element in root.iter("ApplicationVersion"):
        condition = element.get("Condition", "")
        if "== 'android'" in condition:
            platform = "android"
        elif "!= 'android'" in condition:
            platform = "other platforms"
        else:
            return [f"Unrecognized ApplicationVersion condition: {condition}"]
        if platform in actual:
            return [f"Duplicate ApplicationVersion for {platform}"]
        actual[platform] = element.text

    errors = []
    for platform, number in expected.items():
        if actual.get(platform) != str(number):
            errors.append(
                f"{platform} ApplicationVersion must be {number} for "
                f"ApplicationDisplayVersion {display_versions[0]} "
                f"(found {actual.get(platform)})"
            )
    return errors


if __name__ == "__main__":
    problems = check_version(Path(sys.argv[1]) if len(sys.argv) > 1 else PROJECT)
    for problem in problems:
        print(problem, file=sys.stderr)
    sys.exit(bool(problems))
