import hashlib
from io import BytesIO
import json
from pathlib import Path
import plistlib
import tempfile
import unittest
import zipfile

from verify_recitation_assets import verify


class ReleaseArtifactTests(unittest.TestCase):
    @staticmethod
    def book(opus=False, corrupt=False):
        content = b"OggS verified playback" if opus else b"original MP3"
        sha = hashlib.sha256(content).hexdigest()
        track = {"perekId": 1, "audioSha256": sha}
        if opus:
            track["audioSha256"] = "a" * 64
            track["playback"] = {"format": "ogg-opus", "bitrate": 24000, "sha256": sha,
                                 "sizeBytes": len(content), "sourceSha256": "a" * 64}
        payload = BytesIO()
        with zipfile.ZipFile(payload, "w") as archive:
            archive.writestr(sha + (".ogg" if opus else ".mp3"), b"corrupt" if corrupt else content)
        audio = payload.getvalue()
        catalog = {"package": {"tracks": [track]}, "books": [{"seferId": 1,
                   "perekIds": [1], "sha256": hashlib.sha256(audio).hexdigest()}]}
        return audio, catalog

    def test_windows_requires_root_catalog_and_exact_packaged_archives(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            audio, metadata = self.book()
            catalog = root / "catalog.json"
            catalog.write_text(json.dumps(metadata))
            for content in [audio, b"corrupt"]:
                package = root / "app.msix"
                with zipfile.ZipFile(package, "w") as archive:
                    archive.writestr("recitation-catalog.json", catalog.read_bytes())
                    archive.writestr("recitation_1.zip", content)
                if content == audio:
                    verify(package, catalog, "Windows")
                else:
                    with self.assertRaises(ValueError):
                        verify(package, catalog, "Windows")

    def test_aab_requires_every_matching_module_and_excludes_base_audio(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            audio, catalog = self.book(opus=True)
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

    def test_matching_outer_hash_cannot_hide_corrupt_audio_or_wrong_source(self):
        from verify_recitation_assets import verify_book_audio
        audio, catalog = self.book(opus=True, corrupt=True)
        with self.assertRaises(ValueError): verify_book_audio(audio, catalog, catalog["books"][0])
        audio, catalog = self.book(opus=True)
        catalog["package"]["tracks"][0]["playback"]["sourceSha256"] = "b" * 64
        with self.assertRaises(ValueError): verify_book_audio(audio, catalog, catalog["books"][0])

    def test_ipa_requires_tag_and_referenced_compiled_asset_pack(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            catalog = root / "catalog.json"
            catalog.write_text(json.dumps({"books": [{"seferId": 1}]}))
            for payload in [True, False]:
                package = root / "app.ipa"
                with zipfile.ZipFile(package, "w") as archive:
                    archive.writestr("Payload/Bible.app/recitation-catalog.json", catalog.read_bytes())
                    # Apple's reference identifier differs from the physical assetpack directory.
                    metadata = {"NSBundleResourceRequestTags": {"recitation_1": {"NSAssetPacks": ["hashed-pack-id"]}},
                                "NSBundleResourceRequestAssetPacks": {"hashed-pack-id": ["Assets.car"]}}
                    archive.writestr("Payload/Bible.app/OnDemandResources.plist", plistlib.dumps(metadata))
                    if payload:
                        directory = "Payload/OnDemandResources/com.app.recitation_1.assetpack/"
                        archive.writestr(directory + "Assets.car", b"compiled lossless dataset")
                        archive.writestr(directory + "Info.plist", plistlib.dumps({
                            "CFBundleIdentifier": "hashed-pack-id", "Tags": ["recitation_1"]}))
                if payload: verify(package, catalog, "iOS")
                else:
                    with self.assertRaises(ValueError): verify(package, catalog, "iOS")

    def test_ios_datasets_are_hashed_against_signed_book_archives(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            audio, metadata = self.book(opus=True)
            catalog = root / "catalog.json"
            catalog.write_text(json.dumps(metadata))
            package = root / "app.ipa"
            with zipfile.ZipFile(package, "w") as archive:
                archive.writestr("Payload/Bible.app/recitation-catalog.json", catalog.read_bytes())
                metadata_plist = {"NSBundleResourceRequestTags": {"recitation_1": {"NSAssetPacks": ["hashed-pack-id"]}},
                                  "NSBundleResourceRequestAssetPacks": {"hashed-pack-id": ["Assets.car"]}}
                archive.writestr("Payload/Bible.app/OnDemandResources.plist", plistlib.dumps(metadata_plist))
                directory = "Payload/OnDemandResources/com.app.recitation_1.assetpack/"
                archive.writestr(directory + "Assets.car", b"compiled dataset")
                archive.writestr(directory + "Info.plist", plistlib.dumps({
                    "CFBundleIdentifier": "hashed-pack-id", "Tags": ["recitation_1"]}))
            datasets = root / "Recitation.xcassets" / "recitation_1.dataset"
            datasets.mkdir(parents=True)
            with self.assertRaises(ValueError):
                verify(package, catalog, "iOS", datasets.parent)
            (datasets / "recitation_1.zip").write_bytes(b"corrupt")
            with self.assertRaises(ValueError):
                verify(package, catalog, "iOS", datasets.parent)
            (datasets / "recitation_1.zip").write_bytes(audio)
            verify(package, catalog, "iOS", datasets.parent)


if __name__ == "__main__":
    unittest.main()
