"""Golden-set harness for the mention-decoration pipeline (issue #2516).

Evaluates any decoration generator that emits
`tanahpedia_mention_decoration` contract rows against the curated golden
set under `golden/`: precision, recall, span exactness, entity-type and
intended-name accuracy, `held`-suppression handling, plus runtime and
throughput. The scorer is pipeline-agnostic — the future encoder tier
plugs in by emitting the same contract row shape.

Metrics definitions (matching the issue's acceptance list):

- precision: `auto` predictions exactly matching a gold mention / all
  `auto` predictions. `held` rows never render, so they are not precision
  errors — they are scored in the suppression bucket instead.
- recall: `auto`-expected gold mentions exactly matched by an `auto`
  prediction / all `auto`-expected gold mentions.
- detection_recall: adds `held` predictions that found the right span —
  the mention was detected but suppressed before render.
- type / name accuracy: correct entity_type / intended_name among exact
  matches, with `type_alternates`/`name_alternates` accepted where the
  taxonomy or entry spelling is genuinely ambiguous. Strict variants
  score the primary label only.
- span exactness: exact-boundary pairs among all overlapping
  prediction/gold pairs (partial-boundary near-misses are diagnostic).
- suppression: of gold `held` surfaces, the share emitted `held` or not
  emitted at all — rendering one is a precision failure.

`--check` regenerates deterministic metrics and diffs them against
`golden/metrics-baseline.json` (the recorded measurement for the pinned
baseline model revision); `--write` refreshes that record after a
deliberate pipeline change.
"""

import collections
import json
from pathlib import Path
import sys
import time
import tracemalloc

sys.path.insert(0, str(Path(__file__).resolve().parent))
import baseline
import baseline_articles

GOLDEN_DIR = Path(__file__).with_name("golden")
METRICS_PATH = GOLDEN_DIR / "metrics-baseline.json"

GOLD_MENTION_FIELDS = {"start", "end", "text", "name", "type", "surface"}
OPTIONAL_MENTION_FIELDS = {
    "occurrence",
    "expected",
    "name_alternates",
    "type_alternates",
}
VALID_EXPECTED = {"auto", "held"}
ZERO_WIDTH = "\u200b\u200c\u200d\ufeff"


def _clean(text):
    """Normalized surface with zero-width characters removed.

    The canonical dump contains stray zero-width joiners (e.g. inside
    אלימלך in Ruth 1:2); `text` fields stay readable while span identity
    comes from the segment indexes.
    """
    for char in ZERO_WIDTH:
        text = text.replace(char, "")
    return text


def load_golden(path):
    """Load and structurally validate a golden file.

    Returns the parsed payload dict; raises ValueError on malformed input
    so bad gold fails loudly in tests rather than skewing metrics.
    """
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(payload, dict) or not isinstance(
        payload.get("cases"), list
    ):
        raise ValueError(f"{path}: golden file must be an object with a cases list")
    if payload.get("version") != 1:
        raise ValueError(f"{path}: unsupported golden version {payload.get('version')}")
    ids = set()
    for case in payload["cases"]:
        case_id = case.get("id")
        if not case_id or case_id in ids:
            raise ValueError(f"{path}: missing or duplicate case id {case_id!r}")
        ids.add(case_id)
        if not isinstance(case.get("mentions"), list):
            raise ValueError(f"{case_id}: mentions must be a list")
        for mention in case["mentions"]:
            unknown = set(mention) - GOLD_MENTION_FIELDS - OPTIONAL_MENTION_FIELDS
            if unknown:
                raise ValueError(f"{case_id}: unknown mention fields {sorted(unknown)}")
            if "name" not in mention or "type" not in mention:
                raise ValueError(
                    f"{case_id}: mention missing required name/type: {mention}"
                )
            if "surface" in mention:
                span_fields = {"start", "end", "text"}
                if span_fields & set(mention):
                    raise ValueError(
                        f"{case_id}: article and pasuk span fields mixed in {mention}"
                    )
            elif not {"start", "end", "text"} <= set(mention):
                raise ValueError(
                    f"{case_id}: mention needs surface or start/end/text: {mention}"
                )
            if mention.get("expected", "auto") not in VALID_EXPECTED:
                raise ValueError(f"{case_id}: bad expected value in {mention}")
    return payload


