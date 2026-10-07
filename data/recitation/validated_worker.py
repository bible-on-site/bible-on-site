"""Opt-in validated memory transfers around the unchanged full-quality worker."""

import argparse
from contextlib import contextmanager
from copy import deepcopy
import json
from importlib.metadata import version
from pathlib import Path
import subprocess  # nosec B404: fixed FFmpeg command, argv only.
import sys

import benchmark
import recite
import whisper_memory
from alignment import load_chapters, words_for
from trusted import approve_alignment
from whisper_experiment import experimental_memory

PROFILE = "selected-heads-resident-self"
CONTROLS = (338, 354, 203, 531)
# Source actually loaded by the preserved 2026-10-07 full-suite process (b4116ff).
ARCHIVED_RUNNER = {
    "benchmark": "e912a926201d63f6caaa009ab474a7e1b05b062e3438425e6da382bf78658e2f",
    "experiment": "aac430820358fc19a88081a02018f88ff3f3e0795ebeecbaf892251cd7985782",
}


def current_runner():
    return {"benchmark": recite.audio_hash(Path(benchmark.__file__)),
            "experiment": recite.audio_hash(Path(__file__).with_name("whisper_experiment.py"))}


def runtime_environment():
    environment = benchmark.assert_idle_gpu()
    environment["transformers"] = version("transformers")
    environment["numpy"] = version("numpy")
    environment["ffmpeg"] = subprocess.check_output(  # nosec B603 B607: fixed command, same PATH as the original decoder.
        ["ffmpeg", "-version"], text=True).splitlines()[0]
    return environment


def read_result(directory, pid, profile):
    path = directory / f"{pid}-{profile}.json"
    result = json.loads(path.read_text(encoding="utf-8"))
    if result.get("profile") != profile:
        raise ValueError(f"Wrong memory profile: {path}")
    return result


def expected_metadata(snapshot, runner, environment):
    expected_fingerprint = benchmark.digest_json({"goldens": snapshot, "runner": runner,
                                                 "profiles": ["baseline", PROFILE]})
    return {"goldenDigest": benchmark.GOLDEN_DIGEST, "sourceHashes": snapshot["sourceHashes"],
            "runnerHashes": runner, "runFingerprint": expected_fingerprint, "environment": environment}


def verify_result(golden, result, expected):
    if any(result.get(key) != value for key, value in expected.items()):
        raise ValueError(f"Stale or changed validation evidence: {golden['perekId']}")
    comparison = benchmark.compare(golden, result)
    if not comparison["passed"]:
        raise ValueError(f"Word comparison failed: {golden['perekId']}: {comparison['errors']}")
    return comparison


def verify_pair(golden, baseline, candidate, expected):
    verify_result(golden, baseline, expected)
    verify_result(golden, candidate, expected)
    comparison = benchmark.compare(baseline, candidate)
    if not comparison["passed"]:
        raise ValueError(f"Fresh baseline comparison failed: {golden['perekId']}")


def verify_positive_controls(snapshot, goldens, suite, final_control, recordings, runner):
    final_baseline = read_result(final_control, 338, "baseline")
    final_candidate = read_result(final_control, 338, PROFILE)
    environment = final_candidate["environment"]
    suite_metadata = expected_metadata(snapshot, ARCHIVED_RUNNER, environment)
    final_metadata = expected_metadata(snapshot, runner, environment)
    verify_pair(goldens[338], final_baseline, final_candidate, final_metadata)
    chapters = load_chapters(recite.ROOT / benchmark.TEXT)
    for result in (final_baseline, final_candidate):
        approve_alignment(result, result["diagnostics"], result["asr"], words_for(chapters[338]),
                          recordings / "338_record.mp3", goldens[338]["durationMs"])
    comparisons = []
    for pid, golden in goldens.items():
        candidate = read_result(suite, pid, PROFILE)
        comparisons.append(verify_result(golden, candidate, suite_metadata))
        approve_alignment(candidate, candidate["diagnostics"], candidate["asr"],
                          words_for(chapters[pid]), recordings / f"{pid}_record.mp3", golden["durationMs"])
    for pid in CONTROLS:
        verify_pair(goldens[pid], read_result(suite, pid, "baseline"), read_result(suite, pid, PROFILE),
                    suite_metadata)
    return comparisons, environment


