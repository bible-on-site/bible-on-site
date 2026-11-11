"""Exercise CUDA dispatch and pinned model loading without GPU dependencies."""

from dataclasses import FrozenInstanceError
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch

from devops.transcription.model import (
    DEFAULT_MODEL,
    DEFAULT_REVISION,
    LocalTranscriber,
    ModelConfig,
    Segment,
)


class ModelConfigTests(unittest.TestCase):
    """Configuration never silently selects a device, model or precision."""

    def test_defaults_are_frozen_and_pinned(self):
        config = ModelConfig()
        self.assertEqual(config.model, DEFAULT_MODEL)
        self.assertEqual(config.revision, DEFAULT_REVISION)
        self.assertEqual(config.language, "he")
        self.assertEqual(config.compute_type, "float16")
        with self.assertRaises(FrozenInstanceError):
            config.language = "en"

    def test_invalid_configuration_is_rejected(self):
        cases = [
            {"model": "large-v3"},
            {"model": "https://host/model"},
            {"model": "../model"},
            {"revision": "main"},
            {"revision": "A" * 40},
            {"model": "other/model"},
            {"language": ""},
            {"language": "Hebrew"},
            {"device_index": -1},
            {"device_index": True},
            {"device_index": 1.2},
            {"compute_type": "auto"},
            {"compute_type": "default"},
            {"beam_size": 0},
            {"beam_size": True},
            {"beam_size": 1.5},
        ]
        for kwargs in cases:
            with self.subTest(kwargs=kwargs), self.assertRaises(ValueError):
                ModelConfig(**kwargs)

    def test_custom_revision_and_language_detection_are_explicit(self):
        config = ModelConfig(model="other/model", revision="1" * 40, language="auto", compute_type="int8_float16")
        self.assertEqual(config.revision, "1" * 40)
        self.assertEqual(config.language, "auto")


