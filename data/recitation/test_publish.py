"""Publication stays atomic and does not disturb readers of unchanged snapshots."""

import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from alignment import text_hash, words_for
from publish import extract, publish
from recite import export_database, write_json


class PublicationTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.root = Path(self.folder.name)
        self.database = self.root / "canonical.json"
        self.intermediate = self.root / "recitation.sqlite"
        chapter = {"pesukim": [{"segments": [{"type": "qri", "value": "אור"}]}]}
        self.database.write_text(json.dumps([{"perekFrom": 1, "perakim": [chapter]}]), encoding="utf-8")
        write_json(self.root / "1.json", {"version": 1, "perekId": 1,
            "audioUrl": "https://example.com/1_record.mp3", "audioSha256": "audio",
            "textSha256": text_hash(words_for(chapter)), "durationMs": 1000,
            "alignmentStatus": "ready", "words": [{"pasuk": 1, "segment": 1,
                "text": "אור", "startMs": 100, "endMs": 600}]})
        export_database(self.root, self.intermediate)

    def test_repeated_publication_preserves_file_without_replacing_a_readers_snapshot(self):
        self.assertEqual(publish(self.intermediate, self.database), 1)
        before, modified = self.database.read_bytes(), self.database.stat().st_mtime_ns
        with patch.object(Path, "replace", side_effect=PermissionError("reader holds snapshot")) as replace:
            self.assertEqual(publish(self.intermediate, self.database), 1)
            replace.assert_not_called()
        self.assertEqual(self.database.read_bytes(), before)
        self.assertEqual(self.database.stat().st_mtime_ns, modified)

    def test_changed_publication_recovers_from_a_transient_windows_reader(self):
        replace = Path.replace
        locked = PermissionError("sharing violation")
        locked.winerror = 32
        attempts = []

        def transient(path, target):
            attempts.append(path)
            if len(attempts) == 1:
                raise locked
            return replace(path, target)

        with patch.object(Path, "replace", transient), patch("publish.time.sleep") as sleep:
            self.assertEqual(publish(self.intermediate, self.database), 1)
            sleep.assert_called_once_with(.05)
        self.assertEqual(len(attempts), 2)
        actual = extract(1, json.loads(self.database.read_bytes())[0]["perakim"][0])
        self.assertEqual((actual["words"][0]["startMs"], actual["words"][0]["endMs"]), (100, 600))
        self.assertEqual(list(self.root.glob("*.tmp")), [])

    def test_persistent_windows_lock_is_bounded_and_preserves_the_old_snapshot(self):
        before = self.database.read_bytes()
        locked = PermissionError("access denied")
        locked.winerror = 5
        with patch.object(Path, "replace", side_effect=locked) as replace, patch("publish.time.sleep") as sleep:
            with self.assertRaises(PermissionError):
                publish(self.intermediate, self.database)
            self.assertEqual(replace.call_count, 8)
            self.assertEqual(sleep.call_count, 7)
        self.assertEqual(self.database.read_bytes(), before)
        self.assertEqual(list(self.root.glob("*.tmp")), [])

    def test_non_windows_permission_denial_fails_without_retry_or_partial_write(self):
        before = self.database.read_bytes()
        with patch.object(Path, "replace", side_effect=PermissionError("permission denied")) as replace, patch("publish.time.sleep") as sleep:
            with self.assertRaises(PermissionError):
                publish(self.intermediate, self.database)
            replace.assert_called_once()
            sleep.assert_not_called()
        self.assertEqual(self.database.read_bytes(), before)
        self.assertEqual(list(self.root.glob("*.tmp")), [])


if __name__ == "__main__":
    unittest.main()
