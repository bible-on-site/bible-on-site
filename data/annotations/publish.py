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
        --articles /tmp/articles.json --article-out /tmp/mentions-article.json
    node devops/import-tanahpedia-mentions.mts \\
        --decorations /tmp/mentions-pasuk.json --dry-run
    node devops/import-tanahpedia-mentions.mts --decorations /tmp/mentions-pasuk.json
    node devops/import-tanahpedia-mentions.mts --decorations /tmp/mentions-article.json

A model upgrade publishes the new revision's file with
`--supersede-model <old revision>` on the import — the superseded
revision's pipeline-emitted rows are removed so one live revision
decorates each span; manual/rejected decisions survive.
"""

import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
import baseline
import baseline_articles
import encoders

RETYPE_DEFAULT = "dictabert-ner-retype"


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


def pasuk_rows(sefarim, lexicon, entities_fn=None, model_revision=None):
    """Full-corpus pasuk rows: lexical detection, optional encoder re-type."""
    rows = []
    for sefer_index in range(len(sefarim)):
        for perek, stem, chapter in baseline.iter_perek_sources(
            sefer_index, sefarim
        ):
            chapter_tokens = (
                lexicon["books"].get(stem, {}).get(str(chapter), {})
            )
            base = baseline.decorations_for_perek(
                perek, chapter_tokens, lexicon
            )
            rows.extend(
                base
                if entities_fn is None
                else encoders.retype_perek_rows(
                    perek, base, entities_fn, model_revision
                )
            )
    return rows


def article_rows(
    articles,
    gazetteer,
    held=frozenset(),
    word_counts=None,
    tagged_counts=None,
    entities_fn=None,
    model_revision=None,
):
    """Article-domain rows the same way; empty detections skip inference."""
    rows = []
    for article_id, content in articles:
        base = baseline_articles.decorations_for_article(
            article_id,
            content,
            gazetteer,
            held,
            word_counts=word_counts,
            tagged_counts=tagged_counts,
        )
        rows.extend(
            base
            if entities_fn is None
            else encoders.retype_article_rows(
                content, base, entities_fn, model_revision
            )
        )
    return rows


def _summary(label, rows):
    """Print the publish summary line for one domain's row set."""
    distinct = len({row["intended_name"] for row in rows})
    held = sum(1 for row in rows if row["acceptance"] == "held")
    revisions = sorted({row["model_revision"] for row in rows})
    print(
        f"{label}: {len(rows)} decorations, {distinct} distinct names, "
        f"{held} held — model_revision {revisions}"
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
        entities_fn = encoders.load_entities_fn(spec)
        revision = encoders.spec_revision_tag(spec)

    # Both domains derive from the same canonical + lexicon load.
    sefarim = baseline.load_canonical()
    lexicon = baseline.load_lexicon()

    if args.pasuk_out:
        rows = pasuk_rows(sefarim, lexicon, entities_fn, revision)
        _summary("pasuk", rows)
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
        )
        _summary("article", rows)
        args.article_out.write_text(
            json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8"
        )
        print(f"wrote {len(rows)} decorations to {args.article_out}")


if __name__ == "__main__":
    main()