def resolve_pasuk(case, sefarim):
    """Locate the case's canonical perek + (book stem, chapter).

    `additional` selects the split-book index (0=1Sam, 1=2Sam, ...) for
    sefarim that fold books under `additionals`; `perek` is the 1-based
    chapter within that book file.
    """
    sefer_index = case["sefer"]
    chapter = case["perek"]
    additional = case.get("additional")
    stems = baseline.SEFER_BOOKS[sefer_index]
    wanted = stems[0] if additional is None else stems[additional]
    for perek, stem, chapter_number in baseline.iter_perek_sources(
        sefer_index, sefarim
    ):
        if stem == wanted and chapter_number == chapter:
            return perek, stem, chapter_number
    raise ValueError(
        f"{case['id']}: no canonical perek for sefer {sefer_index} "
        f"book {wanted} chapter {chapter}"
    )


def resolve_pasuk_mentions(case, perek):
    """Resolve gold mentions to span tuples + verify `text` against source."""
    pasuk = perek["pesukim"][case["pasuk"] - 1]
    segments = pasuk["segments"]
    golds = []
    for mention in case["mentions"]:
        start, end = mention["start"], mention["end"]
        if not (0 <= start <= end < len(segments)):
            raise ValueError(f"{case['id']}: span {start}-{end} out of range")
        joined = " ".join(s.get("value", "") for s in segments[start : end + 1])
        actual = _clean(baseline.normalize_name(joined))
        if actual != mention["text"]:
            raise ValueError(
                f"{case['id']}: text {mention['text']!r} != source {actual!r}"
            )
        for i in range(start, end + 1):
            if segments[i]["type"] not in ("qri", "ktiv"):
                raise ValueError(
                    f"{case['id']}: segment {i} is not text-bearing"
                )
        golds.append(_gold_row((start, end + 1), mention))
    return golds


def resolve_article_mentions(case):
    """Resolve gold surfaces to UTF-16 span tuples within the content."""
    content = case["content"]
    utf16_map = baseline_articles.utf16_index_map(content)
    golds = []
    for mention in case["mentions"]:
        surface = mention["surface"]
        occurrence = mention.get("occurrence", 0)
        pos = -1
        for _ in range(occurrence + 1):
            pos = content.find(surface, pos + 1)
            if pos < 0:
                raise ValueError(
                    f"{case['id']}: surface {surface!r} occurrence "
                    f"{occurrence} not found"
                )
        golds.append(
            _gold_row(
                (utf16_map[pos], utf16_map[pos + len(surface)]), mention
            )
        )
    spans = sorted(g["span"] for g in golds)
    for left, right in zip(spans, spans[1:]):
        if left[1] > right[0]:
            raise ValueError(f"{case['id']}: overlapping gold spans {left} {right}")
    return golds


def _gold_row(span, mention):
    return {
        "span": span,
        "name": mention["name"],
        "names": {mention["name"], *mention.get("name_alternates", [])},
        "type": mention["type"],
        "types": {mention["type"], *mention.get("type_alternates", [])},
        "expected": mention.get("expected", "auto"),
        "text": mention.get("text", mention.get("surface", "")),
    }


def _pred_span(row):
    if row["source_kind"] == "pasuk":
        return (row["segment_start"], row["segment_end"] + 1)
    return (row["span_start"], row["span_end"])


def _overlap(a, b):
    return a[0] < b[1] and b[0] < a[1]


def score_case(predictions, golds):
    """Score one case's prediction rows against resolved gold mentions.

    Returns the counts dict for the case plus unmatched/partial detail —
    aggregation over cases is a plain counter sum.
    """
    preds = [
        {
            "span": _pred_span(row),
            "name": row["intended_name"],
            "type": row["entity_type"],
            "acceptance": row.get("acceptance", "auto"),
            "surface": row.get("surface", ""),
        }
        for row in predictions
    ]
    counts = collections.Counter()
    pairs = []
    used_preds, used_golds = set(), set()
    # Exact-span pairs first, deterministically.
    for gi, gold in enumerate(golds):
        for pi, pred in enumerate(preds):
            if pi in used_preds or pred["span"] != gold["span"]:
                continue
            used_preds.add(pi)
            used_golds.add(gi)
            pairs.append((pred, gold))
            break
    # Partial overlaps among the leftovers (diagnostics only).
    partials = []
    for pi, pred in enumerate(preds):
        if pi in used_preds:
            continue
        for gi, gold in enumerate(golds):
            if gi in used_golds or not _overlap(pred["span"], gold["span"]):
                continue
            partials.append(
                {
                    "pred_span": list(pred["span"]),
                    "pred_surface": pred["surface"],
                    "pred_name": pred["name"],
                    "pred_acceptance": pred["acceptance"],
                    "gold_span": list(gold["span"]),
                    "gold_text": gold["text"],
                    "gold_name": gold["name"],
                    "gold_expected": gold["expected"],
                }
            )
            break
    for pred, gold in pairs:
        auto_pred = pred["acceptance"] == "auto"
        auto_gold = gold["expected"] == "auto"
        if auto_pred and auto_gold:
            counts["tp"] += 1
            counts["type_hit"] += pred["type"] in gold["types"]
            counts["type_strict_hit"] += pred["type"] == gold["type"]
            counts["name_hit"] += pred["name"] in gold["names"]
            counts["name_strict_hit"] += pred["name"] == gold["name"]
        elif auto_pred:
            counts["rendered_suppressed"] += 1
        elif auto_gold:
            counts["held_hit"] += 1
        else:
            counts["held_correct"] += 1
    for i, pred in enumerate(preds):
        if i in used_preds:
            continue
        counts["fp" if pred["acceptance"] == "auto" else "held_noise"] += 1
    for gi, gold in enumerate(golds):
        if gi in used_golds:
            continue
        if gold["expected"] == "auto":
            counts["fn"] += 1
        else:
            counts["suppressed_ok"] += 1
    counts["gold_auto"] = sum(1 for g in golds if g["expected"] == "auto")
    counts["gold_held"] = sum(1 for g in golds if g["expected"] == "held")
    counts["partial"] = len(partials)
    return counts, partials


