import json
from contextlib import closing
from pathlib import Path
import sqlite3
import tempfile
import unittest

from audit_native import audit_native


class NativeAuditTests(unittest.TestCase):
    def test_null_nonspoken_rows_retain_ordinals_and_changed_words_are_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            native, canonical = Path(folder) / "native.sqlite", Path(folder) / "canonical.json"
            canonical.write_text(json.dumps([{"perekFrom": 1, "perakim": [{"pesukim": [{"segments": [
                {"type": "qri", "value": "ברא"}, {"type": "stuma", "value": ""},
                {"type": "qri", "value": "אור"}]}]}]}]), encoding="utf-8")
            with closing(sqlite3.connect(native)) as db, db:
                db.executescript("CREATE TABLE tanah_pasuk_segment(id INTEGER,perek_id INTEGER,pasuk_id INTEGER,segment_type TEXT);"
                                 "CREATE TABLE tanah_pasuk_segment_value(id INTEGER,value TEXT);"
                                 "INSERT INTO tanah_pasuk_segment VALUES(10,1,1,'qri'),(20,1,1,'stuma'),(30,1,1,'qri');")
                db.executemany("INSERT INTO tanah_pasuk_segment_value VALUES(?,?)", [(10, "ברא"), (30, "אור")])
            before = native.read_bytes()
            audit_native(canonical, native)
            self.assertEqual(before, native.read_bytes())
            with closing(sqlite3.connect(native)) as db, db:
                db.execute("UPDATE tanah_pasuk_segment_value SET value=? WHERE id=30", ("אור<small>[הערה]</small>",))
            with self.assertRaisesRegex(ValueError, "native canonical word identities differ"):
                audit_native(canonical, native)


if __name__ == "__main__":
    unittest.main()
