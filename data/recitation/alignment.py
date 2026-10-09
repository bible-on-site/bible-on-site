"""Deterministic Hebrew transcript reconciliation; no model dependencies."""

import hashlib
import json
import math
import re
import unicodedata
from dataclasses import dataclass
from functools import lru_cache


def normalize(text):
    return re.sub(r"[^\u05d0-\u05ea]", "", unicodedata.normalize("NFKD", text))


def spoken(text):
    letters = normalize(text)
    # The written divine name is read differently. Preserve the displayed text.
    if letters.endswith("יהוה"):
        letters = letters[:-4] + ("אלהים" if "\u05b4" in text else "אדני")
    return letters


@dataclass(frozen=True)
class Word:
    pasuk: int
    segment: int
    text: str

    @property
    def speech(self):
        return spoken(self.text)


def words_for(perek):
    words = [
        Word(pasuk, segment, value["value"])
        for pasuk, verse in enumerate(perek["pesukim"], 1)
        for segment, value in enumerate(verse["segments"], 1)
        if value["type"] == "qri" and normalize(value["value"])
    ]
    for word in words:
        if "<" in word.text or ">" in word.text:
            raise ValueError(f"Markup in canonical word at pasuk {word.pasuk}, segment {word.segment}; repair the source JSON before alignment")
    return words


def text_hash(words):
    text = "\n".join(f"{w.pasuk}:{w.segment}:{w.text}" for w in words)
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


@lru_cache(maxsize=65536)
def similarity(left, right):
    """Normalized character edit similarity, not semantic similarity."""
    if left == right:
        return 1.0
    if not left or not right:
        return 0.0
    previous = list(range(len(right) + 1))
    for i, a in enumerate(left, 1):
        row = [i]
        for j, b in enumerate(right, 1):
            row.append(min(row[-1] + 1, previous[j] + 1, previous[j - 1] + (a != b)))
        previous = row
    return 1 - previous[-1] / max(len(left), len(right))


def reconcile(canonical, recognized):
    """Global monotone alignment with insertions, deletions, and 1:2/2:1 joins."""
    # Return one (recognized indices, similarity) per canonical word. Repeated
    # words remain separate positions. A missing word is never silently shifted.
    n, m = len(canonical), len(recognized)
    costs = [[math.inf] * (m + 1) for _ in range(n + 1)]
    back = [[None] * (m + 1) for _ in range(n + 1)]
    costs[0][0] = 0.0
    for i in range(n + 1):
        for j in range(m + 1):
            options = []
            if i:
                options.append((costs[i - 1][j] + 1, 1, 0, 0.0))
            if j:
                options.append((costs[i][j - 1] + 1, 0, 1, 0.0))
            for a, b in ((1, 1), (1, 2), (2, 1)):
                if i >= a and j >= b:
                    score = similarity("".join(canonical[i - a:i]), "".join(recognized[j - b:j]))
                    penalty = 0.12 if a != b else 0.0
                    options.append((costs[i - a][j - b] + 2 * (1 - score) + penalty, a, b, score))
            if options:
                best = min(options, key=lambda option: option[0])
                costs[i][j], a, b, score = best
                back[i][j] = (a, b, score)
    result = [([], 0.0) for _ in canonical]
    i, j = n, m
    while i or j:
        a, b, score = back[i][j]
        if a and b:
            for k in range(i - a, i):
                result[k] = (list(range(j - b, j)), score)
        i, j = i - a, j - b
    return result


def load_chapters(path):
    books = json.loads(path.read_text(encoding="utf-8"))
    return {
        part["perekFrom"] + i: perek
        for book in books
        for part in book.get("additionals", [book])
        for i, perek in enumerate(part["perakim"])
    }


def validate_timings(words, timings, duration_ms, require_complete=False):
    """Reject corrupt, overlapping, stale, or incomplete verse timing groups."""
    expected = {(w.pasuk, w.segment): w.text for w in words}
    if require_complete and len(timings) != len(words):
        raise ValueError("A complete chapter requires exactly one timing for every spoken database word")
    counts = {}
    for word in words:
        counts[word.pasuk] = counts.get(word.pasuk, 0) + 1
    seen, actual = set(), {}
    previous_end = 0
    for item in timings:
        key = (item["pasuk"], item["segment"])
        start, end = item["startMs"], item["endMs"]
        if key in seen or expected.get(key) != item["text"]:
            raise ValueError(f"Unknown, duplicate, or stale segment: {key}")
        if not all(isinstance(t, int) and not isinstance(t, bool) for t in (start, end)) or not 0 <= start < end <= duration_ms:
            raise ValueError(f"Invalid time interval: {key}")
        if start < previous_end:
            raise ValueError(f"Overlapping/nonmonotone interval: {key}")
        if seen and key <= max(seen):
            raise ValueError("Text order must follow recording order")
        previous_end = end
        seen.add(key)
        actual[key[0]] = actual.get(key[0], 0) + 1
    if any(count != counts[pasuk] for pasuk, count in actual.items()):
        raise ValueError("Only complete aligned pesukim may be published")
