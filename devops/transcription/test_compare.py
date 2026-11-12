"""Regress invisible RTL inflation and verify the exact distance calculation."""

from contextlib import redirect_stderr, redirect_stdout
from io import BytesIO, StringIO, TextIOWrapper
from itertools import product
import json
from pathlib import Path
import runpy
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from devops.transcription.compare import compare_text, edit_distance, main, read_export
from devops.transcription.text import BIDI_CONTROLS, comparison_text, strip_direction_controls


def ordinary_distance(left, right):
    """Use the independent scalar recurrence to check the optimized algorithm."""
    row = list(range(len(right) + 1))
    for index, token in enumerate(left, 1):
        following = [index]
        for other_index, other in enumerate(right, 1):
            following.append(min(row[other_index] + 1, following[-1] + 1,
                                 row[other_index - 1] + (token != other)))
        row = following
    return row[-1]


class ComparisonTests(unittest.TestCase):
    """Measure spelling disagreement without confusing it with formatting or WER."""

    def test_direction_controls_do_not_create_word_substitutions(self):
        controls = "".join(sorted(BIDI_CONTROLS))
        result = compare_text(controls + "שלום\u202b עולם\u202c", "שלום עולם")
        self.assertEqual(result["word"]["edits"], 0)
        self.assertEqual(result["character"]["edits"], 0)
        self.assertEqual(result["bidi_controls"], {"left": 14, "right": 0})
        self.assertEqual(result["comparison_kind"], "output-disagreement")
        self.assertFalse(result["reference_transcript"])

    def test_hebrew_letters_diacritics_and_joiners_still_count(self):
        for left, right in [("היתה", "הייתה"), ("דוד", "דויד"),
                            ("שלם", "שלום"), ("שׁ", "ש"), ("א\u200cב", "אב"),
                            ("א\u200dב", "אב")]:
            with self.subTest(left=left, right=right):
                result = compare_text(left, right)
                self.assertEqual(result["word"]["edits"], 1)
                self.assertEqual(result["character"]["edits"], 1)
        self.assertEqual(strip_direction_controls("\u202bהייתה\u202c"), "הייתה")

    def test_punctuation_case_spacing_and_compatibility_forms_are_normalized(self):
        self.assertEqual(comparison_text('  תנ״ך\n ABC — שׁ  '), 'תנך abc שׁ')
        self.assertEqual(compare_text('תנ״ך ABC שׁ', 'תנ"ך abc שׁ')["word"]["edits"], 0)

    def test_separator_punctuation_keeps_word_boundaries_and_quotes_keep_abbreviations(self):
        for separator in ["-", "־", "–", "—", "/", ",", ".", "+"]:
            with self.subTest(separator=separator):
                result = compare_text("שלום" + separator + "עולם", "שלום עולם")
                self.assertEqual(result["word"]["edits"], 0)
                self.assertEqual(result["character"]["edits"], 0)
        result = compare_text('“תנ״ך”', 'תנך')
        self.assertEqual(result["word"]["edits"], 0)
        self.assertEqual(result["character"]["edits"], 0)

    def test_known_edits_and_empty_denominators(self):
        self.assertEqual(edit_distance("kitten", "sitting"), 3)
        self.assertEqual(edit_distance(["a", "b", "c"], ["a", "c"]), 1)
        empty = compare_text("", "")
        self.assertEqual(empty["word"]["normalized_distance"], 0)
        self.assertIsNone(empty["word"]["fraction_of_left"])
        inserted = compare_text("", "מילה")
        self.assertEqual(inserted["word"]["edits"], 1)
        self.assertEqual(inserted["word"]["normalized_distance"], 1)
        self.assertEqual(compare_text("מילה", "")["word"]["fraction_of_left"], 1)

    def test_distance_agrees_with_independent_dynamic_program(self):
        sequences = ["".join(tokens) for length in range(5) for tokens in product("אב", repeat=length)]
        for left in sequences:
            for right in sequences:
                self.assertEqual(edit_distance(left, right), ordinary_distance(left, right))

    def test_lecture_sized_sequences_keep_an_exact_small_edit(self):
        left = [f"מילה{index}" for index in range(4000)]
        right = [*left[:2000], "אחרת", *left[2001:]]
        self.assertEqual(edit_distance(left, right), 1)


