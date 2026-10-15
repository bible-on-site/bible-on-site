import base64
from contextlib import redirect_stderr, redirect_stdout
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from io import StringIO
import json
from pathlib import Path
import plistlib
import tempfile
import unittest

import ios_signing_requirements as requirements
import verify_ios_signing as signing


GROUP_KEY = "com.apple.security.application-groups"


def distribution_profile(bundle_id, entitlements=None, team="TEAM123456", prefix="PREFIX1234"):
    return {"TeamIdentifier": [team], "ApplicationIdentifierPrefix": [prefix],
            "ExpirationDate": datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(days=30),
            "Entitlements": {"application-identifier": f"{prefix}.{bundle_id}",
                             "com.apple.developer.team-identifier": team, "get-task-allow": False,
                             **(entitlements or {})}}


class ProjectFixture:
    def __init__(self, root):
        """Create canonical source paths, including macOS /var temporary symlinks."""
        root = root.resolve()
        self.root = root
        self.app = root / "Example.csproj"
        self.extensions = root / "extensions"
        self.extensions.mkdir()
        self.settings = {}
        self.calls = []
        self.app.write_text("""<Project><PropertyGroup>
<TargetFrameworks>net10.0-android;net10.0-ios;net10.0-maccatalyst</TargetFrameworks>
<ApplicationId>org.example.application</ApplicationId></PropertyGroup>
<PropertyGroup Condition="$([MSBuild]::GetTargetPlatformIdentifier('$(TargetFramework)')) == 'maccatalyst'">
<CodesignEntitlements>mac.entitlements</CodesignEntitlements></PropertyGroup>
<Target Name="IosSigning" Condition="$([MSBuild]::GetTargetPlatformIdentifier('$(TargetFramework)')) == 'ios'
AND '$(_SdkIsSimulator)' != 'true' AND '$(EnableCodeSigning)' != 'false'">
<PropertyGroup><CodesignEntitlements>ios.entitlements</CodesignEntitlements></PropertyGroup>
</Target></Project>""", encoding="utf8")
        self.write_plist(root / "ios.entitlements", {GROUP_KEY: ["group.org.example.shared"]})
        self.write_plist(root / "mac.entitlements", {"com.apple.security.app-sandbox": True})

    @staticmethod
    def write_plist(path, value):
        path.write_bytes(plistlib.dumps(value))

    def extension(self, name="Downloader", capabilities=None, platform="iphoneos", point=None):
        folder = self.extensions / name
        folder.mkdir()
        project = folder / f"{name}.xcodeproj"
        project.mkdir()
        self.write_plist(folder / "extension.entitlements", capabilities or {})
        info = {"EXAppExtensionAttributes": {"EXExtensionPointIdentifier": point}} if point else {}
        self.write_plist(folder / "Info.plist", info)
        parsed = {"objects": {"target": {"isa": "PBXNativeTarget", "name": name,
                                         "productType": "com.apple.product-type.extensionkit-extension"}}}
        (project / "project.pbxproj").write_text(json.dumps(parsed), encoding="utf8")
        settings = {"PRODUCT_BUNDLE_IDENTIFIER": f"org.example.application.{name}",
                    "CODE_SIGN_ENTITLEMENTS": "extension.entitlements", "INFOPLIST_FILE": "Info.plist",
                    "SUPPORTED_PLATFORMS": platform, "SDKROOT": platform, "SRCROOT": str(folder)}
        self.settings[str(project)] = [{"target": name, "buildSettings": settings}]
        return project

    def run(self, command):
        self.calls.append(command)
        if command[0] == signing.PLUTIL:
            return Path(command[-1]).read_bytes()
        if command[0] == signing.XCODEBUILD:
            return json.dumps(self.settings[command[2]]).encode()
        if command[0] == signing.SECURITY:
            return Path(command[-1]).read_bytes()
        raise AssertionError(f"Unexpected native command: {command}")

    def discover(self):
        return requirements.discover_requirements(self.app, self.extensions, self.run)


