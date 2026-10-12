"""Isolated, resumable GPU A/B runs against an immutable accepted timing snapshot."""

# No production database, canonical JSON, or worker cache is written by this tool.
# The original worker remains the default. A passing smoke test is not promotion.

import argparse
from contextlib import closing, contextmanager
from copy import deepcopy
import gc
import gzip
import hashlib
import json
import math
import os
from pathlib import Path
import sqlite3
import subprocess  # nosec B404: fixed executables and argument vectors only.
import sys
import time
from types import SimpleNamespace
from unittest.mock import patch

from alignment import load_chapters, text_hash, validate_timings, words_for
from awake import keep_awake
from model_versions import ALIGN_MODEL, ALIGN_REVISION, ASR_MODEL, ASR_REVISION
from recite import ROOT, align_track, audio_hash, decode, duration, transcribe, write_json
from trusted import TRUSTED_PIPELINE, approve_alignment
from whisper_experiment import PROFILES, experimental_memory

BASELINE_TAG = "recitation-baseline-2026-10-07"
BASELINE_COMMIT = "f600b484c65f7f3b13dee427cf19de52c58cdb8b"
GOLDEN_DIGEST = "e39ce8284c31679801c149528a6606890e5283ca80bd235f642e8e40e70ac0ad"
BASELINE_FILES = ("recite.py", "whisper_memory.py", "alignment.py", "acoustic.py",
                  "model_versions.py", "trusted.py", "awake.py", "requirements.txt")
SETTINGS = {"dtype": "float32", "numBeams": 5, "language": "he", "task": "transcribe",
            "nativeLongForm": True, "pipeline": TRUSTED_PIPELINE}
TEXT = Path("web/bible-on-site/src/data/db/sefaria-dump-5784-sivan-4.tanah_view.json")
TOLERANCE_MS = 5
ACOUSTIC_TOLERANCE = .001


