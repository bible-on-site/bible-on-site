from copy import deepcopy
from datetime import datetime, timedelta, timezone
from contextlib import redirect_stderr
from io import StringIO
from pathlib import Path
import plistlib
import struct
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import zipfile

import verify_ios_signing as signing


def profile(bundle_id, team="TEAM123456"):
    return {
        "TeamIdentifier": [team],
        "ApplicationIdentifierPrefix": [team],
        "ExpirationDate": datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(days=30),
        "DeveloperCertificates": [b"distribution-certificate"],
        "Entitlements": {
            "application-identifier": f"{team}.{bundle_id}",
            "com.apple.developer.team-identifier": team,
            "com.apple.security.application-groups": [signing.APP_GROUP],
            "get-task-allow": False,
            "keychain-access-groups": [f"{team}.*"],
        },
    }


def swift_binary(entry=True):
    # One 64-bit Mach-O slice with one section; entry must be a real load-command section.
    header = struct.pack("<8I", 0xFEEDFACF, 0x100000C, 0, 2, 1, 152, 0, 0)
    segment = struct.pack("<II16s4Q4I", 0x19, 152, b"__TEXT", 0, 0, 0, 0, 7, 5, 1, 0)
    section = struct.pack("<16s16sQQ8I", b"__swift5_entry" if entry else b"__const",
                          b"__TEXT", 0, 8, 184, 0, 0, 0, 0, 0, 0, 0)
    return header + segment + section + b"\0" * 8


def bundle_info(bundle_id, extension=False):
    info = {
        "CFBundleIdentifier": bundle_id,
        "CFBundleExecutable": "AssetPackDownloader" if extension else "BibleOnSite",
        "CFBundleName": "AssetPackDownloader" if extension else "BibleOnSite",
        "CFBundleDisplayName": "Asset Pack Downloader" if extension else "Bible On Site",
        "CFBundleVersion": "123",
        "CFBundleShortVersionString": "1.2.3",
        "CFBundlePackageType": "XPC!" if extension else "APPL",
    }
    if extension:
        info["EXAppExtensionAttributes"] = {"EXExtensionPointIdentifier": signing.EXTENSION_POINT}
    return info


