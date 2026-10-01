"""Publish alignment results into the existing perakim database, without copied words."""

import argparse
from contextlib import closing
import sqlite3
import tempfile
import json
from pathlib import Path
import re

from alignment import text_hash, validate_timings, words_for

ROOT = Path(__file__).resolve().parents[2]
DATABASE = ROOT / "web/bible-on-site/src/data/db/sefaria-dump-5784-sivan-4.tanah_view.json"


def chapters_in(books):
    return {part["perekFrom"] + i: perek for book in books
            for part in book.get("additionals", [book])
            for i, perek in enumerate(part["perakim"])}


def timestamp(milliseconds):
    seconds, ms = divmod(milliseconds, 1000)
    minutes, seconds = divmod(seconds, 60)
    hours, minutes = divmod(minutes, 60)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d}.{ms:03d}"


def milliseconds(value):
    if not isinstance(value, str) or not re.fullmatch(r"\d{2}:[0-5]\d:[0-5]\d(?:\.\d{3})?", value):
        raise ValueError("Invalid recording timestamp")
    hours, minutes, seconds = value.split(":")
    whole, _, fraction = seconds.partition(".")
    return (int(hours) * 3600 + int(minutes) * 60 + int(whole)) * 1000 + int(fraction or 0)


def extract(perek_id, perek):
    """Build the API/review shape from the canonical words and their own timestamps."""
    if "recitation" not in perek:
        return None
    words = []
    for word in words_for(perek):
        frame = perek["pesukim"][word.pasuk - 1]["segments"][word.segment - 1]["recordingTimeFrame"]
        start, end = milliseconds(frame["from"]), milliseconds(frame["to"])
        words.append({"pasuk": word.pasuk, "segment": word.segment, "text": word.text,
                      "startMs": start if end > start else None,
                      "endMs": end if end > start else None})
    return {**perek["recitation"], "perekId": perek_id, "words": words}


def apply_alignment(perek, data):
    words = words_for(perek)
    if data["textSha256"] != text_hash(words):
        raise ValueError("Canonical words changed after alignment")
    expected = [(w.pasuk, w.segment, w.text) for w in words]
    if expected != [(w["pasuk"], w["segment"], w["text"]) for w in data["words"]]:
        raise ValueError("Alignment must preserve every canonical word in order")
    if data["alignmentStatus"] not in ("pending", "needs_review", "ready"):
        raise ValueError("Invalid alignment status")
    if data["alignmentStatus"] == "ready":
        validate_timings(words, data["words"], data["durationMs"], require_complete=True)
    # Keep only accepted timestamps in the source DB. Candidates stay in the work cache.
    # Validate before changing any field, so a failed publication is atomic.
    for row in data["words"]:
        segment = perek["pesukim"][row["pasuk"] - 1]["segments"][row["segment"] - 1]
        segment["recordingTimeFrame"] = (
            {"from": timestamp(row["startMs"]), "to": timestamp(row["endMs"])}
            if data["alignmentStatus"] == "ready" else {"from": "00:00:00", "to": "00:00:00"})
    perek["recitation"] = {key: value for key, value in data.items() if key not in ("perekId", "words")}


def publish(inputs, database=DATABASE):
    books = json.loads(database.read_text(encoding="utf-8"))
    chapters = chapters_in(books)
    count = 0
    with closing(sqlite3.connect(f"{inputs.resolve().as_uri()}?mode=ro", uri=True)) as db:
        if db.execute("PRAGMA user_version").fetchone()[0] != 3:
            raise ValueError("Unsupported recitation database version")
        records = []
        for perek_id, url, audio_sha, text_sha, duration, status, provenance in db.execute(
                "SELECT perek_id,audio_url,audio_sha256,text_sha256,duration_ms,alignment_status,provenance_json FROM recitation_track"):
            chapter = chapters[perek_id]
            timings = {(p, s): (a, b) for p, s, a, b in db.execute(
                "SELECT pasuk,segment,start_ms,end_ms FROM recitation_word WHERE perek_id=?", (perek_id,))}
            words = words_for(chapter)
            if status == "ready" and set(timings) != {(w.pasuk, w.segment) for w in words}:
                raise ValueError("Ready chapter must cover every canonical word exactly once")
            if status != "ready" and timings:
                raise ValueError("Unapproved candidate timings must stay in the processing cache")
            records.append({**json.loads(provenance), "version": 1, "perekId": perek_id,
                "audioUrl": url, "audioSha256": audio_sha, "textSha256": text_sha,
                "durationMs": duration, "alignmentStatus": status,
                "words": [{"pasuk": w.pasuk, "segment": w.segment, "text": w.text,
                    "startMs": timings.get((w.pasuk, w.segment), (None, None))[0],
                    "endMs": timings.get((w.pasuk, w.segment), (None, None))[1]} for w in words]})
    for data in records:
        chapter = chapters[data["perekId"]]
        apply_alignment(chapter, data)
        count += 1
    if not count:
        return 0
    with tempfile.NamedTemporaryFile(dir=database.parent, suffix=".tmp", delete=False) as handle:
        temporary = Path(handle.name)
    try:
        temporary.write_text(json.dumps(books, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        temporary.replace(database)
    finally:
        temporary.unlink(missing_ok=True)
    return count


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=Path(__file__).parent / "recitation.sqlite")
    parser.add_argument("--database", type=Path, default=DATABASE)
    args = parser.parse_args()
    print(f"Published {publish(args.input, args.database)} chapters into {args.database}")
