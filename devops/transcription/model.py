"""Pinned local CUDA speech recognition without cloud inference or fallback."""

from dataclasses import dataclass
import logging
from pathlib import Path
import re

from .audio import decode_media


DEFAULT_MODEL = "ivrit-ai/whisper-large-v3-ct2"
DEFAULT_REVISION = "e9ed4a4a98d761b0f617d668303de2c514236c66"
_MODEL_FILES = [
    "config.json",
    "preprocessor_config.json",
    "model.bin",
    "tokenizer.json",
    "vocabulary.*",
]
_LOGGER = logging.getLogger(__name__)


@dataclass(frozen=True)
class ModelConfig:
    """An explicit reproducible model and GPU configuration."""

    model: str = DEFAULT_MODEL
    revision: str = DEFAULT_REVISION
    language: str = "he"
    device_index: int = 0
    compute_type: str = "float32"
    beam_size: int = 5
    random_seed: int = 0
    decoding_mode: str = "fallback"
    local_files_only: bool = False
    model_cache: str | None = None
    audio_stream: int | None = None

    def __post_init__(self) -> None:
        """Reject mutable revisions and implicit compute/device selection."""
        if not re.fullmatch(r"[\w.-]+/[\w.-]+", self.model, flags=re.ASCII):
            raise ValueError("Model must be a Hugging Face owner/model ID.")
        if not re.fullmatch(r"[0-9a-f]{40}", self.revision):
            raise ValueError("Model revision must be an exact lowercase 40-character commit SHA.")
        if self.model != DEFAULT_MODEL and self.revision == DEFAULT_REVISION:
            raise ValueError("A custom model requires its own explicit --model-revision commit SHA.")
        if self.language != "auto" and not re.fullmatch(r"[a-z]{2,3}", self.language):
            raise ValueError("Language must be a lowercase language code or 'auto'.")
        if isinstance(self.device_index, bool) or not isinstance(self.device_index, int) or self.device_index < 0:
            raise ValueError("CUDA device index must be a nonnegative integer.")
        if self.compute_type not in {"float16", "float32", "int8_float16", "int8_float32"}:
            raise ValueError("Choose an explicit CUDA compute type: float16, float32, int8_float16 or int8_float32.")
        if isinstance(self.beam_size, bool) or not isinstance(self.beam_size, int) or self.beam_size < 1:
            raise ValueError("Beam size must be a positive integer.")
        if (isinstance(self.random_seed, bool) or not isinstance(self.random_seed, int)
                or not 0 <= self.random_seed < 2**32 - 1):
            raise ValueError("Random seed must be an integer from 0 to 4294967294.")
        if self.decoding_mode not in {"fallback", "beam"}:
            raise ValueError("Decoding mode must be fallback or beam.")
        if self.audio_stream is not None and (
            isinstance(self.audio_stream, bool)
            or not isinstance(self.audio_stream, int)
            or self.audio_stream < 0
        ):
            raise ValueError("Audio stream must be a nonnegative integer.")


@dataclass(frozen=True)
class Segment:
    """Unmodified recognized text with source audio timestamps in seconds."""

    start: float
    end: float
    text: str


@dataclass(frozen=True)
class Transcript:
    """Recognition result and the exact inference settings that produced it."""

    segments: tuple[Segment, ...]
    language: str
    language_probability: float
    duration: float
    model: dict[str, object]


