"""CLI for local CUDA transcription; run from the repository root."""

import argparse
import logging
from pathlib import Path
import sys

from .model import ModelConfig
from .pipeline import ExportOptions, run


def parser() -> argparse.ArgumentParser:
    """Describe storage, inference and export options without importing GPU libraries."""
    defaults = ModelConfig()
    cli = argparse.ArgumentParser(description="Transcribe a local file or s3://bucket/key on the local NVIDIA GPU.")
    cli.add_argument("source", help="Local audio/video file or exact S3 object URI (literal key, not URL encoded)")
    cli.add_argument("--output-dir", type=Path, default=Path(".outputs/transcription"))
    cli.add_argument("--title", help="Article title; defaults to the recording filename")
    cli.add_argument("--aws-profile", help="Existing authorized AWS credential profile; used only for S3 input")
    cli.add_argument("--model", default=defaults.model)
    cli.add_argument("--model-revision", default=None, help="Exact Hugging Face model commit; required for custom models")
    cli.add_argument("--language", default=defaults.language, help="Language code, or auto (default: he)")
    cli.add_argument("--audio-stream", type=int, help="Zero-based audio track; required when a video has multiple audio tracks")
    cli.add_argument("--device-index", type=int, default=defaults.device_index)
    cli.add_argument("--compute-type", choices=["float16", "float32", "int8_float16", "int8_float32"], default=defaults.compute_type)
    cli.add_argument("--beam-size", type=int, default=defaults.beam_size)
    cli.add_argument("--model-cache", help="Hugging Face cache directory")
    cli.add_argument("--offline", action="store_true", help="Require cached model weights; never download models")
    cli.add_argument("--paragraph-pause", type=float, default=1.5, metavar="SECONDS")
    cli.add_argument("--max-paragraph-characters", type=int, default=900)
    return cli


def main(argv: list[str] | None = None) -> int:
    """Return nonzero on failure and print only completed artifact paths on success."""
    # Windows pipes may default to a legacy encoding even when files/arguments
    # contain Hebrew. A successful export must remain a successful command.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="backslashreplace")
    args = parser().parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s", stream=sys.stderr)
    try:
        config_args = {"model": args.model, "language": args.language,
                       "device_index": args.device_index, "compute_type": args.compute_type,
                       "beam_size": args.beam_size, "local_files_only": args.offline,
                       "model_cache": args.model_cache, "audio_stream": args.audio_stream}
        if args.model_revision is not None:
            config_args["revision"] = args.model_revision
        elif args.model != ModelConfig().model:
            raise ValueError("Custom models require --model-revision with an exact commit")
        result = run(args.source, args.output_dir, config=ModelConfig(**config_args),
                     options=ExportOptions(args.title, args.paragraph_pause, args.max_paragraph_characters),
                     aws_profile=args.aws_profile)
    except (ValueError, OSError, RuntimeError) as error:
        print(f"Transcription failed: {error}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("Transcription interrupted; no partial export was published.", file=sys.stderr)
        return 130
    print(result.directory)
    return 0


if __name__ == "__main__":
    sys.exit(main())
