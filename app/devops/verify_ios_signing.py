"""Fail before upload when iOS distribution provisioning or the final IPA is invalid.

Run on macOS, where security, codesign, and ditto are provided by the OS.
Profile mode can run before the expensive build; package mode checks the actual
embedded profiles, signed entitlements, signatures, and ExtensionKit metadata.
"""

import argparse
from datetime import datetime, timezone
from pathlib import Path
import plistlib
import struct
import subprocess
import sys
import tempfile


APP_ID = "com.tanah.daily929"
EXTENSION_ID = APP_ID + ".AssetPackDownloader"
APP_GROUP = "group.com.tanah.daily929.assets"
EXTENSION_POINT = "com.apple.background-asset-downloader-extension"


class SigningError(ValueError):
    """An actionable release-signing failure."""


def run(command):
    try:
        result = subprocess.run(command, check=True, capture_output=True)
    except FileNotFoundError as error:
        raise SigningError(f"Required macOS tool is unavailable: {command[0]}") from error
    except subprocess.CalledProcessError as error:
        detail = (error.stderr or error.stdout or b"").decode(errors="replace").strip()
        raise SigningError(f"{' '.join(map(str, command))} failed: {detail}") from error
    return result.stdout


def read_plist(path):
    try:
        with Path(path).open("rb") as stream:
            value = plistlib.load(stream)
    except (OSError, plistlib.InvalidFileException, ValueError) as error:
        raise SigningError(f"Cannot read plist {path}: {error}") from error
    if not isinstance(value, dict):
        raise SigningError(f"Expected a plist dictionary: {path}")
    return value


def decode_profile(path, runner=run):
    path = Path(path)
    if not path.is_file():
        raise SigningError(f"Missing provisioning profile: {path}")
    try:
        profile = plistlib.loads(runner(["security", "cms", "-D", "-i", str(path)]))
    except (plistlib.InvalidFileException, ValueError) as error:
        raise SigningError(f"Cannot decode provisioning profile {path}: {error}") from error
    if not isinstance(profile, dict):
        raise SigningError(f"Invalid provisioning profile: {path}")
    return profile


def validate_profile(profile, bundle_id, label, now=None):
    entitlements = profile.get("Entitlements", {})
    if not isinstance(entitlements, dict):
        raise SigningError(f"{label}: invalid profile entitlements")
    teams = profile.get("TeamIdentifier", [])
    if not isinstance(teams, list) or len(teams) != 1 or not isinstance(teams[0], str) or not teams[0]:
        raise SigningError(f"{label}: profile must identify one signing team")
    team = teams[0]
    if entitlements.get("com.apple.developer.team-identifier") != team:
        raise SigningError(f"{label}: profile signing team does not match its entitlements")
    prefixes = profile.get("ApplicationIdentifierPrefix", [team])
    if not isinstance(prefixes, list) or not prefixes or not all(isinstance(prefix, str) for prefix in prefixes):
        raise SigningError(f"{label}: invalid application identifier prefix")
    identifiers = {f"{prefix}.{bundle_id}" for prefix in prefixes}
    if entitlements.get("application-identifier") not in identifiers:
        raise SigningError(f"{label}: profile must authorize the explicit App ID {bundle_id}")
    expires = profile.get("ExpirationDate")
    if not isinstance(expires, datetime):
        raise SigningError(f"{label}: profile has no valid expiration date")
    expires = expires.replace(tzinfo=timezone.utc) if expires.tzinfo is None else expires
    if expires <= (now or datetime.now(timezone.utc)):
        raise SigningError(f"{label}: provisioning profile expired at {expires.isoformat()}")
    if (entitlements.get("get-task-allow") is not False
            or "ProvisionedDevices" in profile or profile.get("ProvisionsAllDevices")):
        raise SigningError(f"{label}: an App Store distribution provisioning profile is required")
    groups = entitlements.get("com.apple.security.application-groups", [])
    if not isinstance(groups, list) or APP_GROUP not in groups:
        raise SigningError(f"{label}: provisioning profile does not authorize App Group {APP_GROUP}")
    return team


def _authorized_value(requested, allowed, wildcard=False):
    if isinstance(requested, list):
        return isinstance(allowed, list) and all(
            any(_authorized_value(value, candidate, wildcard) for candidate in allowed)
            for value in requested)
    if isinstance(requested, dict):
        return isinstance(allowed, dict) and all(
            key in allowed and _authorized_value(value, allowed[key], wildcard)
            for key, value in requested.items())
    if wildcard and isinstance(requested, str) and isinstance(allowed, str) and allowed.endswith("*"):
        return requested.startswith(allowed[:-1])
    return type(requested) is type(allowed) and requested == allowed


