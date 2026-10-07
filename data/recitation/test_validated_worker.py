"""No incomplete proof, lost rejection, provenance claim or degraded fallback."""

from copy import deepcopy
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import benchmark
import held_controls
import recite
import validated_worker as worker
import whisper_memory


class QualificationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.snapshot = benchmark.load_snapshot(Path(worker.__file__).with_name("benchmarks") / "golden-2026-10-07.json.gz")
        cls.goldens = {c["perekId"]: c for c in cls.snapshot["chapters"] if c["eligible"]}
        cls.environment = {"device": "validated CUDA", "cuda": "12.6"}
        cls.runner = worker.current_runner()
        cls.metadata = {
            "suite": worker.expected_metadata(cls.snapshot, worker.ARCHIVED_RUNNER, cls.environment),
            "final": worker.expected_metadata(cls.snapshot, cls.runner, cls.environment),
        }

    def result(self, directory, pid, profile):
        return dict(deepcopy(self.goldens[pid]), settings=deepcopy(benchmark.SETTINGS),
                    qualityPassed=True, profile=profile, diagnostics={}, **deepcopy(self.metadata[str(directory)]))

    def qualification(self, reader):
        with patch.object(worker, "read_result", side_effect=reader), \
                patch.object(worker, "approve_alignment") as approval, \
                patch.object(held_controls, "check", return_value={"digest": held_controls.DIGEST, "chapters": [102, 783, 765]}):
            result = worker.qualify(Path("suite"), Path("final"), Path("held"), Path("recordings"))
            self.assertEqual(approval.call_count, 53)
            return result

    def test_all_51_words_controls_and_current_source_required(self):
        proof = self.qualification(self.result)
        self.assertEqual(proof["goldenChapters"], 51)
        self.assertEqual(proof["comparedWords"], 10214)
        self.assertEqual(proof["maxBoundaryDriftMs"], 0)

    def test_missing_chapter_blocks_activation(self):
        missing = Mock(side_effect=FileNotFoundError("Not yet complete"))
        with self.assertRaises(FileNotFoundError):
            self.qualification(missing)
        missing.assert_called_once()

    def test_one_6ms_boundary_among_51_blocks_activation(self):
        def drift(directory, pid, profile):
            result = self.result(directory, pid, profile)
            if str(directory) == "suite" and pid == 826:
                result["words"][0]["endMs"] += 6
            return result

        with self.assertRaisesRegex(ValueError, "Word comparison failed"):
            self.qualification(drift)

    def test_stale_final_source_blocks_activation(self):
        result = self.result(Path("final"), 338, worker.PROFILE)
        result["runnerHashes"]["experiment"] = "old"
        with self.assertRaisesRegex(ValueError, "Stale"):
            worker.verify_result(self.goldens[338], result, self.metadata["final"])

    def test_original_quality_gates_are_rechecked(self):
        with patch.object(worker, "read_result", side_effect=self.result), \
                patch.object(worker, "approve_alignment", side_effect=ValueError("unsupported anchor")) as approval:
            with self.assertRaisesRegex(ValueError, "unsupported anchor"):
                worker.qualify(Path("suite"), Path("final"), Path("held"), Path("recordings"))
            approval.assert_called_once()


class FallbackTests(unittest.TestCase):
    def test_cuda_oom_retries_original_without_changing_arguments(self):
        args, audio, state = object(), object(), {}
        original_memory = whisper_memory.bounded_whisper_memory
        seen = []

        def original(actual_audio, actual_args):
            self.assertIs(actual_audio, audio)
            self.assertIs(actual_args, args)
            seen.append(whisper_memory.bounded_whisper_memory)
            if len(seen) == 1:
                raise RuntimeError("CUDA out of memory")
            return [{"text": "אב", "start": .1, "end": .5}]

        result = worker.transcribe_with_fallback(original, audio, args, state)
        self.assertEqual(result[0]["text"], "אב")
        self.assertIsNot(seen[0], original_memory)
        self.assertIs(seen[1], original_memory)
        self.assertIs(whisper_memory.bounded_whisper_memory, original_memory)
        self.assertEqual(state["memoryProfile"], "baseline")

    def test_driver_or_other_failure_is_not_hidden_by_a_retry(self):
        original = Mock(side_effect=RuntimeError("CUDA driver reset"))
        original_memory = whisper_memory.bounded_whisper_memory
        with self.assertRaisesRegex(RuntimeError, "driver reset"):
            worker.transcribe_with_fallback(original, object(), object(), {})
        original.assert_called_once()
        self.assertIs(whisper_memory.bounded_whisper_memory, original_memory)

    def test_default_path_calls_only_original_worker(self):
        options = SimpleNamespace(memory_profile="baseline", check_only=False)
        with patch.object(recite, "parse_arguments", return_value=(None, None)), \
                patch.object(recite, "main") as original, patch.object(worker, "qualify") as qualify:
            worker.run(options)
            original.assert_called_once_with()
            qualify.assert_not_called()

    def test_modified_models_thresholds_cpu_or_force_are_rejected(self):
        pipeline = benchmark.SETTINGS["pipeline"]
        args = SimpleNamespace(device="cuda", force=False, asr_model=pipeline["asrModel"],
                               asr_revision=pipeline["asrRevision"], align_model=pipeline["alignModel"],
                               align_revision=pipeline["alignRevision"], min_text_score=.6,
                               min_acoustic_score=.5, min_coverage=.85)
        worker.validate_arguments(args)
        for key, value in (("device", "cpu"), ("force", True), ("asr_model", "small"), ("min_coverage", .8)):
            changed = deepcopy(args)
            setattr(changed, key, value)
            with self.subTest(key=key), self.assertRaises(ValueError):
                worker.validate_arguments(changed)

    def test_cached_asr_does_not_claim_optimized_inference(self):
        with tempfile.TemporaryDirectory() as folder:
            cache = Path(folder)
            recite.write_json(cache / "1.asr.json", {"words": []})
            recite.write_json(cache / "1.review.json", {"review": []})
            manifest = {"perekId": 1}
            worker.attach_provenance(manifest, cache / "1.review.json", cache, 1, {}, {"name": worker.PROFILE})
            self.assertEqual(manifest["executionProfile"]["asr"],
                             {"source": "verified-cache", "originalExecutionProfile": None})
            self.assertEqual(json.loads((cache / "1.review.json").read_text(encoding="utf-8"))["review"], [])


class HeldControlTests(unittest.TestCase):
    def test_real_held_fixture_preserves_missing_intervals(self):
        fixture = held_controls.load_fixture()
        self.assertEqual([c["perekId"] for c in fixture["chapters"]], [102, 783, 765])
        for golden in fixture["chapters"]:
            result = dict(deepcopy(golden), qualityPassed=False, qualityError=golden["expectedRejection"])
            self.assertTrue(held_controls.compare(golden, result)["passed"])
            self.assertTrue(any(row["startMs"] is None for row in golden["words"]))
            index = next(i for i, row in enumerate(result["words"]) if row["startMs"] is None)
            result["words"][index]["startMs"] = 100
            self.assertFalse(held_controls.compare(golden, result)["passed"])

    def test_held_case_cannot_turn_into_approval(self):
        golden = held_controls.load_fixture()["chapters"][0]
        result = dict(deepcopy(golden), qualityPassed=True, qualityError=None)
        self.assertFalse(held_controls.compare(golden, result)["passed"])


if __name__ == "__main__":
    unittest.main()
