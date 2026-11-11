"""Capture incremental native ASR diagnostics while running the ordinary CLI."""

from dataclasses import asdict
from datetime import datetime, timezone
from functools import wraps
import importlib
import json
import os
from pathlib import Path
import sys
import time
from typing import TextIO

from .__main__ import main as ordinary_main, parser
from .model import ModelConfig


class Checkpoint:
    """Write flushed JSONL events without changing recognized text or timing."""

    def __init__(self, target: TextIO, pipeline_started: float):
        """Retain the output stream and the whole-command clock origin."""
        self.target = target
        self.pipeline_started = pipeline_started

    def record(self, event: str, *, recognition_started: float | None = None, **fields):
        """Record one event; the two clocks deliberately have different origins."""
        now = time.monotonic()
        row = {"schema_version": 1, "event": event,
               "recorded_at": datetime.now(timezone.utc).isoformat(),
               "pipeline_elapsed_seconds": now - self.pipeline_started, **fields}
        if recognition_started is not None:
            row["recognition_elapsed_seconds"] = now - recognition_started
        self.target.write(json.dumps(row, ensure_ascii=False, allow_nan=False) + "\n")
        self.target.flush()


def checkpoint_transcribe(original, checkpoint: Checkpoint):
    """Forward native arguments, info and ready segment objects unchanged."""
    @wraps(original)
    def wrapped(self, *args, **kwargs):
        recognition_started = time.monotonic()
        checkpoint.record("recognition_started", recognition_started=recognition_started)
        iterator, info = original(self, *args, **kwargs)

        def segments():
            for segment in iterator:
                checkpoint.record("segment", recognition_started=recognition_started,
                                  segment=asdict(segment))
                yield segment

        return segments(), info

    return wrapped


def _run(argv, args, checkpoint: Checkpoint) -> int:
    """Scope the diagnostic wrapper to this command, restoring it on every exit."""
    defaults = ModelConfig()
    checkpoint.record("started", complete=False, request={
        "source": args.source, "model": args.model,
        "model_revision": args.model_revision or (defaults.revision if args.model == defaults.model else None),
        "language": args.language, "compute_type": args.compute_type,
        "device_index": args.device_index, "audio_stream": args.audio_stream,
        "beam_size": args.beam_size, "offline": args.offline,
    })
    exit_code = None
    whisper = None
    original = None
    try:
        whisper = importlib.import_module("faster_whisper")
        original = whisper.WhisperModel.transcribe
        whisper.WhisperModel.transcribe = checkpoint_transcribe(original, checkpoint)
        exit_code = ordinary_main(argv)
        return exit_code
    finally:
        if original is not None:
            whisper.WhisperModel.transcribe = original
        error_type = sys.exc_info()[0]
        checkpoint.record("finished", complete=exit_code == 0, exit_code=exit_code,
                          error_type=error_type.__name__ if error_type else None)


def main(argv: list[str] | None = None) -> int:
    """Run with TRANSCRIPTION_SEGMENT_CHECKPOINT pointing to a new private file."""
    pipeline_started = time.monotonic()
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="backslashreplace")
    args = parser().parse_args(argv)
    destination = os.environ.get("TRANSCRIPTION_SEGMENT_CHECKPOINT")
    if not destination:
        print("TRANSCRIPTION_SEGMENT_CHECKPOINT must name a new JSONL file.", file=sys.stderr)
        return 1
    try:
        path = Path(destination).expanduser().resolve()
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as target:
            return _run(argv, args, Checkpoint(target, pipeline_started))
    except (ImportError, OSError, ValueError, RuntimeError) as error:
        print(f"Checkpointed transcription failed: {error}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("Checkpointed transcription interrupted; retained events are incomplete.", file=sys.stderr)
        return 130


if __name__ == "__main__":
    sys.exit(main())
