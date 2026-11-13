"""Encoder (Hebrew NER) adapter + comparison runner (issue #2516).

Feeds a HuggingFace token-classification model's entity predictions into
the `golden_eval.py` row contract so the encoder tier is measured against
the same golden set and scorer as the lexical baseline.

Pipeline per source text (matching view only — stored data unchanged):

1. Build the normalized matching view: strip niqqud/taamim via
   `baseline.strip_diacritics` and drop geresh/gershayim-style quote
   marks so acronym names stay one token (רש"י -> רשי). The view keeps
   punctuation — the models were trained on natural text.
2. Run the pinned `token-classification` pipeline over word-bounded
   chunks, map each entity's char range back to covered words, and snap
   to whole word/segment boundaries (gold spans never cut a word).
3. Map NER labels onto the `tanahpedia_entity` taxonomy. Labels outside
   the taxonomy (TIMEX/DUC/TTL/MISC/INFORMAL, O) abstain — no row; a
   detected entity the model cannot type must not render a wrong-type
   link, and silence keeps detection_recall honest.
4. `intended_name`: normalized covered-word text, with fused-prefix
   stripping validated against the pasuk-corpus gazetteer (the same
   mechanism `baseline_articles` uses — the lexicon validates the name
   form only; detection and typing stay encoder decisions). Unknown
   names emit un-stripped: a missing gazetteer entry never gates a
   decoration (the issue's entry-independence rule).
5. `acceptance`: `held` when the resolved name is a corpus-dominated
   homograph (same suppression set as the lexical baseline), when a
   stripped match is dominated by its ordinary-word surface, or when
   the model's entity score is below `AUTO_CONFIDENCE`.

Run (needs torch + transformers — see requirements-encoders.txt):

    python encoders.py --list                          # candidates/licenses
    python encoders.py --model dictabert-ner --out golden/encoder-metrics
    python encoders.py --all --out golden/encoder-metrics

Model weights are NOT needed in CI: `python -m unittest` covers the
adapter through injected fake `entities_fn`s, and `--check` still gates
the deterministic lexical baseline only. The committed
`golden/encoder-metrics/*.json` files are the documented comparison
artifact, not a CI gate.
"""

import collections
import hashlib
import importlib.metadata
import json
from pathlib import Path
import re
import sys
import time
import tracemalloc

sys.path.insert(0, str(Path(__file__).resolve().parent))
import baseline
import baseline_articles
import golden_eval as ge

ENCODER_METRICS_DIR = ge.GOLDEN_DIR / "encoder-metrics"

