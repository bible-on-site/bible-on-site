"""Extract the morphhb proper-noun/gentilic token stream for the lexical baseline.

Reads the Open Scriptures Hebrew Bible (morphhb) wlc/ XMLs at the pinned
upstream commit and emits a compact derived artifact:
per verse, every token tagged a proper noun (Np), gentilic noun (Ng) or
gentilic adjective (Ag) — the deterministic candidate universe for the
annotation pipeline's lexical baseline (issue #2516).

Upstream: https://github.com/openscriptures/morphhb (lemma/morphology
CC BY 4.0; WLC text public domain). `--check` regenerates and compares;
`--refresh` rewrites the vendored artifact.
"""

import argparse
import gzip
import hashlib
import json
from pathlib import Path
import re
import sys
import urllib.request

PINNED_REVISION = "3d15126fb1ef74867fc1434be1942e837932691f"
UPSTREAM_DIR = (
    f"https://raw.githubusercontent.com/openscriptures/morphhb/{PINNED_REVISION}/wlc"
)
OUTPUT = Path(__file__).with_name("morphhb-proper-nouns.json.gz")

# OSIS book file -> canonical Tanakh book order (index into the tanah-view
# sefarim array). Order matches the printed Tanakh; additionals merge
# (1Sam+2Sam, 1Kgs+2Kgs, 1Chr+2Chr share one sefer each).
BOOK_FILES = [
    ("Gen.xml", 0),
    ("Exod.xml", 1),
    ("Lev.xml", 2),
    ("Num.xml", 3),
    ("Deut.xml", 4),
    ("Josh.xml", 5),
    ("Judg.xml", 6),
    ("1Sam.xml", 7),
    ("2Sam.xml", 7),
    ("1Kgs.xml", 8),
    ("2Kgs.xml", 8),
    ("Isa.xml", 9),
    ("Jer.xml", 10),
    ("Ezek.xml", 11),
    ("Hos.xml", 12),
    ("Joel.xml", 13),
    ("Amos.xml", 14),
    ("Obad.xml", 15),
    ("Jonah.xml", 16),
    ("Mic.xml", 17),
    ("Nah.xml", 18),
    ("Hab.xml", 19),
    ("Zeph.xml", 20),
    ("Hag.xml", 21),
    ("Zech.xml", 22),
    ("Mal.xml", 23),
    ("Ps.xml", 24),
    ("Prov.xml", 25),
    ("Job.xml", 26),
    ("Song.xml", 27),
    ("Ruth.xml", 28),
    ("Lam.xml", 29),
    ("Eccl.xml", 30),
    ("Esth.xml", 31),
    ("Dan.xml", 32),
    ("Ezra.xml", 33),
    ("Neh.xml", 34),
    ("1Chr.xml", 35),
    ("2Chr.xml", 35),
]

WORD_RE = re.compile(r"<w\b[^>]*>([^<]*)</w>")
ATTR_RE = re.compile(r'(lemma|morph)="([^"]*)"')
VERSE_RE = re.compile(r'<verse osisID="([^.]+)\.(\d+)\.(\d+)"')


def token_kind(morph):
    """Return the decoration-worthy noun class for a morph string, or None.

    Morph parts carry a leading language code (H/A) only on the first part;
    after stripping it, Np = proper noun, Ng/Ag = gentilic noun/adjective.
    """
    kind = None
    for part in morph.split("/"):
        if part[:1] in ("H", "A") and len(part) > 1 and part[1] in "ACDNPRSTV":
            part = part[1:]
        if part.startswith(("N", "A")) and len(part) > 1:
            if part[1] == "p":
                return "proper"
            if part[1] == "g":
                kind = "gentilic"
    return kind


def extract(xml_text, sefer_index, verses):
    book = None
    for match in VERSE_RE.finditer(xml_text):
        book = match.group(1)
        break
    if book is None:
        return
    for verse_match in VERSE_RE.finditer(xml_text):
        chapter, verse = int(verse_match.group(2)), int(verse_match.group(3))
        end = xml_text.find("</verse>", verse_match.end())
        body = xml_text[verse_match.end() : end if end != -1 else len(xml_text)]
        for word_index, word in enumerate(WORD_RE.finditer(body)):
            attrs = dict(ATTR_RE.findall(word.group(0)))
            lemma, morph, surface = (
                attrs.get("lemma", ""),
                attrs.get("morph", ""),
                word.group(1),
            )
            kind = token_kind(morph)
            if kind is None:
                continue
            # Compact record: word index, lemma (keeps the `+` name-chain
            # marker), surface (slash-split prefix/noun/suffix parts), kind.
            verses.setdefault((sefer_index, chapter, verse), []).append(
                [word_index, lemma, surface, "p" if kind == "proper" else "g"]
            )


def build(cache_dir=None):
    verses = {}
    for filename, sefer_index in BOOK_FILES:
        if cache_dir is not None:
            xml_text = (cache_dir / filename).read_text(encoding="utf-8")
        else:
            with urllib.request.urlopen(f"{UPSTREAM_DIR}/{filename}") as response:
                xml_text = response.read().decode("utf-8")
        extract(xml_text, sefer_index, verses)
    books = {}
    for (sefer_index, chapter, verse), tokens in sorted(verses.items()):
        book = books.setdefault(str(sefer_index), {})
        book.setdefault(str(chapter), {})[str(verse)] = tokens
    return {
        "provenance": {
            "source": "openscriptures/morphhb wlc/",
            "revision": PINNED_REVISION,
            "license": "CC BY 4.0 (lemma+morphology); WLC text public domain",
            "derivedBy": "extract_morphhb.py — tokens tagged Np/Ng/Ag",
        },
        "sefarim": books,
    }


def digest(document):
    canonical = json.dumps(document["sefarim"], ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="Verify the vendored artifact still derives from the pinned upstream",
    )
    parser.add_argument(
        "--cache",
        type=Path,
        help="Read XMLs from a local directory instead of fetching",
    )
    parser.add_argument(
        "--refresh", action="store_true", help="Rewrite the vendored artifact"
    )
    args = parser.parse_args()

    if args.check:
        existing = json.loads(gzip.decompress(OUTPUT.read_bytes()).decode("utf-8"))
        fresh = build(args.cache)
        if digest(existing) != digest(fresh):
            raise SystemExit(
                "morphhb-derived artifact drifted from the pinned upstream; run --refresh"
            )
        print(
            f"morphhb artifact verified at {PINNED_REVISION[:10]} ({len(existing['sefarim'])} sefarim)"
        )
        return
    if not args.refresh:
        parser.error("pass --check or --refresh")
    document = build(args.cache)
    # mtime=0 keeps the vendored bytes reproducible for drift checks.
    OUTPUT.write_bytes(
        gzip.compress(
            json.dumps(document, ensure_ascii=False, separators=(",", ":")).encode(
                "utf-8"
            ),
            mtime=0,
        )
    )
    tokens = sum(
        len(v)
        for book in document["sefarim"].values()
        for chapter in book.values()
        for v in chapter.values()
    )
    print(f"wrote {OUTPUT.name}: {tokens} tagged tokens, sha {digest(document)[:12]}")


if __name__ == "__main__":
    sys.exit(main())