class DiscoveryTests(unittest.TestCase):
    def test_fixture_paths_remain_canonical_through_directory_symlinks(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            actual = root / "source"
            actual.mkdir()
            linked = root / "linked"
            try:
                linked.symlink_to(actual, target_is_directory=True)
            except OSError:
                self.skipTest("Creating directory symlinks requires additional Windows privileges")
            fixture = ProjectFixture(linked)
            fixture.extension()
            self.assertEqual(len(fixture.discover()), 2)
            self.assertEqual(fixture.root, actual.resolve())

    def test_dtds_and_entities_are_rejected_before_app_identity_discovery(self):
        with tempfile.TemporaryDirectory() as temporary:
            fixture = ProjectFixture(Path(temporary))
            project_text = fixture.app.read_text()
            for declaration in [
                '<!DOCTYPE Project [<!ENTITY identity "org.injected.application">]>',
                '<!DOCTYPE Project SYSTEM "https://invalid.example/project.dtd">',
            ]:
                with self.subTest(declaration=declaration):
                    fixture.app.write_text(declaration + project_text)
                    with self.assertRaisesRegex(signing.SigningError, "Cannot read app signing declarations"):
                        requirements.app_requirement(fixture.app)

    def test_app_uses_declared_device_ios_entitlements_instead_of_mac_or_debug(self):
        with tempfile.TemporaryDirectory() as temporary:
            fixture = ProjectFixture(Path(temporary))
            target = requirements.app_requirement(fixture.app)
            self.assertEqual(target.bundle_id, "org.example.application")
            self.assertEqual(target.entitlements, {GROUP_KEY: ["group.org.example.shared"]})

    def test_release_application_id_overrides_and_entitlement_build_settings_resolve(self):
        with tempfile.TemporaryDirectory() as temporary:
            fixture = ProjectFixture(Path(temporary))
            text = fixture.app.read_text(encoding="utf8").replace("</Project>", """
<PropertyGroup Condition="'$(Configuration)' == 'Release' AND '$(TargetFramework)' == 'net10.0-ios'">
<ApplicationId>org.example.release</ApplicationId></PropertyGroup></Project>""")
            fixture.app.write_text(text, encoding="utf8")
            fixture.write_plist(fixture.root / "ios.entitlements", {GROUP_KEY: ["group.$(CFBundleIdentifier)"]})
            target = requirements.app_requirement(fixture.app)
            self.assertEqual(target.bundle_id, "org.example.release")
            self.assertEqual(target.entitlements[GROUP_KEY], ["group.org.example.release"])

    def test_new_ios_extension_targets_and_capabilities_are_discovered_automatically(self):
        with tempfile.TemporaryDirectory() as temporary:
            fixture = ProjectFixture(Path(temporary))
            fixture.extension(capabilities={GROUP_KEY: ["group.org.example.shared"]},
                              point=requirements.BACKGROUND_ASSETS_POINT)
            fixture.extension("Share", {"com.apple.developer.associated-domains": ["applinks:example.org"]})
            fixture.extension("MacOnly", {"com.apple.security.app-sandbox": True}, platform="macosx")
            targets = fixture.discover()
            self.assertEqual([target.bundle_id for target in targets],
                             ["org.example.application", "org.example.application.Downloader", "org.example.application.Share"])
            self.assertEqual(targets[2].entitlements,
                             {"com.apple.developer.associated-domains": ["applinks:example.org"]})
            self.assertTrue(all("Release" in call for call in fixture.calls if call[0] == signing.XCODEBUILD))

    def test_multiple_extension_targets_in_one_project_are_not_limited_to_first_target(self):
        with tempfile.TemporaryDirectory() as temporary:
            fixture = ProjectFixture(Path(temporary))
            project = fixture.extension()
            parsed = json.loads((project / "project.pbxproj").read_text())
            parsed["objects"]["other"] = {"isa": "PBXNativeTarget", "name": "Share",
                                           "productType": "com.apple.product-type.app-extension"}
            (project / "project.pbxproj").write_text(json.dumps(parsed))
            other = deepcopy(fixture.settings[str(project)][0])
            other["target"] = "Share"
            other["buildSettings"]["PRODUCT_BUNDLE_IDENTIFIER"] = "org.example.application.Share"
            fixture.settings[str(project)].append(other)
            self.assertEqual(len(fixture.discover()), 3)

    def test_release_settings_use_canonical_target_name_with_action_or_alternate_wrappers(self):
        for wrapper in [{"action": "build"}, {"target": "alltargets", "action": "build"}]:
            with self.subTest(wrapper=wrapper), tempfile.TemporaryDirectory() as temporary:
                fixture = ProjectFixture(Path(temporary))
                project = fixture.extension()
                record = fixture.settings[str(project)][0]
                record.pop("target")
                record.update(wrapper)
                record["buildSettings"]["TARGET_NAME"] = "Downloader"
                self.assertEqual(fixture.discover()[1].bundle_id, "org.example.application.Downloader")

    def test_release_mismatch_reports_only_target_identifiers_and_record_counts(self):
        for count, target_name in [(1, "AnotherTarget"), (2, "Downloader")]:
            with self.subTest(count=count), tempfile.TemporaryDirectory() as temporary:
                fixture = ProjectFixture(Path(temporary))
                project = fixture.extension()
                record = fixture.settings[str(project)][0]
                record["target"] = "wrapper-target"
                record["buildSettings"].update(TARGET_NAME=target_name, PRIVATE_API_KEY="SENSITIVE-ENVIRONMENT-VALUE")
                fixture.settings[str(project)] = [deepcopy(record) for _ in range(count)]
                if count > 1:
                    fixture.settings[str(project)][-1]["buildSettings"]["PRODUCT_BUNDLE_IDENTIFIER"] = "org.example.application.Other"
                with self.assertRaisesRegex(signing.SigningError, "missing or ambiguous Release settings") as error:
                    fixture.discover()
                message = str(error.exception)
                self.assertIn(f"records={count}", message)
                self.assertIn(target_name, message)
                self.assertIn("wrapper-target", message)
                self.assertNotIn("PRIVATE_API_KEY", message)
                self.assertNotIn("SENSITIVE-ENVIRONMENT-VALUE", message)
                self.assertNotIn("PRODUCT_BUNDLE_IDENTIFIER", message)

    def test_device_settings_are_preferred_and_identical_native_records_are_deduplicated(self):
        with tempfile.TemporaryDirectory() as temporary:
            fixture = ProjectFixture(Path(temporary))
            project = fixture.extension()
            device = fixture.settings[str(project)][0]
            device["buildSettings"].update(TARGET_NAME="Downloader", PLATFORM_NAME="iphoneos")
            simulator = deepcopy(device)
            simulator["buildSettings"].update(SDKROOT="iphonesimulator", PLATFORM_NAME="iphonesimulator",
                                               PRODUCT_BUNDLE_IDENTIFIER="org.example.application.Simulator")
            fixture.settings[str(project)] = [simulator, device, deepcopy(device)]
            self.assertEqual(fixture.discover()[1].bundle_id, "org.example.application.Downloader")

    def test_supported_platforms_remain_authoritative_when_sdkroot_is_overridden(self):
        with tempfile.TemporaryDirectory() as temporary:
            fixture = ProjectFixture(Path(temporary))
            project = fixture.extension("MacOnly", platform="macosx")
            fixture.settings[str(project)][0]["buildSettings"]["SDKROOT"] = "iphoneos"
            self.assertEqual(len(fixture.discover()), 1)

    def test_classic_extension_point_is_included_and_boolean_conditions_stay_boolean(self):
        with tempfile.TemporaryDirectory() as temporary:
            fixture = ProjectFixture(Path(temporary))
            project = fixture.extension("Share")
            fixture.write_plist(project.parent / "Info.plist", {
                "NSExtension": {"NSExtensionPointIdentifier": "com.apple.share-services"}})
            self.assertEqual(fixture.discover()[1].extension_point, "com.apple.share-services")
            self.assertFalse(requirements.ios_condition("'$(Enabled)'", {"Enabled": "false"}))
            self.assertTrue(requirements.ios_condition("'$(Enabled)'", {"Enabled": "true"}))
            with self.assertRaisesRegex(signing.SigningError, "cyclic"):
                requirements.expand("$(Circular)", {"Circular": "$(Circular)"})

    def test_unsupported_conditions_missing_projects_and_unresolved_values_fail_closed(self):
        with tempfile.TemporaryDirectory() as temporary:
            fixture = ProjectFixture(Path(temporary))
            fixture.write_plist(fixture.root / "ios.entitlements", {GROUP_KEY: ["$(UNKNOWN_PREFIX)shared"]})
            with self.assertRaisesRegex(signing.SigningError, "Unresolved signing build setting"):
                fixture.discover()
            fixture.write_plist(fixture.root / "ios.entitlements", {})
            # Use an unsupported function directly so declaration discovery cannot silently skip it.
            text = fixture.app.read_text()
            fixture.app.write_text(text.replace("'$(_SdkIsSimulator)' != 'true'", "Exists('unknown')"))
            with self.assertRaises(signing.SigningError):
                fixture.discover()
            with self.assertRaisesRegex(signing.SigningError, "Missing extension project directory"):
                requirements.extension_requirements(fixture.root / "absent", fixture.run)


class ProfileInputTests(unittest.TestCase):
    def test_only_three_explicit_profile_inputs_are_read_and_written_atomically(self):
        encoded = base64.b64encode(b"profile-bytes").decode()

        class Inputs:
            def get(self, key):
                values = {"IOS_PROVISIONING_PROFILE_BASE64": encoded,
                          "IOS_EXTENSION_PROVISIONING_PROFILE_BASE64": encoded,
                          "IOS_PROVISIONING_PROFILES_BASE64": json.dumps({"future.bundle": encoded})}
                return values.get(key)

            def __iter__(self):
                raise AssertionError("Never enumerate unrelated environment values")

        with tempfile.TemporaryDirectory() as temporary:
            directory = requirements.import_profile_inputs(Path(temporary), Inputs())
            self.assertEqual(sorted(path.name for path in directory.iterdir()),
                             ["collection-0000.mobileprovision", "legacy-app.mobileprovision", "legacy-extension.mobileprovision"])
            self.assertTrue(all(path.read_bytes() == b"profile-bytes" for path in directory.iterdir()))

    def test_json_list_accepts_future_profiles_without_new_secret_names(self):
        encoded = base64.b64encode(b"another-profile").decode()
        with tempfile.TemporaryDirectory() as temporary:
            directory = requirements.import_profile_inputs(Path(temporary),
                {"IOS_PROVISIONING_PROFILES_BASE64": json.dumps([encoded, encoded])})
            self.assertEqual(len(list(directory.glob("*.mobileprovision"))), 2)

    def test_invalid_profile_values_do_not_appear_in_diagnostics(self):
        invalid_input = "invalid!SENSITIVE-INPUT"
        for value in [invalid_input, json.dumps({"bundle": invalid_input}), json.dumps([14])]:
            with self.subTest(value=value), tempfile.TemporaryDirectory() as temporary:
                with self.assertRaises(signing.SigningError) as error:
                    requirements.import_profile_inputs(Path(temporary), {"IOS_PROVISIONING_PROFILES_BASE64": value})
                self.assertNotIn(invalid_input, str(error.exception))


class MatchingTests(unittest.TestCase):
    def test_missing_profiles_report_every_generated_target_and_its_capabilities(self):
        targets = [requirements.SigningTarget("App", "new.app", {GROUP_KEY: ["group.new"]}, "app"),
                   requirements.SigningTarget("Future", "new.app.Future", {"aps-environment": "production"}, "extension")]
        with tempfile.TemporaryDirectory() as temporary:
            with self.assertRaises(signing.SigningError) as error:
                requirements.match_profiles(targets, Path(temporary))
            message = str(error.exception)
            for expected in ["new.app", "new.app.Future", "group.new", "aps-environment", "production"]:
                self.assertIn(expected, message)
            self.assertNotIn("IOS_EXTENSION_PROVISIONING_PROFILE_BASE64", message)

    def test_each_new_missing_capability_is_reported_without_changing_validator_code(self):
        target = requirements.SigningTarget("Future", "new.app.Future",
                   {GROUP_KEY: ["group.new"], "aps-environment": "production"}, "extension")
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            path = directory / "future.mobileprovision"
            path.write_bytes(plistlib.dumps(distribution_profile(target.bundle_id)))
            with self.assertRaises(signing.SigningError) as error:
                requirements.match_profiles([target], directory, runner=lambda command: Path(command[-1]).read_bytes())
            self.assertIn(GROUP_KEY, str(error.exception))
            self.assertIn("aps-environment", str(error.exception))

    def test_compatible_profiles_match_by_embedded_app_id_and_prefix_not_filename(self):
        targets = [requirements.SigningTarget("App", "new.app", {}, "app"),
                   requirements.SigningTarget("Future", "new.app.Future", {"aps-environment": "production"}, "extension")]
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            for index, target in enumerate(targets):
                profile = distribution_profile(target.bundle_id, target.entitlements)
                (directory / f"arbitrary-{index}.mobileprovision").write_bytes(plistlib.dumps(profile))
            selected = requirements.match_profiles(targets, directory, runner=lambda command: Path(command[-1]).read_bytes())
            self.assertEqual(set(selected), {target.bundle_id for target in targets})

    def test_expired_profiles_cannot_mask_a_valid_profile_and_teams_must_match(self):
        target = requirements.SigningTarget("App", "new.app", {}, "app")
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            old = distribution_profile(target.bundle_id)
            old["ExpirationDate"] = datetime(2020, 1, 1)
            (directory / "old.mobileprovision").write_bytes(plistlib.dumps(old))
            (directory / "valid.mobileprovision").write_bytes(plistlib.dumps(distribution_profile(target.bundle_id)))
            reader = lambda command: Path(command[-1]).read_bytes()
            selected = requirements.match_profiles([target], directory, reader)
            self.assertEqual(selected[target.bundle_id].name, "valid.mobileprovision")
            extension = requirements.SigningTarget("Future", "new.app.Future", {}, "extension")
            (directory / "other.mobileprovision").write_bytes(plistlib.dumps(distribution_profile(extension.bundle_id, team="OTHERTEAM1")))
            with self.assertRaisesRegex(signing.SigningError, "one unambiguous signing team"):
                requirements.match_profiles([target, extension], directory, reader)


class CommandTests(unittest.TestCase):
    def test_cli_generates_inventory_selects_generic_collection_and_exports_packaging_paths(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            fixture = ProjectFixture(root)
            fixture.extension(capabilities={GROUP_KEY: ["group.org.example.shared"]},
                              point=requirements.BACKGROUND_ASSETS_POINT)
            targets = fixture.discover()
            values = [base64.b64encode(plistlib.dumps(distribution_profile(target.bundle_id, target.entitlements))).decode()
                      for target in targets]
            environment = {"IOS_PROVISIONING_PROFILES_BASE64": json.dumps(values)}
            output, errors = StringIO(), StringIO()
            arguments = ["--app-project", str(fixture.app), "--extensions-dir", str(fixture.extensions),
                         "--profiles-dir", str(root / "profiles"), "--github-env", str(root / "github-env"),
                         "--github-summary", str(root / "summary.md"),
                         "--requirements-out", str(root / "requirements.json")]
            with redirect_stdout(output), redirect_stderr(errors):
                result = requirements.main(arguments, environment, fixture.run)
            self.assertEqual(result, 0, errors.getvalue())
            exported = (root / "github-env").read_text()
            self.assertIn("IOS_APP_PROFILE=", exported)
            self.assertIn("ASSET_PACK_DOWNLOADER_PROFILE=", exported)
            self.assertIn("IOS_SIGNING_PROFILES_JSON=", exported)
            self.assertEqual(json.loads((root / "requirements.json").read_text()),
                             [requirements.requirement_dict(target) for target in targets])
            self.assertIn("ios_signing_requirements", output.getvalue())
            summary = (root / "summary.md").read_text()
            self.assertIn("org.example.application.Downloader", summary)
            self.assertIn("group.org.example.shared", summary)
            self.assertTrue(all(value not in output.getvalue() + errors.getvalue() for value in values))

    def test_cli_missing_collection_reports_requirements_and_fails_before_export(self):
        with tempfile.TemporaryDirectory() as temporary:
            fixture = ProjectFixture(Path(temporary))
            fixture.extension("Future", {"aps-environment": "production"})
            output, errors = StringIO(), StringIO()
            with redirect_stdout(output), redirect_stderr(errors):
                result = requirements.main(["--app-project", str(fixture.app),
                    "--extensions-dir", str(fixture.extensions), "--profiles-dir", str(fixture.root / "profiles"),
                    "--github-env", str(fixture.root / "environment"),
                    "--github-summary", str(fixture.root / "summary.md")], {}, fixture.run)
            self.assertEqual(result, 1)
            self.assertIn("org.example.application.Future", errors.getvalue())
            self.assertIn("aps-environment", errors.getvalue())
            self.assertFalse((fixture.root / "environment").exists())
            summary = (fixture.root / "summary.md").read_text()
            self.assertIn("org.example.application.Future", summary)
            self.assertIn("aps-environment", summary)

    def test_help_describes_generic_inputs_and_generated_requirements(self):
        output = StringIO()
        with redirect_stdout(output), self.assertRaises(SystemExit) as exit_status:
            requirements.main(["--help"])
        self.assertEqual(exit_status.exception.code, 0)
        for option in ["--profiles-dir", "--requirements-out", "--github-env", "--github-summary", "--app-project", "--extensions-dir",
                       "IOS_PROVISIONING_PROFILE_BASE64", "IOS_EXTENSION_PROVISIONING_PROFILE_BASE64",
                       "IOS_PROVISIONING_PROFILES_BASE64"]:
            self.assertIn(option, output.getvalue())


if __name__ == "__main__":
    unittest.main()
