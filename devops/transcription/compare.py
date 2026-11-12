"""Measure output disagreement without interpreting it as transcription accuracy."""

import argparse
from collections.abc import Sequence
import json
from pathlib import Path
import sys

from .text import BIDI_CONTROLS, comparison_text


def edit_distance(left: Sequence[str], right: Sequence[str]) -> int:
    """Compute exact Levenshtein distance with a bit-vector dynamic program."""
    if len(left) > len(right):
        left, right = right, left
    if not left:
        return len(right)
    equality: dict[str, int] = {}
    for index, token in enumerate(left):
        equality[token] = equality.get(token, 0) | (1 << index)
    mask = (1 << len(left)) - 1
    last = 1 << (len(left) - 1)
    positive, negative, result = mask, 0, len(left)
    for token in right:
        equal = equality.get(token, 0)
        delta = (((equal & positive) + positive) ^ positive) | equal | negative
        horizontal_positive = negative | ~(positive | delta)
        horizontal_negative = positive & delta
        result += bool(horizontal_positive & last) - bool(horizontal_negative & last)
        shifted = (horizontal_positive << 1) | 1
        negative = (shifted & delta) & mask
        positive = ((horizontal_negative << 1) | ~(shifted | delta)) & mask
    return result


def _metric(left: Sequence[str], right: Sequence[str]) -> dict[str, int | float | None]:
    distance = edit_distance(left, right)
    return {"edits": distance, "left_units": len(left), "right_units": len(right),
            "fraction_of_left": distance / len(left) if left else None,
            "normalized_distance": distance / max(len(left), len(right)) if left or right else 0.0}


def compare_text(left: str, right: str) -> dict[str, object]:
    """Compare spelling after removing non-speech formatting, never Hebrew letters."""
    normalized_left, normalized_right = comparison_text(left), comparison_text(right)
    return {"comparison_kind": "output-disagreement", "reference_transcript": False,
            "normalization": "NFKC, lowercase, punctuation/symbols and bidi controls removed; whitespace collapsed",
            "letters_and_diacritics_preserved": True,
            "bidi_controls": {"left": sum(c in BIDI_CONTROLS for c in left),
                              "right": sum(c in BIDI_CONTROLS for c in right)},
            "word": _metric(normalized_left.split(), normalized_right.split()),
            "character": _metric(normalized_left, normalized_right)}


def read_export(path: Path) -> str:
    """Read only recognized text from a version-one transcription export."""
    document = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(document, dict) or document.get("schema_version") != 1:
        raise ValueError("Expected a schema_version 1 transcript.json export")
    transcription = document.get("transcription")
    segments = transcription.get("segments") if isinstance(transcription, dict) else None
    if not isinstance(segments, list):
        raise ValueError("Export must contain a transcription.segments list")
    texts = []
    for segment in segments:
        if not isinstance(segment, dict) or not isinstance(segment.get("text"), str):
            raise ValueError("Each exported segment must contain string text")
        texts.append(segment["text"])
    return " ".join(texts)


def main(argv: list[str] | None = None) -> int:
    """Print a CPU-only comparison report for two completed transcript exports."""
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="backslashreplace")
    parser = argparse.ArgumentParser(description="Compare transcription outputs; neither is treated as ground truth.")
    parser.add_argument("left", type=Path)
    parser.add_argument("right", type=Path)
    args = parser.parse_args(argv)
    try:
        result = compare_text(read_export(args.left), read_export(args.right))
    except (OSError, ValueError) as error:
        print(f"Comparison failed: {error}", file=sys.stderr)
        return 1
    print(json.dumps(result, ensure_ascii=False, allow_nan=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
