import copy
import datetime as dt
import plistlib
import tempfile
import unittest
from pathlib import Path

from prepare_extension import signing_entitlements, stamp_version


class PrepareExtensionTests(unittest.TestCase):
    def setUp(self):
        self.bundle_id = "com.tanah.daily929.AssetPackDownloader"
        self.group = "group.com.tanah.daily929.assets"
        self.requested = {"com.apple.security.application-groups": [self.group]}
        self.now = dt.datetime(2026, 10, 15, tzinfo=dt.timezone.utc)
        self.profile = {
            "ExpirationDate": dt.datetime(2027, 10, 15),
            "ApplicationIdentifierPrefix": ["APP_PREFIX"],
            "TeamIdentifier": ["TEAM_ID"],
            "Entitlements": {
                **self.requested,
                "application-identifier": f"APP_PREFIX.{self.bundle_id}",
                "com.apple.developer.team-identifier": "TEAM_ID",
                "get-task-allow": False,
                "unrequested-capability": True,
            },
        }

    def test_adds_exact_profile_identity_without_unrequested_capabilities(self):
        result = signing_entitlements(self.profile, self.requested, self.bundle_id, self.now)
        self.assertEqual(result["application-identifier"], f"APP_PREFIX.{self.bundle_id}")
        self.assertEqual(result["com.apple.developer.team-identifier"], "TEAM_ID")
        self.assertFalse(result["get-task-allow"])
        self.assertNotIn("unrequested-capability", result)
        self.assertNotIn("application-identifier", self.requested)

    def test_rejects_incompatible_and_expired_profiles(self):
        mutations = [
            ("Entitlements", "application-identifier", "APP_PREFIX.com.other.app"),
            ("Entitlements", "application-identifier", "APP_PREFIX.*"),
            ("Entitlements", "com.apple.security.application-groups", []),
            ("Entitlements", "com.apple.developer.team-identifier", "OTHER_TEAM"),
        ]
        for section, key, value in mutations:
            with self.subTest(key=key, value=value):
                profile = copy.deepcopy(self.profile)
                profile[section][key] = value
                with self.assertRaises(ValueError):
                    signing_entitlements(profile, self.requested, self.bundle_id, self.now)
        self.profile["ExpirationDate"] = dt.datetime(2026, 10, 14)
        with self.assertRaisesRegex(ValueError, "expired"):
            signing_entitlements(self.profile, self.requested, self.bundle_id, self.now)

    def test_cached_extension_versions_are_stamped_before_signing(self):
        with tempfile.TemporaryDirectory() as temporary:
            extension = Path(temporary)
            path = extension / "Info.plist"
            original = {
                "CFBundleIdentifier": self.bundle_id,
                "CFBundleExecutable": "AssetPackDownloader",
                "CFBundleName": "AssetPackDownloader",
                "CFBundleDisplayName": "Asset Pack Downloader",
                "CFBundlePackageType": "XPC!",
                "CFBundleShortVersionString": "1.0",
                "CFBundleVersion": "1",
                "EXAppExtensionAttributes": {"EXExtensionPointIdentifier": "expected"},
            }
            path.write_bytes(plistlib.dumps(original))
            self.assertEqual(stamp_version(extension, "5.0.167", "167"), self.bundle_id)
            stamped = plistlib.loads(path.read_bytes())
            self.assertEqual(stamped["CFBundleShortVersionString"], "5.0.167")
            self.assertEqual(stamped["CFBundleVersion"], "167")
            self.assertEqual(stamped["EXAppExtensionAttributes"], original["EXAppExtensionAttributes"])
            stamped["CFBundleExecutable"] = "$(EXECUTABLE_NAME)"
            path.write_bytes(plistlib.dumps(stamped))
            with self.assertRaisesRegex(ValueError, "CFBundleExecutable"):
                stamp_version(extension, "5.0.167", "167")


if __name__ == "__main__":
    unittest.main()
