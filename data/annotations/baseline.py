"""Deterministic lexical baseline for the annotation pipeline (issue #2516).

Stage A+B for scripture: map the pinned morphhb proper-noun/gentilic token
stream onto canonical pasuk segments, assemble multi-token names (lemma `+`
chains), assign a coarse intended entity type by construct-context rules,
and emit mention-decoration rows matching `tanahpedia_mention_decoration`.

No entry lookups anywhere — the candidate universe is the tagged token
stream itself, per the issue's non-gating requirement.
"""

import hashlib
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
CANONICAL = (
    ROOT / "web/bible-on-site/src/data/db/sefaria-dump-5784-sivan-4.tanah_view.json"
)
LEXICON = Path(__file__).with_name("morphhb-proper-nouns.json.gz")
MODEL_REVISION = "morphhb-lexical-baseline@3d15126f+contract1"

DIACRITICS = re.compile("[\u0591-\u05bd\u05bf-\u05c7]")

# morphhb book file -> (canonical sefer index, additionals index).
# The canonical dump folds the split books into one sefer each:
# שמואל→additionals(1Sam,2Sam), מלכים→(1Kgs,2Kgs), עזרא→(Ezra,Neh),
# דברי הימים→(1Chr,2Chr).
BOOK_TO_CANONICAL = {
    "Gen": (0, None), "Exod": (1, None), "Lev": (2, None), "Num": (3, None),
    "Deut": (4, None), "Josh": (5, None), "Judg": (6, None),
    "1Sam": (7, 0), "2Sam": (7, 1), "1Kgs": (8, 0), "2Kgs": (8, 1),
    "Isa": (9, None), "Jer": (10, None), "Ezek": (11, None),
    "Hos": (12, None), "Joel": (13, None), "Amos": (14, None),
    "Obad": (15, None), "Jonah": (16, None), "Mic": (17, None),
    "Nah": (18, None), "Hab": (19, None), "Zeph": (20, None),
    "Hag": (21, None), "Zech": (22, None), "Mal": (23, None),
    "Ps": (24, None), "Prov": (25, None), "Job": (26, None),
    "Song": (27, None), "Ruth": (28, None), "Lam": (29, None),
    "Eccl": (30, None), "Esth": (31, None), "Dan": (32, None),
    "Ezra": (33, 0), "Neh": (33, 1), "1Chr": (34, 0), "2Chr": (34, 1),
}
SEFER_BOOKS = {}
for _stem, (_sefer, _add) in BOOK_TO_CANONICAL.items():
    SEFER_BOOKS.setdefault(_sefer, []).append(_stem)

# Head nouns whose following proper name is a place/person by convention.
PLACE_HEADS = {
    "הר",
    "עיר",
    "נהר",
    "ים",
    "ארץ",
    "מדבר",
    "עמק",
    "באר",
    "גיא",
    "מעין",
    "קבר",
    "שער",
}
PERSON_HEADS = {"בן", "בת", "אבי", "אחי", "בעל"}


def strip_diacritics(text):
    return DIACRITICS.sub("", text).replace("־", " ").replace("\u05be", " ")


def normalize_name(text):
    """Surface -> normalized intended name: no vowels/taamim, maqaf as space."""
    return " ".join(strip_diacritics(text).split())


def text_segments(pasuk):
    """Canonical text-bearing segment indices (qri + ktiv)."""
    return [i for i, s in enumerate(pasuk["segments"]) if s["type"] in ("qri", "ktiv")]


# Inseparable-prefix letters, stripped for intended-name normalization.
PREFIX_LETTERS = {"ו", "ב", "כ", "ל", "מ", "ה", "ש", "וה", "כה", "לה", "מה", "בה"}


def strip_prefix_parts(surface):
    """Return the noun part of a slash-joined morphhb surface."""
    parts = surface.split("/")
    while len(parts) > 1 and strip_diacritics(parts[0]) in PREFIX_LETTERS:
        parts.pop(0)
    return "/".join(parts)


def base_lemma(lemma):
    return lemma.split("/")[-1].rstrip("+")


def assemble(tokens):
    """Group tokens into mentions: lemma `+` chains merge with following tokens."""
    mentions, i = [], 0
    while i < len(tokens):
        token = tokens[i]
        group = [token]
        while (
            token[1].endswith("+")
            and i + 1 < len(tokens)
            and tokens[i + 1][0] == token[0] + 1
        ):
            i += 1
            token = tokens[i]
            group.append(token)
        mentions.append(group)
        i += 1
    return mentions


