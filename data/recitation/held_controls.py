"""Fresh full-quality negative controls; their intervals never become publications."""

import argparse
import gc
import json
from pathlib import Path
from types import SimpleNamespace

import benchmark
import recite
from alignment import load_chapters, text_hash, words_for
from model_versions import ALIGN_MODEL, ALIGN_REVISION, ASR_MODEL, ASR_REVISION
from trusted import TRUSTED_PIPELINE, approve_alignment

DIGEST = "5dc503afc58ce3348eab937861e8f6ad4b65eef2b4779d078f8fa42d90a62c26"
PROFILE = "selected-heads-resident-self"


def load_fixture():
    fixture = benchmark.load_snapshot(Path(__file__).with_name("benchmarks") / "held-2026-10-07.json.gz")
    if benchmark.digest_json(fixture) != DIGEST:
        raise ValueError("Held reference changed")
    return fixture


def row_errors(expected, actual):
    errors = []
    if any(actual.get(key) != expected[key] for key in ("pasuk", "segment", "text")):
        errors.append("Held canonical identity/text evidence changed")
    if actual.get("textScore") != expected.get("textScore"):
        errors.append("Held text score changed")
    for key, tolerance in (("startMs", 5), ("endMs", 5), ("acousticScore", .001)):
        value, reference = actual.get(key), expected.get(key)
        if reference is None:
            if value is not None:
                errors.append(f"A held missing value was filled: {key}")
        elif not benchmark.valid_number(value) or abs(value-reference) > tolerance + 1e-12:
            errors.append(f"Held evidence drifted: {key}")
    return errors


def compare(golden, result):
    errors = []
    for key in ("perekId", "audioSha256", "textSha256", "audioUrl", "durationMs", "pipeline"):
        if result.get(key) != golden[key]:
            errors.append(f"Held source changed: {key}")
    if result.get("qualityPassed") is not False or result.get("qualityError") != golden["expectedRejection"]:
        errors.append("Original rejection changed; negative control cannot approve a chapter")
    rows = result.get("words", [])
    if len(rows) != len(golden["words"]):
        errors.append("Held word count changed")
    else:
        for expected, actual in zip(golden["words"], rows, strict=True):
            errors.extend(row_errors(expected, actual))
    errors.extend(benchmark.asr_comparison(golden["asr"]["words"], result["asr"]["words"]))
    return {"passed": not errors, "errors": errors, "publicationStatus": "held"}


def rejection(result, canonical, path, ms):
    try:
        approve_alignment(result, result["diagnostics"], result["asr"], canonical, path, ms)
    except (ValueError, KeyError, TypeError) as error:
        return str(error)
    return None


def verify_result(golden, result, fixture, environment):
    expected = {"heldDigest": DIGEST, "sourceHashes": fixture["sourceHashes"], "environment": environment,
                "experimentSha256": recite.audio_hash(Path(__file__).with_name("whisper_experiment.py")),
                "runnerSha256": recite.audio_hash(Path(__file__)), "profile": PROFILE}
    if any(result.get(key) != value for key, value in expected.items()):
        raise ValueError("Stale held-control evidence")
    verdict = compare(golden, result)
    if not verdict["passed"]:
        raise ValueError(f"Held comparison failed: {golden['perekId']}: {verdict['errors']}")


def check(directory, recordings, environment):
    fixture = load_fixture()
    chapters = load_chapters(recite.ROOT / benchmark.TEXT)
    for golden in fixture["chapters"]:
        pid = golden["perekId"]
        result = json.loads((directory / f"{pid}.json").read_text(encoding="utf-8"))
        verify_result(golden, result, fixture, environment)
        actual_rejection = rejection(result, words_for(chapters[pid]), recordings / f"{pid}_record.mp3", golden["durationMs"])
        if actual_rejection != golden["expectedRejection"]:
            raise ValueError("Held control no longer has the verified original rejection")
    return {"digest": DIGEST, "chapters": [c["perekId"] for c in fixture["chapters"]]}


def generate(golden, canonical, path, environment, fixture):
    import torch
    from acoustic import HebrewAligner
    from validated_worker import memory_scope

    args = SimpleNamespace(asr_model=ASR_MODEL, asr_revision=ASR_REVISION, device="cuda",
                           min_text_score=.6, min_acoustic_score=.5, min_coverage=.85)
    audio = recite.decode(path)
    with memory_scope(PROFILE):
        recognized = recite.transcribe(audio, args)
    aligner = HebrewAligner(ALIGN_MODEL, "cuda", ALIGN_REVISION)
    rows, warnings = recite.align_track(audio, canonical, recognized, aligner, args)
    del aligner
    gc.collect()
    torch.cuda.empty_cache()
    result = {key: golden[key] for key in ("perekId", "audioSha256", "textSha256", "audioUrl", "durationMs", "pipeline")}
    result.update(words=rows, alignmentStatus="needs_review" if warnings else "ready",
                  asr={"audioSha256": golden["audioSha256"], "model": ASR_MODEL, "revision": ASR_REVISION, "words": recognized})
    report = {key: result[key] for key in ("perekId", "audioSha256", "textSha256", "pipeline", "words")}
    report.update(totalWords=len(canonical), review=warnings)
    result["diagnostics"] = report
    error = rejection(result, canonical, path, golden["durationMs"])
    result.update(qualityPassed=error is None, qualityError=error, profile=PROFILE, diagnosticOnly=True,
                  publicationStatus="held", heldDigest=DIGEST, environment=environment,
                  sourceHashes=fixture["sourceHashes"], runnerSha256=recite.audio_hash(Path(__file__)),
                  experimentSha256=recite.audio_hash(Path(__file__).with_name("whisper_experiment.py")))
    result["comparison"] = compare(golden, result)
    return result


def run(recordings, output):
    from awake import keep_awake
    from validated_worker import runtime_environment

    fixture = load_fixture()
    if benchmark.source_hashes(recite.ROOT) != fixture["sourceHashes"] or fixture["pipeline"] != TRUSTED_PIPELINE:
        raise ValueError("Original held-control pipeline changed")
    with benchmark.exclusive_run(output), keep_awake():
        environment = runtime_environment()
        chapters = load_chapters(recite.ROOT / benchmark.TEXT)
        for golden in fixture["chapters"]:
            pid = golden["perekId"]
            path = recordings / f"{pid}_record.mp3"
            canonical = words_for(chapters[pid])
            if recite.audio_hash(path) != golden["audioSha256"] or text_hash(canonical) != golden["textSha256"]:
                raise ValueError("Held control source changed")
            destination = output / f"{pid}.json"
            if destination.exists():
                result = json.loads(destination.read_text(encoding="utf-8"))
            else:
                print(f"Held control {pid}: fresh FP32/five-beam ASR", flush=True)
                result = generate(golden, canonical, path, environment, fixture)
                recite.write_json(destination, result)
            verify_result(golden, result, fixture, environment)
            print(f"Held control {pid}: {result['comparison']}", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--recordings", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    options = parser.parse_args()
    run(options.recordings, options.output)
