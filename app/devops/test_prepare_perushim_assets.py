import json
from contextlib import closing, redirect_stderr, redirect_stdout
from io import StringIO
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

from prepare_perushim_assets import CATALOG, NOTES, NOTES_DIRECTORIES, main, prepare_assets, validate_pair


class PreparePerushimAssetsTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.source = self.root / "artifact"
        self.source.mkdir()
        self.app = self.root / "app"
        self.mapping = {"13": "ביאור שטיינזלץ", "15": "בכור שור"}
        with closing(sqlite3.connect(self.source / CATALOG)) as db:
            with db:
                db.execute("CREATE TABLE perush (id INTEGER PRIMARY KEY, name TEXT)")
                db.executemany("INSERT INTO perush VALUES (?, ?)", self.mapping.items())
                db.execute("CREATE TABLE _metadata (key TEXT PRIMARY KEY, value TEXT)")
                db.execute("INSERT INTO _metadata VALUES ('build_timestamp', '200')")
        with closing(sqlite3.connect(self.source / NOTES)) as db:
            with db:
                db.execute("CREATE TABLE note (perush_id INTEGER)")
                db.execute("INSERT INTO note VALUES (13)")
                db.execute("CREATE TABLE _metadata (key TEXT PRIMARY KEY, value TEXT)")
                db.executemany("INSERT INTO _metadata VALUES (?, ?)",
                               [("build_timestamp", "200"), ("perush_catalog", json.dumps(self.mapping))])

    def metadata(self, key, value):
        with closing(sqlite3.connect(self.source / NOTES)) as db:
            with db:
                db.execute("DELETE FROM _metadata WHERE key = ?", (key,))
                if value is not None:
                    db.execute("INSERT INTO _metadata VALUES (?, ?)", (key, value))

    def test_prepares_both_platforms_with_the_delivered_catalog(self):
        for platform, directory in NOTES_DIRECTORIES.items():
            with self.subTest(platform=platform):
                self.assertEqual(prepare_assets(self.source, self.app, platform), 2)
                self.assertEqual((self.app / "Resources/Raw" / CATALOG).read_bytes(),
                                 (self.source / CATALOG).read_bytes())
                self.assertEqual((self.app / directory / NOTES).read_bytes(), (self.source / NOTES).read_bytes())

    def test_legacy_artifact_is_rejected_without_changing_existing_assets(self):
        self.metadata("perush_catalog", None)
        existing = self.app / "Resources/Raw" / CATALOG
        existing.parent.mkdir(parents=True)
        existing.write_bytes(b"installed catalog")
        with self.assertRaisesRegex(ValueError, "lack perush_catalog"):
            prepare_assets(self.source, self.app, "iOS")
        self.assertEqual(existing.read_bytes(), b"installed catalog")
        self.assertFalse((self.app / NOTES_DIRECTORIES["iOS"]).exists())

    def test_mapping_must_match_every_id_and_name(self):
        for mapping in [None, {}, {"13": "בכור שור", "15": "ביאור שטיינזלץ"},
                        {"12": "ביאור שטיינזלץ", "15": "בכור שור"}, {**self.mapping, "16": "רשבם"}]:
            with self.subTest(mapping=mapping):
                self.metadata("perush_catalog", json.dumps(mapping))
                with self.assertRaisesRegex(ValueError, "mapping does not match"):
                    validate_pair(self.source)

    def test_invalid_json_is_rejected(self):
        self.metadata("perush_catalog", "not JSON")
        with self.assertRaises(ValueError):
            validate_pair(self.source)

    def test_unmatched_or_missing_generation_is_rejected(self):
        for timestamp in ["1790678024", "0", None, "invalid"]:
            with self.subTest(timestamp=timestamp):
                self.metadata("build_timestamp", timestamp)
                with self.assertRaises(ValueError):
                    validate_pair(self.source)

    def test_notes_cannot_reference_unknown_ids(self):
        with closing(sqlite3.connect(self.source / NOTES)) as db:
            with db:
                db.execute("INSERT INTO note VALUES (999)")
        with self.assertRaisesRegex(ValueError, "IDs absent from the catalog"):
            validate_pair(self.source)

    def test_missing_pair_is_rejected(self):
        for name in [CATALOG, NOTES]:
            with self.subTest(name=name):
                path = self.source / name
                saved = path.read_bytes()
                path.unlink()
                with self.assertRaisesRegex(ValueError, "Missing"):
                    validate_pair(self.source)
                path.write_bytes(saved)

    def test_corrupt_database_is_rejected(self):
        (self.source / NOTES).write_bytes(b"not SQLite")
        with self.assertRaises(sqlite3.DatabaseError):
            validate_pair(self.source)

    def test_cli_prepares_valid_pair_and_fails_for_stale_pair(self):
        arguments = ["prepare_perushim_assets.py",
                   "--source", str(self.source), "--app-directory", str(self.app), "--platform", "iOS"]
        output, errors = StringIO(), StringIO()
        with patch("sys.argv", arguments), redirect_stdout(output), redirect_stderr(errors):
            self.assertEqual(main(), 0)
        self.assertIn("matching catalog and notes", output.getvalue())
        self.metadata("perush_catalog", None)
        with patch("sys.argv", arguments), redirect_stdout(output), redirect_stderr(errors):
            self.assertEqual(main(), 1)
        self.assertIn("regenerate the paired", errors.getvalue())


if __name__ == "__main__":
    unittest.main()
