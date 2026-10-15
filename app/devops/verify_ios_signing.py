"""Reject invalid iOS distribution provisioning and the final signed IPA."""

# Run on macOS, where security, codesign, and ditto are provided by the OS.
# Profile mode runs before the build; package mode checks embedded profiles,
# signed entitlements, signatures, and ExtensionKit metadata in the actual IPA.

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path, PurePosixPath
import plistlib
import struct
import subprocess  # nosec B404: fixed macOS executables and validated argv only, no shell.
import sys
import tempfile


APP_ID = "com.tanah.daily929"
EXTENSION_ID = APP_ID + ".AssetPackDownloader"
APP_GROUP = "group.com.tanah.daily929.assets"
EXTENSION_POINT = "com.apple.background-asset-downloader-extension"
SECURITY = "/usr/bin/security"
CODESIGN = "/usr/bin/codesign"
DITTO = "/usr/bin/ditto"
PLUTIL = "/usr/bin/plutil"
XCODEBUILD = "/usr/bin/xcodebuild"

# Each approved invocation has fixed options followed only by absolute paths.
# Keep mutating signing operations out of this read-only verifier.
COMMAND_SHAPES = (
    ((SECURITY, "cms", "-D", "-i"), 1),
    ((DITTO, "-x", "-k"), 2),
    ((CODESIGN, "--verify", "--strict", "--verbose=2"), 1),
    ((CODESIGN, "--verify", "--deep", "--strict", "--verbose=2"), 1),
    ((CODESIGN, "-d", "--extract-certificates"), 2),
    ((CODESIGN, "-d", "--entitlements", ":-"), 1),
)
DISCOVERY_COMMANDS = (
    (PLUTIL, "-convert", "json", "-o", "-", None),
    (XCODEBUILD, "-project", None, "-alltargets", "-configuration", "Release",
     "-showBuildSettings", "-json", "CODE_SIGNING_ALLOWED=NO"),
)


class SigningError(ValueError):
    """An actionable release-signing failure."""


def validate_command(command):
    if not isinstance(command, (list, tuple)) or not all(isinstance(arg, str) for arg in command):
        raise SigningError("macOS verification commands require a string argument vector")
    command = tuple(command)
    shapes = [prefix + (None,) * count for prefix, count in COMMAND_SHAPES]
    for shape in [*shapes, *DISCOVERY_COMMANDS]:
        if len(command) != len(shape):
            continue
        if any(expected is not None and expected != actual for expected, actual in zip(shape, command)):
            continue
        paths = [actual for expected, actual in zip(shape, command) if expected is None]
        if all(PurePosixPath(path).is_absolute() and "\0" not in path for path in paths):
            return command
        raise SigningError("macOS verification command paths must be absolute and contain no NUL")
    raise SigningError("Unsupported macOS verification command or options")


def run(command):
    command = validate_command(command)
    try:
        # The allowlist above fixes executables/options; only absolute path operands vary.
        result = subprocess.run(  # nosec B603: allowlisted argv, absolute paths, no shell.  # nosemgrep
            command, check=True, capture_output=True, shell=False)
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
    path = Path(path).resolve()
    if not path.is_file():
        raise SigningError(f"Missing provisioning profile: {path}")
    try:
        profile = plistlib.loads(runner([SECURITY, "cms", "-D", "-i", str(path)]))
    except (plistlib.InvalidFileException, ValueError) as error:
        raise SigningError(f"Cannot decode provisioning profile {path}: {error}") from error
    if not isinstance(profile, dict):
        raise SigningError(f"Invalid provisioning profile: {path}")
    return profile


def validate_profile(profile, bundle_id, label, now=None, requested=None):
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
    if requested is not None:
        validate_entitlements(requested, profile, label)
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


def _is_swift_entry_section(image, endian, offset):
    name = image[offset:offset + 16].rstrip(b"\0")
    segment = image[offset + 16:offset + 32].rstrip(b"\0")
    size = struct.unpack_from(endian + "Q", image, offset + 40)[0]
    file_offset = struct.unpack_from(endian + "I", image, offset + 48)[0]
    return (name == b"__swift5_entry" and segment == b"__TEXT"
            and size > 0 and file_offset + size <= len(image))


def _segment_has_swift_entry(image, endian, offset, size):
    if size < 72:
        return None  # Malformed LC_SEGMENT_64 command.
    count = struct.unpack_from(endian + "I", image, offset + 64)[0]
    if 72 + count * 80 > size:
        return None
    return any(_is_swift_entry_section(image, endian, offset + 72 + index * 80)
               for index in range(count))


def _thin_has_swift_entry(image):
    if len(image) < 32 or image[:4] not in (b"\xcf\xfa\xed\xfe", b"\xfe\xed\xfa\xcf"):
        return False
    endian = "<" if image[:4] == b"\xcf\xfa\xed\xfe" else ">"
    count, size = struct.unpack_from(endian + "II", image, 16)
    end = 32 + size
    if end > len(image):
        return False
    offset = 32
    found = False
    for _ in range(count):
        if offset + 8 > end:
            return False
        command, size = struct.unpack_from(endian + "II", image, offset)
        if size < 8 or offset + size > end:
            return False
        if command == 0x19:  # LC_SEGMENT_64
            state = _segment_has_swift_entry(image, endian, offset, size)
            if state is None:
                return False
            found |= state
        offset += size
    return found


