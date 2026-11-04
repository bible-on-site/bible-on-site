"""Publish stage for the mention-annotation pipeline (issue #2516).

Produces the `tanahpedia_mention_decoration` rows files that
`devops/import-tanahpedia-mentions.mts` upserts. The shipped pipeline is
the measured hybrid (see GOLDEN.md): morphhb/lexical detection from
`baseline.py`/`baseline_articles.py` — spans, names, and acceptance all
stay the lexical tier's — re-typed by the pinned DictaBERT encoder via
`encoders.py` retype mode (the encoder re-votes `entity_type` only and
abstains to the lexical type when it maps nothing).

The encoder is opt-in by construction: `entities_fn` is injected, so
tests exercise the full row logic with fakes and CI never downloads
weights (`requirements-encoders.txt`). `--no-retype` emits the bare
lexical rows for diagnosis — useful determinism checks, not the shipped
tier (its type skew is documented in GOLDEN.md).

Gated production run from the repository root (weights fetch once; encoder optional otherwise):

    # articles first, straight from the live export
    node devops/export-tanahpedia-articles.mts \\
        --out /tmp/articles.json --env-file <module>/.dev.env
    python data/annotations/publish.py --pasuk-out /tmp/mentions-pasuk.json \\
        --articles /tmp/articles.json --article-out /tmp/mentions-article.json \\
        --checkpoint-dir .cache/mentions-publish
    node devops/import-tanahpedia-mentions.mts \\
        --decorations /tmp/mentions-pasuk.json --dry-run
    node devops/import-tanahpedia-mentions.mts --decorations /tmp/mentions-pasuk.json
    node devops/import-tanahpedia-mentions.mts --decorations /tmp/mentions-article.json

A model upgrade publishes the new revision's file with
`--supersede-model <old revision>` on the import — the superseded
revision's pipeline-emitted rows are removed so one live revision
decorates each span; manual/rejected decisions survive.

Resumable runs (`--checkpoint-dir`): each perek/article is a bounded
work unit cached as one JSON file keyed by its source hash plus the
inference configuration (emitted model revision, lexicon digest, and —
for the article domain, whose gazetteer is corpus-derived — the
canonical digest). A resumed or repeated run reuses unchanged units
without re-running detection or model calls — the encoder loads lazily
on first inference, so a fully cached run needs neither weights nor
torch; only changed/new sources or a deliberate model/config change
recompute. Cached rows are the exact rows the unit would emit, so a
warm run's output file is byte-identical to a cold run's. Entry
creation never touches the cache — no entry lookup exists anywhere in
the publish stage.
"""

import hashlib
import json
import os
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
import baseline
import baseline_articles
import encoders

RETYPE_DEFAULT = "dictabert-ner-retype"

CHECKPOINT_VERSION = 1

# Contract keys every emitted row carries in both domains — the cheap
# shape gate keeping a hand-edited or foreign unit file from replaying
# garbage rows into the import payload.
_ROW_KEYS = {
    "source_kind",
    "surface",
    "intended_name",
    "entity_type",
    "disambiguation",
    "confidence",
    "acceptance",
    "model_revision",
    "source_hash",
}


def _valid_rows(rows):
    """Cached `rows` is a list of contract-shaped row dicts."""
    return isinstance(rows, list) and all(
        isinstance(row, dict) and _ROW_KEYS <= row.keys() for row in rows
    )


def _file_digest(path):
    """sha256 of a file's bytes — lexicon/canonical inputs to config_hash."""
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def config_hash(**inputs):
    """Digest of the inference-configuration inputs shared by all units.

    Keyword names become part of the hash, so a pasuk store (revision +
    lexicon) and an article store (revision + lexicon + canonical) never
    collide even when pointed at the same checkpoint root.
    """
    canonical = json.dumps(inputs, sort_keys=True)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


