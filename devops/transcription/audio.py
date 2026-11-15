"""Decode a complete, explicitly selected audio stream without skipping errors."""

from dataclasses import dataclass
from pathlib import Path


SAMPLE_RATE = 16000


@dataclass(frozen=True)
class DecodedAudio:
    """Mono float32 samples and the selected stream's decode provenance."""

    samples: object
    metadata: dict[str, object]


def decode_media(path: Path, audio_stream: int | None = None) -> DecodedAudio:
    """Decode every frame, including the resampler tail, or reject the input."""
    if audio_stream is not None and (
        isinstance(audio_stream, bool) or not isinstance(audio_stream, int) or audio_stream < 0
    ):
        raise ValueError("Audio stream must be a nonnegative integer index.")
    try:
        import av
        import numpy as np
    except (ImportError, OSError) as error:
        raise RuntimeError(
            "Install the transcription runtime; PyAV and NumPy are required to decode audio/video."
        ) from error

    try:
        # PyAV passes these FFmpeg options to the container and its streams.
        # Explode asks the decoder to fail on detected bitstream errors.
        with av.open(str(path), mode="r", options={"err_detect": "explode"}) as container:
            streams = tuple(container.streams.audio)
            if not streams:
                raise RuntimeError("The input contains no audio stream.")
            if audio_stream is None and len(streams) != 1:
                raise RuntimeError(
                    f"The input contains {len(streams)} audio streams. "
                    "Select one explicitly with --audio-stream (zero-based audio index)."
                )
            selected = 0 if audio_stream is None else audio_stream
            if selected >= len(streams):
                raise ValueError(f"Audio stream {selected} is unavailable ({len(streams)} audio streams).")
            stream = streams[selected]
            codec = stream.codec_context
            metadata = {
                "audio_stream_count": len(streams),
                "selected_audio_stream": selected,
                "container_stream_index": stream.index,
                "container_stream_id": stream.id,
                "codec": codec.name,
                "source_sample_rate": codec.sample_rate,
                "source_channels": len(codec.layout.channels) if codec.layout is not None else None,
                "sample_rate": SAMPLE_RATE,
                "channels": 1,
                "sample_format": "float32",
                "decoder": "pyav",
                "decoder_version": av.__version__,
                "error_detection": "explode",
            }
            resampler = av.AudioResampler(format="fltp", layout="mono", rate=SAMPLE_RATE)
            chunks = []
            for frame in container.decode(stream):
                if frame.is_corrupt:
                    raise RuntimeError("The audio contains a corrupt frame; partial audio is not transcribed.")
                for output in resampler.resample(frame):
                    chunks.append(output.to_ndarray().reshape(-1))
            for output in resampler.resample(None):
                chunks.append(output.to_ndarray().reshape(-1))
    except (av.FFmpegError, OSError) as error:
        raise RuntimeError(
            "Unable to decode the complete selected audio stream; no partial audio is transcribed."
        ) from error

    if not chunks:
        raise RuntimeError("The selected audio stream decoded to no samples.")
    samples = np.concatenate(chunks).astype(np.float32, copy=False)
    if samples.size == 0 or not np.isfinite(samples).all():
        raise RuntimeError("The selected audio stream has empty or nonfinite samples.")
    metadata["duration"] = samples.size / SAMPLE_RATE
    return DecodedAudio(samples=samples, metadata=metadata)
