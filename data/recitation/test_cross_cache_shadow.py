"""Exact numerical search/timestamp checks and cache mutation recovery guards."""

import os
from copy import deepcopy
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import torch
from transformers import WhisperConfig, WhisperForConditionalGeneration
import cross_cache_shadow as shadow
from whisper_experiment import experimental_memory
import benchmark
import shadow_worker
import validated_worker


class ShadowCacheTests(unittest.TestCase):
    def compare(self, device, seed, inference=False):
        torch.manual_seed(seed)
        torch.set_num_threads(2)
        config = WhisperConfig(vocab_size=64, num_mel_bins=8, d_model=16,
            encoder_layers=2, decoder_layers=3, encoder_attention_heads=4, decoder_attention_heads=4,
            encoder_ffn_dim=32, decoder_ffn_dim=32, max_source_positions=20, max_target_positions=64,
            decoder_start_token_id=1, bos_token_id=1, eos_token_id=2, pad_token_id=0,
            suppress_tokens=[], begin_suppress_tokens=[])
        model = WhisperForConditionalGeneration(config).to(device).eval()
        model.generation_config.alignment_heads = [[2, 3], [1, 2], [1, 0], [1, 2]]
        model.generation_config.no_timestamps_token_id = 60
        model.generation_config.is_multilingual = False
        features = torch.randn(1, 8, 40, device=device)
        options = dict(num_beams=5, do_sample=False, min_new_tokens=24, max_new_tokens=24,
            return_timestamps=False, return_token_timestamps=True, return_dict_in_generate=True,
            attention_mask=torch.ones(1, 40, dtype=torch.long, device=device), cache_implementation="dynamic")
        captured, logits = [], []
        original = model._extract_token_timestamps

        def capture(outputs, *args, **kwargs):
            captured.append(outputs.cross_attentions)
            return original(outputs, *args, **kwargs)

        model._extract_token_timestamps = capture
        recorder = model.register_forward_hook(
            lambda module, args, output: logits.append(output["logits"].detach().cpu().clone()))
        counters = shadow.new_counters()
        context = torch.inference_mode if inference else torch.no_grad
        with context(), experimental_memory(model, shadow.PARENT_PROFILE):
            baseline = model.generate(features, **options)
        n = len(logits)
        hooks = {m: (set(m._forward_pre_hooks), set(m._forward_hooks)) for m in model.modules()}
        with context(), shadow.shadow_memory(model, counters=counters):
            trial = model.generate(features, **options)
        self.assertTrue(torch.equal(baseline["sequences"], trial["sequences"]))
        self.assertTrue(torch.equal(baseline["token_timestamps"], trial["token_timestamps"]))
        self.assertGreater(n, 0)
        self.assertTrue(all(torch.equal(a, b) for a, b in zip(logits[:n], logits[n:], strict=True)))
        self.assertTrue(all(torch.equal(a, b) for xs, ys in zip(*captured, strict=True)
                            for a, b in zip(xs, ys, strict=True)))
        if inference:
            self.assertEqual(counters["reusedCrossPairs"], 0)
        else:
            self.assertGreater(counters["reusedCrossPairs"], 0)
            self.assertGreater(counters["avoidedReturnBytes"], 0)
        for module, expected in hooks.items():
            self.assertEqual((set(module._forward_pre_hooks), set(module._forward_hooks)), expected)
        with self.assertRaisesRegex(RuntimeError, "interrupt"):
            with shadow.shadow_memory(model):
                raise RuntimeError("interrupt")
        for module, expected in hooks.items():
            self.assertEqual((set(module._forward_pre_hooks), set(module._forward_hooks)), expected)
        recorder.remove()

    def test_cpu_exact_tokens_logits_timestamps_and_maps_three_seeds(self):
        for seed in (17, 29, 43):
            with self.subTest(seed=seed):
                self.compare("cpu", seed)

    def test_inference_mode_without_mutation_versions_uses_original_behavior(self):
        self.compare("cpu", 17, True)

    @unittest.skipUnless(os.environ.get("RECITATION_TEST_CUDA") == "1", "Explicit exclusive GPU qualification")
    def test_cuda_exact_tokens_logits_timestamps_and_maps_three_seeds(self):
        for seed in (17, 29, 43):
            with self.subTest(seed=seed):
                self.compare("cuda", seed)

    def test_changed_caches_and_first_forward_preserve_original_copy(self):
        for kind in ("inplace", "replacement", "hostMutation", "isUpdatedFalse"):
            with self.subTest(kind=kind):
                counters = shadow.new_counters()
                before, after = shadow.shadow_hooks(counters)
                layer = SimpleNamespace(keys=torch.ones(5, 4, 20, 4),
                    values=torch.ones(5, 4, 20, 4), is_initialized=True)
                module = torch.nn.Linear(4, 4)
                module.layer_idx = 0
                module.q_proj = SimpleNamespace(weight=module.weight)
                cache = SimpleNamespace(cross_attention_cache=SimpleNamespace(layers=[layer]),
                    is_updated={0: kind != "isUpdatedFalse"})
                kwargs = {"past_key_values": cache, "key_value_states": torch.ones(1)}
                host = layer.keys
                before(module, (), kwargs)
                if kind == "inplace":
                    layer.keys.add_(1)
                elif kind == "replacement":
                    layer.keys = layer.keys + 1
                elif kind == "hostMutation":
                    host.add_(1)
                after(module, (), kwargs, None)
                self.assertEqual(counters["reusedCrossPairs"], 0)
                self.assertEqual(counters["baselineOffloads"], 1)
                if kind != "isUpdatedFalse":
                    self.assertTrue(torch.equal(layer.keys, torch.full_like(layer.keys, 2)))


class ShadowQualificationTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        snapshot = benchmark.load_snapshot(Path(__file__).with_name("benchmarks") / "golden-2026-10-07.json.gz")
        self.golden = next(c for c in snapshot["chapters"] if c["perekId"] == 338)
        hashes = shadow.source_hashes()
        runner = validated_worker.current_runner()
        fingerprint = benchmark.digest_json(
            {"goldens": snapshot, "runner": runner, "profiles": [shadow.PARENT_PROFILE]})
        base = dict(deepcopy(self.golden), settings=benchmark.SETTINGS, qualityPassed=True,
                    profile=shadow.PARENT_PROFILE, sourceHashes=snapshot["sourceHashes"],
                    runnerHashes=runner, runFingerprint=fingerprint, goldenDigest=benchmark.GOLDEN_DIGEST,
                    environment={"testFixture": True}, shadowSourceHashes=hashes,
                    cacheTransferProfile="parent-copy-behavior", measurements={"inferenceSeconds": 10.0})
        candidate = deepcopy(base)
        candidate["cacheTransferProfile"] = shadow.PROFILE
        candidate["measurements"]["inferenceSeconds"] = 9.0
        self.base, self.candidate = base, candidate
        self.proof = {"profile": shadow.PROFILE, "parentProfile": shadow.PARENT_PROFILE,
            "perekId": 338, "canonicalWords": 89, "sourceHashes": hashes, "passed": True,
            "exactAsr": True, "environment": base["environment"], "counters": {"reusedCrossPairs": 1}}
        self.path = self.root / "qualification.json"

    def save(self):
        self.proof["comparisons"] = {"currentVsGolden": benchmark.compare(self.golden, self.base),
            "candidateVsGolden": benchmark.compare(self.golden, self.candidate),
            "candidateVsCurrent": benchmark.compare(self.base, self.candidate)}
        for label, value in (("current", self.base), ("candidate", self.candidate)):
            directory = self.root / label
            directory.mkdir(exist_ok=True)
            (directory / f"338-{shadow.PARENT_PROFILE}.json").write_text(json.dumps(value), encoding="utf-8")
        self.path.write_text(json.dumps(self.proof), encoding="utf-8")

    def test_complete_fixture_qualifies_without_claiming_gpu_execution(self):
        self.save()
        self.assertEqual(shadow_worker.qualify(self.path), self.proof)

    def test_quality_source_asr_runtime_and_speed_fail_closed(self):
        changes = {
            "boundary": lambda: self.candidate["words"][0].update(
                startMs=self.candidate["words"][0]["startMs"] + 6),
            "score": lambda: self.candidate["words"][0].update(acousticScore=self.candidate["words"][0]["acousticScore"] - .002),
            "asr": lambda: self.candidate["asr"]["words"][0].update(text="changed"),
            "runtime": lambda: self.candidate["environment"].update(changed=True),
            "source": lambda: self.candidate["shadowSourceHashes"].update(changed="changed"),
            "runner": lambda: self.candidate["runnerHashes"].update(benchmark="changed"),
            "speed": lambda: self.candidate["measurements"].update(inferenceSeconds=11.0),
            "scope": lambda: self.proof.update(canonicalWords=90),
            "cacheReuse": lambda: self.proof["counters"].update(reusedCrossPairs=0),
        }
        original = deepcopy((self.base, self.candidate, self.proof))
        for name, change in changes.items():
            with self.subTest(name=name):
                self.base, self.candidate, self.proof = deepcopy(original)
                change()
                self.save()
                with self.assertRaises(ValueError):
                    shadow_worker.qualify(self.path)

    def test_oom_recovery_keeps_baseline_provenance(self):
        def parent(original, audio, args, state):
            with validated_worker.experimental_memory(None, shadow.PARENT_PROFILE):
                pass
            state.update(source="inference", memoryProfile="baseline", fallbackReason="GPU memory exhausted")
            return "recovered"

        from contextlib import contextmanager

        @contextmanager
        def attempted(model, profile, counters):
            counters["reusedCrossPairs"] += 1
            yield

        with patch.object(validated_worker, "transcribe_with_fallback", parent), \
                patch.object(shadow, "shadow_memory", attempted):
            with shadow_worker.qualified_shadow(self.proof):
                state = {}
                result = validated_worker.transcribe_with_fallback(None, None, None, state)
        self.assertEqual(result, "recovered")
        self.assertEqual(state["memoryProfile"], "baseline")
        self.assertEqual(state["cacheTransferProfile"], "parent-copy-behavior")
        self.assertIn("discarded", state["cacheTransferCountersScope"])


if __name__ == "__main__":
    unittest.main()