class LocalTranscriberTests(unittest.TestCase):
    """Only local CUDA inference runs, and incomplete generators never succeed."""

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.snapshot = Path(self.directory.name)
        for filename in ("config.json", "model.bin", "tokenizer.json"):
            (self.snapshot / filename).write_bytes(b"fixture")
        self.engine = MagicMock()
        self.info = SimpleNamespace(language="he", language_probability=0.99, duration=12.5)
        self.recognized = [
            SimpleNamespace(start=0.0, end=2.0, text=" שלום עולם"),
            SimpleNamespace(start=3.0, end=5.0, text=" תנ״ך"),
        ]
        self.engine.transcribe.return_value = (iter(self.recognized), self.info)
        self.ctranslate = SimpleNamespace(
            get_cuda_device_count=MagicMock(return_value=1),
            get_supported_compute_types=MagicMock(return_value={"float16", "float32", "int8_float16"}),
            __version__="ct2-test",
        )
        self.whisper = SimpleNamespace(WhisperModel=MagicMock(return_value=self.engine), __version__="whisper-test")
        self.hub = SimpleNamespace(snapshot_download=MagicMock(return_value=str(self.snapshot)))
        patcher = patch.dict(sys.modules, {
            "ctranslate2": self.ctranslate,
            "faster_whisper": self.whisper,
            "huggingface_hub": self.hub,
        })
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_constructor_does_not_load_or_download_model(self):
        LocalTranscriber(ModelConfig())
        self.ctranslate.get_cuda_device_count.assert_not_called()
        self.hub.snapshot_download.assert_not_called()
        self.whisper.WhisperModel.assert_not_called()

    def test_pinned_snapshot_and_cuda_settings_are_forwarded(self):
        config = ModelConfig(model_cache="chosen-cache", local_files_only=True)
        result = LocalTranscriber(config).transcribe(Path("recording.mp3"))
        self.hub.snapshot_download.assert_called_once_with(
            DEFAULT_MODEL,
            revision=DEFAULT_REVISION,
            allow_patterns=["config.json", "preprocessor_config.json", "model.bin", "tokenizer.json", "vocabulary.*"],
            cache_dir="chosen-cache",
            local_files_only=True,
        )
        self.ctranslate.get_supported_compute_types.assert_called_once_with("cuda", 0)
        self.whisper.WhisperModel.assert_called_once_with(
            str(self.snapshot), device="cuda", device_index=0, compute_type="float16", local_files_only=True,
        )
        self.engine.transcribe.assert_called_once_with(
            "recording.mp3", language="he", task="transcribe", beam_size=5, temperature=0.0,
            vad_filter=True, word_timestamps=False, condition_on_previous_text=False,
        )
        self.assertEqual(result.segments, (Segment(0.0, 2.0, " שלום עולם"), Segment(3.0, 5.0, " תנ״ך")))
        self.assertEqual(result.duration, 12.5)
        self.assertEqual(result.language, "he")
        self.assertEqual(result.language_probability, 0.99)
        self.assertEqual(result.model["revision"], DEFAULT_REVISION)
        self.assertEqual(result.model["device"], "cuda")
        self.assertEqual(result.model["runtime_versions"], {"ctranslate2": "ct2-test", "faster_whisper": "whisper-test"})

    def test_no_gpu_fails_before_any_download(self):
        self.ctranslate.get_cuda_device_count.return_value = 0
        with self.assertRaisesRegex(RuntimeError, "no CPU fallback"):
            LocalTranscriber(ModelConfig()).transcribe(Path("recording.mp3"))
        self.hub.snapshot_download.assert_not_called()
        self.whisper.WhisperModel.assert_not_called()

    def test_selected_gpu_must_exist(self):
        with self.assertRaisesRegex(RuntimeError, "CUDA device 1 is unavailable"):
            LocalTranscriber(ModelConfig(device_index=1)).transcribe(Path("recording.mp3"))
        self.hub.snapshot_download.assert_not_called()

    def test_precision_is_never_silently_changed(self):
        self.ctranslate.get_supported_compute_types.return_value = {"int8_float16"}
        with self.assertRaisesRegex(RuntimeError, "precision is never changed automatically"):
            LocalTranscriber(ModelConfig()).transcribe(Path("recording.mp3"))
        self.hub.snapshot_download.assert_not_called()

    def test_cuda_initialization_failure_has_actionable_error(self):
        self.ctranslate.get_cuda_device_count.side_effect = OSError("driver unavailable")
        with self.assertRaisesRegex(RuntimeError, "Check the NVIDIA driver"):
            LocalTranscriber(ModelConfig()).transcribe(Path("recording.mp3"))
        self.hub.snapshot_download.assert_not_called()

    def test_missing_cuda_dependency_has_install_guidance(self):
        with patch.dict(sys.modules, {"ctranslate2": None}):
            with self.assertRaisesRegex(RuntimeError, "CUDA 12/cuDNN 9"):
                LocalTranscriber(ModelConfig()).transcribe(Path("recording.mp3"))
        self.hub.snapshot_download.assert_not_called()

    def test_missing_whisper_dependency_has_install_guidance(self):
        for package in ("faster_whisper", "huggingface_hub"):
            with self.subTest(package=package), patch.dict(sys.modules, {package: None}):
                with self.assertRaisesRegex(RuntimeError, "requirements.txt"):
                    LocalTranscriber(ModelConfig()).transcribe(Path("recording.mp3"))
        self.hub.snapshot_download.assert_not_called()

    def test_missing_tokenizer_cannot_fetch_unpinned_fallback(self):
        (self.snapshot / "tokenizer.json").unlink()
        with self.assertRaisesRegex(RuntimeError, "missing tokenizer.json"):
            LocalTranscriber(ModelConfig()).transcribe(Path("recording.mp3"))
        self.whisper.WhisperModel.assert_not_called()

    def test_download_failure_does_not_start_inference(self):
        self.hub.snapshot_download.side_effect = RuntimeError("snapshot not cached")
        with self.assertRaisesRegex(RuntimeError, "snapshot not cached"):
            LocalTranscriber(ModelConfig(local_files_only=True)).transcribe(Path("recording.mp3"))
        self.whisper.WhisperModel.assert_not_called()

    def test_language_detection_and_custom_gpu_configuration_are_forwarded(self):
        self.ctranslate.get_cuda_device_count.return_value = 3
        config = ModelConfig(language="auto", device_index=2, compute_type="int8_float16", beam_size=7)
        result = LocalTranscriber(config).transcribe(Path("video.mp4"))
        self.engine.transcribe.assert_called_once_with(
            "video.mp4", language=None, task="transcribe", beam_size=7, temperature=0.0,
            vad_filter=True, word_timestamps=False, condition_on_previous_text=False,
        )
        self.assertIsNone(result.model["language"])
        self.assertEqual(result.model["compute_type"], "int8_float16")
        self.ctranslate.get_supported_compute_types.assert_called_once_with("cuda", 2)

    def test_model_is_reused_for_multiple_recordings(self):
        transcriber = LocalTranscriber(ModelConfig())
        transcriber.transcribe(Path("first.mp3"))
        self.engine.transcribe.return_value = (iter(self.recognized), self.info)
        transcriber.transcribe(Path("second.mp3"))
        self.whisper.WhisperModel.assert_called_once()
        self.hub.snapshot_download.assert_called_once()
        self.assertEqual(self.engine.transcribe.call_count, 2)

    def test_generator_failure_never_returns_partial_transcript(self):
        def failing_segments():
            yield self.recognized[0]
            raise RuntimeError("CUDA out of memory")

        self.engine.transcribe.return_value = (failing_segments(), self.info)
        with self.assertRaisesRegex(RuntimeError, "CUDA out of memory"):
            LocalTranscriber(ModelConfig()).transcribe(Path("recording.mp3"))
        self.whisper.WhisperModel.assert_called_once()

    def test_no_speech_returns_empty_result_for_pipeline_to_reject(self):
        self.engine.transcribe.return_value = (iter(()), self.info)
        result = LocalTranscriber(ModelConfig()).transcribe(Path("silence.wav"))
        self.assertEqual(result.segments, ())
        self.assertEqual(result.duration, 12.5)

    def test_progress_log_does_not_disclose_recognized_text(self):
        with self.assertLogs("devops.transcription.model", level="INFO") as logs:
            LocalTranscriber(ModelConfig()).transcribe(Path("recording.mp3"))
        self.assertTrue(any("Transcribed 5.0 / 12.5 seconds" in line for line in logs.output))
        self.assertFalse(any("שלום" in line or "תנ״ך" in line for line in logs.output))


if __name__ == "__main__":
    unittest.main()