# The candidates the issue names, pinned by content revision. `runnable`
# is False for models whose published artifact cannot classify tokens —
# they are recorded for the license/design finding, not measured.
CANDIDATES = [
    {
        "name": "dictabert-ner",
        "hf_repo": "dicta-il/dictabert-ner",
        "revision": "05ed61bc99437b13bc2bdef8154c52f8b44eaad6",
        "license": "CC-BY-4.0",
        "kind": "token-classification",
        "note": (
            "DictaBERT-base fine-tuned for Hebrew NER (the standard "
            "ANG/DUC/EVE/FAC/GPE/LOC/ORG/PER/TIMEX/TTL/WOA label set). "
            "Attribution required; usable."
        ),
    },
    {
        "name": "dictabert-large-ner",
        "hf_repo": "dicta-il/dictabert-large-ner",
        "revision": "ac70130828d5a6811c2dc451e2255424c96f0eb0",
        "license": "CC-BY-4.0",
        "kind": "token-classification",
        "note": "DictaBERT-large NER — same label set, heavier encoder.",
    },
    {
        "name": "alephbert-ner-community",
        "hf_repo": "jony6484/alephbert-base-finetuned-ner-v2",
        "revision": "a94683d536769016f24818f26b900eb763d358a7",
        "license": "undeclared",
        "kind": "token-classification",
        "note": (
            "Community AlephBERT NER fine-tune (no official AlephBERT "
            "token-classification head exists — onlplab/alephbert-base "
            "is Apache-2.0 but fill-mask only). The repo declares no "
            "license: measured for comparison only, CANNOT be shipped."
        ),
    },
    {
        "name": "berel",
        "hf_repo": "dicta-il/BEREL",
        "revision": "029fa610debddd0cd798f8babc33e41388fb2bac",
        "license": "Apache-2.0",
        "kind": "fill-mask",
        "runnable": False,
        "note": (
            "Masked LM for rabbinic Hebrew — no published "
            "token-classification head, so nothing here can score it. "
            "License is clean (Apache-2.0, better than the CC-BY the "
            "design doc expected); a BEREL leg needs a fine-tune on "
            "labeled Tanahpedia data — deferred per the issue phasing."
        ),
    },
    {
        "name": "dictabert-ner-retype",
        "hf_repo": "dicta-il/dictabert-ner",
        "revision": "05ed61bc99437b13bc2bdef8154c52f8b44eaad6",
        "license": "CC-BY-4.0",
        "kind": "token-classification",
        "mode": "retype",
        "note": (
            "The recommended hybrid: morphhb detection (every tagged "
            "proper noun is a candidate — the recall engine) with the "
            "encoder re-typing each candidate's entity_type. Keeps the "
            "baseline's spans, names and acceptance; abstains to the "
            "lexical type when the encoder maps nothing."
        ),
    },
    {
        "name": "dictabert-large-ner-retype",
        "hf_repo": "dicta-il/dictabert-large-ner",
        "revision": "ac70130828d5a6811c2dc451e2255424c96f0eb0",
        "license": "CC-BY-4.0",
        "kind": "token-classification",
        "mode": "retype",
        "note": "Same hybrid with the large encoder.",
    },
    {
        "name": "alephbert-ner-community-retype",
        "hf_repo": "jony6484/alephbert-base-finetuned-ner-v2",
        "revision": "a94683d536769016f24818f26b900eb763d358a7",
        "license": "undeclared",
        "kind": "token-classification",
        "mode": "retype",
        "note": (
            "Same hybrid with the community AlephBERT head — "
            "licenseless, so comparison-only."
        ),
    },
]

# Hebrew-NER label -> tanahpedia_entity.entity_type. Anything missing
# here abstains: O (not an entity), TIMEX/DUC (not Tanahpedia kinds),
# TTL/INFORMAL (not an entry target), MISC (detected entity the model
# left untyped — emitting it with a fabricated enum would render a
# wrong-type link).
LABEL_ENTITY_TYPE = {
    "PER": "PERSON",
    "ANG": "PERSON",
    "LOC": "PLACE",
    "GPE": "PLACE",
    "FAC": "PLACE",
    "ORG": "NATION",
    "EVE": "EVENT",
    "WOA": "SEFER",
}

# Below this entity score a decoration is held for triage instead of
# rendering. DictaBERT entity scores are strongly bimodal (>0.99 vs
# ~0.5 for genuinely uncertain names like יהוה in short pesukim).
AUTO_CONFIDENCE = 0.5

# Word-bounded inference chunks: long article runs stay under BERT's
# 512-wordpiece window (Hebrew words split into ~1-4 wordpieces).
MAX_CHUNK_WORDS = 120

# Geresh/gershayim and ASCII quote marks are dropped from the matching
# view so acronym names (רש"י, צה"ל) reach the encoder as one token.
QUOTE_CHARS = '"\'׳״'


def _strip_quotes(text):
    return "".join(c for c in text if c not in QUOTE_CHARS)


def normalized_run(text, start, end):
    """Build the matching view of `text[start:end]`.

    Returns (normalized_text, words) where each word is
    (src_start, src_end, norm_start, norm_end) — the source code-point
    bounds of every Hebrew word and where it landed in the normalized
    string, so an entity's normalized char range maps back to exact
    source words (which then snap to whole-word spans).
    """
    parts = []
    words = []
    norm_len = 0
    pos = start
    for match in baseline_articles.WORD_RE.finditer(text, start, end):
        gap = _strip_quotes(baseline.strip_diacritics(text[pos : match.start()]))
        parts.append(gap)
        norm_len += len(gap)
        wnorm = baseline.strip_diacritics(match.group(0))
        parts.append(wnorm)
        words.append((match.start(), match.end(), norm_len, norm_len + len(wnorm)))
        norm_len += len(wnorm)
        pos = match.end()
    parts.append(_strip_quotes(baseline.strip_diacritics(text[pos:end])))
    return "".join(parts), words


