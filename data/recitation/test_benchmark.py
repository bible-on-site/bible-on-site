"""Fail-closed golden comparison and exact numerical memory-hook regressions."""

from copy import deepcopy
import os
import tempfile
from pathlib import Path
import unittest

import torch
from transformers import WhisperConfig, WhisperForConditionalGeneration

from benchmark import BASELINE_COMMIT, GOLDEN_DIGEST, ROOT, SETTINGS, TEXT, compare, digest_json, exclusive_run, load_snapshot, source_hashes, summary
from alignment import load_chapters, text_hash, validate_timings, words_for
from whisper_experiment import PROFILES, experimental_memory
from whisper_memory import bounded_whisper_memory


class GoldenComparisonTests(unittest.TestCase):
    def setUp(self):
        self.golden = {"perekId": 1, "audioSha256": "audio", "textSha256": "text", "audioUrl": "url",
                       "durationMs": 2000, "eligible": True,
                       "words": [{"pasuk": 1, "segment": 1, "text": "אב", "startMs": 100, "endMs": 500,
                                  "acousticScore": .8, "textScore": 1.0},
                                 {"pasuk": 2, "segment": 1, "text": "אב", "startMs": 800, "endMs": 1200,
                                  "acousticScore": .9, "textScore": 1.0}],
                       "asr": {"words": [{"text": "אב", "start": .1, "end": .5}]}}
        self.candidate = dict(deepcopy(self.golden), settings=deepcopy(SETTINGS), qualityPassed=True)

    def test_five_ms_is_inclusive_for_both_ends_and_verse_boundaries(self):
        for row in self.candidate["words"]:
            row["startMs"] -= 5
            row["endMs"] += 5
        self.candidate["asr"]["words"][0]["start"] -= .005
        result = compare(self.golden, self.candidate)
        self.assertTrue(result["passed"], result)
        self.assertEqual(result["comparedBoundaries"], 4)
        self.assertEqual(result["maxDriftMs"], 5)

    def test_one_outlier_fails_even_when_the_average_is_small(self):
        self.candidate["words"][1]["endMs"] += 6
        result = compare(self.golden, self.candidate)
        self.assertFalse(result["passed"])
        self.assertEqual(result["maxDriftMs"], 6)

    def test_missing_reordered_repeated_or_changed_text_words_fail(self):
        variants = [self.candidate["words"][:-1], self.candidate["words"][::-1],
                    [self.candidate["words"][0]] * 2]
        altered = deepcopy(self.candidate["words"])
        altered[0]["text"] = "גד"
        variants.append(altered)
        for rows in variants:
            with self.subTest(rows=rows):
                self.assertFalse(compare(self.golden, dict(self.candidate, words=rows))["passed"])

    def test_null_bool_nan_out_of_range_and_overlap_fail(self):
        for value in (None, True, float("nan"), -1, 2001):
            with self.subTest(value=value):
                changed = deepcopy(self.candidate)
                changed["words"][0]["startMs"] = value
                self.assertFalse(compare(self.golden, changed)["passed"])
        self.candidate["words"][1]["startMs"] = 499
        self.assertFalse(compare(self.golden, self.candidate)["passed"])

    def test_source_search_precision_scores_and_quality_cannot_change(self):
        for key in ("perekId", "audioSha256", "textSha256", "audioUrl", "durationMs"):
            with self.subTest(key=key):
                self.assertFalse(compare(self.golden, dict(self.candidate, **{key: "changed"}))["passed"])
        changed = deepcopy(self.candidate)
        changed["settings"]["dtype"] = "float16"
        self.assertFalse(compare(self.golden, changed)["passed"])
        changed = deepcopy(self.candidate)
        changed["words"][0]["acousticScore"] -= .0011
        self.assertFalse(compare(self.golden, changed)["passed"])
        self.assertFalse(compare(self.golden, dict(self.candidate, qualityPassed=False))["passed"])

    def test_tiny_acoustic_variation_is_per_word_and_never_relaxes_boundaries(self):
        self.candidate["words"][0]["acousticScore"] -= .001
        self.candidate["words"][1]["acousticScore"] += .001
        result = compare(self.golden, self.candidate)
        self.assertTrue(result["passed"], result)
        self.assertAlmostEqual(result["maxAcousticScoreDrift"], .001)
        self.candidate["words"][1]["endMs"] += 6
        self.assertFalse(compare(self.golden, self.candidate)["passed"])
        self.candidate["words"][1]["endMs"] -= 6
        self.candidate["words"][1]["acousticScore"] -= .01
        self.assertFalse(compare(self.golden, self.candidate)["passed"])

    def test_asr_text_count_and_boundary_are_compared_independently(self):
        for replacement in ([], [{"text": "גד", "start": .1, "end": .5}],
                            [{"text": "אב", "start": .106, "end": .5}],
                            [{"text": "אב", "start": float("nan"), "end": .5}]):
            with self.subTest(replacement=replacement):
                changed = deepcopy(self.candidate)
                changed["asr"]["words"] = replacement
                self.assertFalse(compare(self.golden, changed)["passed"])

    def test_smoke_pass_or_failed_baseline_cannot_promote(self):
        goldens = {"chapters": [self.golden, dict(self.golden, perekId=2),
                                 dict(self.golden, perekId=3, eligible=False)]}
        results = [dict(self.candidate, profile=profile,
                        comparison={"passed": profile != "baseline"},
                        measurements={"totalSeconds": 10 if profile == "baseline" else 5})
                   for profile in ("baseline", "selected-heads")]
        verdict = summary(goldens, results, ["baseline", "selected-heads"])
        candidate = verdict["profiles"]["selected-heads"]
        self.assertEqual(candidate["missing"], [2])
        self.assertFalse(candidate["baselineReproduced"])
        self.assertFalse(candidate["promotionAllowed"])
        self.assertEqual(verdict["protectedLegacyChapters"], [3])

    def test_atomic_lease_rejects_duplicate_and_cleans_up_on_failure(self):
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder)
            def fail_inside_lease():
                with exclusive_run(output):
                    with self.assertRaises(FileExistsError):
                        with exclusive_run(output):
                            self.fail("Duplicate entered")
                    raise RuntimeError("test failure")
            self.assertRaisesRegex(RuntimeError, "test failure", fail_inside_lease)
            self.assertFalse((output / "worker.lock").exists())

    def test_all_preserved_goldens_have_exact_canonical_identities_and_immutable_sources(self):
        snapshot = load_snapshot(Path(__file__).with_name("benchmarks").joinpath("golden-2026-10-07.json.gz"))
        self.assertEqual(digest_json(snapshot), GOLDEN_DIGEST)
        self.assertEqual(snapshot["baselineCommit"], BASELINE_COMMIT)
        self.assertEqual(snapshot["sourceHashes"], source_hashes(ROOT))
        self.assertEqual(snapshot["settings"], SETTINGS)
        self.assertEqual(len(snapshot["chapters"]), 54)
        self.assertEqual(sum(c["eligible"] for c in snapshot["chapters"]), 51)
        self.assertEqual(sum(len(c["words"]) for c in snapshot["chapters"]), 10370)
        chapters = load_chapters(ROOT / TEXT)
        for golden in snapshot["chapters"]:
            with self.subTest(perek=golden["perekId"]):
                canonical = words_for(chapters[golden["perekId"]])
                self.assertEqual(text_hash(canonical), golden["textSha256"])
                validate_timings(canonical, golden["words"], golden["durationMs"], require_complete=True)
                if golden["eligible"]:
                    self.assertEqual(golden["asr"]["audioSha256"], golden["audioSha256"])
                    self.assertEqual(golden["asr"]["revision"], SETTINGS["pipeline"]["asrRevision"])


