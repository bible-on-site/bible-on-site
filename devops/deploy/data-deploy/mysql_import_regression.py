"""Run real Rust-generated imports through the actual Lambda against disposable MySQL DBs."""

import argparse
from contextlib import contextmanager
import os
from pathlib import Path
import re
import shlex
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

# Only these fixture-owned statements may pass through the query helper. Database
# identifiers use a separately validated, server-side prepared statement below.
QUERIES = {
    "seed_authors": (
        "INSERT INTO parshan (id,name,birth_year,has_pic) "
        "VALUES (7,%s,1000,0),(1,'Other author',1200,0),(900,'Published author',1300,0)"
    ),
    "seed_works": (
        "INSERT INTO perush (id,name,parshan_id,priority) "
        "VALUES (84,%s,7,100),(85,'Other work',1,200),(200,'Published only',900,300)"
    ),
    "seed_notes": (
        "INSERT INTO note VALUES "
        "(84,1,1,1,'old Rashi'),(84,1,2,1,'obsolete Rashi'),(84,2,1,1,'published chapter'),"
        "(84,3,1,1,'common removal chapter'),(84,3,2,1,'removed note'),"
        "(84,4,1,1,'common addition chapter'),(85,3,1,1,'fresh Other'),(200,8,1,1,'published work')"
    ),
    "create_chapters": "CREATE TABLE tanah_perek (id INT PRIMARY KEY)",
    "seed_chapters": "INSERT INTO tanah_perek VALUES (1)",
    "create_source_groups": (
        "CREATE TABLE tanahpedia_source_group (id CHAR(36) PRIMARY KEY) "
        "CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
    ),
    "seed_source_groups": "INSERT INTO tanahpedia_source_group VALUES ('group')",
    "seed_article_reference": (
        "INSERT INTO tanahpedia_tanah_source (id,source_group_id,perush_id,perek_id,pasuk_number) "
        "VALUES ('article-reference','group',84,1,1)"
    ),
    "seed_note_metric": (
        "INSERT INTO tanah_note_metric "
        "(perush_id,perek_id,pasuk,note_idx,word_count,cumulative_words,calc_version,source_hash) "
        "VALUES (%s,%s,1,1,2,2,1,%s)"
    ),
    "seed_work_metric": (
        "INSERT INTO tanah_perush_metric "
        "(perush_id,perek_id,word_count,estimated_seconds,words_per_minute,calc_version,source_hash) "
        "VALUES (%s,%s,2,1,120,1,%s)"
    ),
    "parshan": "SELECT * FROM `parshan` ORDER BY 1,2",
    "perush": "SELECT * FROM `perush` ORDER BY 1,2",
    "note": "SELECT * FROM `note` ORDER BY 1,2",
    "tanahpedia_tanah_source": "SELECT * FROM `tanahpedia_tanah_source` ORDER BY 1,2",
    "tanah_note_metric": "SELECT * FROM `tanah_note_metric` ORDER BY 1,2",
    "tanah_perush_metric": "SELECT * FROM `tanah_perush_metric` ORDER BY 1,2",
    "rashi_identity": "SELECT id,parshan_id FROM perush WHERE name=%s",
    "other_identity": "SELECT id,parshan_id FROM perush WHERE name='Other work'",
    "new_identity": "SELECT id,parshan_id FROM perush WHERE name='New work'",
    "changed_chapter": "SELECT note_content FROM note WHERE perush_id=84 AND perek_id=1 ORDER BY pasuk",
    "absent_chapter": "SELECT note_content FROM note WHERE perush_id=84 AND perek_id=2",
    "removal_chapter": "SELECT note_content FROM note WHERE perush_id=84 AND perek_id=3 ORDER BY pasuk",
    "addition_chapter": "SELECT note_content FROM note WHERE perush_id=84 AND perek_id=4 ORDER BY pasuk",
    "absent_work": "SELECT note_content FROM note WHERE perush_id=200 AND perek_id=8",
    "article_work": "SELECT p.name FROM tanahpedia_tanah_source s JOIN perush p ON p.id=s.perush_id",
    "note_count": "SELECT COUNT(*) FROM note",
    "orphan_count": "SELECT COUNT(*) FROM note n LEFT JOIN perush p ON p.id=n.perush_id WHERE p.id IS NULL",
    "note_metric_pairs": "SELECT perush_id,perek_id FROM tanah_note_metric ORDER BY 1,2",
    "work_metric_pairs": "SELECT perush_id,perek_id FROM tanah_perush_metric ORDER BY 1,2",
    "metric_table_count": (
        "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() "
        "AND TABLE_NAME IN ('tanah_note_metric','tanah_perush_metric')"
    ),
    "duplicate_work": "INSERT INTO perush (id,name,parshan_id) VALUES (201,%s,7)",
    "duplicate_author": "INSERT INTO parshan (id,name) VALUES (901,%s)",
    "nontransactional_note_metric": "ALTER TABLE tanah_note_metric ENGINE=MyISAM",
    "nontransactional_work_metric": "ALTER TABLE tanah_perush_metric ENGINE=MyISAM",
    "reject_import": (
        "CREATE TRIGGER reject_import BEFORE INSERT ON note FOR EACH ROW "
        "SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='injected note failure'"
    ),
    "clone_parshan": "INSERT INTO parshan (id,name,birth_year,has_pic) VALUES (%s,%s,%s,%s)",
    "clone_perush": "INSERT INTO perush (id,name,parshan_id,comp_date,pub_date,priority) VALUES (%s,%s,%s,%s,%s,%s)",
    "clone_note": "INSERT INTO note (perush_id,perek_id,pasuk,note_idx,note_content) VALUES (%s,%s,%s,%s,%s)",
    "work_identities": "SELECT name,id FROM perush ORDER BY BINARY name",
    "notes_by_name": (
        "SELECT p.name,n.perek_id,n.pasuk,n.note_idx,n.note_content FROM note n JOIN perush p ON p.id=n.perush_id "
        "ORDER BY BINARY p.name,n.perek_id,n.pasuk,n.note_idx"
    ),
    "chapter_pairs_by_name": (
        "SELECT DISTINCT p.name,n.perek_id FROM note n JOIN perush p ON p.id=n.perush_id "
        "ORDER BY BINARY p.name,n.perek_id"
    ),
}


