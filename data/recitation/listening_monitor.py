"""Process saved human answers into a separate local recovery preview."""
from contextlib import closing
import json
import sqlite3
import subprocess  # nosec B404: catches audio probe errors; launches no process.
import threading

from listening_accept import stage_reviews
from listening_review import write_json

class RecoveryMonitor:
    def __init__(self, queue, reviews, text, output, database):
        """Bind only explicit source paths and a separate recovery preview database."""
        self.arguments = queue, reviews, text, output, database
        self.output, self.database = output, database
        self.changed, self.stopping = threading.Event(), threading.Event()
        self.lock = threading.Lock()
        self.state = {"state": "pending", "humanRecoveredChapters": 0, "publicationStatus": "local-preview"}
        self.thread = threading.Thread(target=self.run, daemon=True)

    def snapshot(self):
        with self.lock:
            return dict(self.state)

    def start(self):
        self.changed.set()
        self.thread.start()

    def notify(self):
        self.changed.set()

    def close(self):
        self.stopping.set()
        self.changed.set()
        self.thread.join(timeout=5)

    def update(self, **values):
        with self.lock:
            self.state.update(values)
            write_json(self.output / "recovery-state.json", self.state)

    def run(self):
        while not self.stopping.is_set():
            self.changed.wait()
            self.changed.clear()
            if self.stopping.is_set():
                return
            self.update(state="validating")
            try:
                summary = stage_reviews(*self.arguments)
                with closing(sqlite3.connect(f"{self.database.resolve().as_uri()}?mode=ro", uri=True)) as db:
                    count = sum(json.loads(row[0]).get("reviewMethod") == "trusted-process-with-human-verse-review"
                        for row in db.execute("SELECT provenance_json FROM recitation_track WHERE alignment_status='ready'"))
                self.update(state="complete", humanRecoveredChapters=count,
                            accepted=summary["accepted"], withdrawn=summary["withdrawn"], error=None)
            except (ValueError, KeyError, TypeError, OSError, sqlite3.Error, subprocess.SubprocessError) as error:
                self.update(state="error", error=str(error))