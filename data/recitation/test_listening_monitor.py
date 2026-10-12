"""Recovery monitoring processes answers without editing the live worker DB."""
from contextlib import closing
import json
from pathlib import Path
import sqlite3
import tempfile
import threading
import unittest
from unittest.mock import patch
from listening_monitor import RecoveryMonitor

class ListeningMonitorTests(unittest.TestCase):
    def test_notification_processes_answers_and_errors_preserve_preview(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            database = root / "preview.sqlite"
            with closing(sqlite3.connect(database)) as db:
                db.execute("CREATE TABLE recitation_track(alignment_status TEXT,provenance_json TEXT)")
                db.execute("INSERT INTO recitation_track VALUES(?,?)", ("ready", json.dumps({
                    "reviewMethod": "trusted-process-with-human-verse-review"})))
                db.commit()
            before = database.read_bytes()
            calls = []
            completed = threading.Event()
            def stage(*args):
                calls.append(args)
                if len(calls) > 1:
                    raise ValueError("stale source")
                return {"accepted": [7], "withdrawn": []}
            monitor = RecoveryMonitor(root / "queue.json", root / "reviews.json",
                root / "text.json", root / "results", database)
            original_update = monitor.update
            def update(**values):
                original_update(**values)
                if values.get("state") in ("complete", "error"):
                    completed.set()
            with patch("listening_monitor.stage_reviews", side_effect=stage), patch.object(
                    monitor, "update", side_effect=update):
                monitor.start()
                self.assertTrue(completed.wait(5))
                self.assertEqual(monitor.snapshot()["humanRecoveredChapters"], 1)
                completed.clear()
                monitor.notify()
                self.assertTrue(completed.wait(5))
                self.assertEqual(monitor.snapshot()["error"], "stale source")
                monitor.close()
            self.assertEqual(database.read_bytes(), before)
            self.assertEqual(len(calls), 2)

if __name__ == "__main__":
    unittest.main()