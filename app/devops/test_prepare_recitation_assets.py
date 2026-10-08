import hashlib
from contextlib import closing
import io
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch
import zipfile

from prepare_recitation_assets import book_archive, prepare_assets, recording


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
        source_bytes = database.read_bytes()
        catalogs = []
        for platform in ["Android", "iOS", "Windows"]:
            app = self.root / platform
            result = prepare_assets(app, platform, self.cache, self.recordings, intermediate, database, native)
            catalogs.append(result)
            self.assertEqual(result["books"][0]["perekIds"], [1, 2])
            self.assertEqual(result["package"]["tracks"][0]["words"][0]["startMs"], 123)
            self.assertEqual(result["package"]["tracks"][1]["words"], [])
            if platform == "iOS":
                contents = json.loads((app / "Platforms/iOS/Assets/Recitation.xcassets/recitation_1.dataset/Contents.json").read_text())
                self.assertEqual(contents["properties"]["on-demand-resource-tags"], ["recitation_1"])
        self.assertEqual(catalogs[0], catalogs[1])
        self.assertEqual(catalogs[1], catalogs[2])
        self.assertEqual(database.read_bytes(), source_bytes)


if __name__ == "__main__":
    unittest.main()
