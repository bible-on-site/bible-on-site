"""Exercise the Lambda DB-credential contract without AWS or MySQL.

The checked-in handler must support both caller contracts while the gated
#2576 redeploy is pending: the current deployer sends ``db_url`` inside the
invoke payload, while legacy callers (manual invokes, older deployer
checkouts, the bounded schema-recovery procedure) omit it and rely on the
handler's own credential lookup. These tests pin the resolution order —
payload ``db_url`` > ``DB_URL`` env > SSM ``{SSM_PREFIX}-url`` — so neither
contract can silently break.
"""

import importlib.util
import os
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]


def load_lambda():
    spec = importlib.util.spec_from_file_location(
        "data_deploy_lambda_credentials",
        ROOT / "docs/aws/cloudformation/data-deploy/data-deploy-lambda.py",
    )
    module = importlib.util.module_from_spec(spec)
    # The credential path never calls AWS/MySQL in these tests; stub the
    # optional third-party imports exactly like test_lambda_parser.py does.
    with patch.dict(
        sys.modules,
        {
            "boto3": types.ModuleType("boto3"),
            "pymysql": types.ModuleType("pymysql"),
        },
    ):
        spec.loader.exec_module(module)
    return module


LAMBDA = load_lambda()

MYSQL_URL = "mysql://user:p%40ss%3Aword@db.internal:3307/appdb"
EXPECTED_CREDENTIALS = {
    "host": "db.internal",
    "port": 3307,
    "user": "user",
    "password": "p@ss:word",
    "database": "appdb",
}
OTHER_URL = "mysql://other:secret@other.internal:3306/otherdb"


class FakeSsmClient:
    """Minimal stand-in for ``boto3.client("ssm")`` used by the fallback."""

    def __init__(self, value=None, error=None):
        self.value = value
        self.error = error
        self.calls = []

    def get_parameter(self, **kwargs):
        self.calls.append(kwargs)
        if self.error is not None:
            raise self.error
        return {"Parameter": {"Name": kwargs["Name"], "Value": self.value}}


class DbCredentialsTests(unittest.TestCase):
    def setUp(self):
        # Isolate from developer/CI environment; restore exact prior state.
        for key in ("DB_URL", "SSM_PREFIX"):
            prior = os.environ.pop(key, None)
            self.addCleanup(self._restore_env, key, prior)

    @staticmethod
    def _restore_env(key, prior):
        os.environ.pop(key, None)
        if prior is not None:
            os.environ[key] = prior

    def test_event_db_url_takes_precedence_over_env_and_ssm(self):
        fake_ssm = FakeSsmClient(OTHER_URL)
        with (
            patch.dict(os.environ, {"DB_URL": OTHER_URL}),
            patch.object(LAMBDA.boto3, "client", create=True) as client_mock,
        ):
            client_mock.return_value = fake_ssm
            credentials = LAMBDA.db_credentials({"db_url": MYSQL_URL})
        self.assertEqual(credentials, EXPECTED_CREDENTIALS)
        client_mock.assert_not_called()
        self.assertEqual(fake_ssm.calls, [])

    def test_db_url_env_used_when_event_omits_db_url(self):
        fake_ssm = FakeSsmClient(OTHER_URL)
        with (
            patch.dict(os.environ, {"DB_URL": MYSQL_URL}),
            patch.object(LAMBDA.boto3, "client", create=True) as client_mock,
        ):
            client_mock.return_value = fake_ssm
            credentials = LAMBDA.db_credentials({"sql_files": [], "s3_prefix": "sql/x/"})
        self.assertEqual(credentials, EXPECTED_CREDENTIALS)
        client_mock.assert_not_called()

    def test_empty_event_db_url_falls_through_to_env(self):
        with patch.dict(os.environ, {"DB_URL": MYSQL_URL}):
            credentials = LAMBDA.db_credentials({"db_url": ""})
        self.assertEqual(credentials, EXPECTED_CREDENTIALS)

    def test_ssm_fallback_reads_decrypted_default_prefix_url(self):
        fake_ssm = FakeSsmClient(MYSQL_URL)
        with patch.object(LAMBDA.boto3, "client", create=True) as client_mock:
            client_mock.return_value = fake_ssm
            credentials = LAMBDA.db_credentials({})
        self.assertEqual(credentials, EXPECTED_CREDENTIALS)
        client_mock.assert_called_once_with("ssm")
        self.assertEqual(
            fake_ssm.calls,
            [{"Name": "bible-on-site-tanah-db-url", "WithDecryption": True}],
        )

    def test_ssm_fallback_honors_ssm_prefix_env(self):
        fake_ssm = FakeSsmClient(MYSQL_URL)
        with (
            patch.dict(os.environ, {"SSM_PREFIX": "custom-db-prefix"}),
            patch.object(LAMBDA.boto3, "client", create=True) as client_mock,
        ):
            client_mock.return_value = fake_ssm
            LAMBDA.db_credentials({})
        self.assertEqual(
            fake_ssm.calls,
            [{"Name": "custom-db-prefix-url", "WithDecryption": True}],
        )

    def test_ssm_fallback_rejects_empty_parameter(self):
        fake_ssm = FakeSsmClient("")
        with patch.object(LAMBDA.boto3, "client", create=True) as client_mock:
            client_mock.return_value = fake_ssm
            with self.assertRaisesRegex(ValueError, "empty or missing"):
                LAMBDA.db_credentials({})

    def test_non_mysql_url_is_rejected_from_any_source(self):
        with patch.dict(os.environ, {"DB_URL": "postgres://u:p@h:5432/db"}):
            with self.assertRaisesRegex(ValueError, "mysql://"):
                LAMBDA.db_credentials({})

    def test_ssm_client_error_propagates(self):
        fake_ssm = FakeSsmClient(error=RuntimeError("ssm unavailable"))
        with patch.object(LAMBDA.boto3, "client", create=True) as client_mock:
            client_mock.return_value = fake_ssm
            with self.assertRaisesRegex(RuntimeError, "ssm unavailable"):
                LAMBDA.db_credentials({})


if __name__ == "__main__":
    unittest.main()
