#!/usr/bin/env python3
"""Prepare the embedded downloader's version and profile-authorized signature."""

import argparse
import datetime as dt
import plistlib
import subprocess
from pathlib import Path


def signing_entitlements(profile, requested, bundle_id, now=None):
    """Add signing identity without granting unrequested profile capabilities."""
    now = now or dt.datetime.now(dt.timezone.utc)
    expiry = profile.get("ExpirationDate")
    if not isinstance(expiry, dt.datetime):
        raise ValueError("Extension provisioning profile has no expiration date")
    if expiry.replace(tzinfo=dt.timezone.utc) <= now:
        raise ValueError("Extension provisioning profile has expired")

    allowed = profile.get("Entitlements", {})
    app_id_key = ("application-identifier" if "application-identifier" in allowed
                  else "com.apple.application-identifier")
    app_id = allowed.get(app_id_key, "")
    prefixes = profile.get("ApplicationIdentifierPrefix", [])
    if not any(app_id == f"{prefix}.{bundle_id}" for prefix in prefixes):
        raise ValueError(f"Extension profile must explicitly authorize {bundle_id}")
    team = allowed.get("com.apple.developer.team-identifier")
    if not team or team not in profile.get("TeamIdentifier", []):
        raise ValueError("Extension profile has an inconsistent team identifier")

    result = dict(requested)
    for key, value in requested.items():
        authorized = allowed.get(key)
        if isinstance(value, list):
            if not isinstance(authorized, list) or any(v not in authorized for v in value):
                raise ValueError(f"Extension profile does not authorize {key}")
        elif value != authorized:
            raise ValueError(f"Extension profile does not authorize {key}")

    result[app_id_key] = app_id
    result["com.apple.developer.team-identifier"] = team
    result["get-task-allow"] = allowed.get("get-task-allow", False)
    return result


def stamp_version(extension, version, build):
    info_path = extension / "Info.plist"
    if not info_path.is_file():
        info_path = extension / "Contents" / "Info.plist"
    with info_path.open("rb") as source:
        info = plistlib.load(source)
    for key in ("CFBundleIdentifier", "CFBundleExecutable", "CFBundleName",
                "CFBundleDisplayName", "CFBundlePackageType"):
        value = info.get(key)
        if not isinstance(value, str) or not value or "$(" in value:
            raise ValueError(f"Built extension has missing/unexpanded {key}")
    info["CFBundleShortVersionString"] = version
    info["CFBundleVersion"] = build
    with info_path.open("wb") as destination:
        plistlib.dump(info, destination, fmt=plistlib.FMT_BINARY)
    return info["CFBundleIdentifier"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--extension", required=True, type=Path)
    parser.add_argument("--version", required=True)
    parser.add_argument("--build", required=True)
    parser.add_argument("--profile", type=Path)
    parser.add_argument("--entitlements", type=Path)
    parser.add_argument("--output-entitlements", type=Path)
    args = parser.parse_args()
    bundle_id = stamp_version(args.extension, args.version, args.build)
    if args.profile:
        if not args.entitlements or not args.output_entitlements:
            parser.error("--profile requires --entitlements and --output-entitlements")
        decoded = subprocess.run(
            ["security", "cms", "-D", "-i", str(args.profile)],
            check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        ).stdout
        with args.entitlements.open("rb") as source:
            requested = plistlib.load(source)
        entitlements = signing_entitlements(plistlib.loads(decoded), requested, bundle_id)
        args.output_entitlements.parent.mkdir(parents=True, exist_ok=True)
        with args.output_entitlements.open("wb") as destination:
            plistlib.dump(entitlements, destination)


if __name__ == "__main__":
    main()
