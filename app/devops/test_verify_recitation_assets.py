import hashlib
import json
from pathlib import Path
import plistlib
import tempfile
import unittest
import zipfile

from verify_recitation_assets import verify


class ReleaseArtifactTests(unittest.TestCase):
    def test_aab_requires_every_matching_module_and_excludes_base_audio(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            audio = b"book archive"
            catalog = {"books": [{"seferId": 1, "sha256": hashlib.sha256(audio).hexdigest()}]}
            path = root / "catalog.json"
            path.write_text(json.dumps(catalog))
            for problem in [None, "missing", "corrupt", "base"]:
                package = root / "app.aab"
                with zipfile.ZipFile(package, "w") as archive:
                    archive.writestr("base/assets/recitation-catalog.json", path.read_bytes())
                    archive.writestr("recitation_1/manifest/AndroidManifest.xml", "manifest")
                    if problem != "missing":
                        archive.writestr("recitation_1/assets/recitation_1.zip", b"corrupt" if problem == "corrupt" else audio)
                    if problem == "base":
                        archive.writestr("base/assets/recitation_1.zip", audio)
                if problem is None: verify(package, path, "Android")
                else:
                    with self.assertRaises(ValueError): verify(package, path, "Android")

    def test_ipa_requires_tag_and_referenced_compiled_asset_pack(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            catalog = root / "catalog.json"
            catalog.write_text(json.dumps({"books": [{"seferId": 1}]}))
            for payload in [True, False]:
                package = root / "app.ipa"
                with zipfile.ZipFile(package, "w") as archive:
                    archive.writestr("Payload/Bible.app/recitation-catalog.json", catalog.read_bytes())
                    metadata = {"NSBundleResourceRequestTags": {"recitation_1": {"NSBundleResourceRequestAssetPacks": ["pack1"]}}}
                    archive.writestr("Payload/Bible.app/OnDemandResources.plist", plistlib.dumps(metadata))
                    if payload: archive.writestr("OnDemandResources/pack1.assetpack/Assets.car", b"compiled lossless dataset")
                if payload: verify(package, catalog, "iOS")
                else:
                    with self.assertRaises(ValueError): verify(package, catalog, "iOS")


if __name__ == "__main__":
    unittest.main()