def finalize(counts):
    """Derive ratio metrics from a counts Counter."""
    auto_preds = counts["tp"] + counts["fp"] + counts["rendered_suppressed"]
    tp = counts["tp"]

    def ratio(num, den):
        return round(num / den, 6) if den else None

    return {
        "precision": ratio(tp, auto_preds),
        "recall": ratio(tp, counts["gold_auto"]),
        "f1": ratio(
            2 * tp, auto_preds + counts["gold_auto"]
        ),
        "detection_recall": ratio(
            tp + counts["held_hit"], counts["gold_auto"]
        ),
        "type_accuracy": ratio(counts["type_hit"], tp),
        "type_accuracy_strict": ratio(counts["type_strict_hit"], tp),
        "name_accuracy": ratio(counts["name_hit"], tp),
        "name_accuracy_strict": ratio(counts["name_strict_hit"], tp),
        "span_exactness": ratio(
            counts["tp"]
            + counts["held_hit"]
            + counts["held_correct"]
            + counts["rendered_suppressed"],
            counts["tp"]
            + counts["held_hit"]
            + counts["held_correct"]
            + counts["rendered_suppressed"]
            + counts["partial"],
        ),
        "suppression": ratio(
            counts["held_correct"] + counts["suppressed_ok"],
            counts["gold_held"],
        ),
    }


def evaluate_pasuk(cases, sefarim, predict=None, model_revision=None):
    """Run the pasuk domain per case and score it. Returns the domain report.

    `predict(perek, stem, chapter) -> contract rows` defaults to the
    pinned lexical baseline; any generator emitting the same row shape
    plugs in here (the encoder tier will reuse this harness).
    """
    if predict is None:
        lexicon = baseline.load_lexicon()
        model_revision = baseline.MODEL_REVISION

        def predict(perek, stem, chapter):
            chapter_tokens = lexicon["books"].get(stem, {}).get(
                str(chapter), {}
            )
            return baseline.decorations_for_perek(
                perek, chapter_tokens, lexicon
            )

    per_case = {}
    counts = collections.Counter()
    predictions = 0
    for case in cases:
        perek, stem, chapter = resolve_pasuk(case, sefarim)
        rows = [
            row
            for row in predict(perek, stem, chapter)
            if row["pasuk_number"] == case["pasuk"]
        ]
        predictions += len(rows)
        golds = resolve_pasuk_mentions(case, perek)
        case_counts, partials = score_case(rows, golds)
        counts.update(case_counts)
        per_case[case["id"]] = {
            "counts": dict(case_counts),
            "metrics": finalize(case_counts),
            "partials": partials,
            "predictions": len(rows),
        }
    return _domain_report(
        cases, counts, per_case, predictions, model_revision
    )


def evaluate_articles(cases, predict=None, model_revision=None):
    """Run the article domain per case and score it.

    `predict(article_id, content) -> contract rows` defaults to the
    gazetteer baseline over the real corpus.
    """
    if predict is None:
        (
            gazetteer,
            held,
            word_counts,
            tagged_counts,
        ) = baseline_articles.build_gazetteer_from_corpus()
        model_revision = baseline_articles.MODEL_REVISION

        def predict(article_id, content):
            return baseline_articles.decorations_for_article(
                article_id,
                content,
                gazetteer,
                held,
                word_counts=word_counts,
                tagged_counts=tagged_counts,
            )

    per_case = {}
    counts = collections.Counter()
    predictions = 0
    for case in cases:
        rows = predict(case["article_id"], case["content"])
        predictions += len(rows)
        golds = resolve_article_mentions(case)
        case_counts, partials = score_case(rows, golds)
        counts.update(case_counts)
        per_case[case["id"]] = {
            "counts": dict(case_counts),
            "metrics": finalize(case_counts),
            "partials": partials,
            "predictions": len(rows),
        }
    return _domain_report(
        cases,
        counts,
        per_case,
        predictions,
        model_revision,
    )


