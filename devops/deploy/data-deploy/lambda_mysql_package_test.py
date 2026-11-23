"""Exercise the bundled PyMySQL and Lambda handler against disposable MySQL."""

import importlib
import io
import socket
import ssl
import sys
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import patch


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
