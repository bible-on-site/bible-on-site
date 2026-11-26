"""Exercise the bundled PyMySQL and Lambda handler against disposable MySQL."""

import importlib
import io
import socket
import ssl
import sys
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import patch

from validate_lambda_parser import prepare_reference_file


HOST = "mysql-fixture.test"
WRONG_HOST = "wrong-host.test"
SQL = b"""
CREATE TABLE connector_probe (id INT PRIMARY KEY, value VARCHAR(40) NOT NULL);
INSERT INTO connector_probe VALUES (1, 'verified packaged connector');
"""


def fixture_client(service):
    """Return the in-memory SQL input for the Lambda's S3 request."""
    if service != "s3":
        raise AssertionError(f"Unexpected AWS client: {service}")
    return SimpleNamespace(
        get_object=lambda **_: {"Body": io.BytesIO(SQL), "ContentLength": len(SQL)}
    )


def verify_canonical_reference_import(handler, event, boto3):
    """Read the complete chapter view during a reseed and after rollback."""
    data = Path(__file__).resolve().parents[3] / "data" / "mysql"
    inputs = [
        "tanah_static_structure.sql",
        "tanah_perek_pasuk_count_upgrade.sql",
        "tanah_sefarim_and_perakim_data.sql",
        "tanah_perek_pasuk_count_data.sql",
    ]
    contents = {
        name: (
            (data / name).read_bytes() if name.endswith("_upgrade.sql")
            else prepare_reference_file(data / name).encode("utf-8")
        )
        for name in inputs
    }
    event = {**event, "sql_files": inputs}
    pymysql = handler.pymysql

    def get_object(Key, **_kwargs):
        payload = contents[Key]
        return {"Body": io.BytesIO(payload), "ContentLength": len(payload)}

    with (
        patch.object(boto3, "client", return_value=SimpleNamespace(get_object=get_object)),
        pymysql.connect(**handler.db_credentials(event), ssl=handler.database_tls(HOST), autocommit=True) as observer,
        observer.cursor() as reader,
    ):
        assert handler.handler(event, None)["statusCode"] == 200
        reader.execute("SELECT header FROM tanah_perek WHERE id = 1")
        expected_header = reader.fetchone()[0]
        reader.execute("SELECT id FROM tanah_additional ORDER BY id")
        expected_additional = tuple((id_,) for id_ in range(1, 9))
        assert reader.fetchall() == expected_additional

        # Rehearse production with an older schema and objects the deployment
        # does not own. A failed import must leave all committed rows available.
        reader.execute("DROP VIEW tanah_perek_view")
        reader.execute("ALTER TABLE tanah_perek DROP COLUMN pasuk_count")
        reader.execute("CREATE VIEW tanah_perek_view AS SELECT id AS perek_id FROM tanah_perek")
        reader.execute("CREATE INDEX fixture_perek ON tanah_perek (perek)")
        reader.execute("CREATE TABLE fixture_chapter (perek_id INT, FOREIGN KEY (perek_id) REFERENCES tanah_perek (id)) ENGINE=InnoDB")
        reader.execute("INSERT INTO fixture_chapter VALUES (1)")
        reader.execute("INSERT INTO tanah_perek_date VALUES (1, 5, '2035-01-01', '57800000', '18:00:00')")
        reader.execute("UPDATE tanah_perek SET header = 'prior committed chapter' WHERE id = 1")
        original_execute = pymysql.cursors.Cursor.execute
        observed = []

        def observe_during_merge(cursor, statement, args=None):
            result = original_execute(cursor, statement, args)
            if statement.startswith("INSERT INTO tanah_perek_date ("):
                cursor.execute("SELECT header FROM tanah_perek WHERE id = 1")
                assert cursor.fetchone() == (expected_header,)
                reader.execute("SELECT COUNT(*), SUM(perek_id = 1 AND header = 'prior committed chapter') FROM tanah_perek_view")
                assert reader.fetchone() == (929, 1)
                observed.append(True)
                if len(observed) == 1:
                    raise RuntimeError("injected canonical import failure")
            return result

        with patch.object(pymysql.cursors.Cursor, "execute", observe_during_merge):
            try:
                handler.handler(event, None)
            except RuntimeError as error:
                assert str(error) == "injected canonical import failure"
            else:
                raise AssertionError("Expected to interrupt an uncommitted import")
            reader.execute("SELECT COUNT(*), SUM(perek_id = 1 AND header = 'prior committed chapter') FROM tanah_perek_view")
            assert reader.fetchone() == (929, 1)
            assert handler.handler(event, None)["statusCode"] == 200
        assert observed == [True, True]

        reader.execute("SELECT COUNT(*), COUNT(pasuk_count), MIN(perek_id), MAX(perek_id) FROM tanah_perek_view")
        assert reader.fetchone() == (929, 929, 1, 929)
        reader.execute("SELECT header FROM tanah_perek WHERE id = 1")
        assert reader.fetchone() == (expected_header,)
        reader.execute("SELECT id FROM tanah_additional ORDER BY id")
        assert reader.fetchall() == expected_additional
        reader.execute("SELECT cycle FROM tanah_perek_date WHERE perek_id = 1 ORDER BY cycle")
        assert reader.fetchall() == ((1,), (2,), (3,), (4,), (5,))
        reader.execute("SELECT perek_id FROM fixture_chapter")
        assert reader.fetchall() == ((1,),)
        reader.execute("SHOW INDEX FROM tanah_perek WHERE Key_name = 'fixture_perek'")
        assert reader.fetchone()

        # An unexpected overlapping sefer would duplicate a chapter in the view.
        # Stop the import before publishing any rows over that inconsistent state.
        reader.execute("INSERT INTO tanah_sefer VALUES (1000, 'Overlap', NULL, 1, 1)")
        reader.execute("UPDATE tanah_perek SET header = 'before overlapping import' WHERE id = 1")
        try:
            handler.handler(event, None)
        except pymysql.err.OperationalError as error:
            assert "canonical_reference_is_complete" in str(error)
        else:
            raise AssertionError("Expected the final chapter view coverage check to fail")
        reader.execute("SELECT header FROM tanah_perek WHERE id = 1")
        assert reader.fetchone() == ("before overlapping import",)


