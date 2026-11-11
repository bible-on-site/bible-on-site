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

Optional engines use the same import-compatible output and per-source
checkpoints: ``--engine llm-retype`` classifies lexical candidates, while
``--engine llm-detect`` sends all eligible source words/segments to the local
model without a lexical gate. Select a pinned model with ``--llm-model``.
``--max-perakim`` / ``--max-articles`` bound a pilot, counting cached units
too. LLM engines remain opt-in until measured quality selects a winner;
this command writes files and never imports them into a database.

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
on first inference, so a fully cached run needs no weights. Its installed
inference runtime must still match the producing environment; removing or
upgrading a dependency invalidates the relevant cache. Only changed/new
sources or a deliberate model/config change recompute. Cached rows are the exact rows the unit would emit, so a
warm run's output file is byte-identical to a cold run's. Entry
creation never touches the cache — no entry lookup exists anywhere in
the publish stage.
"""

import collections
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
import baseline
import baseline_articles
import encoders
import local_llm
import llm_detect

RETYPE_DEFAULT = "dictabert-ner-retype"

CHECKPOINT_VERSION = 2
ENGINES = ("classifier", "llm-retype", "llm-detect")

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
    """Reject foreign/corrupt cached rows before they become import payloads."""
    if not isinstance(rows, list):
        return False
    for row in rows:
        if not isinstance(row, dict) or not _ROW_KEYS <= row.keys():
            return False
        if (not isinstance(row["entity_type"], str) or row["entity_type"] not in local_llm.ENTITY_TYPES
                or not isinstance(row["acceptance"], str)
                or row["acceptance"] not in {"auto", "manual", "held", "rejected"}
                or any(not isinstance(row[key], str) or not row[key]
                       for key in ("surface", "intended_name", "model_revision", "source_hash"))
                or not re.fullmatch(r"[0-9a-f]{64}", row["source_hash"])):
            return False
        if row["disambiguation"] is not None and not isinstance(row["disambiguation"], str):
            return False
        confidence = row["confidence"]
        if confidence is not None and (
            not isinstance(confidence, (int, float)) or isinstance(confidence, bool)
            or not 0 <= confidence <= 1 or not math.isfinite(confidence)
        ):
            return False
        if row["source_kind"] == "pasuk":
            keys = ("perek_id", "pasuk_number", "segment_start", "segment_end")
            if (any(not isinstance(row.get(key), int) or isinstance(row.get(key), bool)
                    for key in keys)
                    or row["perek_id"] < 1 or row["pasuk_number"] < 1
                    or not 0 <= row["segment_start"] <= row["segment_end"]):
                return False
        elif row["source_kind"] == "article":
            keys = ("article_id", "span_start", "span_end")
            if (any(not isinstance(row.get(key), int) or isinstance(row.get(key), bool)
                    for key in keys)
                    or row["article_id"] < 1 or not 0 <= row["span_start"] < row["span_end"]
                    or not isinstance(row.get("content_hash"), str)
                    or not re.fullmatch(r"[0-9a-f]{64}", row["content_hash"])):
                return False
        else:
            return False
    return True


def _valid_diagnostics(value):
    return isinstance(value, dict) and all(
        isinstance(key, str) and isinstance(count, int)
        and not isinstance(count, bool) and count >= 0
        for key, count in value.items()
    )


def _incomplete_responses(diagnostics):
    return any(diagnostics.get(key, 0) for key in
               ("invalid_batches", "invalid_response_chunks", "oversized_source_units"))


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
    artifact, never content truth. Incomplete model-response records also
    miss and retry on the next run; their diagnostics remain in failure_history.
    """

    def __init__(self, root, domain, config):
        """Bind a source domain and inference profile to an atomic unit cache."""
        self.dir = Path(root) / domain
        self.config = config
        self.hits = 0
        self.misses = 0
        self.last_diagnostics = collections.Counter()
        self._failure_histories = {}

    @property
    def failure_history(self):
        total = collections.Counter()
        for history in self._failure_histories.values():
            total.update(history)
        return total

    def load(self, unit, source_hash):
        """The unit's cached rows, or None when they must be recomputed."""
        self.last_diagnostics = collections.Counter()
        self._failure_histories[unit] = collections.Counter()
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
            or not _valid_diagnostics(record.get("diagnostics", {}))
            or not _valid_diagnostics(record.get("failure_history", {}))
        ):
            self.misses += 1
            return None
        diagnostics = record.get("diagnostics", {})
        # Old incomplete records had no history field. Preserve their failure
        # diagnostics while treating them as retryable, rather than cache hits.
        history = record.get("failure_history") or (
            diagnostics if _incomplete_responses(diagnostics) else {}
        )
        self._failure_histories[unit].update(history)
        if _incomplete_responses(diagnostics):
            self.misses += 1
            return None
        self.hits += 1
        self.last_diagnostics.update(diagnostics)
        return record["rows"]

    def save(self, unit, source_hash, rows, diagnostics=None):
        """Atomically record the unit's rows (tmp file + rename)."""
        self.dir.mkdir(parents=True, exist_ok=True)
        history = self._failure_histories.setdefault(unit, collections.Counter())
        if _incomplete_responses(diagnostics or {}):
            history.update(diagnostics)
        record = {
            "version": CHECKPOINT_VERSION,
            "config": self.config,
            "source": source_hash,
            "rows": rows,
            "diagnostics": dict(diagnostics or {}),
            "failure_history": dict(history),
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


def _validate_engine(engine, generate_fn, limit):
    if engine not in ENGINES:
        raise ValueError(f"unknown engine {engine!r}")
    if engine != "classifier" and not callable(generate_fn):
        raise ValueError("LLM engines require generate_fn")
    if limit is not None and (
        not isinstance(limit, int) or isinstance(limit, bool) or limit < 1
    ):
        raise ValueError("source-unit limit must be a positive integer")


def _diagnostic_snapshot(generate_fn):
    value = getattr(generate_fn, "diagnostics", None)
    return collections.Counter(value) if isinstance(value, collections.Counter) else collections.Counter()


def lazy_generate_fn(spec, execution, response_schema=None):
    """A fully checkpointed run never loads model weights or its tokenizer."""
    loaded = None

    def ensure_loaded():
        nonlocal loaded
        # The loader returns a plain function, which is always truthy.
        if not loaded:
            loaded = local_llm.load_generate_fn(
                spec, device=execution["device"], dtype=execution["dtype"]
            )
            if response_schema is not None:
                loaded = loaded.bind_schema(response_schema)
            generate.execution = loaded.execution
            generate.model_loaded = True
            generate.stats = loaded.stats
        return loaded

    def generate(messages):
        return ensure_loaded()(messages)

    generate.count_input_tokens = lambda messages: ensure_loaded().count_input_tokens(messages)
    generate.execution = execution
    if response_schema is not None:
        generate.execution = dict(execution, structured_output=local_llm.format_identity(response_schema))
    generate.model_loaded = False
    generate.stats = {}
    generate.diagnostics = collections.Counter()
    return generate


def pasuk_rows(
    sefarim, lexicon, entities_fn=None, model_revision=None, checkpoint=None,
    *, engine="classifier", generate_fn=None, max_perakim=None, diagnostics=None,
):
    """Full-corpus pasuk rows: lexical detection, optional encoder re-type.

    With a `CheckpointStore`, each perek is a bounded work unit: cached
    units skip both detection and inference, and only the perek's own
    source hash decides its staleness — an edit to one perek never
    invalidates its neighbors.
    """
    _validate_engine(engine, generate_fn, max_perakim)
    rows = []
    processed = 0
    diagnostics = diagnostics if diagnostics is not None else collections.Counter()
    for sefer_index in range(len(sefarim)):
        for perek, stem, chapter in baseline.iter_perek_sources(
            sefer_index, sefarim
        ):
            if max_perakim is not None and processed >= max_perakim:
                return rows
            processed += 1
            unit = f"perek-{perek['perekId']}"
            source_hash = _perek_source_hash(perek, stem, chapter)
            unit_rows = (
                checkpoint.load(unit, source_hash) if checkpoint else None
            )
            if unit_rows is None:
                unit_diagnostics = collections.Counter()
                if engine == "llm-detect":
                    unit_rows = []
                    for number, pasuk in enumerate(perek["pesukim"], start=1):
                        unit_rows.extend(llm_detect.decorations_for_pasuk(
                            pasuk, number, perek["perekId"], generate_fn,
                            model_revision, unit_diagnostics,
                        ))
                else:
                    chapter_tokens = lexicon["books"].get(stem, {}).get(str(chapter), {})
                    base = baseline.decorations_for_perek(perek, chapter_tokens, lexicon)
                    if engine == "llm-retype":
                        before = _diagnostic_snapshot(generate_fn)
                        unit_rows = local_llm.retype_perek_rows(perek, base, generate_fn, model_revision)
                        unit_diagnostics.update(_diagnostic_snapshot(generate_fn) - before)
                    else:
                        unit_rows = (base if entities_fn is None else
                                     encoders.retype_perek_rows(perek, base, entities_fn, model_revision))
                if checkpoint:
                    checkpoint.save(unit, source_hash, unit_rows, unit_diagnostics)
            else:
                unit_diagnostics = checkpoint.last_diagnostics
            diagnostics.update(unit_diagnostics)
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
    *, engine="classifier", generate_fn=None, max_articles=None, diagnostics=None,
):
    """Article-domain rows the same way; empty detections skip inference.

    The unit source hash is the article's `content_hash` — the contract's
    existing staleness key — so an edited article recomputes and an
    untouched one replays its cached rows verbatim.
    """
    _validate_engine(engine, generate_fn, max_articles)
    rows = []
    diagnostics = diagnostics if diagnostics is not None else collections.Counter()
    for index, (article_id, content) in enumerate(articles):
        if max_articles is not None and index >= max_articles:
            break
        source_hash = hashlib.sha256(content.encode("utf-8")).hexdigest()
        unit = f"article-{article_id}"
        unit_rows = (
            checkpoint.load(unit, source_hash) if checkpoint else None
        )
        if unit_rows is None:
            unit_diagnostics = collections.Counter()
            if engine == "llm-detect":
                unit_rows = llm_detect.decorations_for_article(
                    article_id, content, generate_fn, model_revision, unit_diagnostics
                )
            else:
                base = baseline_articles.decorations_for_article(
                    article_id, content, gazetteer, held,
                    word_counts=word_counts, tagged_counts=tagged_counts,
                )
                if engine == "llm-retype":
                    before = _diagnostic_snapshot(generate_fn)
                    unit_rows = local_llm.retype_article_rows(content, base, generate_fn, model_revision)
                    unit_diagnostics.update(_diagnostic_snapshot(generate_fn) - before)
                else:
                    unit_rows = (base if entities_fn is None else
                                 encoders.retype_article_rows(content, base, entities_fn, model_revision))
            if checkpoint:
                checkpoint.save(unit, source_hash, unit_rows, unit_diagnostics)
        else:
            unit_diagnostics = checkpoint.last_diagnostics
        diagnostics.update(unit_diagnostics)
        rows.extend(unit_rows)
    return rows