def validate_entitlements(requested, profile, label, signed=False, bundle_id=None):
    allowed = profile["Entitlements"]
    for key, value in requested.items():
        wildcard = key in {"application-identifier", "keychain-access-groups"}
        if key not in allowed or not _authorized_value(value, allowed[key], wildcard):
            raise SigningError(f"{label}: entitlement {key} is not authorized by its provisioning profile")
    if APP_GROUP not in requested.get("com.apple.security.application-groups", []):
        raise SigningError(f"{label}: signed/requested entitlements are missing App Group {APP_GROUP}")
    if signed:
        prefixes = profile.get("ApplicationIdentifierPrefix", profile["TeamIdentifier"])
        if requested.get("application-identifier") not in {f"{prefix}.{bundle_id}" for prefix in prefixes}:
            raise SigningError(f"{label}: signed application-identifier does not match {bundle_id}")
        if requested.get("com.apple.developer.team-identifier") != profile["TeamIdentifier"][0]:
            raise SigningError(f"{label}: signed entitlements do not identify the profile's signing team")


def verify_profiles(app_path, extension_path, app_entitlements=None, extension_entitlements=None, runner=run):
    profiles = [decode_profile(app_path, runner), decode_profile(extension_path, runner)]
    teams = [validate_profile(profile, bundle_id, label) for profile, bundle_id, label in zip(
        profiles, [APP_ID, EXTENSION_ID], ["App", "AssetPackDownloader"])]
    if teams[0] != teams[1]:
        raise SigningError("App and AssetPackDownloader provisioning profiles belong to different teams")
    for path, profile, label in zip([app_entitlements, extension_entitlements], profiles,
                                    ["App", "AssetPackDownloader"]):
        if path is not None:
            validate_entitlements(read_plist(path), profile, label)
    return profiles


def has_swift_entry(data):
    """Inspect Mach-O load commands, rather than accepting a stray section-name string."""
    def thin(image):
        if image[:4] not in (b"\xcf\xfa\xed\xfe", b"\xfe\xed\xfa\xcf"):
            return False
        endian = "<" if image[:4] == b"\xcf\xfa\xed\xfe" else ">"
        if len(image) < 32:
            return False
        ncmds, sizeofcmds = struct.unpack_from(endian + "II", image, 16)
        end = 32 + sizeofcmds
        if end > len(image):
            return False
        offset = 32
        found = False
        for _ in range(ncmds):
            if offset + 8 > end:
                return False
            command, size = struct.unpack_from(endian + "II", image, offset)
            if size < 8 or offset + size > end:
                return False
            if command == 0x19:  # LC_SEGMENT_64
                if size < 72:
                    return False
                sections = struct.unpack_from(endian + "I", image, offset + 64)[0]
                if 72 + sections * 80 > size:
                    return False
                for index in range(sections):
                    section = offset + 72 + index * 80
                    name = image[section:section + 16].rstrip(b"\0")
                    segment = image[section + 16:section + 32].rstrip(b"\0")
                    section_size = struct.unpack_from(endian + "Q", image, section + 40)[0]
                    file_offset = struct.unpack_from(endian + "I", image, section + 48)[0]
                    if (name == b"__swift5_entry" and segment == b"__TEXT" and section_size
                            and file_offset + section_size <= len(image)):
                        found = True
            offset += size
        return found

    if data[:4] in (b"\xca\xfe\xba\xbe", b"\xca\xfe\xba\xbf"):
        if len(data) < 8:
            return False
        count = struct.unpack_from(">I", data, 4)[0]
        fat64 = data[:4] == b"\xca\xfe\xba\xbf"
        size = 32 if fat64 else 20
        if not count or 8 + count * size > len(data):
            return False
        for index in range(count):
            record = 8 + index * size
            offset, length = struct.unpack_from(">QQ" if fat64 else ">II", data, record + 8)
            if not length or offset + length > len(data) or not thin(data[offset:offset + length]):
                return False
        return True
    return thin(data)


