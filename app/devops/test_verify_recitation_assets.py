import hashlib
from io import BytesIO
import json
from pathlib import Path
import tempfile
import unittest
import unittest.mock
import zipfile

import verify_recitation_assets as verify_module


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
                    verify_module.verify(package, catalog, "Windows")
                else:
                    with self.assertRaises(ValueError):
                        verify_module.verify(package, catalog, "Windows")

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
                if problem is None: verify_module.verify(package, path, "Android")
                else:
                    with self.assertRaises(ValueError): verify_module.verify(package, path, "Android")

    def test_matching_outer_hash_cannot_hide_corrupt_audio_or_wrong_source(self):
        audio, catalog = self.book(opus=True, corrupt=True)
        with self.assertRaises(ValueError): verify_module.verify_book_audio(audio, catalog, catalog["books"][0])
        audio, catalog = self.book(opus=True)
        catalog["package"]["tracks"][0]["playback"]["sourceSha256"] = "b" * 64
        with self.assertRaises(ValueError): verify_module.verify_book_audio(audio, catalog, catalog["books"][0])

    def _write_ios_fixture(self, root, audio, catalog_path, catalog, problems=()):
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
                archive.writestr("Payload/Bible.app/recitation-1.zip", audio)
        pack_dir = root / "AssetPacks" / "recitation-1"
        pack_dir.mkdir(parents=True)
        archive_dir = root / "aar"
        archive_dir.mkdir()
        payload_dir = root / "payloads"
        payload_dir.mkdir()
        if "no-manifest" not in problems:
            manifest = {"assetPackID": "recitation-1", "downloadPolicy": {"onDemand": {}},
                        "fileSelectors": [{"file": "recitation-1.zip"}],
                        "platforms": ["macOS"] if "missing-ios-platform" in problems
                        else ["iOS", "macOS"] if "extra-macos-platform" in problems else ["iOS"]}
            (pack_dir / "Manifest.json").write_text(json.dumps(manifest))
            (pack_dir / "recitation-1.zip").write_bytes(
                b"corrupt" if "stale-payload" in problems else audio)
        if "no-aar" not in problems:
            (archive_dir / "recitation-1.aar").write_bytes(b"aar bytes")
        if "no-payload" not in problems:
            (payload_dir / "recitation-1.zip").write_bytes(
                b"corrupt" if "staged-mismatch" in problems else audio)
        perushim_dir = root / "AssetPacks" / "perushim-notes"
        perushim_dir.mkdir(parents=True, exist_ok=True)
        notes = "sefaria-dump-5784-sivan-4.perushim_notes.sqlite"
        index = "sefaria-dump-5784-sivan-4.hebrew_search.sqlite"
        perushim_payloads = {notes: b"notes bytes", index: b"index bytes"}
        if "no-perushim-manifest" not in problems:
            selectors = [{"file": notes}] + ([] if "perushim-missing-index" in problems else [{"file": index}])
            if "nested-perushim-selector" in problems:
                selectors.append({"file": f"nested/{index}"})
            manifest = {"assetPackID": "perushim-notes", "downloadPolicy": {"onDemand": {}},
                        "fileSelectors": selectors, "platforms": ["iOS"]}
            (perushim_dir / "Manifest.json").write_text(json.dumps(manifest))
        for name, data in perushim_payloads.items():
            if "no-perushim-payload" in problems and name == index:
                continue
            if "perushim-staged-mismatch" in problems and name == index:
                data = b"stale index"
            (perushim_dir / name).write_bytes(
                b"notes bytes" if name == notes else b"index bytes")
            (payload_dir / name).write_bytes(data)
        if "no-perushim-aar" not in problems:
            (archive_dir / "perushim-notes.aar").write_bytes(b"aar bytes")

        # Stands in for `aa` extraction: serves the bytes the archive carried.
        archived = b"corrupt" if "corrupt-archive" in problems else audio
        archived_perushim = dict(perushim_payloads)
        if "perushim-archive-mismatch" in problems:
            archived_perushim[index] = b"corrupt"

        def fake_extract(archive_path, payload_name, work_dir):
            payload = work_dir / payload_name
            payload.write_bytes(archived_perushim.get(payload_name, archived))
            return payload

        return package, pack_dir.parent, archive_dir, payload_dir, fake_extract

    def test_ipa_requires_aar_manifest_and_embedded_downloader_extension(self):
        audio, catalog = self.book(opus=True)
        for problem in [None, "odr-manifest", "base-audio", "no-extension",
                        "no-manifest", "stale-payload", "no-aar", "missing-ios-platform",
                        "extra-macos-platform",
                        "corrupt-archive", "no-payload", "staged-mismatch",
                        "no-perushim-manifest", "perushim-missing-index",
                        "nested-perushim-selector", "no-perushim-payload",
                        "perushim-staged-mismatch", "perushim-archive-mismatch",
                        "no-perushim-aar"]:
            with self.subTest(problem=problem), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                package, packs, aars, payloads, extract = self._write_ios_fixture(
                    root, audio, root / "catalog.json", catalog, {problem} - {None})
                if problem is None:
                    verify_module.verify(package, root / "catalog.json", "iOS", packs, aars, payloads, extract)
                else:
                    with self.assertRaises(ValueError):
                        verify_module.verify(package, root / "catalog.json", "iOS", packs, aars, payloads, extract)

    def test_aa_payload_propagates_decoder_errors_for_invalid_and_truncated_archives(self):
        for encoded in (b"not an apple archive", b"pbze"):
            with self.subTest(encoded=encoded), tempfile.TemporaryDirectory() as temporary, \
                    unittest.mock.patch.object(verify_module.shutil, "which", return_value="/usr/bin/aa"), \
                    unittest.mock.patch.object(verify_module.subprocess, "run") as decoder:
                root = Path(temporary)
                archive = root / "recitation-1.aar"
                archive.write_bytes(encoded)
                decoder.return_value = verify_module.subprocess.CompletedProcess(
                    [], 1, stdout="", stderr="invalid or truncated archive")
                with self.assertRaisesRegex(ValueError, "aa extract failed.*invalid or truncated archive"):
                    verify_module.aa_payload(archive, "recitation-1.zip", root)
                decoder.assert_called_once()

    def test_aa_payload_delegates_compressed_archive_decoding_to_apple(self):
        with tempfile.TemporaryDirectory() as temporary, \
                unittest.mock.patch.object(verify_module.shutil, "which", return_value="/usr/bin/aa"), \
                unittest.mock.patch.object(verify_module.subprocess, "run") as decoder:
            root = Path(temporary)
            archive = root / "recitation-1.aar"
            archive.write_bytes(b"pbze compressed archive fixture")
            payload = root / "recitation-1.zip"
            payload.write_bytes(b"decoded payload")
            decoder.return_value = verify_module.subprocess.CompletedProcess([], 0, stdout="", stderr="")
            self.assertEqual(verify_module.aa_payload(archive, payload.name, root), payload)
            decoder.assert_called_once_with(
                ["/usr/bin/aa", "extract", "-i", str(archive), "-d", str(root)],
                capture_output=True, text=True)

    def test_aa_payload_requires_the_aa_tool(self):
        with tempfile.TemporaryDirectory() as temporary, \
                unittest.mock.patch.object(verify_module.shutil, "which", return_value=None):
            root = Path(temporary)
            archive = root / "recitation-1.aar"
            archive.write_bytes(b"AA01fake")
            with self.assertRaisesRegex(ValueError, "'aa' is required"):
                verify_module.aa_payload(archive, "recitation-1.zip", root)

    def test_ios_matching_outer_hash_cannot_hide_corrupt_audio(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            audio, catalog = self.book(opus=True, corrupt=True)
            package, packs, aars, payloads, extract = self._write_ios_fixture(
                root, audio, root / "catalog.json", catalog)
            with self.assertRaisesRegex(ValueError, "checksum or format mismatch"):
                verify_module.verify(package, root / "catalog.json", "iOS", packs, aars, payloads, extract)

    def test_ios_verification_emits_the_verified_pack_plan(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            audio, catalog = self.book(opus=True)
            package, packs, aars, payloads, extract = self._write_ios_fixture(
                root, audio, root / "catalog.json", catalog)
            verify_module.verify(package, root / "catalog.json", "iOS", packs, aars, payloads, extract)
            plan = json.loads((aars / verify_module.PACK_MANIFEST).read_text(encoding="utf-8"))
            self.assertEqual(plan["version"], 1)
            self.assertEqual({pack["id"] for pack in plan["packs"]},
                             {"recitation-1", "perushim-notes"})
            for pack in plan["packs"]:
                pack_dir = packs / pack["id"]
                manifest_bytes = (pack_dir / "Manifest.json").read_bytes()
                expected_files = [(item.name, hashlib.sha256(item.read_bytes()).hexdigest(),
                                   item.stat().st_size)
                                  for item in pack_dir.iterdir()
                                  if item.is_file() and item.name != "Manifest.json"]
                self.assertEqual(pack["files"],
                                 [{"name": name, "sha256": sha, "bytes": size}
                                  for name, sha, size in sorted(expected_files)])
                self.assertEqual(pack["contentSha256"],
                                 verify_module.content_fingerprint(manifest_bytes, expected_files))
                self.assertEqual(pack["archive"], f'{pack["id"]}.aar')
                self.assertEqual(pack["archiveSha256"],
                                 hashlib.sha256((aars / pack["archive"]).read_bytes()).hexdigest())
                self.assertEqual(pack["manifest"]["assetPackID"], pack["id"])
            self.assertTrue(all(pack["archiveBytes"] > 0 for pack in plan["packs"]))

    def test_content_fingerprint_changes_on_manifest_or_payload_bytes_only(self):
        payloads = [("a.zip", "f" * 64, 10), ("b.zip", "e" * 64, 20)]
        base = verify_module.content_fingerprint(b'{"assetPackID":"p"}', payloads)
        self.assertEqual(base, verify_module.content_fingerprint(b'{"assetPackID":"p"}', payloads[::-1]))
        self.assertNotEqual(base, verify_module.content_fingerprint(b'{"assetPackID":"q"}', payloads))
        self.assertNotEqual(base, verify_module.content_fingerprint(b'{"assetPackID":"p"}', payloads[1:]))


if __name__ == "__main__":
    unittest.main()