def has_swift_entry(data):
    """Require a real Swift entry section in every Mach-O architecture slice."""
    if data[:4] not in (b"\xca\xfe\xba\xbe", b"\xca\xfe\xba\xbf"):
        return _thin_has_swift_entry(data)
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
        if not length or offset + length > len(data):
            return False
        if not _thin_has_swift_entry(data[offset:offset + length]):
            return False
    return True


def _validate_extension_entry(bundle, binary, info):
    attributes = info.get("EXAppExtensionAttributes")
    if attributes is not None:
        if not isinstance(attributes, dict) or not attributes.get("EXExtensionPointIdentifier"):
            raise SigningError(f"{bundle.name}: invalid ExtensionKit extension point")
        principal_class = attributes.get("EXPrincipalClass")
        if not (isinstance(principal_class, str) and principal_class.strip()) and not has_swift_entry(binary.read_bytes()):
            raise SigningError(f"{bundle.name}: missing ExtensionKit __swift5_entry section or EXPrincipalClass")
        return
    attributes = info.get("NSExtension", {})
    if not isinstance(attributes, dict) or not attributes.get("NSExtensionPointIdentifier"):
        raise SigningError(f"{bundle.name}: missing app extension point")
    # Classic extension points have different entry contracts; for example,
    # SwiftUI widgets do not declare a principal class or a storyboard.


def validate_bundle(bundle, bundle_id, package_type, parent_info=None):
    info = read_plist(bundle / "Info.plist")
    for key in ["CFBundleIdentifier", "CFBundleExecutable", "CFBundleName", "CFBundleDisplayName",
                "CFBundleVersion", "CFBundleShortVersionString"]:
        if not isinstance(info.get(key), str) or not info[key].strip() or "$(" in info[key]:
            raise SigningError(f"{bundle.name}: missing/invalid {key}")
    if bundle_id is not None and info["CFBundleIdentifier"] != bundle_id:
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
        if not info["CFBundleIdentifier"].startswith(parent_info["CFBundleIdentifier"] + "."):
            raise SigningError(f"{bundle.name}: extension bundle ID must start with its containing app's ID")
        for key in ["CFBundleVersion", "CFBundleShortVersionString"]:
            if info[key] != parent_info[key]:
                raise SigningError(f"{bundle.name}: {key} must match its containing app")
        _validate_extension_entry(bundle, binary, info)
    return info


def _package_bundles(root):
    apps = list((root / "Payload").glob("*.app"))
    if len(apps) != 1:
        raise SigningError("IPA must contain exactly one Payload/*.app bundle")
    app = apps[0]
    app_info = validate_bundle(app, None, "APPL")
    bundles = [(app, app_info)]
    for directory in [app / "Extensions", app / "PlugIns"]:
        for extension in sorted(directory.glob("*.appex")):
            info = validate_bundle(extension, None, "XPC!", parent_info=app_info)
            bundles.append((extension, info))
    identifiers = [info["CFBundleIdentifier"] for _, info in bundles]
    if len(identifiers) != len(set(identifiers)):
        raise SigningError("IPA contains duplicate app or extension bundle identifiers")
    return bundles


def _managed_app_group(info, bundles):
    if info.get("BAHasManagedAssetPacks") is not True:
        return None
    group = info.get("BAAppGroupID")
    if not isinstance(group, str) or not group.strip() or "$(" in group:
        raise SigningError("Managed asset packs require a declared BAAppGroupID")
    if not any(is_managed_downloader(extension_info) for _, extension_info in bundles[1:]):
        raise SigningError("Managed asset packs require an embedded background-asset downloader extension point")
    return group


def is_managed_downloader(info):
    attributes = info.get("EXAppExtensionAttributes", {})
    return isinstance(attributes, dict) and attributes.get("EXExtensionPointIdentifier") == EXTENSION_POINT


def _extension_point(info):
    attributes = info.get("EXAppExtensionAttributes", {})
    if isinstance(attributes, dict) and attributes.get("EXExtensionPointIdentifier"):
        return attributes["EXExtensionPointIdentifier"]
    attributes = info.get("NSExtension", {})
    return attributes.get("NSExtensionPointIdentifier") if isinstance(attributes, dict) else None


def read_requirements(path):
    try:
        requirements = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise SigningError(f"Cannot read declared signing requirements {path}: {error}") from error
    if not isinstance(requirements, list) or not requirements:
        raise SigningError("Declared signing requirements must be a nonempty JSON list")
    return requirements


