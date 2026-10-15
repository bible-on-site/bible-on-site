from copy import deepcopy
from datetime import datetime, timedelta, timezone
from contextlib import redirect_stderr
from io import StringIO
from pathlib import Path
import plistlib
import struct
import subprocess  # nosec B404: constructs a process-error fixture only; no processes are launched.
import tempfile
import unittest
from unittest.mock import patch
import zipfile

import verify_ios_signing as signing


def profile(bundle_id, team="TEAM123456", groups=None):
    return {
        "TeamIdentifier": [team],
        "ApplicationIdentifierPrefix": [team],
        "ExpirationDate": datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(days=30),
        "DeveloperCertificates": [b"distribution-certificate"],
        "Entitlements": {
            "application-identifier": f"{team}.{bundle_id}",
            "com.apple.developer.team-identifier": team,
            "com.apple.security.application-groups": [signing.APP_GROUP] if groups is None else groups,
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
    else:
        info["BAHasManagedAssetPacks"] = True
        info["BAAppGroupID"] = signing.APP_GROUP
    return info


class ProfileTests(unittest.TestCase):
    def test_profiles_reject_original_app_group_gap_and_missing_extension_profile(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            app_path, extension_path = root / "app.mobileprovision", root / "extension.mobileprovision"
            app_path.touch()
            app_profile = profile(signing.APP_ID)
            del app_profile["Entitlements"]["com.apple.security.application-groups"]
            requested = root / "app.entitlements"
            requested.write_bytes(plistlib.dumps({"com.apple.security.application-groups": [signing.APP_GROUP]}))
            with self.assertRaisesRegex(signing.SigningError, "Missing provisioning profile"):
                signing.verify_profiles(app_path, extension_path, runner=lambda _: plistlib.dumps(app_profile))
            extension_path.touch()

            def runner(command):
                return plistlib.dumps(app_profile if command[-1] == str(app_path) else profile(signing.EXTENSION_ID))
            with self.assertRaisesRegex(signing.SigningError, "application-groups"):
                signing.verify_profiles(app_path, extension_path, app_entitlements=requested, runner=runner)

    def test_profile_permissions_follow_declarations_without_requiring_a_fixed_group(self):
        plain = profile("org.example.reader", groups=[])
        signing.validate_profile(plain, "org.example.reader", "Reader", requested={})
        declared = {"com.apple.security.application-groups": ["group.org.example.shared"]}
        with self.assertRaisesRegex(signing.SigningError, "application-groups"):
            signing.validate_profile(plain, "org.example.reader", "Reader", requested=declared)
        plain["Entitlements"].update(declared)
        signing.validate_profile(plain, "org.example.reader", "Reader", requested=declared)

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
    def write_ipa(self, root, problem=None, app_id=signing.APP_ID, extension_name="AssetPackDownloader",
                  group=signing.APP_GROUP, managed=True, extra_extension=False, declared_capability=False):
        package = root / "Bible.ipa"
        app = "Payload/Bible.app/"
        extension = app + f"Extensions/{extension_name}.appex/"
        extension_id = app_id + "." + extension_name
        app_info = bundle_info(app_id)
        app_info["BAAppGroupID"] = group
        app_info["BAHasManagedAssetPacks"] = managed
        extension_info = bundle_info(extension_id, extension=True)
        app_profile = profile(app_id, groups=[group] if managed else [])
        extension_profile = profile(extension_id, groups=[group] if managed else [])
        if declared_capability:
            app_profile["Entitlements"]["com.apple.developer.associated-domains"] = ["applinks:example.com"]
        if problem in {"CFBundleIdentifier", "CFBundleExecutable", "CFBundleName", "CFBundleDisplayName",
                       "CFBundleVersion", "CFBundleShortVersionString"}:
            del extension_info[problem]
        if problem == "wrong-version":
            extension_info["CFBundleVersion"] = "122"
        if problem == "unexpanded-name":
            extension_info["CFBundleName"] = "$(PRODUCT_NAME)"
        if problem == "wrong-extension-point":
            extension_info["EXAppExtensionAttributes"]["EXExtensionPointIdentifier"] = "incorrect"
        if problem == "unrelated-extension-id":
            extension_info["CFBundleIdentifier"] = "org.other.extension"
        with zipfile.ZipFile(package, "w") as archive:
            archive.writestr(app + "Info.plist", plistlib.dumps(app_info))
            archive.writestr(app + "BibleOnSite", swift_binary())
            archive.writestr(app + "embedded.mobileprovision", plistlib.dumps(app_profile))
            if problem != "missing-extension":
                archive.writestr(extension + "Info.plist", plistlib.dumps(extension_info))
                archive.writestr(extension + "AssetPackDownloader", swift_binary(entry=problem != "missing-entry"))
                if problem != "missing-extension-profile":
                    archive.writestr(extension + "embedded.mobileprovision", plistlib.dumps(extension_profile))
            if extra_extension:
                widget = app + "PlugIns/Widget.appex/"
                widget_info = bundle_info(app_id + ".Widget", extension=True)
                del widget_info["EXAppExtensionAttributes"]
                widget_info["NSExtension"] = {
                    "NSExtensionPointIdentifier": "com.apple.widgetkit-extension",
                }
                archive.writestr(widget + "Info.plist", plistlib.dumps(widget_info))
                archive.writestr(widget + "AssetPackDownloader", swift_binary())
                archive.writestr(widget + "embedded.mobileprovision", plistlib.dumps(profile(app_id + ".Widget", groups=[])))
        return package

    def runner(self, problem=None):
        self.calls = []

        def invoke(command):
            self.calls.append(command)
            if command[0] == signing.DITTO:
                with zipfile.ZipFile(command[-2]) as archive:
                    archive.extractall(command[-1])
                return b""
            if command[0] == signing.SECURITY:
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
                bundle = Path(command[-1])
                bundle_id = plistlib.loads((bundle / "Info.plist").read_bytes())["CFBundleIdentifier"]
                entitlements = plistlib.loads((bundle / "embedded.mobileprovision").read_bytes())["Entitlements"]
                entitlements["keychain-access-groups"] = [f"TEAM123456.{bundle_id}"]
                if problem == "unauthorized-entitlement":
                    entitlements["com.apple.developer.associated-domains"] = ["applinks:example.com"]
                if problem == "unsigned-group-gap":
                    del entitlements["com.apple.security.application-groups"]
                if problem == "dropped-declared-capability":
                    entitlements.pop("com.apple.developer.associated-domains", None)
                return plistlib.dumps(entitlements)
            raise AssertionError(f"Unexpected command: {command}")
        return invoke

    def test_valid_ipa_checks_both_profiles_signed_entitlements_and_deep_signature(self):
        with tempfile.TemporaryDirectory() as temporary:
            signing.verify_package(self.write_ipa(Path(temporary)), runner=self.runner())
        self.assertEqual(len([c for c in self.calls if c[0] == signing.SECURITY]), 2)
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
            ("missing-extension", "require an embedded"),
            ("missing-extension-profile", "Missing provisioning profile"),
            ("wrong-extension-point", "extension point"),
            ("unrelated-extension-id", "containing app's ID"),
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
            ("unsigned-group-gap", "missing declared.*application-groups"),
        ]:
            with self.subTest(problem=problem), tempfile.TemporaryDirectory() as temporary:
                with self.assertRaisesRegex(signing.SigningError, message):
                    signing.verify_package(self.write_ipa(Path(temporary)), runner=self.runner(problem))

    def test_actual_bundle_ids_groups_and_all_embedded_extensions_are_discovered(self):
        with tempfile.TemporaryDirectory() as temporary:
            package = self.write_ipa(Path(temporary), app_id="org.example.reader", extension_name="BackgroundDelivery",
                                     group="group.org.example.shared", extra_extension=True)
            signing.verify_package(package, runner=self.runner())
            self.assertEqual(len([c for c in self.calls if c[0] == signing.SECURITY]), 3)
        with tempfile.TemporaryDirectory() as temporary:
            package = self.write_ipa(Path(temporary), problem="missing-extension", managed=False)
            signing.verify_package(package, runner=self.runner())

    @staticmethod
    def requirements():
        return [
            {"target": "Bible", "kind": "app", "bundle_id": signing.APP_ID,
             "entitlements": {"com.apple.security.application-groups": [signing.APP_GROUP]},
             "extension_point": None},
            {"target": "Downloader", "kind": "extension", "bundle_id": signing.EXTENSION_ID,
             "entitlements": {"com.apple.security.application-groups": [signing.APP_GROUP]},
             "extension_point": signing.EXTENSION_POINT},
        ]

    def test_declared_targets_cannot_be_omitted_or_have_their_permissions_dropped(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            package = self.write_ipa(root)
            signing.verify_package(package, runner=self.runner(), requirements=self.requirements())
            requirements = self.requirements()
            requirements.append({"target": "Widget", "kind": "extension", "bundle_id": signing.APP_ID + ".Widget",
                                 "entitlements": {}, "extension_point": None})
            with self.assertRaisesRegex(signing.SigningError, "missing:.*Widget"):
                signing.verify_package(package, runner=self.runner(), requirements=requirements)
            requirements = self.requirements()
            requirements[0]["entitlements"]["com.apple.developer.associated-domains"] = ["applinks:example.com"]
            with self.assertRaisesRegex(signing.SigningError, "not authorized"):
                signing.verify_package(package, runner=self.runner(), requirements=requirements)
            package = self.write_ipa(root, declared_capability=True)
            with self.assertRaisesRegex(signing.SigningError, "missing declared.*associated-domains"):
                signing.verify_package(package, runner=self.runner("dropped-declared-capability"), requirements=requirements)

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
        command = [signing.CODESIGN, "--verify", "--strict", "--verbose=2", "/tmp/extension.appex"]
        failure = subprocess.CalledProcessError(1, command, stderr=b"code object is not signed at all")
        with patch.object(signing.subprocess, "run", side_effect=failure):
            with self.assertRaisesRegex(signing.SigningError, "code object is not signed at all"):
                signing.run(command)
        with patch.object(signing, "verify_package", side_effect=signing.SigningError("missing extension profile")):
            with redirect_stderr(StringIO()) as error:
                self.assertEqual(signing.main(["--package", "fixture.ipa"]), 1)
            self.assertIn("iOS signing verification failed: missing extension profile", error.getvalue())

    def test_native_runner_accepts_only_fixed_tools_options_and_absolute_path_operands(self):
        for command in [
            ["codesign", "--verify", "--strict", "--verbose=2", "/tmp/app.app"],
            ["/bin/sh", "-c", "arbitrary command"],
            [signing.CODESIGN, "--force", "--sign", "identity", "/tmp/app.app"],
            [signing.CODESIGN, "--verify", "--strict", "--verbose=2", "--option-instead-of-path"],
            [signing.SECURITY, "cms", "-D", "-i", "relative.mobileprovision"],
            [signing.SECURITY, "cms", "-D", "-i", "/tmp/profile\0.mobileprovision"],
        ]:
            with self.subTest(command=command), patch.object(signing.subprocess, "run") as process:
                with self.assertRaises(signing.SigningError):
                    signing.run(command)
                process.assert_not_called()
        for prefix, count in signing.COMMAND_SHAPES:
            # Spaces and shell metacharacters remain literal path bytes in argv.
            command = [*prefix, *(["/tmp/bundle name;$(literal)"] * count)]
            result = subprocess.CompletedProcess(command, 0, stdout=b"verified")
            with self.subTest(command=command), patch.object(signing.subprocess, "run", return_value=result) as process:
                self.assertEqual(signing.run(command), b"verified")
                process.assert_called_once_with(tuple(command), check=True, capture_output=True, shell=False)
        for shape in signing.DISCOVERY_COMMANDS:
            command = ["/tmp/project.xcodeproj" if argument is None else argument for argument in shape]
            self.assertEqual(signing.validate_command(command), tuple(command))


if __name__ == "__main__":
    unittest.main()
