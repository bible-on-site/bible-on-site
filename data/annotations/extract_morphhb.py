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
import urllib.parse
import urllib.request

PINNED_REVISION = "3d15126fb1ef74867fc1434be1942e837932691f"
UPSTREAM_DIR = (
    f"https://raw.githubusercontent.com/openscriptures/morphhb/{PINNED_REVISION}/wlc"
)
OUTPUT = Path(__file__).with_name("morphhb-proper-nouns.json.gz")

# OSIS book files in canonical Tanakh order. The artifact keys by file stem
# (not sefer index) — the canonical dump folds 1Sam/2Sam, 1Kgs/2Kgs,
# Ezra/Neh and 1Chr/2Chr into single sefarim with `additionals`, so a sefer
# index would collide the two files' chapter keys.
BOOK_FILES = [
    "Gen", "Exod", "Lev", "Num", "Deut", "Josh", "Judg", "1Sam", "2Sam",
    "1Kgs", "2Kgs", "Isa", "Jer", "Ezek", "Hos", "Joel", "Amos", "Obad",
    "Jonah", "Mic", "Nah", "Hab", "Zeph", "Hag", "Zech", "Mal", "Ps",
    "Prov", "Job", "Song", "Ruth", "Lam", "Eccl", "Esth", "Dan", "Ezra",
    "Neh", "1Chr", "2Chr",
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


def extract(xml_text, book_stem, verses):
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
            verses.setdefault((book_stem, chapter, verse), []).append(
                [word_index, lemma, surface, "p" if kind == "proper" else "g"]
            )


def fetch_xml(filename):
    """Download one pinned upstream XML over https (scheme-enforced)."""
    url = f"{UPSTREAM_DIR}/{filename}"
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https":
        raise ValueError(f"refusing non-https upstream URL: {url}")
    with urllib.request.urlopen(url) as response:  # nosec B310: https-scheme validated, host+path are compile-time constants pinned to the upstream revision.  # nosemgrep
        return response.read().decode("utf-8")


def build(cache_dir=None):
    verses = {}
    for stem in BOOK_FILES:
        filename = f"{stem}.xml"
        if cache_dir is not None:
            xml_text = (cache_dir / filename).read_text(encoding="utf-8")
        else:
            xml_text = fetch_xml(filename)
        extract(xml_text, stem, verses)
    books = {}
    for (book_stem, chapter, verse), tokens in sorted(verses.items()):
        book = books.setdefault(book_stem, {})
        book.setdefault(str(chapter), {})[str(verse)] = tokens
    return {
        "provenance": {
            "source": "openscriptures/morphhb wlc/",
            "revision": PINNED_REVISION,
            "license": "CC BY 4.0 (lemma+morphology); WLC text public domain",
            "derivedBy": "extract_morphhb.py — tokens tagged Np/Ng/Ag",
        },
        "books": books,
    }


def digest(document):
    canonical = json.dumps(document["books"], ensure_ascii=False, sort_keys=True)
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
            f"morphhb artifact verified at {PINNED_REVISION[:10]} ({len(existing['books'])} books)"
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
        for book in document["books"].values()
        for chapter in book.values()
        for v in chapter.values()
    )
    print(f"wrote {OUTPUT.name}: {tokens} tagged tokens, sha {digest(document)[:12]}")


if __name__ == "__main__":
    sys.exit(main())