class ProfileTests(unittest.TestCase):
    def test_profiles_reject_original_app_group_gap_and_missing_extension_profile(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            app_path, extension_path = root / "app.mobileprovision", root / "extension.mobileprovision"
            app_path.touch()
            app_profile = profile(signing.APP_ID)
            del app_profile["Entitlements"]["com.apple.security.application-groups"]
            with self.assertRaisesRegex(signing.SigningError, "Missing provisioning profile"):
                signing.verify_profiles(app_path, extension_path, runner=lambda _: plistlib.dumps(app_profile))
            extension_path.touch()
            def runner(command):
                return plistlib.dumps(app_profile if command[-1] == str(app_path) else profile(signing.EXTENSION_ID))
            with self.assertRaisesRegex(signing.SigningError, "does not authorize App Group"):
                signing.verify_profiles(app_path, extension_path, runner=runner)

    def test_profile_expiration_distribution_app_id_and_team_are_enforced(self):
        valid = profile(signing.APP_ID)
        signing.validate_profile(valid, signing.APP_ID, "App")
        cases = [
            ("expired", lambda p: p.update(ExpirationDate=datetime(2020, 1, 1))),
            ("distribution", lambda p: p["Entitlements"].update({"get-task-allow": True})),
            ("distribution", lambda p: p.update(ProvisionedDevices=["device-id"])),
            ("distribution", lambda p: p.update(ProvisionsAllDevices=True)),
            ("explicit App ID", lambda p: p["Entitlements"].update({"application-identifier": "TEAM123456.*"})),
            ("signing team", lambda p: p["Entitlements"].update({"com.apple.developer.team-identifier": "OTHER"})),
        ]
        for message, mutate in cases:
            with self.subTest(message=message):
                invalid = deepcopy(valid)
                mutate(invalid)
                with self.assertRaisesRegex(signing.SigningError, message):
                    signing.validate_profile(invalid, signing.APP_ID, "App")

    def test_profile_pair_must_share_team(self):
        with tempfile.TemporaryDirectory() as temporary:
            app, extension = Path(temporary) / "app", Path(temporary) / "extension"
            app.touch()
            extension.touch()
            def runner(command):
                return plistlib.dumps(profile(signing.APP_ID) if command[-1] == str(app)
                                      else profile(signing.EXTENSION_ID, "OTHERTEAM1"))
            with self.assertRaisesRegex(signing.SigningError, "different teams"):
                signing.verify_profiles(app, extension, runner=runner)

    def test_entitlement_subset_supports_keychain_wildcard_but_not_group_wildcard(self):
        distribution = profile(signing.APP_ID)
        requested = {"com.apple.security.application-groups": [signing.APP_GROUP],
                     "keychain-access-groups": ["TEAM123456.com.tanah.daily929"]}
        signing.validate_entitlements(requested, distribution, "App")
        requested["keychain-access-groups"] = ["OTHERTEAM1.com.tanah.daily929"]
        with self.assertRaisesRegex(signing.SigningError, "keychain-access-groups"):
            signing.validate_entitlements(requested, distribution, "App")
        requested = {"com.apple.security.application-groups": [signing.APP_GROUP]}
        distribution["Entitlements"]["com.apple.security.application-groups"] = ["group.*"]
        with self.assertRaisesRegex(signing.SigningError, "application-groups"):
            signing.validate_entitlements(requested, distribution, "App")


class PackageTests(unittest.TestCase):
    def write_ipa(self, root, problem=None):
        package = root / "Bible.ipa"
        app = "Payload/Bible.app/"
        extension = app + "Extensions/AssetPackDownloader.appex/"
        app_info = bundle_info(signing.APP_ID)
        extension_info = bundle_info(signing.EXTENSION_ID, extension=True)
        if problem in {"CFBundleIdentifier", "CFBundleExecutable", "CFBundleName", "CFBundleDisplayName",
                       "CFBundleVersion", "CFBundleShortVersionString"}:
            del extension_info[problem]
        if problem == "wrong-version":
            extension_info["CFBundleVersion"] = "122"
        if problem == "unexpanded-name":
            extension_info["CFBundleName"] = "$(PRODUCT_NAME)"
        if problem == "wrong-extension-point":
            extension_info["EXAppExtensionAttributes"]["EXExtensionPointIdentifier"] = "incorrect"
        with zipfile.ZipFile(package, "w") as archive:
            archive.writestr(app + "Info.plist", plistlib.dumps(app_info))
            archive.writestr(app + "BibleOnSite", swift_binary())
            archive.writestr(app + "embedded.mobileprovision", plistlib.dumps(profile(signing.APP_ID)))
            if problem != "missing-extension":
                archive.writestr(extension + "Info.plist", plistlib.dumps(extension_info))
                archive.writestr(extension + "AssetPackDownloader", swift_binary(entry=problem != "missing-entry"))
                if problem != "missing-extension-profile":
                    archive.writestr(extension + "embedded.mobileprovision", plistlib.dumps(profile(signing.EXTENSION_ID)))
        return package

    def runner(self, problem=None):
        self.calls = []
        def invoke(command):
            self.calls.append(command)
            if command[0] == "ditto":
                with zipfile.ZipFile(command[-2]) as archive:
                    archive.extractall(command[-1])
                return b""
            if command[0] == "security":
                return Path(command[-1]).read_bytes()
            if "--verify" in command:
                if problem == "unsigned-extension" and command[-1].endswith(".appex"):
                    raise signing.SigningError("code object is not signed at all")
                return b""
            if "--extract-certificates" in command:
                if problem != "adhoc-signature":
                    Path(command[-2] + "0").write_bytes(b"wrong-certificate" if problem == "wrong-certificate"
                                                     else b"distribution-certificate")
                return b""
            if "--entitlements" in command:
                bundle_id = signing.EXTENSION_ID if command[-1].endswith(".appex") else signing.APP_ID
                entitlements = profile(bundle_id)["Entitlements"]
                entitlements["keychain-access-groups"] = [f"TEAM123456.{bundle_id}"]
                if problem == "unauthorized-entitlement":
                    entitlements["com.apple.developer.associated-domains"] = ["applinks:example.com"]
                if problem == "unsigned-group-gap":
                    del entitlements["com.apple.security.application-groups"]
                return plistlib.dumps(entitlements)
            self.fail(f"Unexpected command: {command}")
        return invoke

    def test_valid_ipa_checks_both_profiles_signed_entitlements_and_deep_signature(self):
        with tempfile.TemporaryDirectory() as temporary:
            signing.verify_package(self.write_ipa(Path(temporary)), runner=self.runner())
        self.assertEqual(len([c for c in self.calls if c[0] == "security"]), 2)
        self.assertEqual(len([c for c in self.calls if "--entitlements" in c]), 2)
        self.assertEqual(len([c for c in self.calls if "--verify" in c]), 3)
        self.assertIn("--deep", self.calls[-1])

    def test_ipa_rejects_original_malformed_metadata_missing_profile_and_extension_entry(self):
        for problem, message in [
            ("CFBundleIdentifier", "CFBundleIdentifier"),
            ("CFBundleExecutable", "CFBundleExecutable"),
            ("CFBundleName", "CFBundleName"),
            ("CFBundleDisplayName", "CFBundleDisplayName"),
            ("CFBundleVersion", "CFBundleVersion"),
            ("CFBundleShortVersionString", "CFBundleShortVersionString"),
            ("unexpanded-name", "CFBundleName"),
            ("wrong-version", "must match"),
            ("missing-extension", "must embed"),
            ("missing-extension-profile", "Missing provisioning profile"),
            ("wrong-extension-point", "extension point"),
            ("missing-entry", "__swift5_entry"),
        ]:
            with self.subTest(problem=problem), tempfile.TemporaryDirectory() as temporary:
                with self.assertRaisesRegex(signing.SigningError, message):
                    signing.verify_package(self.write_ipa(Path(temporary), problem), runner=self.runner())

    def test_ipa_rejects_unsigned_or_unauthorized_signatures_and_entitlements(self):
        for problem, message in [
            ("unsigned-extension", "not signed"),
            ("adhoc-signature", "signing certificate"),
            ("wrong-certificate", "signing certificate"),
            ("unauthorized-entitlement", "associated-domains"),
            ("unsigned-group-gap", "missing App Group"),
        ]:
            with self.subTest(problem=problem), tempfile.TemporaryDirectory() as temporary:
                with self.assertRaisesRegex(signing.SigningError, message):
                    signing.verify_package(self.write_ipa(Path(temporary)), runner=self.runner(problem))

    def test_entry_section_is_required_in_every_macho_slice(self):
        valid = swift_binary()
        self.assertTrue(signing.has_swift_entry(valid))
        self.assertFalse(signing.has_swift_entry(b"not a binary __swift5_entry"))
        self.assertFalse(signing.has_swift_entry(swift_binary(False)))
        self.assertFalse(signing.has_swift_entry(valid[:100]))
        for second in [valid, swift_binary(False)]:
            header = struct.pack(">II", 0xCAFEBABE, 2)
            header += struct.pack(">5I", 0x100000C, 0, 48, len(valid), 0)
            header += struct.pack(">5I", 0x100000C, 0, 48 + len(valid), len(second), 0)
            self.assertEqual(signing.has_swift_entry(header + valid + second), second == valid)


class CommandTests(unittest.TestCase):
    def test_native_command_failure_preserves_rejection_and_cli_returns_failure(self):
        failure = subprocess.CalledProcessError(1, ["codesign"], stderr=b"code object is not signed at all")
        with patch.object(signing.subprocess, "run", side_effect=failure):
            with self.assertRaisesRegex(signing.SigningError, "code object is not signed at all"):
                signing.run(["codesign", "--verify", "extension.appex"])
        with patch.object(signing, "verify_package", side_effect=signing.SigningError("missing extension profile")):
            with redirect_stderr(StringIO()) as error:
                self.assertEqual(signing.main(["--package", "fixture.ipa"]), 1)
            self.assertIn("iOS signing verification failed: missing extension profile", error.getvalue())


if __name__ == "__main__":
    unittest.main()
