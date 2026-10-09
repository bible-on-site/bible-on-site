"""Validate the durable intermediate DB and the merged canonical perakim data."""
import argparse
from pathlib import Path
from collections import Counter
from contextlib import closing
import json
import sqlite3

from alignment import load_chapters, text_hash, validate_timings, words_for
from publish import DATABASE, extract
from recite import ROOT


def require(condition, message):
    """Audit checks must run even when Python is started with -O."""
    if not condition:
        raise ValueError(message)


def audit(intermediate=ROOT / "data/recitation/recitation.sqlite", database=DATABASE):
    chapters = load_chapters(database)
    counts = Counter()
    total = 0
    with closing(sqlite3.connect(f"{intermediate.resolve().as_uri()}?mode=ro", uri=True)) as db:
        require(db.execute("PRAGMA user_version").fetchone()[0] == 3, "Unsupported recitation database version")
        ids = set()
        for pid, url, audio_sha, text_sha, duration, status, provenance in db.execute("SELECT * FROM recitation_track"):
            ids.add(pid)
            data = extract(pid, chapters[pid])
            require(data is not None, f"{pid}: recitation metadata missing from perakim DB")
            words = words_for(chapters[pid])
            require(text_sha == text_hash(words), f"{pid}: stale canonical text hash")
            expected = {**json.loads(provenance), "version": 1, "audioUrl": url, "audioSha256": audio_sha,
                "textSha256": text_sha, "durationMs": duration, "alignmentStatus": status}
            require(chapters[pid]["recitation"] == expected, f"{pid}: metadata differs from intermediate DB")
            timings = list(db.execute("SELECT pasuk,segment,start_ms,end_ms FROM recitation_word WHERE perek_id=? ORDER BY pasuk,segment", (pid,)))
            if status == "ready":
                validate_timings(words, data["words"], duration, require_complete=True)
                expected_timings = [(w["pasuk"], w["segment"], w["startMs"], w["endMs"]) for w in data["words"]]
                require(timings == expected_timings, f"{pid}: word timings differ from intermediate DB")
            else:
                require(not timings, f"{pid}: unapproved timings in intermediate DB")
                require(all(w["startMs"] is None and w["endMs"] is None for w in data["words"]), f"{pid}: unapproved timings in perakim DB")
            counts[status] += 1
            total += len(words)
        require(ids == {pid for pid, perek in chapters.items() if "recitation" in perek}, "Recording inventories differ")
    require(counts, "No recitation records found")
    print(f"{sum(counts.values())} recordings; {total} canonical word identities; {dict(counts)}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=ROOT / "data/recitation/recitation.sqlite")
    parser.add_argument("--database", type=Path, default=DATABASE)
    args = parser.parse_args()
    audit(args.input, args.database)
