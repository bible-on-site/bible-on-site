"""Validate every published manifest against the canonical perakim JSON."""

import json
from collections import Counter

from alignment import load_chapters, text_hash, validate_timings, words_for
from recite import ROOT


def audit():
    chapters = load_chapters(ROOT / "web/bible-on-site/src/data/db/sefaria-dump-5784-sivan-4.tanah_view.json")
    counts = Counter()
    total = 0
    for path in (ROOT / "web/bible-on-site/public/recitation").glob("*.json"):
        data = json.loads(path.read_text(encoding="utf-8"))
        assert path.stem == str(data["perekId"]), f"{path}: wrong chapter ID"
        words = words_for(chapters[data["perekId"]])
        assert data["textSha256"] == text_hash(words), f"{path}: stale text hash"
        assert [(w.pasuk, w.segment, w.text) for w in words] == [
            (w["pasuk"], w["segment"], w["text"]) for w in data["words"]
        ], f"{path}: word mapping is not one-to-one"
        assert data["alignmentStatus"] in ("pending", "needs_review", "ready")
        if data["alignmentStatus"] == "ready":
            validate_timings(words, data["words"], data["durationMs"], require_complete=True)
        counts[data["alignmentStatus"]] += 1
        total += len(words)
    assert counts, "No recitation manifests found"
    print(f"{sum(counts.values())} recordings; {total} canonical word identities; {dict(counts)}")


if __name__ == "__main__":
    audit()
