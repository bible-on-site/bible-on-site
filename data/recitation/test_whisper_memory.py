"""Numerical regression checks using a small random Whisper, without model downloads."""

import os
import unittest

try:
    import torch
    from transformers import WhisperConfig, WhisperForConditionalGeneration
except ImportError:
    torch = None

from whisper_memory import bounded_whisper_memory


@unittest.skipIf(torch is None, "Install torch and transformers to test Whisper memory handling")
class WhisperMemoryTests(unittest.TestCase):
    def compare(self, device):
        torch.manual_seed(17)
        torch.set_num_threads(2)
        config = WhisperConfig(vocab_size=64, num_mel_bins=8, d_model=16,
            encoder_layers=2, decoder_layers=2, encoder_attention_heads=2, decoder_attention_heads=2,
            encoder_ffn_dim=32, decoder_ffn_dim=32, max_source_positions=20, max_target_positions=64,
            decoder_start_token_id=1, bos_token_id=1, eos_token_id=2, pad_token_id=0,
            suppress_tokens=[], begin_suppress_tokens=[])
        model = WhisperForConditionalGeneration(config).to(device).eval()
        model.generation_config.alignment_heads = [[0, 0], [1, 1]]
        model.generation_config.no_timestamps_token_id = 60
        model.generation_config.is_multilingual = False
        features = torch.randn(1, 8, 40, device=device)
        options = dict(num_beams=5, do_sample=False, min_new_tokens=8, max_new_tokens=8,
            return_timestamps=False, return_token_timestamps=True, return_dict_in_generate=True,
            attention_mask=torch.ones(1, 40, device=device, dtype=torch.long), cache_implementation="dynamic")
        original = model._extract_token_timestamps
        observed = []
        recorder = model.model.encoder.register_forward_hook(
            lambda module, args, output: observed.append(output.get("attentions") is not None))
        with torch.inference_mode():
            baseline = model.generate(features, **options)
            with bounded_whisper_memory(model):
                bounded = model.generate(features, **options)
            self.assertEqual(model._extract_token_timestamps, original)
            self.assertNotIn("_extract_token_timestamps", model.__dict__)
            self.assertTrue(torch.equal(baseline["sequences"], bounded["sequences"]))
            self.assertTrue(torch.equal(baseline["token_timestamps"], bounded["token_timestamps"]))
            self.assertTrue(observed[0])
            self.assertFalse(observed[-1])
        recorder.remove()
        with self.assertRaisesRegex(RuntimeError, "interrupted"):
            with bounded_whisper_memory(model):
                raise RuntimeError("interrupted")
        self.assertEqual(model._extract_token_timestamps, original)
        self.assertNotIn("_extract_token_timestamps", model.__dict__)
        self.assertEqual(len(model.model.encoder._forward_pre_hooks), 0)

    def test_cpu_tokens_and_word_timestamps_are_identical(self):
        self.compare("cpu")

    @unittest.skipUnless(os.environ.get("RECITATION_TEST_CUDA") == "1", "Enable explicit CUDA validation locally")
    def test_cuda_tokens_and_word_timestamps_are_identical(self):
        self.compare("cuda")
