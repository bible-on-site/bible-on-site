"""State readers must not prevent the existing atomic JSON writer replacing files."""

import json
import os
from pathlib import Path
import tempfile
import unittest

from listening_files import open_state_text, read_state_json, replace_state_file, write_state_json


class StateFileTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.path = Path(temporary.name) / "state.json"

    def test_held_reader_keeps_old_generation_without_blocking_atomic_replace(self):
        old = {"state": "preparing", "completed": 240, "label": "בדיקת הקלטות"}
        new = {"state": "prepared", "completed": 241, "label": "מוכן לבדיקה"}
        write_state_json(self.path, old)
        with open_state_text(self.path) as original:
            self.assertEqual(json.load(original), old)
            original.seek(0)
            # No retries or sleeps: this is the real writer and a genuinely open
            # reader on both Windows and POSIX, not a mocked rename operation.
            write_state_json(self.path, new)
            self.assertEqual(json.load(original), old)
            self.assertEqual(read_state_json(self.path), new)
            self.assertFalse(original.closed)
        self.assertTrue(original.closed)

    def test_one_held_reader_allows_multiple_atomic_generations(self):
        write_state_json(self.path, {"generation": 0})
        with open_state_text(self.path) as original:
            for generation in range(1, 5):
                write_state_json(self.path, {"generation": generation})
                self.assertEqual(read_state_json(self.path), {"generation": generation})
            self.assertEqual(json.load(original), {"generation": 0})

    def test_first_atomic_creation_needs_no_existing_destination(self):
        write_state_json(self.path, {"generation": 1})
        self.assertEqual(read_state_json(self.path), {"generation": 1})
        self.assertFalse(self.path.with_suffix(".tmp").exists())

    def test_ordinary_reader_permissions_are_not_bypassed(self):
        old, new = {"generation": 1}, {"generation": 2}
        write_state_json(self.path, old)
        with self.path.open("r", encoding="utf-8") as ordinary:
            if os.name == "nt":
                with self.assertRaisesRegex(PermissionError, "delete-sharing readers"):
                    write_state_json(self.path, new)
                self.assertEqual(read_state_json(self.path), old)
                self.assertEqual(read_state_json(self.path.with_suffix(".tmp")), new)
            else:
                write_state_json(self.path, new)
                self.assertEqual(read_state_json(self.path), new)
            self.assertEqual(json.load(ordinary), old)

    def test_failed_source_rename_preserves_existing_target(self):
        write_state_json(self.path, {"generation": 1})
        with self.assertRaises(FileNotFoundError):
            replace_state_file(self.path.with_name("missing.tmp"), self.path)
        self.assertEqual(read_state_json(self.path), {"generation": 1})

    def test_context_closes_the_native_descriptor_after_an_exception(self):
        write_state_json(self.path, {"state": "preparing"})
        with self.assertRaisesRegex(RuntimeError, "reader interrupted"):
            with open_state_text(self.path) as stream:
                descriptor = stream.fileno()
                self.assertEqual(json.load(stream), {"state": "preparing"})
                raise RuntimeError("reader interrupted")
        self.assertTrue(stream.closed)
        with self.assertRaises(OSError):
            os.fstat(descriptor)
        write_state_json(self.path, {"state": "prepared"})
        self.assertEqual(read_state_json(self.path), {"state": "prepared"})

    def test_missing_state_preserves_file_not_found(self):
        with self.assertRaises(FileNotFoundError):
            read_state_json(self.path)
        self.assertFalse(self.path.exists())

    def test_malformed_state_preserves_json_error_and_closes_reader(self):
        self.path.write_text('{"state":', encoding="utf-8")
        with self.assertRaises(json.JSONDecodeError):
            read_state_json(self.path)
        write_state_json(self.path, {"state": "repaired by its writer"})
        self.assertEqual(read_state_json(self.path), {"state": "repaired by its writer"})

    def test_unicode_paths_and_bom_preserve_exact_json_values(self):
        self.path = self.path.parent / "מצב בדיקה 🎧.json"
        value = {"עברית": "מילה לפני ואחרי", "non_bmp": "🎧", "empty": ""}
        self.path.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8-sig")
        self.assertEqual(read_state_json(self.path), value)
        with open_state_text(self.path) as stream:
            self.assertEqual(stream.read(), json.dumps(value, ensure_ascii=False))
            write_state_json(self.path, {**value, "generation": 2})
            stream.seek(0)
            self.assertEqual(json.load(stream), value)
            self.assertEqual(read_state_json(self.path), {**value, "generation": 2})

    def test_invalid_utf8_is_not_silently_replaced(self):
        self.path.write_bytes(b'{"state":"\xff"}')
        with self.assertRaises(UnicodeDecodeError):
            read_state_json(self.path)
        write_state_json(self.path, {"state": "valid"})
        self.assertEqual(read_state_json(self.path), {"state": "valid"})


if __name__ == "__main__":
    unittest.main()
