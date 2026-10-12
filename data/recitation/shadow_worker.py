"""Explicitly qualified shadow cache, wrapping the unchanged validated worker."""

import argparse
from contextlib import contextmanager
import json
from pathlib import Path
import sys
from unittest.mock import patch

import benchmark
import cross_cache_shadow as shadow
import validated_worker


def qualify(path):
    proof = json.loads(path.read_text(encoding="utf-8"))
    if (proof.get("profile") != shadow.PROFILE or proof.get("parentProfile") != shadow.PARENT_PROFILE
            or proof.get("perekId") != 338 or proof.get("canonicalWords") != 89
            or proof.get("sourceHashes") != shadow.source_hashes()):
        raise ValueError("Shadow source, qualification scope or profile changed")
    snapshot = benchmark.load_snapshot(Path(__file__).with_name("benchmarks") / "golden-2026-10-07.json.gz")
    if benchmark.digest_json(snapshot) != benchmark.GOLDEN_DIGEST:
        raise ValueError("Golden source changed")
    golden = next(c for c in snapshot["chapters"] if c["perekId"] == 338 and c["eligible"])
    name = f"338-{shadow.PARENT_PROFILE}.json"
    base = json.loads((path.parent / "current" / name).read_text(encoding="utf-8"))
    candidate = json.loads((path.parent / "candidate" / name).read_text(encoding="utf-8"))
    runner = validated_worker.current_runner()
    fingerprint = benchmark.digest_json({"goldens": snapshot, "runner": runner, "profiles": [shadow.PARENT_PROFILE]})
    for result in (base, candidate):
        if (result.get("profile") != shadow.PARENT_PROFILE or result.get("goldenDigest") != benchmark.GOLDEN_DIGEST
                or result.get("sourceHashes") != snapshot["sourceHashes"]
                or result.get("runnerHashes") != runner or result.get("runFingerprint") != fingerprint
                or result.get("shadowSourceHashes") != proof["sourceHashes"]):
            raise ValueError("Stale shadow benchmark source/fixture/runner evidence")
    if (base.get("cacheTransferProfile") != "parent-copy-behavior"
            or candidate.get("cacheTransferProfile") != shadow.PROFILE):
        raise ValueError("Wrong shadow execution profile")
    comparisons = {"currentVsGolden": benchmark.compare(golden, base),
                   "candidateVsGolden": benchmark.compare(golden, candidate),
                   "candidateVsCurrent": benchmark.compare(base, candidate)}
    if (proof.get("passed") is not True or proof.get("comparisons") != comparisons
            or not all(c["passed"] for c in comparisons.values())
            or base["asr"] != candidate["asr"] or proof.get("exactAsr") is not True
            or base["environment"] != candidate["environment"]
            or proof.get("environment") != base["environment"]
            or candidate["measurements"]["inferenceSeconds"] >= base["measurements"]["inferenceSeconds"]
            or proof.get("counters", {}).get("reusedCrossPairs", 0) <= 0):
        raise ValueError("Shadow evidence did not reproduce its exact ASR/quality/runtime comparison")
    return proof


@contextmanager
def qualified_shadow(proof):
    original_qualify = validated_worker.qualify
    original_transcribe = validated_worker.transcribe_with_fallback
    counters = shadow.new_counters()

    def qualification(*args, **kwargs):
        parent = original_qualify(*args, **kwargs)
        if parent["environment"] != proof["environment"]:
            raise ValueError("Shadow runtime differs from the qualified parent profile")
        parent["cacheTransferQualification"] = proof
        return parent

    def transcribe(original, audio, args, state):
        for key in counters:
            counters[key] = 0
        result = original_transcribe(original, audio, args, state)
        reused = counters["reusedCrossPairs"] and state.get("memoryProfile") == shadow.PARENT_PROFILE
        state["cacheTransferProfile"] = shadow.PROFILE if reused else "parent-copy-behavior"
        state["cacheTransferCounters"] = dict(counters)
        if state.get("memoryProfile") == "baseline":
            state["cacheTransferCountersScope"] = "discarded optimized attempt before original OOM recovery"
        return result

    @contextmanager
    def memory(model, profile):
        with shadow.shadow_memory(model, profile, counters):
            yield

    with patch.object(validated_worker, "qualify", qualification), \
            patch.object(validated_worker, "experimental_memory", memory), \
            patch.object(validated_worker, "transcribe_with_fallback", transcribe):
        yield


def main():
    parser = argparse.ArgumentParser(description=__doc__, add_help=False)
    parser.add_argument("--shadow-validation", type=Path, required=True)
    args, remaining = parser.parse_known_args()
    shadow.assert_idle_processes()
    proof = qualify(args.shadow_validation)
    old_argv = sys.argv
    try:
        sys.argv = [old_argv[0], *remaining]
        with qualified_shadow(proof):
            validated_worker.main()
    finally:
        sys.argv = old_argv


if __name__ == "__main__":
    main()