def _declared_requirements(bundles, requirements):
    if requirements is None:
        return {}
    declared = {}
    for requirement in requirements:
        if (not isinstance(requirement, dict) or not isinstance(requirement.get("bundle_id"), str)
                or not isinstance(requirement.get("entitlements"), dict)
                or requirement.get("kind") not in {"app", "extension"}):
            raise SigningError("Invalid declared signing requirement")
        bundle_id = requirement["bundle_id"]
        if bundle_id in declared:
            raise SigningError(f"Duplicate declared bundle ID: {bundle_id}")
        declared[bundle_id] = requirement
    actual_ids = {info["CFBundleIdentifier"] for _, info in bundles}
    if set(declared) != actual_ids:
        missing = sorted(set(declared) - actual_ids)
        unexpected = sorted(actual_ids - set(declared))
        raise SigningError(f"IPA does not match declared targets; missing: {missing}; unexpected: {unexpected}")
    for index, (bundle, info) in enumerate(bundles):
        requirement = declared[info["CFBundleIdentifier"]]
        if requirement["kind"] != ("app" if index == 0 else "extension"):
            raise SigningError(f"{bundle.name}: packaged target kind does not match its declaration")
        expected_point = requirement.get("extension_point")
        if expected_point is not None and expected_point != _extension_point(info):
            raise SigningError(f"{bundle.name}: packaged extension point does not match its declaration")
    return declared


def _requested_entitlements(info, declaration, group, is_app):
    requested = dict(declaration.get("entitlements", {}))
    if group and (is_app or is_managed_downloader(info)):
        key = "com.apple.security.application-groups"
        groups = requested.get(key, [])
        if not isinstance(groups, list):
            raise SigningError(f"{info['CFBundleIdentifier']}: declared App Groups must be an array")
        requested[key] = list(dict.fromkeys([*groups, group]))
    return requested


def _verify_bundle_signature(bundle, profile, certificate_prefix, runner):
    runner([CODESIGN, "--verify", "--strict", "--verbose=2", str(bundle)])
    runner([CODESIGN, "-d", "--extract-certificates", str(certificate_prefix), str(bundle)])
    certificate = Path(str(certificate_prefix) + "0")
    if not certificate.is_file() or certificate.read_bytes() not in profile.get("DeveloperCertificates", []):
        raise SigningError(f"{bundle.name}: signing certificate is not authorized by its provisioning profile")
    try:
        entitlements = plistlib.loads(runner([CODESIGN, "-d", "--entitlements", ":-", str(bundle)]))
    except (plistlib.InvalidFileException, ValueError) as error:
        raise SigningError(f"{bundle.name}: cannot read signed entitlements: {error}") from error
    if not isinstance(entitlements, dict):
        raise SigningError(f"{bundle.name}: missing signed entitlements")
    return entitlements


def _verify_package_signatures(root, bundles, runner, requirements):
    declared = _declared_requirements(bundles, requirements)
    group = _managed_app_group(bundles[0][1], bundles)
    team = None
    for index, (bundle, info) in enumerate(bundles):
        bundle_id = info["CFBundleIdentifier"]
        requested = _requested_entitlements(info, declared.get(bundle_id, {}), group, index == 0)
        profile = decode_profile(bundle / "embedded.mobileprovision", runner)
        current_team = validate_profile(profile, bundle_id, bundle.name, requested=requested)
        if team is not None and current_team != team:
            raise SigningError("App and extension provisioning profiles belong to different teams")
        team = current_team
        entitlements = _verify_bundle_signature(bundle, profile, root / f"bundle-{index}-certificate-", runner)
        validate_entitlements(entitlements, profile, bundle.name, signed=True, bundle_id=bundle_id)
        for key, value in requested.items():
            if not _authorized_value(value, entitlements.get(key)):
                raise SigningError(f"{bundle.name}: signed entitlements are missing declared {key}: {value}")
    runner([CODESIGN, "--verify", "--deep", "--strict", "--verbose=2", str(bundles[0][0])])


def verify_package(package, runner=run, requirements=None):
    package = Path(package).resolve()
    if not package.is_file():
        raise SigningError(f"Missing IPA: {package}")
    with tempfile.TemporaryDirectory(prefix="ios-signing-") as temporary:
        root = Path(temporary)
        # ditto preserves bundle symlinks and modes, as Apple's IPA tooling expects.
        runner([DITTO, "-x", "-k", str(package), str(root)])
        _verify_package_signatures(root, _package_bundles(root), runner, requirements)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--package", type=Path, help="Validate the final signed IPA")
    parser.add_argument("--requirements", type=Path, help="JSON requirements emitted by signing preflight")
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
    elif args.requirements:
        parser.error("--requirements requires --package")
    try:
        if args.package:
            requirements = read_requirements(args.requirements) if args.requirements else None
            verify_package(args.package, requirements=requirements)
        else:
            verify_profiles(args.app_profile, args.extension_profile, args.app_entitlements, args.extension_entitlements)
    except SigningError as error:
        print(f"iOS signing verification failed: {error}", file=sys.stderr)
        return 1
    print("iOS signing verification passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
