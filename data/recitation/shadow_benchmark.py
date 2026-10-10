"""Fresh one-chapter A/B qualification, isolated from the collection checkpoint."""

import argparse
from contextlib import contextmanager
import json
from pathlib import Path
from unittest.mock import patch

import benchmark
import cross_cache_shadow as shadow
from recite import write_json


def run(recordings, output):
    shadow.assert_idle_processes()
    snapshot = benchmark.load_snapshot(Path(__file__).with_name("benchmarks") / "golden-2026-10-07.json.gz")
    golden = next(c for c in snapshot["chapters"] if c["perekId"] == 338 and c["eligible"])
    hashes = shadow.source_hashes()
    benchmark.run(snapshot, recordings, output / "current", [shadow.PARENT_PROFILE], [338])
    counters = shadow.new_counters()

    @contextmanager
    def candidate_memory(model, profile):
        with shadow.shadow_memory(model, profile, counters):
            yield

    with patch.object(benchmark, "experimental_memory", candidate_memory):
        benchmark.run(snapshot, recordings, output / "candidate", [shadow.PARENT_PROFILE], [338])
    name = f"338-{shadow.PARENT_PROFILE}.json"
    base = json.loads((output / "current" / name).read_text(encoding="utf-8"))
    candidate = json.loads((output / "candidate" / name).read_text(encoding="utf-8"))
    for label, result in (("current", base), ("candidate", candidate)):
        result["shadowSourceHashes"] = hashes
        result["cacheTransferProfile"] = shadow.PROFILE if label == "candidate" else "parent-copy-behavior"
        write_json(output / label / name, result)
    # Require a contemporaneous exact ASR replay as well as the stored golden.
    comparisons = {"currentVsGolden": benchmark.compare(golden, base),
                   "candidateVsGolden": benchmark.compare(golden, candidate),
                   "candidateVsCurrent": benchmark.compare(base, candidate)}
    asr_exact = base["asr"] == candidate["asr"]
    same_runtime = base["environment"] == candidate["environment"]
    base_seconds = base["measurements"]["inferenceSeconds"]
    candidate_seconds = candidate["measurements"]["inferenceSeconds"]
    passed = (all(c["passed"] for c in comparisons.values()) and asr_exact and same_runtime
              and hashes == shadow.source_hashes() and counters["reusedCrossPairs"] > 0
              and candidate_seconds < base_seconds)
    proof = {"profile": shadow.PROFILE, "parentProfile": shadow.PARENT_PROFILE,
             "scope": "one fresh GPU golden chapter explicitly authorized by the user on 2026-10-09",
             "perekId": 338, "canonicalWords": len(golden["words"]), "sourceHashes": hashes,
             "environment": base["environment"], "comparisons": comparisons,
             "exactAsr": asr_exact, "currentInferenceSeconds": base_seconds,
             "candidateInferenceSeconds": candidate_seconds,
             "inferenceReductionPercent": 100 * (1 - candidate_seconds / base_seconds),
             "counters": counters, "passed": passed, "productionActivated": False}
    write_json(output / "qualification.json", proof)
    print(json.dumps(proof, indent=2), flush=True)
    if not passed:
        raise ValueError("The shadow cache was not qualified; resume the existing selected profile")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--recordings", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    run(args.recordings, args.output)
