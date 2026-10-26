"""Deterministic lexical baseline for the article domain (issue #2516).

Stage A+B for articles: reuse the pasuk-corpus decoration set as a
proper-name gazetteer (intended_name -> majority entity_type), then match
those names inside article HTML text nodes — longest match with fused
prefix stripping — and emit contract rows keyed by character offsets plus
the `content_hash` staleness key.

The gazetteer is entry-independent by construction: it derives from the
morphhb-tagged token stream, never from the live Tanahpedia entry table.

Input articles come from `devops/export-tanahpedia-articles.mts` as JSON
`[{"id": 1, "content": "<p>...</p>"}]`; output rows match the same
`tanahpedia_mention_decoration` contract `devops/import-tanahpedia-mentions.mts`
consumes, with `source_kind = "article"` and `span_start`/`span_end` as
character offsets into `tanah_article.content`.

Known baseline limits (documented per issue): typing inherits the pasuk
corpus's measured PERSON skew; prefix stripping can turn an ordinary word
into a name (e.g. ה+אל); spans inside HTML entities are not decoded.
"""

import collections
import hashlib
import json
from pathlib import Path
import re
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
import baseline

MODEL_REVISION = "morphhb-gazetteer@3d15126f+contract1"

# Elements whose text must never be decorated: an anchor interior would
# nest links, and script/style bodies are not visible prose.
SKIP_TAGS = {"a", "script", "style"}

# Tags, comments and CDATA sections; quoted attribute values may contain
# `>`, so the tag alternative tolerates them.
TAG_RE = re.compile(
    r"<!--.*?-->|<!\[CDATA\[.*?\]\]>|<(?:[^>\"']|\"[^\"]*\"|'[^']*')*>",
    re.DOTALL,
)
TAG_NAME_RE = re.compile(r"</?\s*([a-zA-Z][a-zA-Z0-9]*)")

# A word starts on a Hebrew letter and may continue through letters and
# niqqud/taamim marks (articles quote vocalized pesukim). Maqaf (U+05BE)
# and sof pasuq (U+05C3) stay out of the continuation set so they keep
# splitting words; geresh/gershayim and HTML entities are separators too.
WORD_MARKS = "֑-ֽֿ-ׂׄ-ׇ"  # ֑-ֽ + ֿ-ׂ + ׄ-ׇ (diacritics minus maqaf/sof pasuq)
WORD_RE = re.compile(rf"[א-ת][א-ת{WORD_MARKS}]*")

# Inseparable-prefix letters fused to nouns in rabbinic/modern Hebrew.
PREFIX_LETTERS = "ובכלמהש"
MAX_PREFIX_STRIP = 2

# A single letter is never a meaningful mention target.
MIN_NAME_LENGTH = 2


def build_gazetteer(decorations):
    """intended_name -> majority entity_type over the pasuk decoration set."""
    votes = {}
    for row in decorations:
        counts = votes.setdefault(row["intended_name"], {})
        counts[row["entity_type"]] = counts.get(row["entity_type"], 0) + 1
    gazetteer = {}
    for name, counts in votes.items():
        if len(name) < MIN_NAME_LENGTH:
            continue
        # Deterministic majority: highest count, then alphabetical.
        gazetteer[name] = max(counts.items(), key=lambda kv: (kv[1], kv[0]))[0]
    return gazetteer


def canonical_word_counts(sefarim):
    """Consonantal word-form counts over the whole canonical dump.

    Counts every bare normalized word (prefix letters stay fused), so a
    genuine name reads close to its tagged total while a homograph like
    מלך (Molech ~10x, "king" ~1000x) is dominated by ordinary usage.
    """
    counts = collections.Counter()
    for sefer in sefarim:
        perakim = sefer.get("perakim") or [
            perek for add in sefer["additionals"] for perek in add["perakim"]
        ]
        for perek in perakim:
            for pasuk in perek["pesukim"]:
                for segment in pasuk["segments"]:
                    for match in WORD_RE.finditer(segment.get("value", "")):
                        counts[baseline.strip_diacritics(match.group(0))] += 1
    return counts


def held_names(decorations, word_counts):
    """Single-word names dominated by ordinary-word usage in the corpus.

    These homographs (מלך, שם, אמר, בן, ...) are real Tanahpedia names but
    overwhelmingly read as ordinary words in commentary prose, so their
    matches emit `held` diagnostics — persisted for triage, never rendered
    — instead of `auto` decorations. Measured on the canonical corpus:
    pure names keep corpus <= tagged; homographs are dominated.
    """
    tagged = collections.Counter(row["intended_name"] for row in decorations)
    return {
        name
        for name, n in tagged.items()
        if " " not in name
        and len(name) >= MIN_NAME_LENGTH
        and word_counts.get(name, 0) > n
    }


def iter_text_runs(html):
    """Yield (start, end) offsets of text outside <a>/<script>/<style>."""
    depth = 0
    cursor = 0
    for match in TAG_RE.finditer(html):
        if depth == 0 and match.start() > cursor:
            yield cursor, match.start()
        name_match = TAG_NAME_RE.match(match.group(0))
        if name_match:
            name = name_match.group(1).lower()
            tag = match.group(0)
            if name in SKIP_TAGS:
                if tag.startswith("</"):
                    depth = max(0, depth - 1)
                elif not tag.rstrip().endswith("/>"):
                    depth += 1
        cursor = match.end()
    if depth == 0 and cursor < len(html):
        yield cursor, len(html)


