"""Reject native Bible databases whose spoken identities differ from canonical JSON."""
import argparse
from pathlib import Path
import sqlite3

from alignment import load_chapters, words_for
from publish import DATABASE

NATIVE = Path(__file__).resolve().parents[2] / "app/BibleOnSite/Resources/Raw/sefaria-dump-5784-sivan-4.tanah_view.sqlite"


def audit_native(database=DATABASE, native=NATIVE):
    chapters = load_chapters(database)
    with sqlite3.connect(f"{native.resolve().as_uri()}?mode=ro", uri=True) as connection:
        for pid, chapter in chapters.items():
            rows = connection.execute(
                "SELECT s.pasuk_id,s.segment_type,v.value FROM tanah_pasuk_segment s "
                "LEFT JOIN tanah_pasuk_segment_value v ON v.id=s.id WHERE s.perek_id=? "
                "ORDER BY s.pasuk_id,s.id", (pid,))
            actual = []
            previous, ordinal = None, 0
            for pasuk, kind, value in rows:
                if pasuk != previous:
                    previous, ordinal = pasuk, 0
                ordinal += 1
                if kind == "qri" and value and any("\u05d0" <= c <= "\u05ea" for c in value):
                    actual.append((pasuk, ordinal, value))
            expected = [(w.pasuk, w.segment, w.text) for w in words_for(chapter)]
            if actual != expected:
                raise ValueError(f"{pid}: native canonical word identities differ from the alignment database")
    print(f"Native Bible text matches all {len(chapters)} canonical chapters")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", type=Path, default=DATABASE)
    parser.add_argument("--native", type=Path, default=NATIVE)
    args = parser.parse_args()
    audit_native(args.database, args.native)
