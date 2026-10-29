"""Exercise the real Lambda SQL helpers without AWS or third-party imports."""

import importlib.util
import json
import sqlite3
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
MIGRATION = "tanahpedia_alter_mention_decoration.sql"


def load_helpers(path):
    spec = importlib.util.spec_from_file_location(path.stem, path)
    module = importlib.util.module_from_spec(spec)
    # The helpers do not call AWS or MySQL. Stub only those optional imports.
    with patch.dict(sys.modules, {
        "boto3": types.ModuleType("boto3"),
        "pymysql": types.ModuleType("pymysql"),
    }):
        spec.loader.exec_module(module)
    return module


LAMBDA = load_helpers(
    ROOT / "docs/aws/cloudformation/data-deploy/data-deploy-lambda.py",
)
VALIDATOR = load_helpers(
    HERE / "validate_lambda_parser.py",
)


class ChunkedBody:
    def __init__(self, sql):
        """Encode the SQL as the bytes returned by an S3 response body."""
        self.content = sql.encode("utf-8")

    def iter_chunks(self, chunk_size):
        # Cross SQL keyword boundaries as a real S3 stream can.
        for offset in range(0, len(self.content), 13):
            yield self.content[offset:offset + 13]


class LocalConnection:
    """SQLite executes the common table DDL; MySQL session settings are ignored."""

    def __init__(self):
        """Create an isolated in-memory database for each parser case."""
        self.database = sqlite3.connect(":memory:")

    def cursor(self):
        return self

    def __enter__(self):
        """Expose this adapter through the MySQL cursor context interface."""
        return self

    def __exit__(self, *_args):
        """Allow execution failures to propagate to the test runner."""
        return False

    def execute(self, statement):
        if not statement.startswith("SET FOREIGN_KEY_CHECKS"):
            self.database.execute(statement)

    def close(self):
        self.database.close()