def validate_bundle(bundle, bundle_id, package_type, parent_info=None):
    info = read_plist(bundle / "Info.plist")
    for key in ["CFBundleIdentifier", "CFBundleExecutable", "CFBundleName", "CFBundleDisplayName",
                "CFBundleVersion", "CFBundleShortVersionString"]:
        if not isinstance(info.get(key), str) or not info[key].strip() or "$(" in info[key]:
            raise SigningError(f"{bundle.name}: missing/invalid {key}")
    if info["CFBundleIdentifier"] != bundle_id:
        raise SigningError(f"{bundle.name}: CFBundleIdentifier must be {bundle_id}")
    if info.get("CFBundlePackageType") != package_type:
        raise SigningError(f"{bundle.name}: CFBundlePackageType must be {package_type}")
    executable = info["CFBundleExecutable"]
    if Path(executable).name != executable or "/" in executable or "\\" in executable:
        raise SigningError(f"{bundle.name}: CFBundleExecutable must name a bundled file")
    binary = bundle / executable
    if not binary.is_file():
        raise SigningError(f"{bundle.name}: CFBundleExecutable {executable} is missing")
    if parent_info is not None:
        for key in ["CFBundleVersion", "CFBundleShortVersionString"]:
            if info[key] != parent_info[key]:
                raise SigningError(f"{bundle.name}: {key} must match its containing app")
        attributes = info.get("EXAppExtensionAttributes", {})
        if not isinstance(attributes, dict) or attributes.get("EXExtensionPointIdentifier") != EXTENSION_POINT:
            raise SigningError(f"{bundle.name}: invalid ExtensionKit extension point")
        principal_class = attributes.get("EXPrincipalClass")
        if not (isinstance(principal_class, str) and principal_class.strip()) and not has_swift_entry(binary.read_bytes()):
            raise SigningError(f"{bundle.name}: missing ExtensionKit __swift5_entry section or EXPrincipalClass")
    return info


def verify_package(package, runner=run):
    package = Path(package).resolve()
    if not package.is_file():
        raise SigningError(f"Missing IPA: {package}")
    with tempfile.TemporaryDirectory(prefix="ios-signing-") as temporary:
        root = Path(temporary)
        # ditto preserves bundle symlinks and modes, as Apple's IPA tooling expects.
        runner(["ditto", "-x", "-k", str(package), str(root)])
        apps = list((root / "Payload").glob("*.app"))
        if len(apps) != 1:
            raise SigningError("IPA must contain exactly one Payload/*.app bundle")
        app = apps[0]
        extensions = list(app.rglob("AssetPackDownloader.appex"))
        expected_extension = app / "Extensions" / "AssetPackDownloader.appex"
        if extensions != [expected_extension] or not expected_extension.is_dir():
            raise SigningError("IPA must embed AssetPackDownloader.appex once under the app's Extensions directory")
        extension = expected_extension
        app_info = validate_bundle(app, APP_ID, "APPL")
        validate_bundle(extension, EXTENSION_ID, "XPC!", parent_info=app_info)
        profiles = verify_profiles(app / "embedded.mobileprovision", extension / "embedded.mobileprovision", runner=runner)
        for bundle, bundle_id, profile in zip([app, extension], [APP_ID, EXTENSION_ID], profiles):
            runner(["codesign", "--verify", "--strict", "--verbose=2", str(bundle)])
            certificate_prefix = root / (bundle.name + "-certificate-")
            runner(["codesign", "-d", "--extract-certificates", str(certificate_prefix), str(bundle)])
            certificate = Path(str(certificate_prefix) + "0")
            if not certificate.is_file() or certificate.read_bytes() not in profile.get("DeveloperCertificates", []):
                raise SigningError(f"{bundle.name}: signing certificate is not authorized by its provisioning profile")
            try:
                entitlements = plistlib.loads(runner(["codesign", "-d", "--entitlements", ":-", str(bundle)]))
            except (plistlib.InvalidFileException, ValueError) as error:
                raise SigningError(f"{bundle.name}: cannot read signed entitlements: {error}") from error
            if not isinstance(entitlements, dict):
                raise SigningError(f"{bundle.name}: missing signed entitlements")
            validate_entitlements(entitlements, profile, bundle.name, signed=True, bundle_id=bundle_id)
        runner(["codesign", "--verify", "--deep", "--strict", "--verbose=2", str(app)])


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--package", type=Path, help="Validate the final signed IPA")
    parser.add_argument("--app-profile", type=Path)
    parser.add_argument("--extension-profile", type=Path)
    parser.add_argument("--app-entitlements", type=Path)
    parser.add_argument("--extension-entitlements", type=Path)
    args = parser.parse_args(argv)
    if args.package:
        if any([args.app_profile, args.extension_profile, args.app_entitlements, args.extension_entitlements]):
            parser.error("--package cannot be combined with profile-mode arguments")
    elif not args.app_profile or not args.extension_profile:
        parser.error("Supply --package or both --app-profile and --extension-profile")
    try:
        if args.package:
            verify_package(args.package)
        else:
            verify_profiles(args.app_profile, args.extension_profile, args.app_entitlements, args.extension_entitlements)
    except SigningError as error:
        print(f"iOS signing verification failed: {error}", file=sys.stderr)
        return 1
    print("iOS signing verification passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