def _domain_report(cases, counts, per_case, predictions, model_revision):
    categories = collections.defaultdict(collections.Counter)
    for case in cases:
        for category in case.get("categories", []):
            categories[category].update(per_case[case["id"]]["counts"])
    return {
        "model_revision": model_revision,
        "cases": len(cases),
        "gold_auto": counts["gold_auto"],
        "gold_held": counts["gold_held"],
        "predictions": predictions,
        "counts": dict(counts),
        "metrics": finalize(counts),
        "per_category": {
            name: {
                "counts": dict(cat_counts),
                "metrics": finalize(cat_counts),
            }
            for name, cat_counts in sorted(categories.items())
        },
        "per_case": per_case,
    }


def evaluate(gold_dir=GOLDEN_DIR):
    """Run both domains; returns the full deterministic report."""
    timing = {}
    tracemalloc.start()
    start = time.perf_counter()
    pasuk_cases = load_golden(gold_dir / "pesukim.json")["cases"]
    sefarim = baseline.load_canonical()
    pasuk = evaluate_pasuk(pasuk_cases, sefarim)
    timing["pasuk_seconds"] = round(time.perf_counter() - start, 3)
    start = time.perf_counter()
    article_cases = load_golden(gold_dir / "articles.json")["cases"]
    article = evaluate_articles(article_cases)
    timing["article_seconds"] = round(time.perf_counter() - start, 3)
    _, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    timing["peak_tracemalloc_kib"] = round(peak / 1024, 1)
    total_pesukim = len(pasuk_cases)
    total_article_chars = sum(len(c["content"]) for c in article_cases)
    timing["pasuk_per_sec"] = (
        round(total_pesukim / timing["pasuk_seconds"], 1)
        if timing["pasuk_seconds"]
        else None
    )
    timing["article_chars_per_sec"] = (
        round(total_article_chars / timing["article_seconds"], 1)
        if timing["article_seconds"]
        else None
    )
    return {"schema": 1, "pasuk": pasuk, "article": article, "runtime": timing}


def deterministic(report):
    """The report minus wall-clock fields — what `--check` compares."""
    return {k: v for k, v in report.items() if k != "runtime"}


def print_report(report):
    for domain in ("pasuk", "article"):
        d = report[domain]
        m = d["metrics"]
        print(
            f"[{domain}] {d['model_revision']} — {d['cases']} cases, "
            f"{d['gold_auto']} gold mentions, {d['predictions']} predictions"
        )
        for key, value in m.items():
            print(f"  {key}: {value}")
        print(f"  counts: {d['counts']}")
        print("  per-category:")
        for name, cat in d["per_category"].items():
            cm = cat["metrics"]
            print(
                f"    {name}: p={cm['precision']} r={cm['recall']} "
                f"type={cm['type_accuracy']} name={cm['name_accuracy']} "
                f"counts={cat['counts']}"
            )
    print(f"runtime: {report['runtime']}")


def main():
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--gold-dir", type=Path, default=GOLDEN_DIR)
    parser.add_argument("--out", type=Path, help="write full report JSON")
    parser.add_argument(
        "--check",
        action="store_true",
        help="diff deterministic metrics against metrics-baseline.json",
    )
    parser.add_argument(
        "--write",
        action="store_true",
        help="record current metrics as the new baseline",
    )
    args = parser.parse_args()

    report = evaluate(args.gold_dir)
    print_report(report)
    if args.out:
        args.out.write_text(
            json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8"
        )
    if args.write:
        METRICS_PATH.write_text(
            json.dumps(deterministic(report), ensure_ascii=False, indent=1),
            encoding="utf-8",
        )
        print(f"recorded baseline metrics at {METRICS_PATH}")
    if args.check:
        recorded = json.loads(METRICS_PATH.read_text(encoding="utf-8"))
        if deterministic(report) != recorded:
            print(
                "METRICS DRIFT: deterministic metrics differ from "
                f"{METRICS_PATH} — regenerate with --write if the "
                "pipeline change is deliberate.",
                file=sys.stderr,
            )
            sys.exit(1)
        print("metrics match the recorded baseline")


if __name__ == "__main__":
    main()