def included_snapshot_tables(workflow):
    """Read only the known production-dump invocation and reject unknown exclusions."""
    lines = workflow.splitlines()
    headers = [index for index, line in enumerate(lines) if line == "      - name: Dump production data into local MySQL"]
    if len(headers) != 1:
        raise RuntimeError("Expected exactly one production data dump step")
    step = []
    for line in lines[headers[0] + 1:]:
        if line.startswith("      - "):
            break
        step.append(line)
    commands = [index for index, line in enumerate(step) if line.strip().startswith("mysqldump ")]
    if len(commands) != 1:
        raise RuntimeError("Expected exactly one mysqldump command in the production snapshot step")
    command = []
    for line in step[commands[0]:]:
        line = line.strip()
        if line.startswith("|"):
            break
        continued = line.endswith("\\")
        command.append(line[:-1] if continued else line)
        if not continued:
            break
    tokens = shlex.split(" ".join(command))
    expected = [
        "mysqldump", "-h", "$DB_HOST", "-P", "$DB_PORT", "-u", "$DB_USER",
        "--ssl-ca=$RDS_CA_BUNDLE", "--ssl-mode=VERIFY_IDENTITY", "--single-transaction",
        "--quick", "--no-tablespaces", "--column-statistics=0", "--set-gtid-purged=OFF",
        "--default-character-set=utf8mb4", "--databases", "$DB_NAME",
    ]
    tables = ("parshan", "perush", "note")
    excluded = set()
    actual = []
    for token in tokens:
        if token.startswith("--ignore-"):
            prefix = "--ignore-table=$DB_NAME."
            if not token.startswith(prefix) or token[len(prefix):] not in tables:
                raise RuntimeError("Unrecognized production snapshot table exclusion")
            table = token[len(prefix):]
            if table in excluded:
                raise RuntimeError("Duplicate production snapshot table exclusion")
            excluded.add(table)
        else:
            actual.append(token)
    if actual != expected:
        raise RuntimeError("Production dump invocation changed beyond the supported snapshot contract")
    return tuple(table for table in tables if table not in excluded)


class S3Body:
    def __init__(self, content):
        """Store fixture bytes exposed through the S3 response-body interface."""
        self.content = content

    def read(self):
        return self.content

    def iter_chunks(self, chunk_size):
        for offset in range(0, len(self.content), chunk_size):
            yield self.content[offset:offset + chunk_size]


