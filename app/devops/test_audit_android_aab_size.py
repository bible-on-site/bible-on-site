"""Tests for the AAB size audit.

A synthetic bundle mirroring the real layout, plus negative fixtures
proving bloat and mispackaging are rejected (#3309).
"""

import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
import zipfile

from audit_android_aab_size import (
    BASE_MODULE_MAX_COMPRESSED,
    SEARCH_INDEX,
    audit,
    main,
)


def write_search_index(path: Path, slim: bool = True) -> None:
    with sqlite3.connect(path) as db:
        db.execute("CREATE TABLE search_metadata (name TEXT PRIMARY KEY, fingerprint TEXT)")
        if slim:
            db.execute("CREATE TABLE notes_documents (rowid INTEGER PRIMARY KEY,"
                       " PerekId INTEGER, PasukNum INTEGER, PerushId INTEGER, SeferId INTEGER, NoteIdx INTEGER)")
            db.execute("INSERT INTO notes_documents VALUES (1,1,1,7,1,0)")
        else:
            db.execute("CREATE TABLE notes_documents (rowid INTEGER PRIMARY KEY, Text TEXT,"
                       " PerekId INTEGER, PasukNum INTEGER, PerushId INTEGER, SeferId INTEGER)")
            db.execute("INSERT INTO notes_documents VALUES (1,'בראשית',1,1,7,1)")


def write_aab(path: Path, *, slim_index: bool = True, perushim: bool = True,
              on_demand: bool = True, base_payloads: dict | None = None,
              recitations: int = 2, search_index: bool = True) -> None:
    workdir = Path(tempfile.mkdtemp())
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as bundle:
        bundle.writestr("base/manifest/AndroidManifest.xml", b"manifest")
        bundle.writestr("base/assets/sefaria-dump-5784-sivan-4.tanah_view.sqlite", b"tanah")
        bundle.writestr("base/assets/sefaria-dump-5784-sivan-4.perushim_catalog.sqlite", b"catalog")
        bundle.writestr("base/assets/recitation-catalog.json", b"{}")
        for name, content in (base_payloads or {}).items():
            bundle.writestr(f"base/{name}", content)
        if perushim:
            delivery = b"on-demand" if on_demand else b"install-time"
            bundle.writestr("perushim_notes/manifest/AndroidManifest.xml", b"dist:delivery " + delivery)
            if search_index:
                index_path = workdir / "index.sqlite"
                write_search_index(index_path, slim=slim_index)
                bundle.write(index_path, f"perushim_notes/assets/{SEARCH_INDEX}")
            bundle.writestr("perushim_notes/assets/sefaria-dump-5784-sivan-4.perushim_notes.sqlite", b"notes")
        for sefer in range(1, recitations + 1):
            delivery = b"on-demand" if on_demand else b"install-time"
            bundle.writestr(f"recitation_{sefer}/manifest/AndroidManifest.xml", b"dist:delivery " + delivery)
            bundle.writestr(f"recitation_{sefer}/assets/recitation_{sefer}.zip", b"audio")
            bundle.writestr(f"recitation_{sefer}/assets.pb", b"pb")


class AuditAndroidAabSizeTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.package = self.root / "app.aab"

    def test_valid_bundle_reports_the_module_breakdown(self):
        write_aab(self.package)
        report = audit(self.package)
        self.assertIn("base", report["modules"])
        self.assertIn("perushim_notes", report["modules"])
        self.assertIn("recitation_1", report["modules"])
        self.assertEqual(report["searchIndex"]["notesDocumentRows"], 1)
        self.assertNotIn("Text", report["searchIndex"]["notesDocumentColumns"])

    def test_json_output_is_written(self):
        write_aab(self.package)
        output = self.root / "report.json"
        self.assertEqual(main(["--package", str(self.package), "--json-out", str(output)]), 0)
        report = json.loads(output.read_text(encoding="utf-8"))
        self.assertIn("compressedBytes", report["modules"]["base"])

    def test_optional_payload_in_base_is_rejected(self):
        write_aab(self.package, base_payloads={
            "assets/sefaria-dump-5784-sivan-4.hebrew_search.sqlite": b"fat",
        })
        with self.assertRaisesRegex(ValueError, "base module"):
            audit(self.package)

    def test_base_over_budget_is_rejected(self):
        # Random bytes do not deflate, so the compressed module size grows too.
        import os
        write_aab(self.package, base_payloads={
            "assets/bloat.bin": os.urandom(BASE_MODULE_MAX_COMPRESSED + 1),
        })
        with self.assertRaisesRegex(ValueError, "base module"):
            audit(self.package)

    def test_install_time_pack_is_rejected(self):
        write_aab(self.package, on_demand=False)
        with self.assertRaisesRegex(ValueError, "on-demand"):
            audit(self.package)

    def test_missing_perushim_pack_is_rejected(self):
        write_aab(self.package, perushim=False)
        with self.assertRaisesRegex(ValueError, "perushim_notes"):
            audit(self.package)

    def test_missing_search_index_is_rejected(self):
        write_aab(self.package, search_index=False)
        with self.assertRaisesRegex(ValueError, "delivered search index"):
            audit(self.package)

    def test_fat_search_index_layout_is_rejected(self):
        write_aab(self.package, slim_index=False)
        with self.assertRaisesRegex(ValueError, "still stores the note text"):
            audit(self.package)

    def test_cli_fails_on_a_mispackaged_bundle(self):
        write_aab(self.package, slim_index=False)
        self.assertEqual(main(["--package", str(self.package)]), 1)


if __name__ == "__main__":
    unittest.main()