def pasuk_view(pasuk):
    """(normalized_text, words) for one pasuk at SEGMENT granularity.

    Each word entry is (segment_index, norm_start, norm_end): a segment
    is the snapping unit, so a maqaf pair inside one segment stays one
    word even though normalization renders it with a space.
    """
    parts = []
    words = []
    norm_len = 0
    for seg_index, seg in enumerate(pasuk["segments"]):
        if seg["type"] not in ("qri", "ktiv"):
            continue
        wnorm = _strip_quotes(
            baseline.strip_diacritics(seg.get("value", ""))
        ).strip()
        if not wnorm:
            continue
        if parts:
            parts.append(" ")
            norm_len += 1
        parts.append(wnorm)
        words.append((seg_index, norm_len, norm_len + len(wnorm)))
        norm_len += len(wnorm)
    return "".join(parts), words


def entity_label(entity):
    """Group label from a pipeline entity dict ('PER' etc.)."""
    raw = (
        entity.get("entity_group")
        or entity.get("entity")
        or entity.get("label")
        or ""
    )
    return raw.split("-")[-1].upper()


def classify_words(norm_text, words, entities_fn):
    """Run the encoder over word-bounded chunks of one view.

    Yields (first_word_index, last_word_index, label, score) per entity,
    with word indexes snapping each entity's normalized char range to
    covered words. `entities_fn(text) -> [entity dicts]` injects the
    model so tests need no torch/transformers.
    """
    i = 0
    while i < len(words):
        chunk = words[i : i + MAX_CHUNK_WORDS]
        base = chunk[0][-2]
        text = norm_text[base : chunk[-1][-1]]
        entities = entities_fn(text) if text.strip() else []
        for entity in entities:
            nstart = base + entity.get("start", 0)
            nend = base + entity.get("end", 0)
            covered = [
                k
                for k in range(i, i + len(chunk))
                if words[k][-2] < nend and nstart < words[k][-1]
            ]
            if covered:
                yield (
                    covered[0],
                    covered[-1],
                    entity_label(entity),
                    float(entity.get("score", 0.0)),
                )
        i += len(chunk)


def intended_name(norm_surface, names):
    """Gazetteer-validated intended name.

    Returns (name, stripped_first_word). Prefer the un-stripped form
    when it is itself a known name (כנען must never strip כ); otherwise
    the shallowest fused-prefix strip that lands in the gazetteer
    (ומצרים->מצרים, והכנעני->כנעני via הכנעני); otherwise the raw
    normalized surface — an unknown name still decorates
    (entry-independence). `stripped_first_word` is the raw first word
    only when a stripped variant won, feeding the dominance check.
    """
    norm = " ".join(norm_surface.split())
    if norm in names:
        return norm, None
    first, _, tail = norm.partition(" ")
    variants = list(baseline_articles.prefix_variants(first))
    for variant in variants[1:]:
        candidate = f"{variant} {tail}" if tail else variant
        if candidate in names:
            return candidate, first
    return norm, None


def _acceptance(score, name, first_word, held, word_counts, tagged_counts):
    """auto vs held for one resolved candidate."""
    if name in held:
        return "held"
    if (
        first_word is not None
        and word_counts is not None
        and tagged_counts is not None
        and word_counts.get(first_word, 0) > tagged_counts.get(name, 0)
    ):
        # The strip manufactured a name out of an ordinary word
        # (האל -> אל): same dominance rule baseline_articles applies.
        return "held"
    return "auto" if score >= AUTO_CONFIDENCE else "held"


def _contract_row(base, surface, name, entity_type, score, acceptance, rev):
    base.update(
        {
            "surface": surface,
            "intended_name": name,
            "entity_type": entity_type,
            "disambiguation": None,
            "confidence": round(score, 6),
            "acceptance": acceptance,
            "model_revision": rev,
        }
    )
    return base