class CheckpointStore:
    """Per-unit resumable cache under `<root>/<domain>/<unit>.json`.

    A unit file records `{version, config, source, rows}`; a hit requires
    all three keys to match, so a source edit invalidates only its own
    unit while a model/config change invalidates every unit. Missing,
    stale or corrupt files are plain misses — the cache is a rebuildable
    artifact, never content truth.
    """

    def __init__(self, root, domain, config):
        self.dir = Path(root) / domain
        self.config = config
        self.hits = 0
        self.misses = 0

    def load(self, unit, source_hash):
        """The unit's cached rows, or None when they must be recomputed."""
        try:
            record = json.loads(
                (self.dir / f"{unit}.json").read_text(encoding="utf-8")
            )
        # OSError: missing/unreadable file; ValueError: invalid JSON or
        # non-UTF-8 bytes — either way the unit is a plain recompute.
        except (OSError, ValueError):
            record = None
        if (
            not isinstance(record, dict)
            or record.get("version") != CHECKPOINT_VERSION
            or record.get("config") != self.config
            or record.get("source") != source_hash
            or not _valid_rows(record.get("rows"))
        ):
            self.misses += 1
            return None
        self.hits += 1
        return record["rows"]

    def save(self, unit, source_hash, rows):
        """Atomically record the unit's rows (tmp file + rename)."""
        self.dir.mkdir(parents=True, exist_ok=True)
        record = {
            "version": CHECKPOINT_VERSION,
            "config": self.config,
            "source": source_hash,
            "rows": rows,
        }
        tmp = self.dir / f"{unit}.{os.getpid()}.tmp"
        tmp.write_text(
            json.dumps(record, ensure_ascii=False), encoding="utf-8"
        )
        os.replace(tmp, self.dir / f"{unit}.json")


def retype_candidates():
    """Shippable hybrid candidates: licensed, runnable retype specs.

    Detection stays the lexical tier's, and a publish run ships model
    output — a candidate whose license is undeclared (the AlephBERT
    community fine-tune) stays comparison-only, exactly as the encoder
    evaluation ruled it.
    """
    return [
        spec
        for spec in encoders.CANDIDATES
        if spec.get("runnable", True)
        and spec.get("mode") == "retype"
        and spec["license"] != "undeclared"
    ]


def resolve_retype_spec(name):
    """The named retype candidate, or a clear error listing valid names."""
    for spec in retype_candidates():
        if spec["name"] == name:
            return spec
    names = ", ".join(spec["name"] for spec in retype_candidates())
    raise SystemExit(
        f"cannot publish with {name!r} — the shipped path is lexical "
        f"detection + encoder re-type on a licensed candidate; "
        f"shippable retype candidates: {names}"
    )