def _summary(label, rows, checkpoint=None, diagnostics=None):
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
    if diagnostics and any(diagnostics.get(key, 0) for key in
                           ("invalid_batches", "invalid_response_chunks", "oversized_source_units")):
        print(f"{label}: incomplete model responses — diagnostics {dict(diagnostics)}")


def write_provenance(path, *, spec, execution, entities_fn, checkpoint=None, runtime=None,
                     engine="classifier", diagnostics=None, limits=None, model_revision=None):
    """Keep rows import-compatible and put execution evidence beside them.

    Package metadata is available without importing torch or loading weights,
    including for a fully cached run. Actual GPU details come from the loaded
    callable; a cache-only run explicitly says no inference occurred.
    """
    versions = runtime if runtime is not None else encoders.runtime_signature(execution)
    backend = (entities_fn.generate_fn if isinstance(entities_fn, local_llm.CachedGenerator)
               else entities_fn)
    diagnostics = dict(diagnostics or {})
    record = {
        "schema": 1,
        "rows_sha256": _file_digest(path),
        "candidate": spec,
        "engine": engine,
        "model_revision": model_revision,
        "limits": limits,
        "execution": getattr(backend, "execution", execution),
        "model_loaded_this_run": getattr(backend, "model_loaded", False),
        "inference_runtime": versions,
        "inference_stats_this_run": (
            backend.stats if isinstance(getattr(backend, "stats", None), dict) else None
        ),
        "request_cache": (
            {"model_calls": entities_fn.calls, "hits": entities_fn.cache_hits}
            if isinstance(entities_fn, local_llm.CachedGenerator) else None
        ),
        "detection": ({"prompt_version": llm_detect.PROMPT_VERSION} if engine == "llm-detect" else {
            "pasuk": baseline.MODEL_REVISION,
            "article": baseline_articles.MODEL_REVISION,
        }),
        "diagnostics": diagnostics,
        "failure_history": dict(checkpoint.failure_history) if checkpoint else {},
        "complete_valid_responses": not _incomplete_responses(diagnostics),
        "checkpoint": (
            {"config": checkpoint.config, "hits": checkpoint.hits,
             "misses": checkpoint.misses} if checkpoint else None
        ),
    }
    sidecar = Path(f"{path}.provenance.json")
    sidecar.write_text(
        json.dumps(record, ensure_ascii=False, indent=1), encoding="utf-8"
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
    parser.add_argument("--engine", choices=ENGINES, default="classifier",
                        help="classification engine; LLM engines remain opt-in")
    parser.add_argument("--llm-model", choices=sorted(local_llm.MODEL_CANDIDATES),
                        default=local_llm.CANDIDATE["name"], help="pinned local LLM candidate")
    parser.add_argument("--llm-cache-dir", type=Path,
                        help="optional content-addressed response cache (defaults below checkpoint-dir)")
    parser.add_argument("--constrained-json", action="store_true",
                        help="enforce LLM JSON schemas during decoding (optional pinned LMFE dependency)")
    def positive_limit(value):
        try:
            number = int(value)
        except ValueError as exc:
            raise argparse.ArgumentTypeError("limit must be a positive integer") from exc
        if number < 1:
            raise argparse.ArgumentTypeError("limit must be a positive integer")
        return number
    parser.add_argument("--max-perakim", type=positive_limit,
                        help="process at most this many perakim, including checkpoint hits")
    parser.add_argument("--max-articles", type=positive_limit,
                        help="process at most this many articles, including checkpoint hits")
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
    encoders.add_execution_arguments(parser)
    args = parser.parse_args()

    if args.article_out and not args.articles:
        parser.error("--article-out needs --articles")
    if not args.pasuk_out and not args.article_out:
        parser.error(
            "nothing to publish: pass --pasuk-out and/or --article-out"
        )
    if args.engine != "classifier" and (args.no_retype or args.retype != RETYPE_DEFAULT):
        parser.error("--no-retype/--retype select classifier behavior; choose --llm-model for LLM engines")
    if args.constrained_json and args.engine == "classifier":
        parser.error("--constrained-json applies to local LLM engines")

    entities_fn = None
    revision = None
    spec = None
    execution = None
    runtime = None
    generate_fn = None
    if not args.no_retype:
        try:
            execution = encoders.normalize_execution(args.device, args.dtype)
        except (ValueError, RuntimeError) as exc:
            parser.error(str(exc))
        runtime = encoders.runtime_signature(execution)
        if args.engine == "classifier":
            spec = resolve_retype_spec(args.retype)
            entities_fn = encoders.lazy_entities_fn(
                spec, device=execution["device"], dtype=execution["dtype"]
            )
            revision = encoders.spec_revision_tag(spec)
        else:
            spec = local_llm.MODEL_CANDIDATES[args.llm_model]
            if spec.get("quantization") and (
                not execution["device"].startswith("cuda") or execution["dtype"] != "bfloat16"
            ):
                parser.error("NF4 models require --device cuda:N --dtype bfloat16")
            if args.engine == "llm-detect":
                spec = llm_detect.detection_spec(spec)
                revision = llm_detect.revision_tag(execution, spec, constrained_json=args.constrained_json)
                response_schema = llm_detect.DETECT_RESPONSE_SCHEMA
            else:
                revision = local_llm.revision_tag(spec, execution, constrained_json=args.constrained_json)
                response_schema = local_llm.RETYPE_RESPONSE_SCHEMA
            generate_fn = (lazy_generate_fn(spec, execution, response_schema=response_schema)
                           if args.constrained_json else lazy_generate_fn(spec, execution))
            response_cache = args.llm_cache_dir or (
                args.checkpoint_dir / "requests" if args.checkpoint_dir else None
            )
            if response_cache:
                generate_fn = local_llm.CachedGenerator(generate_fn, response_cache, revision)

    # Both domains derive from the same canonical + lexicon load.
    sefarim = baseline.load_canonical() if args.pasuk_out or args.engine != "llm-detect" else []
    lexicon = baseline.load_lexicon() if args.engine != "llm-detect" else None

    # Per-domain checkpoint stores share the root; config digests keep
    # them disjoint. Pasuk units key on their own perek bytes + the
    # lexicon; article units additionally cover the whole canonical dump
    # because their gazetteer is corpus-derived.
    stores = {}
    if args.checkpoint_dir:
        independent = args.engine == "llm-detect"
        lexicon_digest = None if independent else _file_digest(baseline.LEXICON)
        canonical_digest = None if independent else _file_digest(baseline.CANONICAL)
        stores["pasuk"] = CheckpointStore(
            args.checkpoint_dir,
            "pasuk",
            config_hash(
                revision=revision or baseline.MODEL_REVISION,
                lexicon=lexicon_digest,
                execution=execution,
                detector=llm_detect.PROMPT_VERSION if independent else baseline.MODEL_REVISION,
                runtime=runtime,
                engine=args.engine,
            ),
        )
        stores["article"] = CheckpointStore(
            args.checkpoint_dir,
            "article",
            config_hash(
                revision=revision or baseline_articles.MODEL_REVISION,
                lexicon=lexicon_digest,
                canonical=canonical_digest,
                execution=execution,
                detector=(llm_detect.PROMPT_VERSION if independent else
                          [baseline.MODEL_REVISION, baseline_articles.MODEL_REVISION]),
                runtime=runtime,
                engine=args.engine,
            ),
        )

    if args.pasuk_out:
        diagnostics = collections.Counter()
        rows = pasuk_rows(
            sefarim,
            lexicon,
            entities_fn,
            revision,
            checkpoint=stores.get("pasuk"),
            engine=args.engine, generate_fn=generate_fn,
            max_perakim=args.max_perakim, diagnostics=diagnostics,
        )
        _summary("pasuk", rows, checkpoint=stores.get("pasuk"), diagnostics=diagnostics)
        args.pasuk_out.parent.mkdir(parents=True, exist_ok=True)
        args.pasuk_out.write_text(
            json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8"
        )
        write_provenance(
            args.pasuk_out, spec=spec, execution=execution,
            entities_fn=generate_fn or entities_fn, checkpoint=stores.get("pasuk"),
            runtime=runtime,
            engine=args.engine, diagnostics=diagnostics, model_revision=revision or baseline.MODEL_REVISION,
            limits={"max_perakim": args.max_perakim},
        )
        print(f"wrote {len(rows)} decorations to {args.pasuk_out}")

    if args.article_out:
        if args.engine == "llm-detect":
            gazetteer, held, word_counts, tagged_counts = None, frozenset(), None, None
        else:
            gazetteer, held, word_counts, tagged_counts = (
                baseline_articles.build_gazetteer_from_corpus(sefarim, lexicon)
            )
        diagnostics = collections.Counter()
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
            engine=args.engine, generate_fn=generate_fn,
            max_articles=args.max_articles, diagnostics=diagnostics,
        )
        _summary("article", rows, checkpoint=stores.get("article"), diagnostics=diagnostics)
        args.article_out.parent.mkdir(parents=True, exist_ok=True)
        args.article_out.write_text(
            json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8"
        )
        write_provenance(
            args.article_out, spec=spec, execution=execution,
            entities_fn=generate_fn or entities_fn, checkpoint=stores.get("article"),
            runtime=runtime,
            engine=args.engine, diagnostics=diagnostics, model_revision=revision or baseline_articles.MODEL_REVISION,
            limits={"max_articles": args.max_articles},
        )
        print(f"wrote {len(rows)} decorations to {args.article_out}")


if __name__ == "__main__":
    main()