def decorations_for_pasuk(
    pasuk,
    pasuk_number,
    perek_id,
    entities_fn,
    names,
    held=frozenset(),
    word_counts=None,
    tagged_counts=None,
    model_revision="encoder",
):
    """Emit contract rows for one pasuk via the encoder."""
    norm_text, words = pasuk_view(pasuk)
    source_hash = hashlib.sha256(
        json.dumps(pasuk["segments"], ensure_ascii=False).encode("utf-8")
    ).hexdigest()
    rows = []
    emitted = []
    for w_first, w_last, label, score in classify_words(
        norm_text, words, entities_fn
    ):
        entity_type = LABEL_ENTITY_TYPE.get(label)
        if entity_type is None:
            continue
        seg_start = words[w_first][0]
        seg_end = words[w_last][0]
        if any(s <= seg_end and seg_start <= e for s, e in emitted):
            continue  # contract: no duplicate/nested anchors on a span
        emitted.append((seg_start, seg_end))
        segs = pasuk["segments"][seg_start : seg_end + 1]
        surface = " ".join(s.get("value", "") for s in segs)
        norm_surface = " ".join(
            _strip_quotes(baseline.strip_diacritics(s.get("value", "")))
            for s in segs
        )
        name, first_word = intended_name(norm_surface, names)
        rows.append(
            _contract_row(
                {
                    "source_kind": "pasuk",
                    "perek_id": perek_id,
                    "pasuk_number": pasuk_number,
                    "segment_start": seg_start,
                    "segment_end": seg_end,
                    "source_hash": source_hash,
                },
                surface,
                name,
                entity_type,
                score,
                _acceptance(
                    score, name, first_word, held, word_counts, tagged_counts
                ),
                model_revision,
            )
        )
    return rows


def decorations_for_perek(perek, entities_fn, names, **kw):
    """Contract rows for a whole perek (evaluate_pasuk's predict shape)."""
    rows = []
    for pasuk_number, pasuk in enumerate(perek["pesukim"], start=1):
        rows.extend(
            decorations_for_pasuk(
                pasuk, pasuk_number, perek["perekId"], entities_fn, names, **kw
            )
        )
    return rows


def decorations_for_article(
    article_id,
    content,
    entities_fn,
    names,
    held=frozenset(),
    word_counts=None,
    tagged_counts=None,
    model_revision="encoder",
):
    """Emit contract rows for one article's stored HTML content."""
    content_hash = hashlib.sha256(content.encode("utf-8")).hexdigest()
    utf16_map = baseline_articles.utf16_index_map(content)
    rows = []
    emitted = []
    for run_start, run_end in baseline_articles.iter_text_runs(content):
        norm_text, words = normalized_run(content, run_start, run_end)
        for w_first, w_last, label, score in classify_words(
            norm_text, words, entities_fn
        ):
            entity_type = LABEL_ENTITY_TYPE.get(label)
            if entity_type is None:
                continue
            cp_start, cp_end = words[w_first][0], words[w_last][1]
            if any(s < cp_end and cp_start < e for s, e in emitted):
                continue  # no duplicate/nested decorations
            emitted.append((cp_start, cp_end))
            norm_surface = " ".join(
                baseline.strip_diacritics(
                    content[words[k][0] : words[k][1]]
                )
                for k in range(w_first, w_last + 1)
            )
            name, first_word = intended_name(norm_surface, names)
            rows.append(
                _contract_row(
                    {
                        "source_kind": "article",
                        "article_id": article_id,
                        "content_hash": content_hash,
                        "span_start": utf16_map[cp_start],
                        "span_end": utf16_map[cp_end],
                        "source_hash": content_hash,
                    },
                    content[cp_start:cp_end],
                    name,
                    entity_type,
                    score,
                    _acceptance(
                        score,
                        name,
                        first_word,
                        held,
                        word_counts,
                        tagged_counts,
                    ),
                    model_revision,
                )
            )
    return rows


def word_entity_types(norm_text, words, entities_fn):
    """word_index -> entity_type over a matching view.

    Majority/earliest entity label wins when entities overlap a word —
    classify_words already yields document order, so first write stands.
    """
    types = {}
    for w_first, w_last, label, _score in classify_words(
        norm_text, words, entities_fn
    ):
        entity_type = LABEL_ENTITY_TYPE.get(label)
        if entity_type is None:
            continue
        for k in range(w_first, w_last + 1):
            types.setdefault(k, entity_type)
    return types