class LambdaParserSafetyTests(unittest.TestCase):
    def execute_sql(self, connection, sql, streaming):
        if streaming:
            LAMBDA.execute_sql_streaming(ChunkedBody(sql), connection)
        else:
            for statement in LAMBDA.parse_statements(LAMBDA.preprocess_sql(sql)):
                connection.execute(statement)

    def test_additive_table_migrations_preserve_rows_on_repeated_deploys(self):
        for streaming in (False, True):
            for clause in ("CREATE TABLE IF NOT EXISTS", "create table if\nnot exists"):
                with self.subTest(streaming=streaming, clause=clause):
                    connection = LocalConnection()
                    self.addCleanup(connection.close)
                    sql = f"{clause} annotations (id INTEGER PRIMARY KEY, content TEXT);"
                    self.execute_sql(connection, sql, streaming)
                    connection.database.execute("INSERT INTO annotations VALUES (1, 'קיים')")
                    self.execute_sql(connection, sql, streaming)
                    self.execute_sql(connection, sql, streaming)
                    self.assertEqual(
                        connection.database.execute("SELECT * FROM annotations").fetchall(),
                        [(1, "קיים")],
                    )

    def test_plain_bootstrap_table_replacement_is_unchanged(self):
        for streaming in (False, True):
            with self.subTest(streaming=streaming):
                connection = LocalConnection()
                self.addCleanup(connection.close)
                sql = "CREATE TABLE bootstrap (id INTEGER);"
                self.execute_sql(connection, sql, streaming)
                connection.database.execute("INSERT INTO bootstrap VALUES (1)")
                self.execute_sql(connection, sql, streaming)
                self.assertEqual(connection.database.execute("SELECT * FROM bootstrap").fetchall(), [])

    def test_reading_metrics_migration_is_lambda_safe(self):
        path = ROOT / "data/mysql" / "tanah_reading_metrics_upgrade.sql"
        VALIDATOR.validate_lambda_safe_comments(path)
        processed = LAMBDA.preprocess_sql(path.read_text(encoding="utf-8"))
        statements = LAMBDA.parse_statements(processed)
        # Two session settings plus 8 tables x SET/PREPARE/EXECUTE/DEALLOCATE.
        self.assertEqual(len(statements), 34)
        self.assertNotRegex(processed, r"(?im)^\s*(?:DROP|TRUNCATE|DELETE)\b")

    def test_dedication_upgrade_is_in_manifest_and_lambda_safe(self):
        manifest = json.loads((HERE / "sql-files.json").read_text(encoding="utf-8"))
        self.assertIn("tanah_dedication_upgrade.sql", manifest)
        path = ROOT / "data/mysql" / "tanah_dedication_upgrade.sql"
        VALIDATOR.validate_lambda_safe_comments(path)
        processed = LAMBDA.preprocess_sql(path.read_text(encoding="utf-8"))
        statements = LAMBDA.parse_statements(processed)
        # Two session settings plus 18 idempotent blocks (bootstrap creates,
        # guarded column adds, guarded FK adds and the scope link tables),
        # each a SET/PREPARE/EXECUTE/DEALLOCATE group.
        self.assertEqual(len(statements), 74)
        self.assertNotRegex(processed, r"(?im)^\s*(?:DROP|TRUNCATE|DELETE)\b")
        # The rewriter must not see literal table-creation keywords: every
        # new or preserved dedication table is built inside a string.
        self.assertNotIn("CREATE TABLE", processed.upper().replace("CREATE ', 'TABLE", ""))

    def test_dedication_seed_data_is_in_manifest_and_idempotent(self):
        manifest = json.loads((HERE / "sql-files.json").read_text(encoding="utf-8"))
        self.assertIn("tanah_dedication_data.sql", manifest)
        self.assertLess(
            manifest.index("tanah_dedication_upgrade.sql"),
            manifest.index("tanah_dedication_data.sql"),
        )
        path = ROOT / "data/mysql" / "tanah_dedication_data.sql"
        VALIDATOR.validate_lambda_safe_comments(path)
        processed = LAMBDA.preprocess_sql(path.read_text(encoding="utf-8"))
        statements = LAMBDA.parse_statements(processed)
        # 2 session settings + 3 type guards x (SET + INSERT)
        # + 5 records x (INSERT + SET + INSERT IGNORE + INSERT IGNORE).
        self.assertEqual(len(statements), 28)
        # Seed content must never wipe anything.
        self.assertNotRegex(processed, r"(?im)^\s*(?:DROP|TRUNCATE|DELETE|REPLACE|CREATE)\b")
        for subject in ("מרדכי בן זאב", "יעל בת רחל", "מזל בת רחל", "עלושה בת גֿזלה", "ראובן בן יקוט"):
            self.assertIn(subject, processed)

    def test_mention_schema_is_in_manifest_and_remains_one_additive_statement(self):
        manifest = json.loads((HERE / "sql-files.json").read_text(encoding="utf-8"))
        self.assertIn(MIGRATION, manifest)
        path = ROOT / "data/mysql" / MIGRATION
        VALIDATOR.validate_lambda_safe_comments(path)
        processed = LAMBDA.preprocess_sql(path.read_text(encoding="utf-8"))
        statements = LAMBDA.parse_statements(processed)
        self.assertEqual(len(statements), 3)  # Two session settings and one CREATE.
        self.assertRegex(processed, r"CREATE TABLE IF NOT EXISTS `tanahpedia_mention_decoration`")
        self.assertNotRegex(processed, r"(?im)^\s*(?:DROP|TRUNCATE|DELETE)\b")
        self.assertEqual(VALIDATOR.preprocess_sql(path.read_text(encoding="utf-8")), processed)

    def test_whatsapp_upgrade_is_additive_and_all_prepared_blocks_survive_parser(self):
        manifest = json.loads((HERE / "sql-files.json").read_text(encoding="utf-8"))
        filename = "tanah_daily_bulletin_whatsapp_upgrade.sql"
        self.assertIn(filename, manifest)
        self.assertEqual(manifest.index(filename), manifest.index("tanah_daily_bulletin_upgrade.sql") + 1)
        path = ROOT / "data/mysql/tanah_daily_bulletin_whatsapp_upgrade.sql"
        VALIDATOR.validate_lambda_safe_comments(path)
        source = path.read_text(encoding="utf-8")
        processed = LAMBDA.preprocess_sql(source)
        statements = LAMBDA.parse_statements(processed)
        # Two session settings, three complete prepared DDL groups, one default.
        self.assertEqual(len(statements), 15)
        self.assertNotRegex(processed, r"(?im)^\s*(?:DROP|TRUNCATE|DELETE|REPLACE)\b")
        self.assertEqual(VALIDATOR.preprocess_sql(source), processed)
        self.assertEqual(VALIDATOR.parse_statements(processed), statements)
        for operation in ("PREPARE whatsappUpgrade", "EXECUTE whatsappUpgrade", "DEALLOCATE PREPARE whatsappUpgrade"):
            self.assertEqual(sum(statement.startswith(operation) for statement in statements), 3)
        self.assertEqual(sum("INSERT IGNORE INTO tanah_daily_bulletin_whatsapp_settings" in statement for statement in statements), 1)
        self.assertIn("DEFAULT ''test''", processed)


if __name__ == "__main__":
    unittest.main()
