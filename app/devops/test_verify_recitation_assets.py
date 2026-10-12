import hashlib
import json
from pathlib import Path
import tempfile
import unittest
import unittest.mock
import zipfile

import verify_recitation_assets as verify_module
from verify_recitation_assets import verify


class ReleaseArtifactTests(unittest.TestCase):
    def test_windows_requires_root_catalog_and_exact_packaged_archives(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            audio = b"book archive"
            catalog = root / "catalog.json"
            catalog.write_text(json.dumps({"books": [{"seferId": 1, "sha256": hashlib.sha256(audio).hexdigest()}]}))
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

    def _write_ios_fixture(self, root, audio, catalog_path, problems=()):
        catalog = {"books": [{"seferId": 1, "sha256": hashlib.sha256(audio).hexdigest()}]}
        catalog_path.write_text(json.dumps(catalog))
        package = root / "app.ipa"
        with zipfile.ZipFile(package, "w") as archive:
            archive.writestr("Payload/Bible.app/recitation-catalog.json", catalog_path.read_bytes())
            if "no-extension" not in problems:
                archive.writestr("Payload/Bible.app/Extensions/AssetPackDownloader.appex/AssetPackDownloader",
                                 b"appex binary")
            if "odr-manifest" in problems:
                archive.writestr("Payload/Bible.app/OnDemandResources.plist", b"metadata")
            if "base-audio" in problems:
                archive.writestr("Payload/Bible.app/recitation_1.zip", audio)
        pack_dir = root / "AssetPacks" / "recitation_1"
        pack_dir.mkdir(parents=True)
        archive_dir = root / "aar"
        archive_dir.mkdir()
        payload_dir = root / "payloads"
        payload_dir.mkdir()
        if "no-manifest" not in problems:
            manifest = {"assetPackID": "recitation_1", "downloadPolicy": {"onDemand": {}},
                        "fileSelectors": [{"file": "recitation_1.zip"}],
                        "platforms": ["macOS"] if "missing-ios-platform" in problems else ["iOS", "macOS"]}
            (pack_dir / "Manifest.json").write_text(json.dumps(manifest))
            (pack_dir / "recitation_1.zip").write_bytes(
                b"corrupt" if "stale-payload" in problems else audio)
        if "no-aar" not in problems:
            (archive_dir / "recitation_1.aar").write_bytes(b"aar bytes")
        if "no-payload" not in problems:
            (payload_dir / "recitation_1.zip").write_bytes(
                b"corrupt" if "staged-mismatch" in problems else audio)

        # Stands in for `aa` extraction: serves the bytes the archive carried.
        archived = b"corrupt" if "corrupt-archive" in problems else audio

        def fake_extract(archive_path, payload_name, work_dir):
            payload = work_dir / payload_name
            payload.write_bytes(archived)
            return payload

        return package, pack_dir.parent, archive_dir, payload_dir, fake_extract

    def test_ipa_requires_aar_manifest_and_embedded_downloader_extension(self):
        audio = b"book archive"
        for problem in [None, "odr-manifest", "base-audio", "no-extension",
                        "no-manifest", "stale-payload", "no-aar", "missing-ios-platform",
                        "corrupt-archive", "no-payload", "staged-mismatch"]:
            with self.subTest(problem=problem), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                package, packs, aars, payloads, extract = self._write_ios_fixture(
                    root, audio, root / "catalog.json", {problem} - {None})
                if problem is None:
                    verify(package, root / "catalog.json", "iOS", packs, aars, payloads, extract)
                else:
                    with self.assertRaises(ValueError):
                        verify(package, root / "catalog.json", "iOS", packs, aars, payloads, extract)

    def test_aa_payload_rejects_non_apple_archive_bytes(self):
        with tempfile.TemporaryDirectory() as temporary, \
                unittest.mock.patch.object(verify_module.shutil, "which", return_value="/usr/bin/aa"):
            root = Path(temporary)
            archive = root / "recitation_1.aar"
            archive.write_bytes(b"not an apple archive")
            with self.assertRaisesRegex(ValueError, "not an Apple Archive"):
                verify_module.aa_payload(archive, "recitation_1.zip", root)

    def test_aa_payload_requires_the_aa_tool(self):
        with tempfile.TemporaryDirectory() as temporary, \
                unittest.mock.patch.object(verify_module.shutil, "which", return_value=None):
            root = Path(temporary)
            archive = root / "recitation_1.aar"
            archive.write_bytes(b"AA01fake")
            with self.assertRaisesRegex(ValueError, "'aa' is required"):
                verify_module.aa_payload(archive, "recitation_1.zip", root)


if __name__ == "__main__":
    unittest.main()
