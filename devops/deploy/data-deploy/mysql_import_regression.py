"""Run real Rust-generated imports through the actual Lambda against disposable MySQL DBs."""

import argparse
from contextlib import contextmanager
import os
from pathlib import Path
import re
import types
import unittest
from unittest.mock import patch
from urllib.parse import quote, unquote, urlparse
import uuid

import pymysql

from test_lambda_parser import LAMBDA, ROOT


RASHI = 'רש"י'
FRESH_RASHI = "fresh Rashi; quoted 'text'"
CONFIG = None


class S3Body:
    def __init__(self, content):
        self.content = content

    def read(self):
        return self.content

    def iter_chunks(self, chunk_size):
        for offset in range(0, len(self.content), chunk_size):
            yield self.content[offset:offset + chunk_size]


class ObservedConnection:
    """Use the real connection, inspecting its pending transaction before handler cleanup."""

    def __init__(self, connection, before_close=None):
        self.connection = connection
        self.before_close = before_close
        self.closed = False

    def cursor(self):
        return self.connection.cursor()

    def close(self):
        try:
            if self.before_close:
                self.before_close(self.connection)
        finally:
            self.connection.close()
            self.closed = True


class MysqlImportRegression(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if CONFIG is None:
            raise RuntimeError("Run this harness through the Rust mysql_import integration test")
        raw_url = os.environ.get("MYSQL_IMPORT_TEST_DB_URL", "")
        parsed = urlparse(raw_url)
        if (
            parsed.scheme != "mysql"
            or parsed.hostname not in {"localhost", "127.0.0.1", "::1"}
            or not parsed.username
        ):
            raise RuntimeError("MYSQL_IMPORT_TEST_DB_URL must identify a local MySQL test server")
        cls.server = {
            "host": parsed.hostname,
            "port": parsed.port or 3306,
            "user": unquote(parsed.username),
            "password": unquote(parsed.password or ""),
            "charset": "utf8mb4",
            "autocommit": True,
            "connect_timeout": 30,
        }
        cls.sql = Path(CONFIG.sql).read_bytes()
        cls.bad_source_sql = {
            "missing author": Path(CONFIG.bad_author_sql).read_bytes(),
            "missing note work": Path(CONFIG.bad_note_sql).read_bytes(),
        }
        cls.structure = (ROOT / "data/mysql/perushim_structure.sql").read_bytes()
        source = (ROOT / "data/mysql/tanahpedia_structure.sql").read_text(encoding="utf-8")
        source_table = source[source.index("CREATE TABLE `tanahpedia_tanah_source`"):]
        cls.source_ddl = source_table[:LAMBDA.find_statement_end(source_table)]
        metric_source = (ROOT / "data/mysql/tanah_reading_metrics_upgrade.sql").read_text(encoding="utf-8")
        cls.metric_ddl = [
            re.search(
                r"SET @readingMetricsSql = CONCAT\('CREATE ', 'TABLE IF NOT EXISTS `"
                + table + r"`[\s\S]*?DEALLOCATE PREPARE readingMetricsUpgrade;",
                metric_source,
            )[0]
            for table in ("tanah_note_metric", "tanah_perush_metric")
        ]

    @contextmanager
    def database(self):
        name = f"codex_perushim_import_{uuid.uuid4().hex[:20]}"
        admin = pymysql.connect(**self.server)
        try:
            with admin.cursor() as cursor:
                cursor.execute(f"CREATE DATABASE `{name}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci")
            yield name
        finally:
            # Never use a supplied database name for cleanup.
            assert re.fullmatch(r"codex_perushim_import_[a-f0-9]{20}", name)
            with admin.cursor() as cursor:
                cursor.execute(f"DROP DATABASE IF EXISTS `{name}`")
            admin.close()

    def connect(self, name):
        return pymysql.connect(database=name, **self.server)

    def execute(self, name, statement, args=None):
        connection = self.connect(name)
        try:
            with connection.cursor() as cursor:
                cursor.execute(statement, args)
                return cursor.fetchall()
        finally:
            connection.close()

    def deploy(self, name, streaming, structure_only=False, before_close=None, sql=None):
        files = {"structure.sql": self.structure}
        if not structure_only:
            # Exercise the handler's actual >10MiB branch with normal 1MiB S3 chunks.
            # A trailing comment adds no DB rows and no copied import implementation.
            padding = b"\n-- " + b"x" * (10 * 1024 * 1024) + b"\n" if streaming else b""
            files["generated.sql"] = (self.sql if sql is None else sql) + padding

        def get_object(**kwargs):
            content = files[kwargs["Key"].removeprefix("fixture/")]
            return {"Body": S3Body(content), "ContentLength": len(content)}

        opened = []

        def connect(**kwargs):
            self.assertEqual(kwargs["database"], name)
            connection = ObservedConnection(
                pymysql.connect(charset="utf8mb4", **kwargs), before_close,
            )
            opened.append(connection)
            return connection

        def client(service):
            self.assertEqual(service, "s3", "The regression must never call live AWS")
            return types.SimpleNamespace(get_object=get_object)

        host = self.server["host"]
        url_host = f"[{host}]" if ":" in host else host
        url = (
            f"mysql://{quote(self.server['user'], safe='')}:"
            f"{quote(self.server['password'], safe='')}@"
            f"{url_host}:{self.server['port']}/{name}"
        )
        try:
            with patch.object(LAMBDA, "boto3", types.SimpleNamespace(client=client)), patch.object(
                LAMBDA, "pymysql", types.SimpleNamespace(connect=connect),
            ):
                return LAMBDA.handler({
                    "db_url": url,
                    "sql_files": list(files),
                    "s3_prefix": "fixture/",
                }, None)
        finally:
            self.assertEqual(len(opened), 1)
            self.assertTrue(opened[0].closed, "The actual handler must close its connection")

    def seed(self, name, streaming):
        self.deploy(name, streaming, structure_only=True)
        self.execute(name, "INSERT INTO parshan (id,name,birth_year,has_pic) VALUES (7,%s,1000,0),(1,'Other author',1200,0),(900,'Published author',1300,0)", (RASHI,))
        self.execute(name, "INSERT INTO perush (id,name,parshan_id,priority) VALUES (84,%s,7,100),(85,'Other work',1,200),(200,'Published only',900,300)", (RASHI,))
        self.execute(name, "INSERT INTO note VALUES (84,1,1,1,'old Rashi'),(84,1,2,1,'obsolete Rashi'),(84,2,1,1,'published chapter'),(84,3,1,1,'common removal chapter'),(84,3,2,1,'removed note'),(84,4,1,1,'common addition chapter'),(85,3,1,1,'fresh Other'),(200,8,1,1,'published work')")
        self.execute(name, "CREATE TABLE tanah_perek (id INT PRIMARY KEY)")
        self.execute(name, "INSERT INTO tanah_perek VALUES (1)")
        self.execute(name, "CREATE TABLE tanahpedia_source_group (id CHAR(36) PRIMARY KEY) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci")
        self.execute(name, "INSERT INTO tanahpedia_source_group VALUES ('group')")
        self.execute(name, self.source_ddl)
        self.execute(name, "INSERT INTO tanahpedia_tanah_source (id,source_group_id,perush_id,perek_id,pasuk_number) VALUES ('article-reference','group',84,1,1)")
        connection = self.connect(name)
        try:
            with connection.cursor() as cursor:
                for ddl in self.metric_ddl:
                    for statement in LAMBDA.parse_statements(LAMBDA.preprocess_sql(ddl)):
                        cursor.execute(statement)
        finally:
            connection.close()
        for work, chapter in ((84, 1), (84, 2), (84, 3), (84, 4), (85, 3), (200, 8)):
            self.seed_metric(name, work, chapter)

    def seed_metric(self, name, work, chapter):
        self.execute(name, "INSERT INTO tanah_note_metric (perush_id,perek_id,pasuk,note_idx,word_count,cumulative_words,calc_version,source_hash) VALUES (%s,%s,1,1,2,2,1,%s)", (work, chapter, "a" * 64))
        self.execute(name, "INSERT INTO tanah_perush_metric (perush_id,perek_id,word_count,estimated_seconds,words_per_minute,calc_version,source_hash) VALUES (%s,%s,2,1,120,1,%s)", (work, chapter, "b" * 64))

    def snapshot(self, name):
        return {
            table: self.execute(name, f"SELECT * FROM `{table}` ORDER BY 1,2")
            for table in ("parshan", "perush", "note", "tanahpedia_tanah_source", "tanah_note_metric", "tanah_perush_metric")
        }

    def assert_imported(self, name):
        self.assertEqual(self.execute(name, "SELECT id,parshan_id FROM perush WHERE name=%s", (RASHI,)), ((84, 7),))
        self.assertEqual(self.execute(name, "SELECT id,parshan_id FROM perush WHERE name='Other work'"), ((85, 1),))
        self.assertEqual(self.execute(name, "SELECT id,parshan_id FROM perush WHERE name='New work'"), ((201, 901),))
        self.assertEqual(self.execute(name, "SELECT note_content FROM note WHERE perush_id=84 AND perek_id=1 ORDER BY pasuk"), ((FRESH_RASHI,), ("fresh second verse",)))
        self.assertEqual(self.execute(name, "SELECT note_content FROM note WHERE perush_id=84 AND perek_id=2"), (("published chapter",),))
        self.assertEqual(self.execute(name, "SELECT note_content FROM note WHERE perush_id=84 AND perek_id=3 ORDER BY pasuk"), (("common removal chapter",),))
        self.assertEqual(self.execute(name, "SELECT note_content FROM note WHERE perush_id=84 AND perek_id=4 ORDER BY pasuk"), (("common addition chapter",), ("added note",)))
        self.assertEqual(self.execute(name, "SELECT note_content FROM note WHERE perush_id=200 AND perek_id=8"), (("published work",),))
        self.assertEqual(self.execute(name, "SELECT p.name FROM tanahpedia_tanah_source s JOIN perush p ON p.id=s.perush_id"), ((RASHI,),))
        self.assertEqual(self.execute(name, "SELECT COUNT(*) FROM note"), ((9,),))
        self.assertEqual(self.execute(name, "SELECT COUNT(*) FROM note n LEFT JOIN perush p ON p.id=n.perush_id WHERE p.id IS NULL"), ((0,),))
        for table in ("tanah_note_metric", "tanah_perush_metric"):
            self.assertEqual(self.execute(name, f"SELECT perush_id,perek_id FROM {table} ORDER BY 1,2"), ((84, 2), (85, 3), (200, 8)))

    def test_empty_bootstrap_and_repeated_import(self):
        for streaming in (False, True):
            with self.subTest(streaming=streaming), self.database() as name:
                self.assertEqual(self.deploy(name, streaming)["statusCode"], 200)
                before = {table: self.execute(name, f"SELECT * FROM `{table}` ORDER BY 1,2") for table in ("parshan", "perush", "note")}
                self.assertEqual(len(before["parshan"]), 3)
                self.assertEqual(len(before["perush"]), 3)
                self.assertEqual(len(before["note"]), 7)
                self.assertEqual(self.execute(name, "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('tanah_note_metric','tanah_perush_metric')"), ((0,),))
                self.deploy(name, streaming)
                self.assertEqual(before, {table: self.execute(name, f"SELECT * FROM `{table}` ORDER BY 1,2") for table in before})

    def test_live_ids_external_foreign_keys_and_absent_chapters_survive(self):
        for streaming in (False, True):
            with self.subTest(streaming=streaming), self.database() as name:
                self.seed(name, streaming)
                self.deploy(name, streaming)
                self.assert_imported(name)
                # Simulate metrics computed for the newly imported current text.
                self.seed_metric(name, 84, 1)
                self.seed_metric(name, 84, 3)
                self.seed_metric(name, 84, 4)
                self.seed_metric(name, 201, 1)
                before = self.snapshot(name)
                self.deploy(name, streaming)
                self.assertEqual(self.snapshot(name), before)

    def assert_duplicate_rejected(self, table):
        for streaming in (False, True):
            with self.subTest(streaming=streaming, table=table), self.database() as name:
                self.seed(name, streaming)
                if table == "perush":
                    self.execute(name, "INSERT INTO perush (id,name,parshan_id) VALUES (201,%s,7)", (RASHI,))
                else:
                    self.execute(name, "INSERT INTO parshan (id,name) VALUES (901,%s)", (RASHI,))
                before = self.snapshot(name)
                with self.assertRaises(pymysql.MySQLError):
                    self.deploy(name, streaming)
                self.assertEqual(self.snapshot(name), before)

    def test_duplicate_existing_work_name_fails_closed(self):
        self.assert_duplicate_rejected("perush")

    def test_duplicate_existing_author_name_fails_closed(self):
        self.assert_duplicate_rejected("parshan")

    def test_nontransactional_metric_tables_fail_before_live_mutation(self):
        for streaming in (False, True):
            for table in ("tanah_note_metric", "tanah_perush_metric"):
                with self.subTest(streaming=streaming, table=table), self.database() as name:
                    self.seed(name, streaming)
                    self.execute(name, f"ALTER TABLE {table} ENGINE=MyISAM")
                    before = self.snapshot(name)
                    with self.assertRaises(pymysql.MySQLError):
                        self.deploy(name, streaming)
                    self.assertEqual(self.snapshot(name), before)

    def test_missing_source_foreign_keys_fail_before_live_mutation(self):
        for streaming in (False, True):
            for label, sql in self.bad_source_sql.items():
                with self.subTest(streaming=streaming, malformed=label), self.database() as name:
                    self.seed(name, streaming)
                    before = self.snapshot(name)
                    inspected = []

                    def before_close(connection):
                        with connection.cursor() as cursor:
                            cursor.execute("SELECT COUNT(*) FROM perush WHERE name='New work'")
                            self.assertEqual(cursor.fetchone()[0], 0)
                            cursor.execute("SELECT has_pic FROM parshan WHERE id=7")
                            self.assertEqual(cursor.fetchone()[0], 0)
                            cursor.execute("SELECT COUNT(*) FROM note WHERE perush_id=84 AND perek_id=1")
                            self.assertEqual(cursor.fetchone()[0], 2)
                        inspected.append(True)

                    with self.assertRaises(pymysql.MySQLError):
                        self.deploy(name, streaming, before_close=before_close, sql=sql)
                    self.assertEqual(inspected, [True])
                    self.assertEqual(self.snapshot(name), before)

    def test_note_failure_rolls_back_metadata_and_chapter_replacement(self):
        for streaming in (False, True):
            with self.subTest(streaming=streaming), self.database() as name:
                self.seed(name, streaming)
                before = self.snapshot(name)
                self.execute(name, "CREATE TRIGGER reject_import BEFORE INSERT ON note FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='injected note failure'")
                observed = []

                def pending_transaction(connection):
                    with connection.cursor() as cursor:
                        cursor.execute("SELECT COUNT(*) FROM perush WHERE name='New work'")
                        self.assertEqual(cursor.fetchone()[0], 1, "Metadata writes must precede the injected failure")
                        cursor.execute("SELECT COUNT(*) FROM note WHERE perush_id=84 AND perek_id=1")
                        self.assertEqual(cursor.fetchone()[0], 0, "Chapter replacement DELETE must precede the failure")
                        cursor.execute("SELECT @@FOREIGN_KEY_CHECKS")
                        self.assertEqual(cursor.fetchone()[0], 1)
                    observed.append(True)

                with self.assertRaisesRegex(pymysql.MySQLError, "injected note failure"):
                    self.deploy(name, streaming, before_close=pending_transaction)
                self.assertEqual(observed, [True])
                self.assertEqual(self.snapshot(name), before)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sql", required=True, help="Fixture emitted by the actual Rust MySQL generator")
    parser.add_argument("--bad-author-sql", required=True)
    parser.add_argument("--bad-note-sql", required=True)
    CONFIG = parser.parse_args()
    unittest.main(argv=[__file__], verbosity=2)