def _perek_source_hash(perek, stem, chapter):
    """Hash of one perek's canonical content plus its positional chapter.

    `iter_perek_sources` assigns the lexicon's `stem`/`chapter` by the
    perek's position in its sefer, so an unchanged perek that moves must
    recompute — the chapter assignment is part of what produced its rows.
    """
    canonical = json.dumps(
        {"stem": stem, "chapter": chapter, "perek": perek},
        ensure_ascii=False,
        sort_keys=True,
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def pasuk_rows(
    sefarim, lexicon, entities_fn=None, model_revision=None, checkpoint=None
):
    """Full-corpus pasuk rows: lexical detection, optional encoder re-type.

    With a `CheckpointStore`, each perek is a bounded work unit: cached
    units skip both detection and inference, and only the perek's own
    source hash decides its staleness — an edit to one perek never
    invalidates its neighbors.
    """
    rows = []
    for sefer_index in range(len(sefarim)):
        for perek, stem, chapter in baseline.iter_perek_sources(
            sefer_index, sefarim
        ):
            unit = f"perek-{perek['perekId']}"
            source_hash = _perek_source_hash(perek, stem, chapter)
            unit_rows = (
                checkpoint.load(unit, source_hash) if checkpoint else None
            )
            if unit_rows is None:
                chapter_tokens = (
                    lexicon["books"].get(stem, {}).get(str(chapter), {})
                )
                base = baseline.decorations_for_perek(
                    perek, chapter_tokens, lexicon
                )
                unit_rows = (
                    base
                    if entities_fn is None
                    else encoders.retype_perek_rows(
                        perek, base, entities_fn, model_revision
                    )
                )
                if checkpoint:
                    checkpoint.save(unit, source_hash, unit_rows)
            rows.extend(unit_rows)
    return rows


def article_rows(
    articles,
    gazetteer,
    held=frozenset(),
    word_counts=None,
    tagged_counts=None,
    entities_fn=None,
    model_revision=None,
    checkpoint=None,
):
    """Article-domain rows the same way; empty detections skip inference.

    The unit source hash is the article's `content_hash` — the contract's
    existing staleness key — so an edited article recomputes and an
    untouched one replays its cached rows verbatim.
    """
    rows = []
    for article_id, content in articles:
        source_hash = hashlib.sha256(content.encode("utf-8")).hexdigest()
        unit = f"article-{article_id}"
        unit_rows = (
            checkpoint.load(unit, source_hash) if checkpoint else None
        )
        if unit_rows is None:
            base = baseline_articles.decorations_for_article(
                article_id,
                content,
                gazetteer,
                held,
                word_counts=word_counts,
                tagged_counts=tagged_counts,
            )
            unit_rows = (
                base
                if entities_fn is None
                else encoders.retype_article_rows(
                    content, base, entities_fn, model_revision
                )
            )
            if checkpoint:
                checkpoint.save(unit, source_hash, unit_rows)
        rows.extend(unit_rows)
    return rows


def _summary(label, rows, checkpoint=None):
    """Print the publish summary line for one domain's row set."""
    distinct = len({row["intended_name"] for row in rows})
    held = sum(1 for row in rows if row["acceptance"] == "held")
    revisions = sorted({row["model_revision"] for row in rows})
    stats = (
        f" — checkpoint: {checkpoint.hits} cached, "
        f"{checkpoint.misses} computed"
        if checkpoint
        else ""
    )
    print(
        f"{label}: {len(rows)} decorations, {distinct} distinct names, "
        f"{held} held — model_revision {revisions}{stats}"
    )


def main():
    """CLI entry: produce rows files per domain (see module docstring)."""
    import argparse

    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--pasuk-out",
        type=Path,
        help="write pasuk-domain rows for the whole canonical corpus",
    )
    parser.add_argument(
        "--articles",
        type=Path,
        help="articles JSON [{id, content}] from "
        "export-tanahpedia-articles.mts",
    )
    parser.add_argument(
        "--article-out", type=Path, help="write article-domain rows"
    )
    retype_group = parser.add_mutually_exclusive_group()
    retype_group.add_argument(
        "--retype",
        default=RETYPE_DEFAULT,
        metavar="CANDIDATE",
        help=f"encoder re-type candidate (default: {RETYPE_DEFAULT}); "
        "needs torch+transformers — see requirements-encoders.txt",
    )
    retype_group.add_argument(
        "--no-retype",
        action="store_true",
        help="skip the encoder: deterministic lexical rows only",
    )
    parser.add_argument(
        "--checkpoint-dir",
        type=Path,
        metavar="DIR",
        help="resume cache: one file per perek/article unit keyed by "
        "source + inference config; unchanged units skip detection and "
        "model calls, changed sources and model upgrades recompute",
    )
    args = parser.parse_args()

    if args.article_out and not args.articles:
        parser.error("--article-out needs --articles")
    if not args.pasuk_out and not args.article_out:
        parser.error(
            "nothing to publish: pass --pasuk-out and/or --article-out"
        )

    entities_fn = None
    revision = None
    if not args.no_retype:
        spec = resolve_retype_spec(args.retype)
        # Lazy: a fully cached run needs no weights — or torch — at all.
        entities_fn = encoders.lazy_entities_fn(spec)
        revision = encoders.spec_revision_tag(spec)

    # Both domains derive from the same canonical + lexicon load.
    sefarim = baseline.load_canonical()
    lexicon = baseline.load_lexicon()

    # Per-domain checkpoint stores share the root; config digests keep
    # them disjoint. Pasuk units key on their own perek bytes + the
    # lexicon; article units additionally cover the whole canonical dump
    # because their gazetteer is corpus-derived.
    stores = {}
    if args.checkpoint_dir:
        lexicon_digest = _file_digest(baseline.LEXICON)
        canonical_digest = _file_digest(baseline.CANONICAL)
        stores["pasuk"] = CheckpointStore(
            args.checkpoint_dir,
            "pasuk",
            config_hash(
                revision=revision or baseline.MODEL_REVISION,
                lexicon=lexicon_digest,
            ),
        )
        stores["article"] = CheckpointStore(
            args.checkpoint_dir,
            "article",
            config_hash(
                revision=revision or baseline_articles.MODEL_REVISION,
                lexicon=lexicon_digest,
                canonical=canonical_digest,
            ),
        )

    if args.pasuk_out:
        rows = pasuk_rows(
            sefarim,
            lexicon,
            entities_fn,
            revision,
            checkpoint=stores.get("pasuk"),
        )
        _summary("pasuk", rows, checkpoint=stores.get("pasuk"))
        args.pasuk_out.write_text(
            json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8"
        )
        print(f"wrote {len(rows)} decorations to {args.pasuk_out}")

    if args.article_out:
        gazetteer, held, word_counts, tagged_counts = (
            baseline_articles.build_gazetteer_from_corpus(sefarim, lexicon)
        )
        articles = baseline_articles.load_articles(args.articles)
        rows = article_rows(
            articles,
            gazetteer,
            held,
            word_counts,
            tagged_counts,
            entities_fn,
            revision,
            checkpoint=stores.get("article"),
        )
        _summary("article", rows, checkpoint=stores.get("article"))
        args.article_out.write_text(
            json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8"
        )
        print(f"wrote {len(rows)} decorations to {args.article_out}")


if __name__ == "__main__":
    main()
