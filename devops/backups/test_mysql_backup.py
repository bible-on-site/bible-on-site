"""Fail-closed backup, publication, credential and restoration regressions."""

import base64
import gzip
import hashlib
import io
import json
import os
import subprocess  # nosec B404 # Only constants and mocked subprocesses are used here.
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import boto3
from botocore.exceptions import BotoCoreError
from botocore.stub import Stubber

import mysql_backup as backup
import restore_backup as recovery
from integration_test import MemoryS3


class Process:
    def __init__(self, data=b"dump contents", code=0, broken=False):
        """Provide fixture pipes and the requested exit or write failure."""
        self.stdout = io.BytesIO(data)
        self.stdin = MagicMock()
        if broken:
            self.stdin.write.side_effect = BrokenPipeError()
        self.code = code

    def __enter__(self):
        """Enter the simulated subprocess context."""
        return self

    def __exit__(self, *args):
        """Preserve exceptions from the operation under test."""
        return False

    def wait(self):
        return self.code


class BackupTests(unittest.TestCase):
    def setUp(self):
        self.enterContext(
            patch.object(
                backup.shutil,
                "which",
                side_effect=lambda tool: str(Path(self.temp.name, tool).resolve()),
            )
        )
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.source = backup.Database(
            "db.example.test", 3306, "bos_backup", 'p\\a"ss\nword', "tanah", "ca.pem"
        )
        self.scratch = backup.Database(
            "127.0.0.1", 3306, "root", "fixture-only", "tanah"
        )
        self.path = self.directory / "application.sql.gz"
        with gzip.open(self.path, "wb") as output:
            output.write(b"CREATE DATABASE tanah;\n")
        self.schema = {
            "TABLES": [{"name": "entry", "type": "BASE TABLE", "engine": "InnoDB"}]
        }
        self.restoration = {
            "schemaSha256": backup.fingerprint(self.schema),
            "tables": {"entry": {"rows": 2, "checksum": "42"}},
        }
        self.s3 = MemoryS3()

    def mock_backup(self, **changes):
        patches = {
            "server_identity": {"uuid": "production", "version": "8.4.9"},
            "catalog": self.schema,
            "validate_scratch": None,
            "dump_archive": None,
            "restore_archive": self.restoration,
        }
        patches.update(changes)
        for name, result in patches.items():
            self.enterContext(patch.object(backup, name, return_value=result))

    def manifest(self):
        self.mock_backup()
        return backup.backup(
            self.source,
            self.scratch,
            self.s3,
            "weekly",
            self.directory,
            now=datetime(2026, 11, 2, tzinfo=UTC),
            run="123",
        )

    def test_database_url_does_not_expose_credentials(self):
        value = backup.Database.from_url(
            "mysql://bos_backup:p%40ss@host:3307/tanah", "root-ca.pem"
        )
        self.assertEqual(value.password, "p@ss")
        self.assertNotIn("p@ss", repr(value))
        for url in [
            "https://user:password@host/tanah",
            "mysql://user@host/tanah",
            "mysql://a:b@host/tanah?tls=off",
            "mysql://a:b@host:bad/tanah",
            "mysql://a:b@host/tanah#fragment",
        ]:
            with self.subTest(url=url), self.assertRaises(backup.BackupError):
                backup.Database.from_url(url)

    def test_identifiers_reject_sql_and_system_path_characters(self):
        self.assertEqual(backup.identifier("revision_123"), "`revision_123`")
        for name in ["", "tanah; DROP DATABASE mysql", "a`b", "a/b", "x" * 65]:
            with self.assertRaises(backup.BackupError):
                backup.identifier(name)

    def test_private_defaults_and_verified_tls(self):
        path = self.source.defaults(self.directory)
        text = path.read_text()
        self.assertIn('password="p\\\\a\\"ss\\nword"', text)
        if os.name != "nt":
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        args = self.source.command("mysqldump", path)
        self.assertEqual(args[1], f"--defaults-file={path}")
        self.assertIn("--ssl-mode=VERIFY_IDENTITY", args)
        self.assertNotIn(self.source.password, " ".join(args))
        self.assertNotIn("--get-server-public-key", args)
        scratch_args = self.scratch.command("mysql", path)
        self.assertIn("--ssl-mode=DISABLED", scratch_args)
        # The cold-cache caching_sha2_password login on the loopback-only
        # scratch path needs the RSA key exchange (MySQL error 2061 without it).
        self.assertIn("--get-server-public-key", scratch_args)
        self.source.ca = None
        with self.assertRaises(backup.BackupError):
            self.source.command("mysql", path)

    def test_executable_requires_an_installed_allowlisted_mysql_tool(self):
        self.assertTrue(Path(self.source.executable("mysql")).is_absolute())
        with self.assertRaisesRegex(backup.BackupError, "Unsupported"):
            self.source.executable("sh")
        with patch.object(backup.shutil, "which", return_value=None):
            with self.assertRaisesRegex(backup.BackupError, "unavailable"):
                self.source.executable("mysql")

    def test_query_credentials_are_removed_on_success_and_failure(self):
        with patch.object(
            backup.subprocess,
            "run",
            return_value=SimpleNamespace(returncode=0, stdout=b"one\ntwo\n"),
        ) as command:
            self.assertEqual(
                self.source.query("SELECT 1;", self.directory, "phase"),
                ["one", "two"],
            )
            self.assertEqual(command.call_args.kwargs["stderr"], subprocess.PIPE)
            self.assertFalse(command.call_args.kwargs["shell"])
        with (
            patch.object(
                backup.subprocess,
                "run",
                return_value=SimpleNamespace(returncode=1, stdout=b"", stderr=b""),
            ),
            self.assertRaises(backup.BackupError),
        ):
            self.source.query("SELECT 1;", self.directory, "phase")
        self.assertFalse(list(self.directory.glob("client-*.cnf")))

    def test_query_failure_reports_phase_and_code_without_stderr(self):
        stderr = b'ERROR 2061 (HY000): plugin text secret p\\a"ss\nword detail'
        with patch.object(
            backup.subprocess,
            "run",
            return_value=SimpleNamespace(returncode=1, stdout=b"", stderr=stderr),
        ):
            with self.assertRaises(backup.BackupError) as caught:
                self.scratch.query("SELECT 1;", self.directory, "Scratch phase")
            message = str(caught.exception)
            self.assertIn("Scratch phase", message)
            self.assertIn("2061", message)
            self.assertNotIn("secret", message)
            self.assertNotIn("plugin text", message)
        with patch.object(
            backup.subprocess,
            "run",
            return_value=SimpleNamespace(
                returncode=1, stdout=b"", stderr=b"unstructured detail"
            ),
        ):
            with self.assertRaises(backup.BackupError) as caught:
                self.scratch.query("SELECT 1;", self.directory, "Scratch phase")
            self.assertEqual(str(caught.exception), "Scratch phase failed")

    def test_identity_requires_exactly_one_json_row(self):
        self.source.query = MagicMock(return_value=[json.dumps({"uuid": "a"})])
        self.assertEqual(
            backup.server_identity(self.source, self.directory, "phase"),
            {"uuid": "a"},
        )
        self.source.query.return_value = []
        with self.assertRaises(backup.BackupError):
            backup.server_identity(self.source, self.directory, "phase")

    def test_catalog_rejects_inconsistent_engines_and_empty_database(self):
        for rows in [[], [{"type": "BASE TABLE", "engine": "MyISAM"}]]:
            self.source.query = MagicMock(
                side_effect=lambda sql, directory, phase: (
                    [json.dumps(r) for r in rows] if ".TABLES " in sql else []
                )
            )
            with self.assertRaises(backup.BackupError):
                backup.catalog(self.source, self.directory, "phase")

    def test_export_uses_complete_nonlocking_dump_and_detects_failure(self):
        for code in [0, 1]:
            with patch.object(
                backup.subprocess, "Popen", return_value=Process(code=code)
            ) as command:
                if code:
                    with self.assertRaises(backup.BackupError):
                        backup.dump_archive(self.source, self.path, self.directory)
                else:
                    backup.dump_archive(self.source, self.path, self.directory)
                    self.assertEqual(
                        gzip.decompress(self.path.read_bytes()), b"dump contents"
                    )
                args = command.call_args.args[0]
                for flag in [
                    "--single-transaction",
                    "--no-tablespaces",
                    "--set-gtid-purged=OFF",
                    "--routines",
                    "--events",
                    "--triggers",
                    "--hex-blob",
                ]:
                    self.assertIn(flag, args)
                self.assertFalse(any("ignore-table" in arg for arg in args))
        self.assertFalse(list(self.directory.glob("client-*.cnf")))
        self.assertFalse(list(self.directory.glob("*.stderr")))

    def test_restore_refuses_remote_wrong_schema_or_corrupt_archive(self):
        for target in [
            self.source,
            backup.Database("127.0.0.1", 3306, "root", "x", "other"),
        ]:
            with self.assertRaises(backup.BackupError):
                backup.restore_archive(
                    target,
                    self.path,
                    self.directory,
                    "production",
                    backup.digest(self.path),
                )
        with self.assertRaisesRegex(backup.BackupError, "SHA-256"):
            backup.restore_archive(
                self.scratch, self.path, self.directory, "production", "0" * 64
            )

    def test_restore_refuses_source_server_enabled_events_and_existing_schema(self):
        for identity, rows in [
            ({"uuid": "production", "events": "OFF"}, []),
            ({"uuid": "scratch", "events": "ON"}, []),
            ({"uuid": "scratch", "events": "OFF", "version": "8.4.9"}, ["tanah"]),
            ({"uuid": "scratch", "events": "OFF", "version": "8.0.40"}, []),
        ]:
            with patch.object(backup, "server_identity", return_value=identity):
                self.scratch.query = MagicMock(return_value=rows)
                with self.assertRaises(backup.BackupError):
                    backup.restore_archive(
                        self.scratch,
                        self.path,
                        self.directory,
                        "production",
                        backup.digest(self.path),
                    )

    def test_restore_detects_import_exit_and_broken_pipe(self):
        for process in [Process(code=1), Process(broken=True)]:
            with (
                patch.object(
                    backup,
                    "server_identity",
                    return_value={
                        "uuid": "scratch",
                        "events": "OFF",
                        "version": "8.4.9",
                    },
                ),
                patch.object(backup.subprocess, "Popen", return_value=process),
            ):
                self.scratch.query = MagicMock(return_value=[])
                with self.assertRaises(backup.BackupError):
                    backup.restore_archive(
                        self.scratch,
                        self.path,
                        self.directory,
                        "production",
                        backup.digest(self.path),
                    )
        self.assertFalse(list(self.directory.glob("client-*.cnf")))
        self.assertFalse(list(self.directory.glob("*.stderr")))

    def test_scratch_is_validated_before_the_complete_export(self):
        self.mock_backup()
        calls = []
        backup.validate_scratch.side_effect = lambda *args: calls.append("scratch")
        backup.dump_archive.side_effect = lambda *args: calls.append("export")
        backup.backup(self.source, self.scratch, self.s3, "weekly", self.directory)
        self.assertEqual(calls, ["scratch", "export"])

    def test_multipart_checksum_version_retention_and_abort(self):
        until = datetime(2027, 1, 1, tzinfo=UTC)
        self.assertEqual(
            backup.upload_archive(self.s3, self.path, "weekly/key", until),
            "archive-version",
        )
        for method, value in [
            ("upload_part", {"ChecksumSHA256": "wrong"}),
            ("complete_multipart_upload", {}),
        ]:
            s3 = MagicMock(wraps=MemoryS3())
            getattr(s3, method).return_value = value
            with self.assertRaises(backup.BackupError):
                backup.upload_archive(s3, self.path, "weekly/key", until)
            if method == "upload_part":
                s3.abort_multipart_upload.assert_called_once()
            else:
                s3.abort_multipart_upload.assert_not_called()
        self.path.write_bytes(b"")
        s3 = MagicMock(wraps=MemoryS3())
        with self.assertRaises(backup.BackupError):
            backup.upload_archive(s3, self.path, "weekly/key", until)
        s3.abort_multipart_upload.assert_called_once()

    def test_sdk_accepts_real_multipart_request_shapes(self):
        s3 = boto3.client(  # nosec B106 # Stubber's public dummy credentials, never AWS.
            "s3",
            region_name=backup.REGION,
            aws_access_key_id="testing",
            aws_secret_access_key="testing",
        )
        checksum = base64.b64encode(
            hashlib.sha256(self.path.read_bytes()).digest()
        ).decode()
        with Stubber(s3) as stub:
            stub.add_response("create_multipart_upload", {"UploadId": "upload"})
            stub.add_response(
                "upload_part", {"ETag": '"etag"', "ChecksumSHA256": checksum}
            )
            stub.add_response("complete_multipart_upload", {"VersionId": "version"})
            self.assertEqual(
                backup.upload_archive(s3, self.path, "weekly/test", datetime.now(UTC)),
                "version",
            )
            stub.assert_no_pending_responses()

    def test_verified_backup_publishes_manifest_last_with_exact_version(self):
        result = self.manifest()
        key = result["key"].replace("application.sql.gz", "manifest.json")
        manifest = json.loads(self.s3.objects[(key, "manifest-version")])
        self.assertEqual(manifest["versionId"], "archive-version")
        self.assertEqual(manifest["retainUntil"], "2026-12-28T00:00:00+00:00")
        self.assertNotIn(self.source.password, json.dumps(manifest))
        self.assertEqual(manifest["restoration"], self.restoration)

    def test_monthly_retention(self):
        self.mock_backup()
        result = backup.backup(
            self.source,
            self.scratch,
            self.s3,
            "monthly",
            self.directory,
            now=datetime(2026, 11, 2, tzinfo=UTC),
        )
        self.assertEqual(result["retainUntil"], "2027-11-03T00:00:00+00:00")

    def test_no_publication_after_schema_drift_or_failed_restore(self):
        self.mock_backup()
        backup.catalog.side_effect = [self.schema, {}]
        with self.assertRaises(backup.BackupError):
            backup.backup(self.source, self.scratch, self.s3, "weekly", self.directory)
        self.assertEqual(self.s3.objects, {})
        backup.catalog.side_effect = None
        backup.restore_archive.return_value = {"schemaSha256": "different"}
        with self.assertRaises(backup.BackupError):
            backup.backup(self.source, self.scratch, self.s3, "weekly", self.directory)
        self.assertEqual(self.s3.objects, {})
        with self.assertRaises(backup.BackupError):
            backup.backup(self.source, self.scratch, self.s3, "daily", self.directory)

    def test_failed_manifest_is_not_reported_as_success(self):
        self.mock_backup()
        self.s3.put_object = MagicMock(return_value={})
        with self.assertRaises(backup.BackupError):
            backup.backup(self.source, self.scratch, self.s3, "weekly", self.directory)

    def test_version_pinned_restore_and_corrupt_size_or_content(self):
        result = self.manifest()
        key = result["key"].replace("application.sql.gz", "manifest.json")
        with patch.object(
            recovery, "restore_archive", return_value=self.restoration
        ) as restore:
            self.assertEqual(
                recovery.restore(
                    self.s3,
                    key,
                    "manifest-version",
                    self.scratch,
                    self.directory / "download",
                ),
                self.restoration,
            )
            self.assertEqual(restore.call_args.args[-1], result["sha256"])
        self.s3.objects[(result["key"], "archive-version")] = b"x"
        with self.assertRaises(backup.BackupError):
            recovery.restore(
                self.s3,
                key,
                "manifest-version",
                self.scratch,
                self.directory / "download2",
            )

    def test_manifest_rejects_cross_account_wrong_archive_and_unversioned_inputs(self):
        result = self.manifest()
        key = result["key"].replace("application.sql.gz", "manifest.json")
        for field, value in [
            ("account", "000000000000"),
            ("key", "outside/path"),
            ("versionId", "null"),
            ("sha256", "bad"),
            ("bytes", 0),
            ("restoration", {}),
        ]:
            invalid = {**result, field: value}
            self.s3.objects[(key, "manifest-version")] = json.dumps(invalid).encode()
            with self.assertRaises(backup.BackupError):
                recovery.read_manifest(self.s3, key, "manifest-version")
        for bad_key, version in [("other/manifest.json", "version"), (key, "null")]:
            with self.assertRaises(backup.BackupError):
                recovery.read_manifest(self.s3, bad_key, version)
        self.s3.objects[(key, "manifest-version")] = b"x" * (1024 * 1024 + 1)
        with self.assertRaises(backup.BackupError):
            recovery.read_manifest(self.s3, key, "manifest-version")