def run(package, port):
    """Invoke the packaged Lambda and verify both TLS outcomes."""
    getaddrinfo = socket.getaddrinfo

    def loopback_lookup(host, *args, **kwargs):
        if host not in (HOST, WRONG_HOST):
            raise AssertionError(f"Unexpected fixture hostname: {host}")
        return getaddrinfo("127.0.0.1", *args, **kwargs)

    boto3 = ModuleType("boto3")
    boto3.client = fixture_client
    sys.path.insert(0, str(package))
    with (
        patch.dict(sys.modules, {"boto3": boto3}),
        patch.object(socket, "getaddrinfo", side_effect=loopback_lookup),
    ):
        handler = importlib.import_module("index")
        pymysql = handler.pymysql
        assert Path(pymysql.__file__).resolve().is_relative_to(package)
        event = {
            "db_url": f"mysql://lambda_fixture:fixture-only@{HOST}:{port}/lambda_test",
            "sql_files": ["fixture.sql"],
        }
        # The fixture has never authenticated this account. TLS must work for
        # a cold caching_sha2_password login using the vendored package.
        assert handler.handler(event, None)["statusCode"] == 200
        with pymysql.connect(
            **handler.db_credentials(event), ssl=handler.database_tls(HOST),
        ) as connection, connection.cursor() as cursor:
            cursor.execute("SELECT value FROM connector_probe WHERE id = 1")
            assert cursor.fetchone() == ("verified packaged connector",)
            cursor.execute("SHOW SESSION STATUS LIKE 'Ssl_cipher'")
            assert cursor.fetchone()[1]

        verify_canonical_reference_import(handler, event, boto3)
        event["db_url"] = event["db_url"].replace(HOST, WRONG_HOST)
        try:
            handler.handler(event, None)
        except pymysql.err.OperationalError as error:
            assert isinstance(error.original_exception, ssl.SSLCertVerificationError)
        else:
            raise AssertionError("The connection accepted a mismatched TLS hostname")
    print("Packaged Lambda verified MySQL TLS and applied its fixture")


if __name__ == "__main__":
    run(Path(sys.argv[1]).resolve(), int(sys.argv[2]))