def classify(group, pasuk_texts, word_to_seg):
    """Coarse deterministic entity type from the morph + construct context."""
    head = group[0]
    if head[3] == "g":
        return "NATION"
    lemma = base_lemma(head[1])
    if lemma == "3068":  # the Tetragrammaton
        return "PERSON"
    # Construct-context rule: a plain noun head before this mention.
    first_seg = word_to_seg.get(head[0])
    if first_seg is not None and first_seg > 0:
        prev = normalize_name(pasuk_texts.get(first_seg - 1, ""))
        if prev in PLACE_HEADS:
            return "PLACE"
        if prev in PERSON_HEADS:
            return "PERSON"
    # Morph state hint: gentilic adjectives already handled; Np defaults to
    # PERSON (biblical proper nouns skew personal); place-only heads refine it.
    return "PERSON"


def decorations_for_perek(perek, chapter_tokens, lexicon):
    """Emit decoration rows for one canonical perek.

    `chapter_tokens` is the lexicon's verse map for the matching book chapter
    (1-based within that book file — additionals keep their own numbering).
    """
    rows = []
    for pasuk_number, pasuk in enumerate(perek["pesukim"], start=1):
        tokens = chapter_tokens.get(str(pasuk_number), [])
        if not tokens:
            continue
        seg_index = text_segments(pasuk)
        word_to_seg = {w: seg_index[w] for w in range(len(seg_index))}
        pasuk_texts = {i: s.get("value", "") for i, s in enumerate(pasuk["segments"])}
        source_hash = hashlib.sha256(
            json.dumps(pasuk["segments"], ensure_ascii=False).encode("utf-8")
        ).hexdigest()
        for group in assemble(tokens):
            segs = [word_to_seg[t[0]] for t in group if t[0] in word_to_seg]
            if not segs:
                continue
            surface = " ".join(strip_prefix_parts(t[2]) for t in group)
            rows.append(
                {
                    "source_kind": "pasuk",
                    "perek_id": perek["perekId"],
                    "pasuk_number": pasuk_number,
                    "segment_start": min(segs),
                    "segment_end": max(segs),
                    "surface": surface,
                    "intended_name": normalize_name(
                        " ".join(strip_prefix_parts(t[2]) for t in group)
                    ),
                    "entity_type": classify(group, pasuk_texts, word_to_seg),
                    "disambiguation": None,
                    "confidence": None,
                    "acceptance": "auto",
                    "model_revision": MODEL_REVISION,
                    "source_hash": source_hash,
                }
            )
    return rows


def load_lexicon(path=LEXICON):
    import gzip

    return json.loads(gzip.decompress(Path(path).read_bytes()).decode("utf-8"))


def load_canonical(path=CANONICAL):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def iter_perek_sources(sefer_index, sefarim):
    """Yield (perek_object, book_stem, chapter_number) for a canonical sefer.

    Plain sefarim map to their single book file; `additionals` split into
    one morphhb book each (שמואל א→1Sam, שמואל ב→2Sam, ...), with chapter
    numbering 1-based inside that book.
    """
    sefer = sefarim[sefer_index]
    stems = SEFER_BOOKS[sefer_index]
    if "perakim" in sefer:
        for i, perek in enumerate(sefer["perakim"]):
            yield perek, stems[0], i + 1
    else:
        for add_index, additional in enumerate(sefer["additionals"]):
            for i, perek in enumerate(additional["perakim"]):
                yield perek, stems[add_index], i + 1


def decorations_for_sefer(sefer_index, sefarim, lexicon):
    rows = []
    for perek, stem, chapter in iter_perek_sources(sefer_index, sefarim):
        chapter_tokens = lexicon["books"].get(stem, {}).get(str(chapter), {})
        rows.extend(decorations_for_perek(perek, chapter_tokens, lexicon))
    return rows


def main():
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("sefer", type=int, nargs="?", default=0, help="sefer index")
    parser.add_argument("perek", type=int, nargs="?", help="0-based perek index within the sefer (omit for whole sefer)")
    parser.add_argument("--out", type=Path, help="write decoration rows to a JSON file")
    args = parser.parse_args()

    sefarim = load_canonical()
    lexicon = load_lexicon()
    if args.perek is None:
        rows = decorations_for_sefer(args.sefer, sefarim, lexicon)
    else:
        sources = list(iter_perek_sources(args.sefer, sefarim))
        perek, stem, chapter = sources[args.perek]
        chapter_tokens = lexicon["books"].get(stem, {}).get(str(chapter), {})
        rows = decorations_for_perek(perek, chapter_tokens, lexicon)
    payload = json.dumps(rows, ensure_ascii=False, indent=1)
    if args.out:
        args.out.write_text(payload, encoding="utf-8")
        print(f"wrote {len(rows)} decorations to {args.out}")
    else:
        print(payload)


if __name__ == "__main__":
    main()
