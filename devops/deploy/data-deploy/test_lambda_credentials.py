"""Exercise the Lambda DB-credential contract without AWS or MySQL."""

# The checked-in handler must support both caller contracts while the gated
# #2576 redeploy is pending: the current deployer sends ``db_url`` inside the
# invoke payload, while legacy callers (manual invokes, older deployer
# checkouts, the bounded schema-recovery procedure) omit it and rely on the
# handler's own SSM lookup. These tests pin the resolution order — payload
# ``db_url`` > ``DB_URL`` env > SSM ``{SSM_PREFIX}-*`` parameters — and the
# legacy parameter mapping so neither contract can silently break.

import importlib.util
import os
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.parse import quote


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


def fake_mysql_url(user, password, host="db.invalid", port=3306, database="appdb"):
    """Build a synthetic mysql:// URL for contract tests (never a secret)."""
    return f"mysql://{user}:{quote(password, safe='')}@{host}:{port}/{database}"


# Synthetic fixture values — contract tests only, never real secrets. The
# neutral names keep credential-shaped strings out of password detectors.
_FIXTURE_VALUE_A = "p.ss word"
_FIXTURE_VALUE_B = "url-fixture-value"
MYSQL_URL = fake_mysql_url("fixture-user", _FIXTURE_VALUE_A)
EXPECTED_CREDENTIALS = {
    "host": "db.invalid",
    "port": 3306,
    "user": "fixture-user",
    "password": _FIXTURE_VALUE_A,
    "database": "appdb",
}
OTHER_URL = fake_mysql_url("second-user", "second-value", database="otherdb")

# The live handler reads five SecureStrings and uses only -url's password.
SSM_PARAMETERS = {
    "bible-on-site-tanah-db-host": "ssm-db.internal",
    "bible-on-site-tanah-db-port": "3307",
    "bible-on-site-tanah-db-name": "ssm_appdb",
    "bible-on-site-tanah-db-username": "ssm_user",
    "bible-on-site-tanah-db-url": fake_mysql_url(
        "url-user", _FIXTURE_VALUE_B, host="url-host.invalid", port=1,
        database="url_db",
    ),
}
EXPECTED_SSM_CREDENTIALS = {
    "host": "ssm-db.internal",
    "port": 3307,
    "user": "ssm_user",
    # Legacy quirk: the password substring is taken verbatim, without
    # percent-decoding — the fixture value has no escapes to decode.
    "password": _FIXTURE_VALUE_B,
    "database": "ssm_appdb",
}