def _row_entity_type(rows_words_types):
    """Mode entity type across a row's covered words (earliest on ties)."""
    counts = collections.Counter(rows_words_types)
    return counts.most_common(1)[0][0] if counts else None


def _stamp(row, model_revision):
    """Attach the producing model's revision tag to an emitted row."""
    return row if model_revision is None else dict(row, model_revision=model_revision)


def retype_pasuk_rows(pasuk, rows, entities_fn, model_revision=None):
    """Re-type baseline pasuk rows with the encoder's word labels.

    Detection, spans, names and acceptance stay the lexical tier's; a
    row whose words map to nothing keeps its lexical type (abstain, not
    discard — a missing entity_type vote never deletes a candidate).
    `model_revision` restamps every row when the hybrid — not the bare
    lexical tier — is the emitting pipeline.
    """
    if not rows:
        return []
    norm_text, words = pasuk_view(pasuk)
    types = word_entity_types(norm_text, words, entities_fn)
    seg_to_word = {w[0]: k for k, w in enumerate(words)}
    out = []
    for row in rows:
        covered = [
            types[k]
            for k in (
                seg_to_word.get(seg)
                for seg in range(row["segment_start"], row["segment_end"] + 1)
            )
            if k in types
        ]
        entity_type = _row_entity_type(covered)
        if entity_type is not None:
            row = dict(row, entity_type=entity_type)
        out.append(_stamp(row, model_revision))
    return out


def retype_perek_rows(perek, base_rows, entities_fn, model_revision=None):
    """Re-type one perek's baseline rows, grouped per pasuk.

    Shared by the golden eval and the publish stage: pesukim with no
    detected candidates skip inference entirely — a retype of zero rows
    is empty either way, and the model call is the expensive part.
    """
    by_pasuk = {}
    for row in base_rows:
        by_pasuk.setdefault(row["pasuk_number"], []).append(row)
    rows = []
    for pasuk_number, pasuk in enumerate(perek["pesukim"], start=1):
        chunk = by_pasuk.get(pasuk_number)
        if chunk:
            rows.extend(
                retype_pasuk_rows(
                    pasuk, chunk, entities_fn, model_revision
                )
            )
    return rows


def retype_article_rows(content, rows, entities_fn, model_revision=None):
    """Re-type baseline article rows the same way, per text run.

    Same contract as `retype_pasuk_rows`: spans/names/acceptance stay,
    unmapped words abstain to the lexical type, `model_revision` restamps
    every emitted row.
    """
    if not rows:
        return []
    types_by_run = []
    for run_start, run_end in baseline_articles.iter_text_runs(content):
        norm_text, words = normalized_run(content, run_start, run_end)
        types_by_run.append((words, word_entity_types(norm_text, words, entities_fn)))
    utf16_map = baseline_articles.utf16_index_map(content)
    out = []
    for row in rows:
        covered = []
        for words, types in types_by_run:
            covered.extend(
                types[k]
                for k, (ws, we, _ns, _ne) in enumerate(words)
                if k in types
                and utf16_map[ws] < row["span_end"]
                and row["span_start"] < utf16_map[we]
            )
        entity_type = _row_entity_type(covered)
        if entity_type is not None:
            row = dict(row, entity_type=entity_type)
        out.append(_stamp(row, model_revision))
    return out


