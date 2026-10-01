"""Validate the durable intermediate DB and the merged canonical perakim data."""
from collections import Counter
from contextlib import closing
import json
import sqlite3

from alignment import load_chapters, text_hash, validate_timings, words_for
from publish import DATABASE, extract
from recite import ROOT


def audit():
    chapters = load_chapters(DATABASE)
    counts = Counter()
    total = 0
    intermediate = ROOT / "data/recitation/recitation.sqlite"
    with closing(sqlite3.connect(f"{intermediate.resolve().as_uri()}?mode=ro", uri=True)) as db:
        assert db.execute("PRAGMA user_version").fetchone()[0] == 3
        ids = set()
        for pid, url, audio_sha, text_sha, duration, status, provenance in db.execute("SELECT * FROM recitation_track"):
            ids.add(pid)
            data = extract(pid, chapters[pid])
            assert data is not None, f"{pid}: recitation metadata missing from perakim DB"
            words = words_for(chapters[pid])
            assert text_sha == text_hash(words), f"{pid}: stale canonical text hash"
            expected = {**json.loads(provenance), "version": 1, "audioUrl": url, "audioSha256": audio_sha,
                "textSha256": text_sha, "durationMs": duration, "alignmentStatus": status}
            assert chapters[pid]["recitation"] == expected, f"{pid}: metadata differs from intermediate DB"
            timings = list(db.execute("SELECT pasuk,segment,start_ms,end_ms FROM recitation_word WHERE perek_id=? ORDER BY pasuk,segment", (pid,)))
            if status == "ready":
                validate_timings(words, data["words"], duration, require_complete=True)
                assert timings == [(w["pasuk"],w["segment"],w["startMs"],w["endMs"]) for w in data["words"]]
            else:
                assert not timings
                assert all(w["startMs"] is None and w["endMs"] is None for w in data["words"])
            counts[status] += 1
            total += len(words)
        assert ids == {pid for pid, perek in chapters.items() if "recitation" in perek}
    assert counts, "No recitation records found"
    print(f"{sum(counts.values())} recordings; {total} canonical word identities; {dict(counts)}")


if __name__ == "__main__":
    audit()