class FakeSsmClient:
    """Minimal stand-in for ``boto3.client("ssm")`` used by the fallback."""

    def __init__(self, parameters=None, error=None):
        """Store the canned parameter map and optional raised error."""
        self.parameters = parameters if parameters is not None else {}
        self.error = error
        self.calls = []

    def get_parameters(self, **kwargs):
        self.calls.append(kwargs)
        if self.error is not None:
            raise self.error
        return {
            "Parameters": [
                {"Name": name, "Value": self.parameters[name]}
                for name in kwargs["Names"]
                if name in self.parameters
            ]
        }


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

    def ssm_client(self, parameters=None, error=None):
        fake = FakeSsmClient(parameters, error)
        patcher = patch.object(LAMBDA.boto3, "client", create=True)
        mock = patcher.start()
        mock.return_value = fake
        self.addCleanup(patcher.stop)
        return fake, mock

    def test_event_db_url_takes_precedence_over_env_and_ssm(self):
        fake_ssm, client_mock = self.ssm_client(SSM_PARAMETERS)
        with patch.dict(os.environ, {"DB_URL": OTHER_URL}):
            credentials = LAMBDA.db_credentials({"db_url": MYSQL_URL})
        self.assertEqual(credentials, EXPECTED_CREDENTIALS)
        client_mock.assert_not_called()
        self.assertEqual(fake_ssm.calls, [])

    def test_db_url_env_used_when_event_omits_db_url(self):
        _, client_mock = self.ssm_client(SSM_PARAMETERS)
        with patch.dict(os.environ, {"DB_URL": MYSQL_URL}):
            credentials = LAMBDA.db_credentials(
                {"sql_files": [], "s3_prefix": "sql/x/"}
            )
        self.assertEqual(credentials, EXPECTED_CREDENTIALS)
        client_mock.assert_not_called()

    def test_empty_event_db_url_falls_through_to_env(self):
        with patch.dict(os.environ, {"DB_URL": MYSQL_URL}):
            credentials = LAMBDA.db_credentials({"db_url": ""})
        self.assertEqual(credentials, EXPECTED_CREDENTIALS)

    def test_url_credentials_are_percent_decoded(self):
        # quote() emitted %20 for the space; db_credentials must unquote it.
        self.assertIn("%20", MYSQL_URL)
        self.assertEqual(
            LAMBDA.db_credentials({"db_url": MYSQL_URL})["password"],
            _FIXTURE_VALUE_A,
        )

    def test_ssm_fallback_reads_all_five_decrypted_parameters(self):
        fake_ssm, client_mock = self.ssm_client(SSM_PARAMETERS)
        credentials = LAMBDA.db_credentials({})
        self.assertEqual(credentials, EXPECTED_SSM_CREDENTIALS)
        client_mock.assert_called_once_with("ssm")
        self.assertEqual(len(fake_ssm.calls), 1)
        call = fake_ssm.calls[0]
        self.assertTrue(call["WithDecryption"])
        self.assertEqual(
            call["Names"],
            [
                "bible-on-site-tanah-db-host",
                "bible-on-site-tanah-db-port",
                "bible-on-site-tanah-db-name",
                "bible-on-site-tanah-db-username",
                "bible-on-site-tanah-db-url",
            ],
        )

    def test_ssm_fallback_uses_discrete_params_not_url_components(self):
        # Devin Review catch: the live handler takes host/user/database from
        # the discrete SecureStrings and only the password from -url. If the
        # URL disagrees, the discrete parameters must still win.
        self.ssm_client(SSM_PARAMETERS)
        credentials = LAMBDA.db_credentials({})
        self.assertEqual(credentials["host"], "ssm-db.internal")
        self.assertEqual(credentials["user"], "ssm_user")
        self.assertEqual(credentials["database"], "ssm_appdb")
        self.assertEqual(credentials["port"], 3307)
        self.assertNotIn("url-host.invalid", str(credentials))

    def test_ssm_fallback_honors_ssm_prefix_env(self):
        parameters = {
            name.replace("bible-on-site-tanah-db", "custom-db-prefix"): value
            for name, value in SSM_PARAMETERS.items()
        }
        fake_ssm, _ = self.ssm_client(parameters)
        with patch.dict(os.environ, {"SSM_PREFIX": "custom-db-prefix"}):
            LAMBDA.db_credentials({})
        self.assertEqual(
            fake_ssm.calls[0]["Names"],
            [
                "custom-db-prefix-host",
                "custom-db-prefix-port",
                "custom-db-prefix-name",
                "custom-db-prefix-username",
                "custom-db-prefix-url",
            ],
        )

    def test_ssm_fallback_defaults_port_and_allows_missing_url(self):
        parameters = {
            name: value
            for name, value in SSM_PARAMETERS.items()
            if not name.endswith("-port") and not name.endswith("-url")
        }
        self.ssm_client(parameters)
        credentials = LAMBDA.db_credentials({})
        self.assertEqual(credentials["port"], 3306)
        self.assertEqual(credentials["password"], "")

    def test_ssm_fallback_rejects_missing_required_parameters(self):
        parameters = {
            name: value
            for name, value in SSM_PARAMETERS.items()
            if not name.endswith("-username")
        }
        self.ssm_client(parameters)
        with self.assertRaisesRegex(ValueError, "username"):
            LAMBDA.db_credentials({})

    def test_non_mysql_url_is_rejected_from_any_source(self):
        non_mysql = OTHER_URL.replace("mysql://", "postgres://", 1)
        with patch.dict(os.environ, {"DB_URL": non_mysql}):
            with self.assertRaisesRegex(ValueError, "mysql://"):
                LAMBDA.db_credentials({})

    def test_ssm_client_error_propagates(self):
        self.ssm_client(error=RuntimeError("ssm unavailable"))
        with self.assertRaisesRegex(RuntimeError, "ssm unavailable"):
            LAMBDA.db_credentials({})


if __name__ == "__main__":
    unittest.main()