def normalize_execution(device="cpu", dtype="float32", torch_module=None):
    """Resolve explicit inference settings before weights or corpus are loaded.

    CPU/fp32 is the compatibility default and needs no optional imports, so
    a cached publish run remains usable without torch. ``auto`` resolves to
    an actual device before checkpoint hashing; an explicit CUDA request
    never silently falls back to CPU. Reduced precision is always opt-in.
    """
    if dtype not in ("float32", "float16", "bfloat16"):
        raise ValueError("dtype must be float32, float16, or bfloat16")
    if not isinstance(device, str) or not re.fullmatch(
        r"cpu|auto|cuda(?::[0-9]+)?", device
    ):
        raise ValueError("device must be cpu, auto, cuda, or cuda:N")
    if device != "cpu":
        if torch_module is None:
            try:
                import torch as torch_module
            except ImportError as exc:
                raise RuntimeError(
                    "CUDA/auto selection needs a CUDA-enabled torch install; "
                    "see requirements-encoders.txt"
                ) from exc
        available = torch_module.cuda.is_available()
        if device == "auto":
            device = "cuda:0" if available else "cpu"
        elif not available:
            raise RuntimeError(
                "CUDA was requested but torch.cuda.is_available() is false; "
                "check the NVIDIA driver and CUDA-enabled torch wheel"
            )
        if device.startswith("cuda"):
            index = int(device.split(":", 1)[1]) if ":" in device else 0
            if index >= torch_module.cuda.device_count():
                raise RuntimeError(f"CUDA device {index} is not available")
            device = f"cuda:{index}"
            if dtype == "bfloat16":
                with torch_module.cuda.device(index):
                    if not torch_module.cuda.is_bf16_supported():
                        raise RuntimeError(
                            f"{device} does not support bfloat16 inference"
                        )
    if device == "cpu" and dtype != "float32":
        raise ValueError("CPU inference requires float32; choose CUDA for reduced precision")
    return {"device": device, "dtype": dtype, "tf32": False}


def add_execution_arguments(parser):
    """Shared CLI settings: CPU/fp32 preserves the measured baseline."""
    parser.add_argument(
        "--device", default="cpu", metavar="DEVICE",
        help="cpu (default), cuda, cuda:N, or auto; CUDA never falls back",
    )
    parser.add_argument(
        "--dtype", default="float32",
        choices=("float32", "float16", "bfloat16"),
        help="inference precision (default: float32, TF32 disabled)",
    )


def execution_provenance(execution, torch_module):
    """Record the actual backend separately from the model's content SHA."""
    result = dict(
        execution,
        torch=torch_module.__version__,
        cuda_runtime=torch_module.version.cuda,
    )
    if execution["device"].startswith("cuda"):
        index = int(execution["device"].split(":")[1])
        properties = torch_module.cuda.get_device_properties(index)
        result.update(
            gpu_name=properties.name,
            gpu_total_memory_bytes=properties.total_memory,
            gpu_compute_capability=list(torch_module.cuda.get_device_capability(index)),
        )
    return result


def validate_model_runtime(execution, torch_module):
    """Reject the measured native CPU crash before any weights are loaded."""
    if (execution["device"] == "cpu" and sys.platform == "win32"
            and torch_module.__version__ == "2.14.1+cu126"):
        raise RuntimeError(
            "torch 2.14.1+cu126 has a measured native CPU access violation on Windows; "
            "use the separate CPU-only torch 2.15.0+cpu environment described in "
            "data/annotations/README.md, or select --device cuda:0 in the CUDA environment"
        )


def runtime_signature(execution=None):
    """Backend identity for caches; CPU metadata does not import torch.

    Library upgrades and GPU architectures can change floating-point votes
    despite identical weights. Recompute instead of attributing old cached
    predictions to a different producing environment.
    """
    versions = {}
    for package in ("torch", "transformers", "tokenizers", "bitsandbytes"):
        try:
            versions[package] = importlib.metadata.version(package)
        except importlib.metadata.PackageNotFoundError:
            versions[package] = None
    if execution and execution["device"].startswith("cuda"):
        import torch
        index = int(execution["device"].split(":")[1])
        versions.update(
            cuda_runtime=torch.version.cuda,
            gpu_name=torch.cuda.get_device_properties(index).name,
            gpu_compute_capability=list(torch.cuda.get_device_capability(index)),
        )
    return versions


