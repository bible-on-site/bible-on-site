"""The recitation database lockfile serializes copy-mutate-replace writers."""

import json
from pathlib import Path
import sqlite3
import tempfile
import threading
import unittest
from unittest.mock import patch

from alignment import text_hash, words_for
from checkpoint_handoff import recover_checkpoint
from db_lock import database_lock
from listening_accept import overlay_reviews
from recite import export_database, write_json

try:
    import fcntl
    msvcrt = None
except ImportError:  # Windows
    fcntl = None
    import msvcrt


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
            if fcntl is not None:
                try:
                    fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BlockingIOError:
                    return True
                fcntl.flock(handle, fcntl.LOCK_UN)
                return False
            try:
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            except OSError:
                return True
            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            return False

    def replace_probe(self):
        held = []
        original = Path.replace

        def probe(path, target):
            held.append(self.lock_held())
            return original(path, target)

        return held, patch.object(Path, "replace", probe)

    def seed_accepted_track(self):
        write_json(self.output / "1.json", manifest(1,
            reviewMethod="trusted-process-with-human-verse-review"))
        export_database(self.output, self.database)

    def test_overlay_holds_lockfile_and_withdraws_approval(self):
        self.seed_accepted_track()
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

    def test_checkpoint_recovery_holds_lockfile_while_replacing(self):
        write_json(self.output / "1.json", manifest(1))
        held, probe = self.replace_probe()
        with probe:
            result = recover_checkpoint(self.output, self.database, 1)
        self.assertEqual(result["checkpointIntegrity"], "ok")
        self.assertEqual(held, [True])

    def test_overlay_waits_for_a_concurrent_writer(self):
        self.seed_accepted_track()
        (self.output / "1.json").unlink()
        write_json(self.output / "1.json", manifest(1, status="needs_review",
            reviewMethod="human-verse-review-withdrawn"))
        entered = threading.Event()
        original = Path.replace

        def probe(path, target):
            entered.set()
            return original(path, target)

        worker = threading.Thread(target=overlay_reviews,
                                  args=(self.output, self.database, [1]))
        with patch.object(Path, "replace", probe):
            with database_lock(self.database):
                worker.start()
                self.assertFalse(entered.wait(1.5))
            worker.join(10)
        self.assertTrue(entered.is_set())


if __name__ == "__main__":
    unittest.main()
