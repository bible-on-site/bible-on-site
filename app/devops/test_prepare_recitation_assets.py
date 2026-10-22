import hashlib
from http.client import IncompleteRead
from contextlib import closing
import io
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch
from urllib.error import HTTPError, URLError
import zipfile

from prepare_recitation_assets import DOWNLOAD_ATTEMPTS, book_archive, prepare_assets, recording


class RecitationAssetsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.cache = self.root / "cache"
        self.cache.mkdir()
        self.recordings = self.root / "recordings"
        self.recordings.mkdir()
        self.audio = b"original MP3 bytes"
        self.sha = hashlib.sha256(self.audio).hexdigest()
        self.track = {"perekId": 1, "audioSha256": self.sha}
        (self.recordings / "1_record.mp3").write_bytes(self.audio)

    def test_exact_bytes_deterministic_pack_and_cached_offline_rebuild(self):
        path = recording(self.track, self.cache, self.recordings)
        self.assertEqual(path.read_bytes(), self.audio)
        (self.recordings / "1_record.mp3").unlink()
        self.assertEqual(recording(self.track, self.cache).read_bytes(), self.audio)
        pack = self.root / "recitation_1.zip"
        book_archive(pack, [self.track], self.cache)
        original = pack.read_bytes()
        book_archive(pack, [self.track], self.cache)
        self.assertEqual(pack.read_bytes(), original)
        with zipfile.ZipFile(pack) as archive:
            self.assertEqual(archive.read(self.sha + ".mp3"), self.audio)
            self.assertEqual(archive.infolist()[0].compress_type, zipfile.ZIP_STORED)

    def test_corruption_is_never_cached(self):
        (self.recordings / "1_record.mp3").write_bytes(b"corrupt MP3")
        with self.assertRaisesRegex(ValueError, "checksum"):
            recording(self.track, self.cache, self.recordings)
        self.assertEqual(list(self.cache.iterdir()), [])

    def test_build_http_transport_checks_exact_original_bytes(self):
        response = io.BytesIO(self.audio)
        response.status = 200
        with patch("prepare_recitation_assets.open_https", return_value=response) as transport:
            track = {**self.track, "audioUrl": "https://example.com/recordings/1_record.mp3"}
            self.assertEqual(recording(track, self.cache).read_bytes(), self.audio)
            transport.assert_called_once_with("https://example.com/recordings/1_record.mp3")

    def test_cold_cache_connection_reset_then_exact_download(self):
        response = io.BytesIO(self.audio)
        response.status = 200
        track = {**self.track, "audioUrl": "https://example.com/recordings/1_record.mp3"}
        with patch("prepare_recitation_assets.open_https", side_effect=[ConnectionResetError(104, "reset"), response]) as transport, \
                patch("prepare_recitation_assets.time.sleep"):
            self.assertEqual(recording(track, self.cache).read_bytes(), self.audio)
            self.assertEqual(transport.call_count, 2)
        self.assertEqual(sorted(p.name for p in self.cache.iterdir()), [self.sha + ".mp3"])

    def test_partial_response_is_discarded_before_retry_and_hash_check(self):
        class InterruptedResponse(io.BytesIO):
            status = 200

            def read(self, size=-1):
                if self.tell():
                    raise IncompleteRead(b"", len(self.audio))
                return super().read(3)

        partial = InterruptedResponse(self.audio)
        partial.audio = self.audio
        complete = io.BytesIO(self.audio)
        complete.status = 200
        track = {**self.track, "audioUrl": "https://example.com/recordings/1_record.mp3"}
        with patch("prepare_recitation_assets.open_https", side_effect=[partial, complete]), \
                patch("prepare_recitation_assets.time.sleep"):
            self.assertEqual(recording(track, self.cache).read_bytes(), self.audio)
        self.assertFalse((self.cache / (self.sha + ".download")).exists())

    def test_transient_http_failure_retries_but_permanent_failure_does_not(self):
        track = {**self.track, "audioUrl": "https://example.com/recordings/1_record.mp3"}
        complete = io.BytesIO(self.audio)
        complete.status = 200
        with patch("prepare_recitation_assets.open_https", side_effect=[HTTPError(track['audioUrl'], 503, 'unavailable', {}, None), complete]) as transport, \
                patch("prepare_recitation_assets.time.sleep"):
            self.assertEqual(recording(track, self.cache).read_bytes(), self.audio)
            self.assertEqual(transport.call_count, 2)
        (self.cache / (self.sha + ".mp3")).unlink()
        for code in (403, 404):
            failure = HTTPError(track['audioUrl'], code, 'permanent', {}, None)
            with self.subTest(code=code), patch("prepare_recitation_assets.open_https", side_effect=failure) as transport, \
                    patch("prepare_recitation_assets.time.sleep") as sleep:
                with self.assertRaises(HTTPError):
                    recording(track, self.cache)
                self.assertEqual(transport.call_count, 1)
                sleep.assert_not_called()
        self.assertEqual(list(self.cache.iterdir()), [])

    def test_exhausted_network_retries_leave_no_partial_or_valid_cache(self):
        track = {**self.track, "audioUrl": "https://example.com/recordings/1_record.mp3"}
        with patch("prepare_recitation_assets.open_https", side_effect=URLError(TimeoutError("network timeout"))) as transport, \
                patch("prepare_recitation_assets.time.sleep") as sleep:
            with self.assertRaises(URLError):
                recording(track, self.cache)
            self.assertEqual(transport.call_count, DOWNLOAD_ATTEMPTS)
            self.assertEqual(sleep.call_count, DOWNLOAD_ATTEMPTS - 1)
        self.assertEqual(list(self.cache.iterdir()), [])

    def test_successful_http_response_with_wrong_bytes_is_never_retried_or_cached(self):
        response = io.BytesIO(b"different MP3 bytes")
        response.status = 200
        track = {**self.track, "audioUrl": "https://example.com/recordings/1_record.mp3"}
        with patch("prepare_recitation_assets.open_https", return_value=response) as transport, \
                patch("prepare_recitation_assets.time.sleep") as sleep:
            with self.assertRaisesRegex(ValueError, "checksum"):
                recording(track, self.cache)
            self.assertEqual(transport.call_count, 1)
            sleep.assert_not_called()
        self.assertEqual(list(self.cache.iterdir()), [])

    def test_build_rejects_non_https_and_non_chapter_urls(self):
        for url in ["file:///recordings/1_record.mp3", "http://example.com/recordings/1_record.mp3",
                    "https://example.com/other.mp3", "https://user:password@example.com/recordings/1_record.mp3"]:
            with self.subTest(url=url), self.assertRaisesRegex(ValueError, "HTTPS"):
                recording({**self.track, "audioUrl": url}, self.cache)
        self.assertEqual(list(self.cache.iterdir()), [])

    def test_end_to_end_packs_native_books_and_only_approved_exact_timings(self):
        words = [{"type": "qri", "value": "אור"}]
        text_sha = hashlib.sha256("1:1:אור".encode()).hexdigest()
        database = self.root / "perakim.json"
        database.write_text(json.dumps([{"perekFrom": 1, "perakim": [
            {"pesukim": [{"segments": words}]}, {"pesukim": [{"segments": words}]}]}]), encoding="utf-8")
        intermediate = self.root / "recitation.sqlite"
        with closing(sqlite3.connect(intermediate)) as connection:
            connection.executescript("""PRAGMA user_version=3;
                CREATE TABLE recitation_track(perek_id,audio_url,audio_sha256,text_sha256,duration_ms,alignment_status,provenance_json);
                CREATE TABLE recitation_word(perek_id,pasuk,segment,start_ms,end_ms);""")
            for pid, status in [(1, "ready"), (2, "pending")]:
                connection.execute("INSERT INTO recitation_track VALUES (?,?,?,?,?,?,?)", (
                    pid, f"https://example.com/recordings/{pid}_record.mp3", self.sha, text_sha, 1000, status, "{}"))
            connection.execute("INSERT INTO recitation_word VALUES (1,1,1,123,987)")
            connection.commit()
        native = self.root / "native.sqlite"
        with closing(sqlite3.connect(native)) as connection:
            connection.executescript("""CREATE TABLE tanah_sefer(id,perek_id_from,perek_id_to);
                INSERT INTO tanah_sefer VALUES (1,1,2);
                CREATE TABLE tanah_pasuk_segment(id,perek_id,pasuk_id,segment_type);
                CREATE TABLE tanah_pasuk_segment_value(id,value);
                INSERT INTO tanah_pasuk_segment VALUES (1,1,1,'qri'),(2,2,1,'qri');
                INSERT INTO tanah_pasuk_segment_value VALUES (1,'אור'),(2,'אור');""")
            connection.commit()
        (self.recordings / "2_record.mp3").write_bytes(self.audio)
        opus = b"OggS compressed playback"
        opus_sha = hashlib.sha256(opus).hexdigest()
        (self.recordings / (opus_sha + ".ogg")).write_bytes(opus)
        playback = {"sha256": opus_sha, "sizeBytes": len(opus), "key": f"recordings/opus-24k/{opus_sha}.ogg"}
        source_bytes = database.read_bytes()
        catalogs = []
        for platform in ["Android", "iOS", "Windows"]:
            app = self.root / platform
            if platform == "iOS":
                # A legacy underscore pack dir must not survive into the archive glob.
                stale = app / "Platforms/iOS/AssetPacks/recitation_9"
                stale.mkdir(parents=True)
                (stale / "Manifest.json").write_text("{}")
            with patch("prepare_recitation_assets.load_playback", return_value=playback):
                result = prepare_assets(app, platform, self.cache, self.recordings, intermediate, database, native)
            catalogs.append(result)
            self.assertEqual(result["books"][0]["perekIds"], [1, 2])
            self.assertEqual(result["package"]["tracks"][0]["words"][0]["startMs"], 123)
            self.assertEqual(result["package"]["tracks"][1]["words"], [])
            if platform == "iOS":
                self.assertFalse(stale.exists())
                pack_dir = app / "Platforms/iOS/AssetPacks/recitation-1"
                manifest = json.loads((pack_dir / "Manifest.json").read_text())
                self.assertEqual(manifest["assetPackID"], "recitation-1")
                self.assertEqual(manifest["downloadPolicy"], {"onDemand": {}})
                self.assertEqual(manifest["fileSelectors"], [{"file": "recitation-1.zip"}])
                self.assertEqual(manifest["platforms"], ["iOS", "macOS"])
                self.assertTrue((pack_dir / "recitation-1.zip").is_file())
        android = catalogs[0]["package"]["tracks"][0]
        self.assertEqual(android["audioSha256"], self.sha)
        self.assertEqual(android["playback"]["sha256"], opus_sha)
        self.assertEqual(android["playback"]["sourceSha256"], self.sha)
        with zipfile.ZipFile(self.root / "Android/Platforms/Android/AssetPacks/recitation_1/recitation_1.zip") as packed:
            self.assertEqual(packed.namelist(), [opus_sha + ".ogg"])
            self.assertEqual(packed.read(opus_sha + ".ogg"), opus)
        # Apple asset packs carry the identical Opus bytes as the Android modules.
        self.assertEqual(catalogs[0], catalogs[1])
        with zipfile.ZipFile(self.root / "iOS/Platforms/iOS/AssetPacks/recitation-1/recitation-1.zip") as packed:
            self.assertEqual(packed.namelist(), [opus_sha + ".ogg"])
            self.assertEqual(packed.read(opus_sha + ".ogg"), opus)
        self.assertNotIn("playback", catalogs[2]["package"]["tracks"][0])
        # A cold local mobile build uses the configured original MP3s without
        # needing the store playback manifest, derived files or network access.
        for platform in ["Android", "iOS"]:
            app = self.root / (platform + "-local")
            cache = self.root / (platform + "-local-cache")
            with patch("prepare_recitation_assets.load_playback", side_effect=AssertionError("store manifest")), \
                    patch("prepare_recitation_assets.open_https", side_effect=AssertionError("network")):
                local = prepare_assets(app, platform, cache, self.recordings, intermediate, database, native,
                                       local_originals=True)
            self.assertNotIn("playback", local["package"]["tracks"][0])
            self.assertEqual(local["package"]["tracks"][0]["words"], catalogs[0]["package"]["tracks"][0]["words"])
            pack = "recitation-1" if platform == "iOS" else "recitation_1"
            with zipfile.ZipFile(app / f"Platforms/{platform}/AssetPacks/{pack}/{pack}.zip") as packed:
                self.assertEqual(packed.namelist(), [self.sha + ".mp3"])
                self.assertEqual(packed.read(self.sha + ".mp3"), self.audio)
            self.assertEqual(local["books"][0]["sha256"], hashlib.sha256(
                (app / f"Platforms/{platform}/AssetPacks/{pack}/{pack}.zip").read_bytes()).hexdigest())
        self.assertEqual(database.read_bytes(), source_bytes)

    def test_local_originals_requires_source_directory(self):
        with self.assertRaisesRegex(ValueError, "recordings directory"):
            prepare_assets(self.root / "app", "Android", self.cache, local_originals=True)


if __name__ == "__main__":
    unittest.main()