def load_entities_fn(spec, *, device="cpu", dtype="float32"):
    """Build the real inference callable for a runnable candidate spec.

    Imported lazily: CI never installs torch/transformers, and the unit
    tests inject fakes. Pins the model by repo + commit sha and applies
    the model card's WordPiece-decoder workaround so decoded `word`
    fields stay readable (spans come from char offsets either way).
    """
    execution = normalize_execution(device, dtype)
    try:
        import torch
        from transformers import pipeline
        from tokenizers.decoders import WordPiece
    except ImportError as exc:
        raise SystemExit(
            "encoder evaluation needs torch + transformers — see "
            "requirements-encoders.txt for the pinned install commands"
        ) from exc
    validate_model_runtime(execution, torch)
    if execution["device"].startswith("cuda"):
        # Keep FP32 quality comparable with the measured CPU baseline.
        torch.backends.cuda.matmul.allow_tf32 = False
        torch.backends.cudnn.allow_tf32 = False
        torch.set_float32_matmul_precision("highest")
    pipe = pipeline(
        spec["kind"],
        model=spec["hf_repo"],
        revision=spec["revision"],
        aggregation_strategy="simple",
        device=execution["device"],
        dtype=getattr(torch, execution["dtype"]),
    )
    if str(pipe.device) != execution["device"]:
        raise RuntimeError(
            f"requested {execution['device']} but model loaded on {pipe.device}"
        )
    pipe.model.eval()
    pipe.tokenizer.backend_tokenizer.decoder = WordPiece()

    def entities_fn(text):
        return pipe(text)

    entities_fn.execution = execution_provenance(execution, torch)
    return entities_fn


def lazy_entities_fn(spec, *, device="cpu", dtype="float32"):
    """Defer `load_entities_fn` until the first inference call.

    A publish run whose checkpoint covers every unit never touches the
    model: weights stay unfetched and torch/transformers unimported. The
    first call builds the real pipeline once and memoizes it.
    """
    loaded = None
    execution = normalize_execution(device, dtype)

    def entities_fn(text):
        nonlocal loaded
        # `not loaded`: the built pipeline callable is always truthy.
        if not loaded:
            loaded = load_entities_fn(
                spec, device=execution["device"], dtype=execution["dtype"]
            )
            entities_fn.execution = loaded.execution
            entities_fn.model_loaded = True
        return loaded(text)

    entities_fn.execution = execution
    entities_fn.model_loaded = False
    return entities_fn


def spec_revision_tag(spec):
    """Pin the detector as well as the encoder for hybrid emitted rows."""
    detector = ""
    if spec.get("mode") == "retype":
        digest = hashlib.sha256(json.dumps(
            [baseline.MODEL_REVISION, baseline_articles.MODEL_REVISION]
        ).encode("utf-8")).hexdigest()[:8]
        detector = f"+detect{digest}"
    return f"{spec['name']}@{spec['revision'][:8]}{detector}+contract1"


def evaluate_candidate(spec, gold_dir=ge.GOLDEN_DIR, *, device="cpu", dtype="float32"):
    """Run one runnable candidate through both golden domains.

    Returns the full report (runtime included — the issue's cost
    metrics) plus environment provenance; `spec` supplies the row
    contract's model_revision tag.
    """
    entities_fn = load_entities_fn(spec, device=device, dtype=dtype)
    import torch
    cuda_device = (
        entities_fn.execution["device"]
        if entities_fn.execution["device"].startswith("cuda") else None
    )
    if cuda_device:
        torch.cuda.synchronize(cuda_device)
        torch.cuda.reset_peak_memory_stats(cuda_device)
    sefarim = baseline.load_canonical()
    gazetteer, held, word_counts, tagged_counts = (
        baseline_articles.build_gazetteer_from_corpus(sefarim)
    )
    names = set(gazetteer)
    revision = spec_revision_tag(spec)
    retype = spec.get("mode") == "retype"
    lexicon = baseline.load_lexicon() if retype else None
    timing = {}
    report = {"schema": 1}

    tracemalloc.start()
    start = time.perf_counter()
    pasuk_cases = ge.load_golden(gold_dir / "pesukim.json")["cases"]

    def predict_pasuk(perek, stem, chapter):
        if retype:
            chapter_tokens = lexicon["books"].get(stem, {}).get(
                str(chapter), {}
            )
            return retype_perek_rows(
                perek,
                baseline.decorations_for_perek(
                    perek, chapter_tokens, lexicon
                ),
                entities_fn,
                model_revision=revision,
            )
        return decorations_for_perek(
            perek,
            entities_fn,
            names,
            held=held,
            word_counts=word_counts,
            tagged_counts=tagged_counts,
            model_revision=revision,
        )

    report["pasuk"] = ge.evaluate_pasuk(
        pasuk_cases, sefarim, predict=predict_pasuk, model_revision=revision
    )
    timing["pasuk_seconds"] = round(time.perf_counter() - start, 3)

    start = time.perf_counter()
    article_cases = ge.load_golden(gold_dir / "articles.json")["cases"]

    def predict_article(article_id, content):
        if retype:
            return retype_article_rows(
                content,
                baseline_articles.decorations_for_article(
                    article_id,
                    content,
                    gazetteer,
                    held,
                    word_counts=word_counts,
                    tagged_counts=tagged_counts,
                ),
                entities_fn,
                model_revision=revision,
            )
        return decorations_for_article(
            article_id,
            content,
            entities_fn,
            names,
            held=held,
            word_counts=word_counts,
            tagged_counts=tagged_counts,
            model_revision=revision,
        )

    report["article"] = ge.evaluate_articles(
        article_cases, predict=predict_article, model_revision=revision
    )
    timing["article_seconds"] = round(time.perf_counter() - start, 3)
    _, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    timing["peak_tracemalloc_kib"] = round(peak / 1024, 1)
    if cuda_device:
        torch.cuda.synchronize(cuda_device)
        timing["peak_cuda_allocated_bytes"] = torch.cuda.max_memory_allocated(cuda_device)
    report["runtime"] = timing

    env = {}
    for module_name in ("torch", "transformers"):
        try:
            module = __import__(module_name)
            env[module_name] = getattr(module, "__version__", "?")
        except ImportError:
            env[module_name] = None
    report["candidate"] = {
        "name": spec["name"],
        "hf_repo": spec["hf_repo"],
        "revision": spec["revision"],
        "license": spec["license"],
    }
    report["environment"] = env
    report["execution"] = entities_fn.execution
    return report


