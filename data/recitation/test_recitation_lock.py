"""The recitation database lockfile serializes copy-mutate-replace writers."""

import fcntl
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

from alignment import text_hash, words_for
from listening_accept import overlay_reviews
from recite import export_database, write_json


def manifest(perek_id, status="ready", **extra):
    chapter = {"pesukim": [{"segments": [{"type": "qri", "value": "אור"}]}]}
    data = {"version": 1, "perekId": perek_id,
        "audioUrl": f"https://example.com/{perek_id}_record.mp3", "audioSha256": "audio",
        "textSha256": text_hash(words_for(chapter)), "durationMs": 1000,
        "alignmentStatus": status,
        "words": [{"pasuk": 1, "segment": 1, "text": "אור",
            "startMs": 100, "endMs": 600}] if status == "ready" else []}
    return {**data, **extra}


class DatabaseLockTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.root = Path(self.folder.name)
        self.database = self.root / "recitation.sqlite"
        self.output = self.root / "staged"
        self.output.mkdir()

    def lock_held(self):
        lock = self.database.parent / (self.database.name + ".lock")
        with lock.open("a+b") as handle:
            try:
                fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                return True
            fcntl.flock(handle, fcntl.LOCK_UN)
        return False

    def replace_probe(self):
        held = []
        original = Path.replace

        def probe(path, target):
            held.append(self.lock_held())
            return original(path, target)

        return held, patch.object(Path, "replace", probe)

    def test_export_holds_lockfile_across_snapshot_and_replace(self):
        write_json(self.output / "1.json", manifest(1))
        held, probe = self.replace_probe()
        with probe:
            export_database(self.output, self.database)
        self.assertEqual(held, [True])
        self.assertFalse(self.lock_held())

    def test_concurrent_exporters_keep_every_committed_track(self):
        other = self.root / "other"
        other.mkdir()
        write_json(self.output / "1.json", manifest(1))
        write_json(other / "2.json", manifest(2, audioSha256="other-audio"))
        export_database(self.output, self.database)
        export_database(other, self.database)
        with sqlite3.connect(self.database) as db:
            tracks = {row[0] for row in db.execute("SELECT perek_id FROM recitation_track")}
        self.assertEqual(tracks, {1, 2})

    def test_overlay_holds_lockfile_and_withdraws_approval(self):
        write_json(self.output / "1.json", manifest(1,
            reviewMethod="trusted-process-with-human-verse-review"))
        export_database(self.output, self.database)
        (self.output / "1.json").unlink()
        write_json(self.output / "1.json", manifest(1, status="needs_review",
            reviewMethod="human-verse-review-withdrawn"))
        held, probe = self.replace_probe()
        with probe:
            overlay_reviews(self.output, self.database, [1])
        self.assertEqual(held, [True])
        self.assertFalse(self.lock_held())
        with sqlite3.connect(self.database) as db:
            status, provenance = db.execute(
                "SELECT alignment_status, provenance_json FROM recitation_track WHERE perek_id=1").fetchone()
        self.assertEqual(status, "needs_review")
        self.assertEqual(json.loads(provenance)["reviewMethod"], "human-verse-review-withdrawn")


if __name__ == "__main__":
    unittest.main()