def digest_json(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def load_snapshot(path):
    data = path.read_bytes()
    if path.suffix == ".gz":
        data = gzip.decompress(data)
    return json.loads(data.decode("utf-8"))


def source_hashes(root):
    return {name: audio_hash(root / "data/recitation" / name) for name in BASELINE_FILES}


def snapshot(root, recordings, output):
    """Read accepted data from the backup commit, not the working checkpoint DB."""
    reference = load_snapshot(Path(__file__).with_name("benchmarks") / "golden-2026-10-07.json.gz")
    if digest_json(reference) != GOLDEN_DIGEST or reference["baselineCommit"] != BASELINE_COMMIT:
        raise ValueError("The preserved baseline reference changed")
    commit = BASELINE_COMMIT
    hashes = source_hashes(root)
    if hashes != reference["sourceHashes"]:
        raise ValueError("Baseline source differs from the preserved backup hashes")
    db_path = root / "data/recitation/recitation.sqlite"
    if reference["databaseSha256"] != audio_hash(db_path):
        raise ValueError("Accepted database differs from the preserved backup")
    chapters = load_chapters(root / TEXT)
    cache = root / "data/recitation/.outputs"
    goldens = []
    with closing(sqlite3.connect(f"{db_path.resolve().as_uri()}?mode=ro", uri=True)) as db:
        tracks = db.execute("SELECT perek_id,audio_url,audio_sha256,text_sha256,duration_ms,provenance_json "
                            "FROM recitation_track WHERE alignment_status='ready' ORDER BY perek_id").fetchall()
        for pid, url, audio_sha, text_sha, ms, provenance in tracks:
            words = words_for(chapters[pid])
            rows = [{"pasuk": p, "segment": s, "text": word.text, "startMs": start, "endMs": end}
                    for (p, s, start, end), word in zip(db.execute(
                        "SELECT pasuk,segment,start_ms,end_ms FROM recitation_word WHERE perek_id=? ORDER BY pasuk,segment",
                        (pid,)), words, strict=True)]
            validate_timings(words, rows, ms, require_complete=True)
            track = {"perekId": pid, "audioUrl": url, "audioSha256": audio_sha, "textSha256": text_sha,
                     "durationMs": ms, "words": rows, "provenance": json.loads(provenance)}
            recording = recordings / f"{pid}_record.mp3"
            if text_hash(words) != text_sha or audio_hash(recording) != audio_sha or duration(recording) != ms:
                raise ValueError(f"Golden source changed: {pid}")
            track["eligible"] = track["provenance"].get("pipeline") == TRUSTED_PIPELINE
            if track["eligible"]:
                manifest = json.loads((cache / "alignments" / f"{pid}.json").read_text(encoding="utf-8"))
                report = json.loads((cache / f"{pid}.review.json").read_text(encoding="utf-8"))
                asr = json.loads((cache / f"{pid}.asr.json").read_text(encoding="utf-8"))
                approve_alignment(manifest, report, asr, words, recording, ms)
                if [{key: row[key] for key in rows[0]} for row in manifest["words"]] != rows:
                    raise ValueError(f"Raw evidence differs from accepted golden timings: {pid}")
                track["words"] = manifest["words"]
                track["asr"] = asr
            else:
                track["exclusion"] = "Earlier manually accepted pipeline; protected, not a v3 regression reference"
            goldens.append(track)
    result = {"version": 1, "baselineTag": BASELINE_TAG, "baselineCommit": commit,
              "sourceHashes": hashes, "databaseSha256": audio_hash(db_path), "settings": SETTINGS,
              "chapters": goldens}
    if output.suffix == ".gz":
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(gzip.compress(json.dumps(result, ensure_ascii=False, separators=(",", ":")).encode(), mtime=0))
    else:
        write_json(output, result)
    return result


def valid_number(value):
    return isinstance(value, (float, int)) and not isinstance(value, bool) and math.isfinite(value)


def valid_interval(start, end, previous_end, duration_ms):
    integers = all(isinstance(value, int) and not isinstance(value, bool) for value in (start, end))
    return integers and previous_end <= start < end <= duration_ms and 40 <= end-start <= 3000


def word_comparison(expected, actual, previous_end, duration_ms):
    identity = (expected["pasuk"], expected["segment"])
    if not isinstance(actual, dict) or any(actual.get(k) != expected[k] for k in ("pasuk", "segment", "text")):
        return [f"Changed word identity/text: {identity}"], [], [], previous_end
    start, end = actual.get("startMs"), actual.get("endMs")
    if not valid_interval(start, end, previous_end, duration_ms):
        return [f"Invalid/missing/overlapping word interval: {identity}"], [], [], previous_end
    errors, deltas, scores = [], [], []
    for key in ("startMs", "endMs"):
        delta = abs(actual[key] - expected[key])
        deltas.append(delta)
        if delta > TOLERANCE_MS:
            errors.append(f"{identity} {key}: {delta} ms drift")
    if expected.get("textScore") != actual.get("textScore"):
        errors.append(f"Changed textScore: {identity}")
    score, expected_score = actual.get("acousticScore"), expected.get("acousticScore")
    if not valid_number(score) or not 0 <= score <= 1 or expected_score is None:
        errors.append(f"Missing/invalid acousticScore: {identity}")
    else:
        delta = abs(score - expected_score)
        scores.append(delta)
        # User allows slight score variation (2026-10-07). No original gate changes.
        if delta > ACOUSTIC_TOLERANCE + 1e-12:
            errors.append(f"Changed acousticScore: {identity}, {delta:.6f} drift")
    return errors, deltas, scores, end


def asr_comparison(expected_asr, actual_asr):
    errors = []
    if len(expected_asr) != len(actual_asr):
        return ["ASR word count changed"]
    for index, (expected, actual) in enumerate(zip(expected_asr, actual_asr, strict=True)):
        if expected.get("text") != actual.get("text"):
            errors.append(f"ASR text changed: {index}")
        for key in ("start", "end"):
            value = actual.get(key)
            if not valid_number(value) or abs(value - expected[key]) * 1000 > TOLERANCE_MS + 1e-8:
                errors.append(f"ASR boundary changed: {index}/{key}")
    return errors


def compare(golden, candidate):
    """Fail on any missing/changed identity, quality gate or boundary beyond 5 ms."""
    errors, deltas, score_deltas = [], [], []
    for key in ("perekId", "audioSha256", "textSha256", "audioUrl", "durationMs"):
        if candidate.get(key) != golden.get(key):
            errors.append(f"Changed source: {key}")
    if candidate.get("settings") != SETTINGS:
        errors.append("Changed model/search/precision/threshold settings")
    if candidate.get("qualityPassed") is not True:
        errors.append("Original acceptance gates did not pass")
    rows = candidate.get("words", [])
    if not isinstance(rows, list) or len(rows) != len(golden["words"]):
        return {"passed": False, "errors": errors + ["Canonical word count changed"], "maxDriftMs": None}
    previous_end = 0
    for expected, actual in zip(golden["words"], rows, strict=True):
        word_errors, word_deltas, word_scores, previous_end = word_comparison(expected, actual, previous_end, golden["durationMs"])
        errors.extend(word_errors)
        deltas.extend(word_deltas)
        score_deltas.extend(word_scores)
    errors.extend(asr_comparison(golden.get("asr", {}).get("words", []), candidate.get("asr", {}).get("words", [])))
    return {"passed": not errors, "errors": errors, "maxDriftMs": max(deltas, default=None),
            "maxAcousticScoreDrift": max(score_deltas, default=None),
            "comparedWords": len(rows), "comparedBoundaries": len(deltas)}


def assert_idle_gpu():
    """Fail closed when another actual GPU worker/benchmark is running."""
    if sys.platform == "win32":
        command = ("Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^python' } | "
                   "Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress")
        processes = json.loads(subprocess.check_output(  # nosec B603 B607: fixed PowerShell script, no user input.
            ["powershell.exe", "-NoProfile", "-Command", command], text=True) or "[]")
        if isinstance(processes, dict):
            processes = [processes]
        # A Windows venv launcher and its actual child share the same command.
        for process in processes:
            if process["ProcessId"] in (os.getpid(), os.getppid()):
                continue
            command_line = process.get("CommandLine") or ""
            if ("recite.py" in command_line or "validated_worker.py" in command_line or "held_controls.py" in command_line
                    or ("benchmark.py" in command_line and " run " in command_line)):
                raise RuntimeError(f"Another GPU worker is running: {process['ProcessId']}")
    import torch
    if not torch.cuda.is_available():
        raise RuntimeError("CUDA unavailable; no CPU or reduced-quality fallback")
    torch.ones(1, device="cuda").item()
    return {"device": torch.cuda.get_device_name(), "torch": torch.__version__,
            "cuda": torch.version.cuda, "python": sys.version,
            "tf32Matmul": torch.backends.cuda.matmul.allow_tf32,
            "tf32Cudnn": torch.backends.cudnn.allow_tf32}


@contextmanager
def exclusive_run(output):
    # Atomic lease, removed on normal/exception exit. A crash leaves evidence and
    # requires actual process inspection before manually removing this file.
    output.mkdir(parents=True, exist_ok=True)
    lease = output / "worker.lock"
    with lease.open("x", encoding="utf-8") as handle:
        handle.write(json.dumps({"pid": os.getpid(), "startedAt": time.time()}))
    try:
        yield
    finally:
        lease.unlink(missing_ok=True)


def run(goldens, recordings, output, profiles, ids, baseline_ids=None):
    import torch
    import transformers
    from acoustic import HebrewAligner
    from importlib.metadata import version

    if (digest_json(goldens) != GOLDEN_DIGEST or goldens.get("baselineCommit") != BASELINE_COMMIT
            or goldens.get("settings") != SETTINGS):
        raise ValueError("Unknown golden source/settings")
    if goldens["sourceHashes"] != source_hashes(ROOT):
        raise ValueError("Default pipeline changed; compare the preserved source first")
    eligible = [chapter for chapter in goldens["chapters"] if chapter["eligible"]]
    if ids and not set(ids).issubset({chapter["perekId"] for chapter in eligible}):
        raise ValueError("Requested chapter is not a pinned v3 golden reference")
    chosen = [chapter for chapter in eligible if not ids or chapter["perekId"] in ids]
    if baseline_ids and ("baseline" not in profiles or not set(baseline_ids).issubset({c["perekId"] for c in chosen})):
        raise ValueError("Baseline controls must be selected eligible chapters with the baseline profile enabled")
    chosen.sort(key=lambda chapter: chapter["durationMs"])
    args = SimpleNamespace(asr_model=ASR_MODEL, asr_revision=ASR_REVISION, device="cuda",
                           min_text_score=.6, min_acoustic_score=.5, min_coverage=.85)
    runner = {"benchmark": audio_hash(Path(__file__)), "experiment": audio_hash(Path(__file__).with_name("whisper_experiment.py"))}
    fingerprint = digest_json({"goldens": goldens, "runner": runner, "profiles": profiles})
    results = []
    with exclusive_run(output), keep_awake():
        environment = assert_idle_gpu()
        environment["transformers"] = version("transformers")
        environment["numpy"] = version("numpy")
        environment["ffmpeg"] = subprocess.check_output(["ffmpeg", "-version"], text=True).splitlines()[0]  # nosec B603 B607
        chapters = load_chapters(ROOT / TEXT)
        for golden in chosen:
            pid = golden["perekId"]
            path = recordings / f"{pid}_record.mp3"
            canonical = words_for(chapters[pid])
            if (audio_hash(path) != golden["audioSha256"] or text_hash(canonical) != golden["textSha256"]
                    or duration(path) != golden["durationMs"]):
                raise ValueError(f"Source changed: {pid}")
            audio = decode(path)
            for profile in profiles:
                if profile == "baseline" and baseline_ids and pid not in baseline_ids:
                    continue
                destination = output / f"{pid}-{profile}.json"
                if destination.exists():
                    result = json.loads(destination.read_text(encoding="utf-8"))
                    if result.get("runFingerprint") != fingerprint or result.get("environment") != environment:
                        raise ValueError("Stale benchmark results; use a new output directory")
                    results.append(result)
                    continue
                print(f"Benchmark {pid}/{profile}: fresh full FP32 ASR; {len(canonical)} canonical words", flush=True)
                began = time.monotonic()
                phases = {}
                original_pipeline = transformers.pipeline

                def measured_load(*args, **kwargs):
                    started = time.monotonic()
                    loaded = original_pipeline(*args, **kwargs)
                    phases["modelLoadSeconds"] = time.monotonic() - started
                    return loaded

                @contextmanager
                def measured_memory(model):
                    with experimental_memory(model, profile):
                        started = time.monotonic()
                        yield
                        phases["inferenceSeconds"] = time.monotonic() - started

                with patch("whisper_memory.bounded_whisper_memory", measured_memory), patch("transformers.pipeline", measured_load):
                    recognized = transcribe(audio, args)
                asr_seconds = time.monotonic() - began
                peak = torch.cuda.max_memory_allocated()
                cached = {"audioSha256": golden["audioSha256"], "model": ASR_MODEL,
                          "revision": ASR_REVISION, "words": recognized}
                align_began = time.monotonic()
                aligner = HebrewAligner(ALIGN_MODEL, "cuda", ALIGN_REVISION)
                rows, warnings = align_track(audio, canonical, recognized, aligner, args)
                del aligner
                gc.collect()
                torch.cuda.empty_cache()
                manifest = {key: deepcopy(golden[key]) for key in
                            ("perekId", "audioUrl", "audioSha256", "textSha256", "durationMs")}
                manifest.update(words=rows, pipeline=TRUSTED_PIPELINE, alignmentStatus="needs_review" if warnings else "ready")
                report = {key: deepcopy(manifest[key]) for key in ("perekId", "audioSha256", "textSha256", "words", "pipeline")}
                report.update(totalWords=len(canonical), review=warnings)
                quality_error = None
                try:
                    approve_alignment(manifest, report, cached, canonical, path, golden["durationMs"])
                except (ValueError, KeyError, TypeError) as error:
                    quality_error = str(error)
                result = dict(manifest, asr=cached, settings=SETTINGS, qualityPassed=quality_error is None,
                              qualityError=quality_error, profile=profile, runFingerprint=fingerprint,
                              runnerHashes=runner, goldenDigest=digest_json(goldens), sourceHashes=goldens["sourceHashes"],
                              environment=environment, diagnostics=report,
                              measurements={**phases, "asrSeconds": asr_seconds, "ctcSeconds": time.monotonic()-align_began,
                                            "totalSeconds": time.monotonic()-began, "peakCudaBytes": peak})
                result["comparison"] = compare(golden, result)
                write_json(destination, result)
                results.append(result)
                print(f"{pid}/{profile}: {result['comparison']}; {result['measurements']}", flush=True)
            write_json(output / "summary.json", summary(goldens, results, profiles))
    return summary(goldens, results, profiles)


def summary(goldens, results, profiles):
    required = {chapter["perekId"] for chapter in goldens["chapters"] if chapter["eligible"]}
    records = {(result["perekId"], result["profile"]): result for result in results}
    verdicts = {}
    for profile in profiles:
        covered = {pid for pid, name in records if name == profile}
        pairs = [(records[pid, "baseline"], records[pid, profile]) for pid in sorted(covered)
                 if (pid, "baseline") in records]
        drift_passed = bool(covered) and all(records[pid, profile]["comparison"]["passed"] for pid in covered)
        baseline_passed = bool(pairs) and all(base["comparison"]["passed"] for base, candidate in pairs)
        baseline_seconds = sum(base["measurements"]["totalSeconds"] for base, candidate in pairs)
        candidate_seconds = sum(candidate["measurements"]["totalSeconds"] for base, candidate in pairs)
        speedup = baseline_seconds / candidate_seconds if candidate_seconds else None
        inference_pairs = [(base["measurements"]["inferenceSeconds"], candidate["measurements"]["inferenceSeconds"])
                           for base, candidate in pairs if "inferenceSeconds" in base["measurements"]
                           and "inferenceSeconds" in candidate["measurements"]]
        inference_total = sum(candidate for base, candidate in inference_pairs)
        inference_speedup = sum(base for base, candidate in inference_pairs) / inference_total if inference_total else None
        paired_comparisons = [{"perekId": candidate["perekId"], **compare(base, candidate)} for base, candidate in pairs]
        verdicts[profile] = {"covered": sorted(covered), "missing": sorted(required-covered),
                             "allBoundariesPassed": drift_passed, "baselineReproduced": baseline_passed,
                             "pairedComparisons": paired_comparisons,
                             "pairedSpeedup": speedup,
                             "pairedInferenceSpeedup": inference_speedup,
                             "promotionAllowed": False}
        # Even a complete golden suite supplies evidence, not an automatic change
        # to the production worker. Held-case controls and review are still needed.
    return {"profiles": verdicts, "defaultWorkerUnchanged": True,
            "protectedLegacyChapters": [c["perekId"] for c in goldens["chapters"] if not c["eligible"]]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    capture = commands.add_parser("snapshot")
    capture.add_argument("--baseline-root", type=Path, required=True)
    capture.add_argument("--recordings", type=Path, required=True)
    capture.add_argument("--output", type=Path, required=True)
    execute = commands.add_parser("run")
    execute.add_argument("--goldens", type=Path, required=True)
    execute.add_argument("--recordings", type=Path, required=True)
    execute.add_argument("--output", type=Path, required=True)
    execute.add_argument("--profiles", choices=PROFILES, nargs="+", default=["baseline"])
    execute.add_argument("--perek", type=int, action="append")
    execute.add_argument("--baseline-perek", type=int, action="append",
                         help="Optional baseline controls; candidates still run on every selected golden")
    args = parser.parse_args()
    if args.command == "snapshot":
        result = snapshot(args.baseline_root, args.recordings, args.output)
        print(json.dumps({"goldenChapters": len(result["chapters"]),
                          "eligible": sum(c["eligible"] for c in result["chapters"])}))
    else:
        result = run(load_snapshot(args.goldens), args.recordings,
                     args.output, args.profiles, args.perek, args.baseline_perek)
        print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