class PreflightTests(unittest.TestCase):
    def setUp(self):
        self.session = MagicMock()
        self.clients = {name: MagicMock() for name in ["sts", "rds", "ssm", "s3"]}
        self.session.client.side_effect = self.clients.__getitem__
        self.clients["sts"].get_caller_identity.return_value = {
            "Account": backup.ACCOUNT
        }
        self.instance = {
            "DBInstanceStatus": "available",
            "Engine": "mysql",
            "EngineVersion": "8.4.9",
            "VpcSecurityGroups": [{"VpcSecurityGroupId": "sg-fixture"}],
            "Endpoint": {"Address": "db.example.test", "Port": 3306},
        }
        self.clients["rds"].describe_db_instances.return_value = {
            "DBInstances": [self.instance]
        }
        self.clients["ssm"].get_parameter.return_value = {
            "Parameter": {
                "Value": "mysql://bos_backup:fixture-only@db.example.test:3306/tanah"
            }
        }
        s3 = self.clients["s3"]
        s3.get_bucket_versioning.return_value = {"Status": "Enabled"}
        self.lock = {
            "ObjectLockEnabled": "Enabled",
            "Rule": {"DefaultRetention": {"Mode": "GOVERNANCE", "Days": 56}},
        }
        s3.get_object_lock_configuration.return_value = {
            "ObjectLockConfiguration": self.lock
        }
        s3.get_public_access_block.return_value = {
            "PublicAccessBlockConfiguration": {
                key: True
                for key in [
                    "BlockPublicAcls",
                    "IgnorePublicAcls",
                    "BlockPublicPolicy",
                    "RestrictPublicBuckets",
                ]
            }
        }
        self.temp = self.enterContext(tempfile.TemporaryDirectory())
        self.enterContext(patch.dict(os.environ, {"RDS_SECURITY_GROUP": "sg-fixture"}))
        self.enterContext(
            patch.object(
                backup, "urlopen", return_value=io.BytesIO(b"test certificate")
            )
        )

    def test_preflight_and_each_safety_rejection(self):
        source, s3 = backup.preflight(self.session, self.temp)
        self.assertEqual(source.username, "bos_backup")
        self.assertIs(s3, self.clients["s3"])
        cases = [
            (self.clients["sts"].get_caller_identity, {"Account": "0"}),
            (
                self.clients["rds"].describe_db_instances,
                {"DBInstances": [{**self.instance, "DBInstanceStatus": "stopped"}]},
            ),
            (
                self.clients["rds"].describe_db_instances,
                {"DBInstances": [{**self.instance, "EngineVersion": "9.0.0"}]},
            ),
            (
                self.clients["rds"].describe_db_instances,
                {"DBInstances": [{**self.instance, "VpcSecurityGroups": []}]},
            ),
            (
                self.clients["ssm"].get_parameter,
                {
                    "Parameter": {
                        "Value": "mysql://admin:fixture-only@db.example.test/tanah"
                    }
                },
            ),
            (s3.get_bucket_versioning, {"Status": "Suspended"}),
            (
                s3.get_object_lock_configuration,
                {"ObjectLockConfiguration": {"ObjectLockEnabled": "Disabled"}},
            ),
            (s3.get_public_access_block, {"PublicAccessBlockConfiguration": {}}),
        ]
        for method, invalid in cases:
            previous = method.return_value
            method.return_value = invalid
            backup.urlopen.return_value = io.BytesIO(b"test certificate")
            with self.assertRaises(backup.BackupError):
                backup.preflight(self.session, self.temp)
            method.return_value = previous

    def test_backup_cli_success_and_sanitized_failure(self):
        for error in [None, backup.BackupError("safe message"), BotoCoreError()]:
            with (
                patch.dict(
                    os.environ,
                    {
                        "AWS_REGION": backup.REGION,
                        "BACKUP_SCRATCH_URL": "mysql://root:fixture-only@127.0.0.1/tanah",
                    },
                ),
                patch.object(sys, "argv", ["backup", "weekly"]),
                patch.object(
                    backup, "preflight", return_value=(MagicMock(), MagicMock())
                ),
                patch.object(
                    backup,
                    "backup",
                    return_value={"key": "key", "versionId": "version"},
                    side_effect=error,
                ),
                redirect_stdout(io.StringIO()) as output,
            ):
                self.assertEqual(backup.main(), int(error is not None))
                self.assertNotIn("fixture-only", output.getvalue())
        with (
            patch.dict(os.environ, {"AWS_REGION": "wrong"}),
            patch.object(sys, "argv", ["backup", "weekly"]),
            redirect_stdout(io.StringIO()),
        ):
            self.assertEqual(backup.main(), 1)
        with (
            patch.dict(os.environ, {"AWS_REGION": backup.REGION}),
            patch.object(sys, "argv", ["backup", "check"]),
            patch.object(backup, "preflight", return_value=(MagicMock(), MagicMock())),
            patch.object(backup, "backup") as export,
            redirect_stdout(io.StringIO()),
        ):
            self.assertEqual(backup.main(), 0)
            export.assert_not_called()

    def test_restore_cli_success_and_failure(self):
        with (
            patch.dict(
                os.environ,
                {
                    "AWS_REGION": backup.REGION,
                    "BACKUP_SCRATCH_URL": "mysql://root:fixture-only@127.0.0.1/tanah",
                },
            ),
            patch.object(sys, "argv", ["restore", "key", "version"]),
            patch.object(boto3, "Session", return_value=self.session),
            patch.object(recovery, "restore", return_value={"tables": {"entry": {}}}),
            redirect_stdout(io.StringIO()),
        ):
            self.assertEqual(recovery.main(), 0)
            self.clients["sts"].get_caller_identity.return_value = {"Account": "wrong"}
            self.assertEqual(recovery.main(), 1)
        with (
            patch.dict(os.environ, {"AWS_REGION": "wrong"}),
            patch.object(sys, "argv", ["restore", "key", "version"]),
            redirect_stdout(io.StringIO()),
        ):
            self.assertEqual(recovery.main(), 1)


if __name__ == "__main__":
    unittest.main()