class ObservedConnection:
    """Use the real connection, inspecting its pending transaction before handler cleanup."""

    def __init__(self, connection, before_close=None):
        """Observe the real connection immediately before the handler closes it."""
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
        if not re.fullmatch(r"codex_perushim_import_[a-f0-9]{20}", name):
            raise RuntimeError("Refusing to create or remove a non-fixture database")
        admin = pymysql.connect(**self.server)
        try:
            with admin.cursor() as cursor:
                cursor.execute("SET @fixture_database_name = %s", (name,))
                cursor.execute(
                    "SET @fixture_database_sql = CONCAT('CREATE DATABASE `', @fixture_database_name, "
                    "'` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci')"
                )
                cursor.execute("PREPARE fixture_database_command FROM @fixture_database_sql")
                cursor.execute("EXECUTE fixture_database_command")
                cursor.execute("DEALLOCATE PREPARE fixture_database_command")
            yield name
        finally:
            # Never use a supplied database name for cleanup.
            try:
                if not re.fullmatch(r"codex_perushim_import_[a-f0-9]{20}", name):
                    raise RuntimeError("Refusing to remove a non-fixture database")
                with admin.cursor() as cursor:
                    cursor.execute("SET @fixture_database_name = %s", (name,))
                    cursor.execute(
                        "SET @fixture_database_sql = CONCAT('DROP DATABASE IF EXISTS `', @fixture_database_name, '`')"
                    )
                    cursor.execute("PREPARE fixture_database_command FROM @fixture_database_sql")
                    cursor.execute("EXECUTE fixture_database_command")
                    cursor.execute("DEALLOCATE PREPARE fixture_database_command")
            finally:
                admin.close()

    def connect(self, name):
        return pymysql.connect(database=name, **self.server)

    def execute(self, name, query_key, args=None):
        statement = QUERIES[query_key]
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
        self.execute(name, "seed_authors", (RASHI,))
        self.execute(name, "seed_works", (RASHI,))
        self.execute(name, "seed_notes")
        self.execute(name, "create_chapters")
        self.execute(name, "seed_chapters")
        self.execute(name, "create_source_groups")
        self.execute(name, "seed_source_groups")
        connection = self.connect(name)
        try:
            with connection.cursor() as cursor:
                cursor.execute(self.source_ddl)
                for ddl in self.metric_ddl:
                    for statement in LAMBDA.parse_statements(LAMBDA.preprocess_sql(ddl)):
                        cursor.execute(statement)
        finally:
            connection.close()
        self.execute(name, "seed_article_reference")
        for work, chapter in ((84, 1), (84, 2), (84, 3), (84, 4), (85, 3), (200, 8)):
            self.seed_metric(name, work, chapter)

    def seed_metric(self, name, work, chapter):
        self.execute(name, "seed_note_metric", (work, chapter, "a" * 64))
        self.execute(name, "seed_work_metric", (work, chapter, "b" * 64))

    def snapshot(self, name, tables=(
        "parshan", "perush", "note", "tanahpedia_tanah_source", "tanah_note_metric", "tanah_perush_metric",
    )):
        return {table: self.execute(name, table) for table in tables}

    def commentary_snapshot(self, name):
        return {
            "identities": self.execute(name, "work_identities"),
            "notes": self.execute(name, "notes_by_name"),
            "pairs": self.execute(name, "chapter_pairs_by_name"),
        }

    def assert_snapshot_matches(self, actual, expected):
        self.assertEqual(actual["identities"], expected["identities"], "SSG snapshot must preserve live work IDs")
        self.assertEqual(actual["notes"], expected["notes"], "SSG snapshot must preserve notes by work name")
        self.assertEqual(actual["pairs"], expected["pairs"], "SSG snapshot must preserve published work/chapter pairs")

    def assert_imported(self, name):
        self.assertEqual(self.execute(name, "rashi_identity", (RASHI,)), ((84, 7),))
        self.assertEqual(self.execute(name, "other_identity"), ((85, 1),))
        self.assertEqual(self.execute(name, "new_identity"), ((201, 901),))
        self.assertEqual(self.execute(name, "changed_chapter"), ((FRESH_RASHI,), ("fresh second verse",)))
        self.assertEqual(self.execute(name, "absent_chapter"), (("published chapter",),))
        self.assertEqual(self.execute(name, "removal_chapter"), (("common removal chapter",),))
        self.assertEqual(self.execute(name, "addition_chapter"), (("common addition chapter",), ("added note",)))
        self.assertEqual(self.execute(name, "absent_work"), (("published work",),))
        self.assertEqual(self.execute(name, "article_work"), ((RASHI,),))
        self.assertEqual(self.execute(name, "note_count"), ((9,),))
        self.assertEqual(self.execute(name, "orphan_count"), ((0,),))
        for query in ("note_metric_pairs", "work_metric_pairs"):
            self.assertEqual(self.execute(name, query), ((84, 2), (85, 3), (200, 8)))

    def test_invalid_database_name_is_rejected_before_connecting(self):
        invalid_uuid = types.SimpleNamespace(hex="invalid_database_name")
        with patch.object(uuid, "uuid4", return_value=invalid_uuid), patch.object(pymysql, "connect") as connect:
            with self.assertRaisesRegex(RuntimeError, "non-fixture database"):
                with self.database():
                    self.fail("An invalid database name must never be yielded")
            connect.assert_not_called()

    def test_unknown_query_is_rejected_before_connecting(self):
        with patch.object(self, "connect") as connect:
            with self.assertRaises(KeyError):
                self.execute("unused_database", "not_a_fixture_query")
            connect.assert_not_called()

    def test_empty_bootstrap_and_repeated_import(self):
        for streaming in (False, True):
            with self.subTest(streaming=streaming), self.database() as name:
                self.assertEqual(self.deploy(name, streaming)["statusCode"], 200)
                before = self.snapshot(name, ("parshan", "perush", "note"))
                self.assertEqual(len(before["parshan"]), 3)
                self.assertEqual(len(before["perush"]), 3)
                self.assertEqual(len(before["note"]), 7)
                self.assertEqual(self.execute(name, "metric_table_count"), ((0,),))
                self.deploy(name, streaming)
                self.assertEqual(before, self.snapshot(name, before))

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

    def test_workflow_snapshot_matches_production_identity_and_retained_chapters(self):
        workflow = (ROOT / ".github/workflows/shared-dockerize.yml").read_text(encoding="utf-8")
        included = included_snapshot_tables(workflow)
        # Refuse an exclusion outside this narrowly modeled dump contract.
        anchor = '            --databases "$DB_NAME"'
        self.assertEqual(workflow.count(anchor), 1)
        unknown = workflow.replace(anchor, anchor + ' --ignore-table="$DB_NAME.unmodeled_table"')
        with self.assertRaisesRegex(RuntimeError, "Unrecognized production snapshot table exclusion"):
            included_snapshot_tables(unknown)
        no_data = workflow.replace(anchor, anchor + " --no-data")
        with self.assertRaisesRegex(RuntimeError, "supported snapshot contract"):
            included_snapshot_tables(no_data)
        clone_queries = {"parshan": "clone_parshan", "perush": "clone_perush", "note": "clone_note"}
        variants = (
            ("actual workflow", included, None),
            ("old snapshot excluding all commentary", (), "live work IDs"),
            ("catalog-only snapshot", ("parshan", "perush"), "notes by work name"),
        )
        for streaming in (False, True):
            with self.subTest(streaming=streaming), self.database() as production:
                self.seed(production, streaming)
                dumped = self.snapshot(production, ("parshan", "perush", "note"))
                self.deploy(production, streaming)
                expected = self.commentary_snapshot(production)
                self.assertIn((RASHI, 84), expected["identities"])
                self.assertIn(("Published only", 200), expected["identities"])
                self.assertIn((RASHI, 2, 1, 1, "published chapter"), expected["notes"])
                self.assertIn(("Published only", 8, 1, 1, "published work"), expected["notes"])
                for label, tables, failure in variants:
                    with self.subTest(snapshot=label), self.database() as clone:
                        self.deploy(clone, streaming, structure_only=True)
                        for table in tables:
                            for row in dumped[table]:
                                self.execute(clone, clone_queries[table], row)
                        self.deploy(clone, streaming)
                        actual = self.commentary_snapshot(clone)
                        if failure:
                            # The same parity assertions must reject each historical partial dump.
                            with self.assertRaisesRegex(AssertionError, failure):
                                self.assert_snapshot_matches(actual, expected)
                            if label == "catalog-only snapshot":
                                self.assertEqual(actual["identities"], expected["identities"])
                                self.assertNotIn((RASHI, 2), actual["pairs"])
                                self.assertNotIn(("Published only", 8), actual["pairs"])
                        else:
                            self.assert_snapshot_matches(actual, expected)

    def assert_duplicate_rejected(self, table):
        for streaming in (False, True):
            with self.subTest(streaming=streaming, table=table), self.database() as name:
                self.seed(name, streaming)
                if table == "perush":
                    self.execute(name, "duplicate_work", (RASHI,))
                else:
                    self.execute(name, "duplicate_author", (RASHI,))
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
            for query in ("nontransactional_note_metric", "nontransactional_work_metric"):
                with self.subTest(streaming=streaming, query=query), self.database() as name:
                    self.seed(name, streaming)
                    self.execute(name, query)
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
                self.execute(name, "reject_import")
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