def qualify(suite, final_control, held, recordings):
    from held_controls import check

    snapshot = benchmark.load_snapshot(Path(__file__).with_name("benchmarks") / "golden-2026-10-07.json.gz")
    if benchmark.digest_json(snapshot) != benchmark.GOLDEN_DIGEST:
        raise ValueError("Golden snapshot changed")
    if benchmark.source_hashes(recite.ROOT) != snapshot["sourceHashes"]:
        raise ValueError("The original fallback pipeline changed")
    goldens = {c["perekId"]: c for c in snapshot["chapters"] if c["eligible"]}
    runner = current_runner()
    comparisons, environment = verify_positive_controls(snapshot, goldens, suite, final_control, recordings, runner)
    held_evidence = check(held, recordings, environment)
    return {"name": PROFILE, "goldenDigest": benchmark.GOLDEN_DIGEST, "heldControls": held_evidence,
            "goldenChapters": len(goldens), "comparedWords": sum(c["comparedWords"] for c in comparisons),
            "maxBoundaryDriftMs": max(c["maxDriftMs"] for c in comparisons),
            "maxAcousticScoreDrift": max(c["maxAcousticScoreDrift"] for c in comparisons),
            "controls": list(CONTROLS), "suiteRunner": ARCHIVED_RUNNER,
            "finalControlRunner": runner, "environment": environment}


def validate_arguments(args):
    actual = {"version": recite.PIPELINE_VERSION, "asrModel": args.asr_model, "asrRevision": args.asr_revision,
              "alignModel": args.align_model, "alignRevision": args.align_revision,
              "minTextScore": args.min_text_score, "minAcousticScore": args.min_acoustic_score,
              "minCoverage": args.min_coverage}
    if args.device != "cuda" or actual != benchmark.SETTINGS["pipeline"] or args.force:
        raise ValueError("Validated memory profile requires the unchanged CUDA models/gates and preserves reviewed chapters")


@contextmanager
def memory_scope(profile):
    original = whisper_memory.bounded_whisper_memory
    try:
        whisper_memory.bounded_whisper_memory = lambda model: experimental_memory(model, profile)
        yield
    finally:
        whisper_memory.bounded_whisper_memory = original


def transcribe_with_fallback(original, audio, args, state):
    try:
        with memory_scope(PROFILE):
            result = original(audio, args)
        state.update(source="inference", memoryProfile=PROFILE)
        return result
    except Exception as error:
        message = str(error).lower()
        if "cuda" not in message or "out of memory" not in message:
            raise
        print("Memory profile ran out of GPU memory; retrying the original full FP32/five-beam inference", flush=True)
        result = original(audio, args)
        state.update(source="inference", memoryProfile="baseline", fallbackReason="GPU memory exhausted")
        return result


def attach_provenance(manifest, report, cache, pid, state, qualification):
    asr_path = cache / f"{pid}.asr.json"
    cached = json.loads(asr_path.read_text(encoding="utf-8"))
    if state:
        cached["executionProfile"] = deepcopy(state)
        recite.write_json(asr_path, cached)
        evidence = deepcopy(state)
    else:
        evidence = {"source": "verified-cache", "originalExecutionProfile": cached.get("executionProfile")}
    manifest["executionProfile"] = {"worker": qualification, "asr": evidence}
    diagnostic = json.loads(report.read_text(encoding="utf-8"))
    diagnostic["executionProfile"] = deepcopy(manifest["executionProfile"])
    recite.write_json(report, diagnostic)


@contextmanager
def validated_execution(qualification):
    original_transcribe, original_align = recite.transcribe, recite.align_manifest
    state = {}

    def transcribe(audio, args):
        return transcribe_with_fallback(original_transcribe, audio, args, state)

    def align_manifest(path, words, fingerprint, manifest, report, config, args):
        state.clear()
        original_align(path, words, fingerprint, manifest, report, config, args)
        attach_provenance(manifest, report, args.cache, manifest["perekId"], state, qualification)

    try:
        recite.transcribe, recite.align_manifest = transcribe, align_manifest
        yield
    finally:
        recite.transcribe, recite.align_manifest = original_transcribe, original_align


def run(profile_args):
    _, args = recite.parse_arguments()
    if profile_args.memory_profile == "baseline":
        if profile_args.check_only:
            print(json.dumps({"name": "baseline", "validationRequired": False}))
        else:
            recite.main()
        return
    validate_arguments(args)
    if not profile_args.validation or not profile_args.final_control or not profile_args.held_controls:
        raise ValueError("The complete golden suite, fresh final-source pair and held controls are required")
    qualification = qualify(profile_args.validation, profile_args.final_control, profile_args.held_controls, args.recordings)
    if profile_args.check_only:
        print(json.dumps(qualification, ensure_ascii=False, indent=2))
        return
    environment = runtime_environment()
    if environment != qualification["environment"]:
        raise ValueError("GPU/runtime environment differs from the validated evidence")
    with validated_execution(qualification):
        recite.main()


def main():
    parser = argparse.ArgumentParser(description=__doc__, add_help=False)
    parser.add_argument("--memory-profile", choices=("baseline", PROFILE), default="baseline")
    parser.add_argument("--validation", type=Path)
    parser.add_argument("--final-control", type=Path)
    parser.add_argument("--held-controls", type=Path)
    parser.add_argument("--check-only", action="store_true")
    profile_args, remaining = parser.parse_known_args()
    original_argv = sys.argv
    try:
        sys.argv = [original_argv[0], *remaining]
        run(profile_args)
    finally:
        sys.argv = original_argv


if __name__ == "__main__":
    main()