class CompareExportTests(unittest.TestCase):
    """Exercise the real export format and CPU-only command interface."""

    def setUp(self):
        self.temporary = TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.left, self.right = self.root / "א.json", self.root / "ב.json"
        self.left.write_text(json.dumps({"schema_version": 1, "transcription": {"segments": [
            {"start": 0, "end": 1, "text": "\u202bשלום"}, {"start": 2, "end": 3, "text": "עולם"},
        ]}}), encoding="utf-8")
        self.right.write_text(json.dumps({"schema_version": 1, "transcription": {"segments": [
            {"start": 50, "end": 60, "text": "שלום עולם"},
        ]}}), encoding="utf-8")

    def test_segment_boundaries_and_timestamps_do_not_change_text_distance(self):
        self.assertEqual(read_export(self.left), "\u202bשלום עולם")
        stdout = StringIO()
        with redirect_stdout(stdout):
            self.assertEqual(main([str(self.left), str(self.right)]), 0)
        result = json.loads(stdout.getvalue())
        self.assertEqual(result["word"]["edits"], 0)
        self.assertEqual(result["bidi_controls"]["left"], 1)

    def test_cli_runs_without_loading_gpu_or_media_dependencies(self):
        unavailable = {name: None for name in ("ctranslate2", "faster_whisper", "av", "numpy")}
        with patch.dict(sys.modules, unavailable), patch("sys.argv", ["compare", str(self.left), str(self.right)]):
            sys.modules.pop("devops.transcription.compare", None)
            with redirect_stdout(StringIO()) as stdout, self.assertRaises(SystemExit) as result:
                runpy.run_module("devops.transcription.compare", run_name="__main__")
        self.assertEqual(result.exception.code, 0)
        self.assertEqual(json.loads(stdout.getvalue())["word"]["edits"], 0)

    def test_module_entry_handles_legacy_windows_console_encoding(self):
        stdout_bytes, stderr_bytes = BytesIO(), BytesIO()
        stdout = TextIOWrapper(stdout_bytes, encoding="ascii")
        stderr = TextIOWrapper(stderr_bytes, encoding="ascii")
        with patch.dict(sys.modules), patch("sys.argv", ["compare", str(self.left), str(self.right)]):
            sys.modules.pop("devops.transcription.compare", None)
            with redirect_stdout(stdout), redirect_stderr(stderr), self.assertRaises(SystemExit) as exit_result:
                runpy.run_module("devops.transcription.compare", run_name="__main__")
            stdout.flush()
            stderr.flush()
        self.assertEqual(exit_result.exception.code, 0)
        self.assertEqual(stdout.encoding, "utf-8")
        self.assertEqual(json.loads(stdout_bytes.getvalue().decode("utf-8"))["word"]["edits"], 0)
        self.assertEqual(stderr_bytes.getvalue(), b"")

    def test_invalid_export_shapes_have_actionable_errors(self):
        for document in [[], {}, {"schema_version": 2},
                         {"schema_version": 1, "transcription": []},
                         {"schema_version": 1, "transcription": {"segments": "text"}},
                         {"schema_version": 1, "transcription": {"segments": ["text"]}},
                         {"schema_version": 1, "transcription": {"segments": [{"text": None}]}}]:
            with self.subTest(document=document):
                self.right.write_text(json.dumps(document), encoding="utf-8")
                with self.assertRaises(ValueError):
                    read_export(self.right)

    def test_cli_reports_missing_files_and_bad_json(self):
        for content in (None, "{broken"):
            if content is None:
                self.right.unlink()
            else:
                self.right.write_text(content, encoding="utf-8")
            stderr = StringIO()
            with redirect_stderr(stderr):
                self.assertEqual(main([str(self.left), str(self.right)]), 1)
            self.assertIn("Comparison failed:", stderr.getvalue())


if __name__ == "__main__":
    unittest.main()