def run_words(html, start, end):
    """Yield (start, end, normalized) per Hebrew word in a text run.

    Maqaf-joined parts are separate WORD_RE matches with their own raw
    offsets, so a phrase span always lands on exact source boundaries.
    """
    for match in WORD_RE.finditer(html[start:end]):
        yield (
            start + match.start(),
            start + match.end(),
            baseline.strip_diacritics(match.group(0)),
        )


def prefix_variants(word):
    """Candidate first-word forms: identity, then fused-prefix removals."""
    yield word
    stripped = word
    for _ in range(MAX_PREFIX_STRIP):
        if len(stripped) > MIN_NAME_LENGTH and stripped[0] in PREFIX_LETTERS:
            stripped = stripped[1:]
            yield stripped


def decorations_for_article(
    article_id,
    content,
    gazetteer,
    held=frozenset(),
    word_counts=None,
    tagged_counts=None,
):
    """Emit contract rows for one article's stored HTML content.

    `held` covers names dominated by ordinary-word usage at the name level.
    Prefix-stripped matches get a second, stricter check: stripping fused
    prefixes manufactures name candidates out of ordinary words (היה -> יה),
    so when `word_counts`/`tagged_counts` are supplied a stripped match is
    also held whenever its un-stripped surface word is dominated by
    ordinary usage in the canonical corpus.
    """
    max_words = max((name.count(" ") + 1 for name in gazetteer), default=1)
    content_hash = hashlib.sha256(content.encode("utf-8")).hexdigest()
    rows = []
    for run_start, run_end in iter_text_runs(content):
        words = list(run_words(content, run_start, run_end))
        i = 0
        while i < len(words):
            hit = None
            # Longest match wins; within a length the un-stripped form is
            # preferred over fused-prefix removals.
            for j in range(min(i + max_words, len(words)), i, -1):
                tail = " ".join(w[2] for w in words[i + 1 : j])
                for first in prefix_variants(words[i][2]):
                    phrase = first if not tail else f"{first} {tail}"
                    if phrase in gazetteer:
                        hit = (j, phrase, first)
                        break
                if hit:
                    break
            if not hit:
                i += 1
                continue
            end_index, phrase, first_form = hit
            stripped = first_form != words[i][2]
            dominated = (
                stripped
                and word_counts is not None
                and tagged_counts is not None
                and word_counts.get(words[i][2], 0) > tagged_counts.get(phrase, 0)
            )
            span_start, span_end = words[i][0], words[end_index - 1][1]
            rows.append(
                {
                    "source_kind": "article",
                    "article_id": article_id,
                    "content_hash": content_hash,
                    "span_start": span_start,
                    "span_end": span_end,
                    # Exact original span (fused prefixes included) — the
                    # render-side integrity check compares it verbatim.
                    "surface": content[span_start:span_end],
                    "intended_name": phrase,
                    "entity_type": gazetteer[phrase],
                    "disambiguation": None,
                    "confidence": None,
                    # Homographs stay triageable without rendering.
                    "acceptance": (
                        "held" if phrase in held or dominated else "auto"
                    ),
                    "model_revision": MODEL_REVISION,
                    "source_hash": content_hash,
                }
            )
            i = end_index
    return rows


def load_articles(path):
    articles = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(articles, list):
        raise ValueError("articles JSON must be a list of {id, content} objects")
    return [
        (int(a["id"]), str(a["content"]))
        for a in articles
        if a.get("content")
    ]


def build_gazetteer_from_corpus(sefarim=None, lexicon=None):
    """(gazetteer, held, word_counts, tagged_counts) over the pasuk corpus."""
    sefarim = sefarim if sefarim is not None else baseline.load_canonical()
    lexicon = lexicon if lexicon is not None else baseline.load_lexicon()
    rows = []
    for sefer_index in range(len(sefarim)):
        rows.extend(baseline.decorations_for_sefer(sefer_index, sefarim, lexicon))
    word_counts = canonical_word_counts(sefarim)
    tagged_counts = collections.Counter(
        row["intended_name"] for row in rows
    )
    return (
        build_gazetteer(rows),
        held_names(rows, word_counts),
        word_counts,
        tagged_counts,
    )


def main():
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--articles",
        type=Path,
        required=True,
        help="JSON list of {id, content} from export-tanahpedia-articles.mts",
    )
    parser.add_argument(
        "--out", type=Path, help="write decoration rows to a JSON file"
    )
    args = parser.parse_args()

    gazetteer, held, word_counts, tagged_counts = build_gazetteer_from_corpus()
    articles = load_articles(args.articles)
    rows = []
    for article_id, content in articles:
        rows.extend(
            decorations_for_article(
                article_id,
                content,
                gazetteer,
                held,
                word_counts=word_counts,
                tagged_counts=tagged_counts,
            )
        )
    print(
        f"{len(articles)} articles -> {len(rows)} decorations "
        f"({len({r['intended_name'] for r in rows})} distinct names, "
        f"gazetteer {len(gazetteer)} names, {len(held)} held homographs, "
        f"{sum(1 for r in rows if r['acceptance'] == 'held')} held rows)"
    )
    payload = json.dumps(rows, ensure_ascii=False, indent=1)
    if args.out:
        args.out.write_text(payload, encoding="utf-8")
        print(f"wrote {len(rows)} decorations to {args.out}")
    else:
        print(payload)


if __name__ == "__main__":
    main()