class LocalTranscriber:
    """Load one pinned model and execute transcription on the selected GPU."""

    def __init__(self, config: ModelConfig) -> None:
        """Defer dependency imports and model loading until inference is requested."""
        self.config = config
        self._model = None
        self._runtime_versions: dict[str, str] = {}

    def _load(self) -> None:
        """Check the CUDA device before fetching or loading model weights."""
        try:
            import ctranslate2
        except (ImportError, OSError) as error:
            raise RuntimeError(
                "Install the transcription runtime and compatible CUDA 12/cuDNN 9 libraries; "
                "CTranslate2 could not be imported. See devops/transcription/README.md."
            ) from error
        try:
            # Native worker RNGs initialize once; seed before creating CUDA/model workers.
            # Repeated calls on an already-loaded engine consume that RNG state.
            ctranslate2.set_random_seed(self.config.random_seed)
            count = ctranslate2.get_cuda_device_count()
            if self.config.device_index >= count:
                raise RuntimeError(
                    f"CUDA device {self.config.device_index} is unavailable ({count} devices detected). "
                    "Local GPU transcription requires a compatible NVIDIA GPU; no CPU fallback is used."
                )
            supported = ctranslate2.get_supported_compute_types("cuda", self.config.device_index)
            if self.config.compute_type not in supported:
                raise RuntimeError(
                    f"CUDA device {self.config.device_index} does not support {self.config.compute_type}. "
                    "Select a supported compute type explicitly; precision is never changed automatically."
                )
        except (OSError, ValueError) as error:
            raise RuntimeError("Unable to initialize CUDA. Check the NVIDIA driver and CUDA runtime.") from error

        try:
            import faster_whisper
            from huggingface_hub import snapshot_download
        except (ImportError, OSError) as error:
            raise RuntimeError(
                "Install the transcription runtime from devops/transcription/requirements.txt."
            ) from error

        _LOGGER.info("Loading %s at %s on CUDA device %s", self.config.model, self.config.revision, self.config.device_index)
        model_path = snapshot_download(
            self.config.model,
            revision=self.config.revision,
            allow_patterns=_MODEL_FILES,
            cache_dir=self.config.model_cache,
            local_files_only=self.config.local_files_only,
        )
        # Faster-whisper otherwise fetches a fallback tokenizer independently,
        # which would break pinned provenance and the offline guarantee.
        for filename in ("config.json", "model.bin", "tokenizer.json"):
            if not (Path(model_path) / filename).is_file():
                raise RuntimeError(f"Pinned model snapshot is missing {filename}; no fallback model or tokenizer is fetched.")
        self._model = faster_whisper.WhisperModel(
            model_path,
            device="cuda",
            device_index=self.config.device_index,
            compute_type=self.config.compute_type,
            local_files_only=True,
        )
        self._runtime_versions = {
            "ctranslate2": getattr(ctranslate2, "__version__", "unknown"),
            "faster_whisper": getattr(faster_whisper, "__version__", "unknown"),
        }

    def transcribe(self, path: Path) -> Transcript:
        """Consume native long-form decoding completely before returning a result."""
        decoded = decode_media(path, audio_stream=self.config.audio_stream)
        if self._model is None:
            self._load()
        options = {
            "language": None if self.config.language == "auto" else self.config.language,
            "task": "transcribe",
            "beam_size": self.config.beam_size,
            "best_of": 5,
            "temperature": (0.0, 0.2, 0.4, 0.6, 0.8, 1.0) if self.config.decoding_mode == "fallback" else (0.0,),
            "compression_ratio_threshold": 2.4,
            "log_prob_threshold": -1.0,
            "no_speech_threshold": 0.6,
            "prompt_reset_on_temperature": 0.5,
            "vad_filter": False,
            "word_timestamps": False,
            "condition_on_previous_text": True,
        }
        segments, info = self._model.transcribe(decoded.samples, **options)
        result = []
        for segment in segments:
            result.append(Segment(start=segment.start, end=segment.end, text=segment.text))
            _LOGGER.info("Transcribed %.1f / %.1f seconds", segment.end, info.duration)
        return Transcript(
            segments=tuple(result),
            language=info.language,
            language_probability=info.language_probability,
            duration=info.duration,
            model={
                "model_id": self.config.model,
                "revision": self.config.revision,
                "device": "cuda",
                "device_index": self.config.device_index,
                "compute_type": self.config.compute_type,
                "random_seed": self.config.random_seed,
                "decoding_mode": self.config.decoding_mode,
                "runtime_versions": dict(self._runtime_versions),
                "audio": dict(decoded.metadata),
                **options,
            },
        )