class ExperimentalMemoryTests(unittest.TestCase):
    def compare_profiles(self, device):
        torch.manual_seed(17)
        torch.set_num_threads(2)
        config = WhisperConfig(vocab_size=64, num_mel_bins=8, d_model=16,
            encoder_layers=2, decoder_layers=3, encoder_attention_heads=4, decoder_attention_heads=4,
            encoder_ffn_dim=32, decoder_ffn_dim=32, max_source_positions=20, max_target_positions=64,
            decoder_start_token_id=1, bos_token_id=1, eos_token_id=2, pad_token_id=0,
            suppress_tokens=[], begin_suppress_tokens=[])
        model = WhisperForConditionalGeneration(config).to(device).eval()
        # Unused layer zero, nonascending/multiple heads and duplicate head order
        # exercise compact remapping, not just a trivial single-head model.
        model.generation_config.alignment_heads = [[2, 3], [1, 2], [1, 0], [1, 2]]
        model.generation_config.no_timestamps_token_id = 60
        model.generation_config.is_multilingual = False
        features = torch.randn(1, 8, 40, device=device)
        options = dict(num_beams=5, do_sample=False, min_new_tokens=8, max_new_tokens=8,
            return_timestamps=False, return_token_timestamps=True, return_dict_in_generate=True,
            attention_mask=torch.ones(1, 40, device=device, dtype=torch.long), cache_implementation="dynamic")
        original = model._extract_token_timestamps
        captured = []

        def capture(outputs, *args, **kwargs):
            captured.append(outputs.cross_attentions)
            return original(outputs, *args, **kwargs)

        model._extract_token_timestamps = capture
        with torch.inference_mode(), bounded_whisper_memory(model):
            baseline = model.generate(features, **options)
        baseline_maps = captured[-1]
        hook_sets = {module: (set(module._forward_pre_hooks), set(module._forward_hooks))
                     for module in model.modules()}
        for profile in PROFILES:
            with self.subTest(profile=profile, device=device):
                with torch.inference_mode(), experimental_memory(model, profile):
                    candidate = model.generate(features, **options)
                self.assertTrue(torch.equal(baseline["sequences"], candidate["sequences"]))
                self.assertTrue(torch.equal(baseline["token_timestamps"], candidate["token_timestamps"]))
                if profile.startswith("selected-heads"):
                    for base_step, compact_step in zip(baseline_maps, captured[-1], strict=True):
                        for layer, head, compact_head in ((2, 3, 0), (1, 2, 0), (1, 0, 1)):
                            self.assertTrue(torch.equal(base_step[layer][:, head], compact_step[layer][:, compact_head]))
                self.assertEqual(model._extract_token_timestamps, capture)
                def fail_inside_profile():
                    with experimental_memory(model, profile):
                        raise RuntimeError("interrupted")
                self.assertRaisesRegex(RuntimeError, "interrupted", fail_inside_profile)
                for module in model.modules():
                    self.assertEqual(set(module._forward_pre_hooks), hook_sets[module][0])
                    self.assertEqual(set(module._forward_hooks), hook_sets[module][1])
                self.assertEqual(model._extract_token_timestamps, capture)
        del model._extract_token_timestamps
        self.assertEqual(model._extract_token_timestamps, original)
        self.assertNotIn("_extract_token_timestamps", model.__dict__)

    def test_cpu_full_search_tokens_timestamps_and_selected_maps_are_exact(self):
        self.compare_profiles("cpu")

    @unittest.skipUnless(os.environ.get("RECITATION_TEST_CUDA") == "1", "Explicit local CUDA validation")
    def test_cuda_full_search_tokens_timestamps_and_selected_maps_are_exact(self):
        self.compare_profiles("cuda")


if __name__ == "__main__":
    unittest.main()
