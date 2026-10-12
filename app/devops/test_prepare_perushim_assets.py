import json
from contextlib import closing, redirect_stderr, redirect_stdout
from io import StringIO
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

from prepare_perushim_assets import CATALOG, NOTES, NOTES_DIRECTORIES, SEARCH_INDEX, SEARCH_INDEX_DIRECTORIES, TANAH, main, prepare_assets, validate_pair


def write_search_index(path: Path, notes_timestamp: int = 200) -> None:
    """A minimal delivered-index fixture carrying the generation fingerprints."""
    with closing(sqlite3.connect(path)) as db:
        with db:
            db.execute("CREATE TABLE search_metadata (name TEXT PRIMARY KEY, fingerprint TEXT)")
            db.executemany("INSERT INTO search_metadata VALUES (?, ?)", [
                ("notes", f"v4:{notes_timestamp}:n1"),
                ("verses", "v4:2026-01-03 22:08:48 UTC:n1"),
            ])
            for table in ("verses", "notes"):
                db.execute(f"CREATE TABLE {table}_documents (rowid INTEGER PRIMARY KEY, Text TEXT, "
                           "PerekId INTEGER, PasukNum INTEGER, PerushId INTEGER, SeferId INTEGER)")
                db.execute(f"INSERT INTO {table}_documents VALUES (1,'בראשית',1,1,0,1)")
                db.execute(f"CREATE VIRTUAL TABLE {table} USING fts5(Text, content='{table}_documents', content_rowid='rowid')")
                db.execute(f"INSERT INTO {table}(rowid,Text) VALUES (1,'בראשית')")
                db.execute(f"CREATE VIRTUAL TABLE {table}_vocab USING fts5vocab({table}, 'row')")


class PreparePerushimAssetsTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.source = self.root / "artifact"
        self.source.mkdir()
        self.app = self.root / "app"
        (self.app / "Resources/Raw").mkdir(parents=True)
        with closing(sqlite3.connect(self.app / "Resources/Raw" / TANAH)) as db:
            with db:
                db.execute("CREATE TABLE _metadata (key TEXT PRIMARY KEY, value TEXT)")
                db.execute("INSERT INTO _metadata VALUES ('generated_at', '2026-01-03 22:08:48 UTC')")
        self.mapping = {"13": "ביאור שטיינזלץ", "15": "בכור שור"}
        with closing(sqlite3.connect(self.source / CATALOG)) as db:
            with db:
                db.execute("CREATE TABLE perush (id INTEGER PRIMARY KEY, name TEXT)")
                db.executemany("INSERT INTO perush VALUES (?, ?)", self.mapping.items())
                db.execute("CREATE TABLE _metadata (key TEXT PRIMARY KEY, value TEXT)")
                db.execute("INSERT INTO _metadata VALUES ('build_timestamp', '200')")
        with closing(sqlite3.connect(self.source / NOTES)) as db:
            with db:
                db.execute("CREATE TABLE note_blob (perek_id INTEGER PRIMARY KEY, data BLOB NOT NULL)")
                db.execute("INSERT INTO note_blob VALUES (1, X'504e4231')")
                db.execute("CREATE TABLE perek_perush (perek_id INTEGER, perush_id INTEGER,"
                           " PRIMARY KEY (perek_id, perush_id))")
                db.execute("INSERT INTO perek_perush VALUES (1, 13)")
                db.execute("CREATE TABLE _metadata (key TEXT PRIMARY KEY, value TEXT)")
                db.executemany("INSERT INTO _metadata VALUES (?, ?)",
                               [("build_timestamp", "200"), ("schema_version", "2"),
                                ("perush_catalog", json.dumps(self.mapping))])

        write_search_index(self.source / SEARCH_INDEX)

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
        existing.parent.mkdir(parents=True, exist_ok=True)
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
                db.execute("INSERT INTO perek_perush VALUES (2, 999)")
                db.execute("INSERT INTO note_blob VALUES (2, X'504e4231')")
        with self.assertRaisesRegex(ValueError, "IDs absent from the catalog"):
            validate_pair(self.source)

    def test_wrong_schema_version_is_rejected(self):
        for version in [None, "1", "3"]:
            with self.subTest(version=version):
                self.metadata("schema_version", version)
                with self.assertRaisesRegex(ValueError, "schema v2"):
                    validate_pair(self.source)

    def test_blob_must_cover_every_perek(self):
        with closing(sqlite3.connect(self.source / NOTES)) as db:
            with db:
                db.execute("INSERT INTO perek_perush VALUES (2, 13)")
        with self.assertRaisesRegex(ValueError, "every perek"):
            validate_pair(self.source)

    def test_delivered_index_is_staged_and_validated(self):
        for platform, directory in SEARCH_INDEX_DIRECTORIES.items():
            with self.subTest(platform=platform):
                self.assertEqual(prepare_assets(self.source, self.app, platform), 2)
                self.assertEqual((self.app / directory / SEARCH_INDEX).read_bytes(),
                                 (self.source / SEARCH_INDEX).read_bytes())

    def test_index_from_another_generation_is_rejected(self):
        (self.source / SEARCH_INDEX).unlink()
        write_search_index(self.source / SEARCH_INDEX, notes_timestamp=999)
        with self.assertRaisesRegex(ValueError, "different notes generation"):
            validate_pair(self.source)

    def test_index_missing_fingerprint_or_tables_is_rejected(self):
        path = self.source / SEARCH_INDEX
        path.unlink()
        with closing(sqlite3.connect(path)) as db:
            with db:
                db.execute("CREATE TABLE search_metadata (name TEXT PRIMARY KEY, fingerprint TEXT)")
        with self.assertRaisesRegex(ValueError, "different notes generation|verses fingerprint"):
            validate_pair(self.source)

    def test_missing_index_is_rejected_before_changing_assets(self):
        (self.source / SEARCH_INDEX).unlink()
        with self.assertRaisesRegex(ValueError, "Missing"):
            prepare_assets(self.source, self.app, "Android")
        self.assertFalse((self.app / "Resources/Raw" / CATALOG).exists())

    def test_stale_verse_index_is_rejected_before_changing_assets(self):
        with closing(sqlite3.connect(self.source / SEARCH_INDEX)) as db:
            with db:
                db.execute("UPDATE search_metadata SET fingerprint='v4:old-scripture:n1' WHERE name='verses'")
        with self.assertRaisesRegex(ValueError, "different bundled scripture"):
            prepare_assets(self.source, self.app, "iOS")
        self.assertFalse((self.app / "Resources/Raw" / CATALOG).exists())
        self.assertFalse((self.app / NOTES_DIRECTORIES["iOS"]).exists())

    def test_old_normalization_is_rejected(self):
        with closing(sqlite3.connect(self.source / SEARCH_INDEX)) as db:
            with db:
                db.execute("UPDATE search_metadata SET fingerprint='v4:200:n0' WHERE name='notes'")
        with self.assertRaisesRegex(ValueError, "different notes generation"):
            validate_pair(self.source)

    def test_missing_vocabulary_and_empty_documents_are_rejected(self):
        for defect in ("DROP TABLE notes_vocab", "DELETE FROM notes_documents"):
            with self.subTest(defect=defect):
                (self.source / SEARCH_INDEX).unlink()
                write_search_index(self.source / SEARCH_INDEX)
                with closing(sqlite3.connect(self.source / SEARCH_INDEX)) as db:
                    with db:
                        db.execute(defect)
                with self.assertRaisesRegex(ValueError, "missing|no notes documents"):
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
        self.assertIn("matching catalog, notes and prebuilt search index", output.getvalue())
        self.metadata("perush_catalog", None)
        with patch("sys.argv", arguments), redirect_stdout(output), redirect_stderr(errors):
            self.assertEqual(main(), 1)
        self.assertIn("regenerate the paired", errors.getvalue())


if __name__ == "__main__":
    unittest.main()