def print_summary(name, report):
    for domain in ("pasuk", "article"):
        d = report[domain]
        m = d["metrics"]
        print(
            f"[{name}/{domain}] {d['cases']} cases, "
            f"{d['predictions']} predictions — "
            f"p={m['precision']} r={m['recall']} "
            f"det={m['detection_recall']} type={m['type_accuracy']} "
            f"name={m['name_accuracy']} span={m['span_exactness']} "
            f"suppr={m['suppression']}"
        )


def main():
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--model",
        action="append",
        dest="models",
        help="candidate name (repeatable); default: all runnable",
    )
    parser.add_argument(
        "--all", action="store_true", help="evaluate all runnable candidates"
    )
    parser.add_argument(
        "--list",
        action="store_true",
        help="print the candidate registry (licenses) and exit",
    )
    parser.add_argument(
        "--out",
        type=Path,
        help="directory for per-candidate report JSONs "
        "(record the comparison at golden/encoder-metrics)",
    )
    parser.add_argument("--gold-dir", type=Path, default=ge.GOLDEN_DIR)
    add_execution_arguments(parser)
    args = parser.parse_args()

    if args.list:
        for spec in CANDIDATES:
            runnable = "runnable" if spec.get("runnable", True) else "NOT runnable"
            print(
                f"{spec['name']}: {spec['hf_repo']}@{spec['revision'][:8]} "
                f"[{spec['license']}] {runnable}\n    {spec['note']}"
            )
        return

    selected = [
        spec
        for spec in CANDIDATES
        if spec.get("runnable", True)
        and (args.all or not args.models or spec["name"] in args.models)
    ]
    if not selected:
        parser.error("no runnable candidate selected (see --list)")
    try:
        execution = normalize_execution(args.device, args.dtype)
    except (ValueError, RuntimeError) as exc:
        parser.error(str(exc))
    if args.out:
        args.out.mkdir(parents=True, exist_ok=True)
    for spec in selected:
        print(f"=== {spec['name']} ({spec['hf_repo']}) ===")
        report = evaluate_candidate(
            spec, args.gold_dir,
            device=execution["device"], dtype=execution["dtype"],
        )
        print_summary(spec["name"], report)
        if args.out:
            path = args.out / f"{spec['name']}.json"
            path.write_text(
                json.dumps(report, ensure_ascii=False, indent=1),
                encoding="utf-8",
            )
            print(f"  wrote {path}")


if __name__ == "__main__":
    main()
