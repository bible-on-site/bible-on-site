"""Exercise local files and isolated, streamed S3 input materialization."""

import hashlib
from io import BytesIO
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from sources import CHUNK_BYTES, SourceError, materialize_source


class FakeAwsError(Exception):
    """Represent botocore failures without installing optional dependencies."""


class SourcesTests(unittest.TestCase):
    def test_local_media_preserves_file_and_records_hash(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "שיעור.mp3"
            path.write_bytes(b"media")
            with materialize_source(str(path)) as media:
                snapshot = media.path
                self.assertNotEqual(media.path, path.resolve())
                self.assertEqual(media.path.suffix, ".mp3")
                self.assertEqual(media.path.read_bytes(), b"media")
                self.assertEqual(media.filename, path.name)
                self.assertEqual(media.uri, path.resolve().as_uri())
                self.assertEqual(media.sha256, hashlib.sha256(b"media").hexdigest())
                self.assertEqual(media.metadata, {"contentLength": 5})
            self.assertFalse(snapshot.parent.exists())
            self.assertEqual(path.read_bytes(), b"media")

    def test_local_snapshot_does_not_change_when_original_is_edited(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "lecture"
            path.write_bytes(b"original")
            with materialize_source(str(path)) as media:
                path.write_bytes(b"edited")
                self.assertEqual(media.path.read_bytes(), b"original")
                self.assertEqual(media.path.suffix, "")
                self.assertEqual(media.sha256, hashlib.sha256(b"original").hexdigest())

    def test_local_snapshot_is_removed_when_consumer_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "lecture.mp3"
            path.write_bytes(b"original")
            consumer = Mock(side_effect=ValueError("consumer failed"))
            with self.assertRaises(ValueError):
                with materialize_source(str(path)) as media:
                    snapshot = media.path
                    consumer(snapshot)
            consumer.assert_called_once_with(snapshot)
            self.assertFalse(snapshot.parent.exists())
            self.assertEqual(path.read_bytes(), b"original")

    def test_local_rejects_missing_directory_and_empty_file(self):
        with tempfile.TemporaryDirectory() as directory:
            empty = Path(directory) / "empty.wav"
            empty.touch()
            for source in (directory, str(empty), str(Path(directory) / "missing")):
                with self.subTest(source=source), self.assertRaises(SourceError):
                    with materialize_source(source):
                        self.fail("Invalid media must not be yielded")

    def test_s3_streams_literal_key_and_cleans_up(self):
        content = b"a" * (CHUNK_BYTES + 3)
        body = Mock(wraps=BytesIO(content))
        client = Mock()
        client.get_object.return_value = {
            "Body": body,
            "ContentLength": len(content),
            "ETag": '"etag"',
            "VersionId": "version-1",
        }
        session = Mock()
        session.client.return_value = client
        boto3 = SimpleNamespace(Session=Mock(return_value=session))
        with self.aws_modules(boto3):
            with materialize_source(
                "s3://private-archive/authors/הרב מחבר/nested/lecture%20name.mp4",
                aws_profile="existing-profile",
            ) as media:
                temporary_path = media.path
                self.assertEqual(media.path.read_bytes(), content)
                self.assertEqual(media.filename, "lecture%20name.mp4")
                self.assertEqual(media.sha256, hashlib.sha256(content).hexdigest())
                self.assertEqual(media.metadata, {
                    "contentLength": len(content), "etag": '"etag"', "versionId": "version-1",
                })
                self.assertTrue(media.uri.startswith("s3://private-archive/"))
            self.assertFalse(temporary_path.exists())
        boto3.Session.assert_called_once_with(profile_name="existing-profile")
        session.client.assert_called_once_with("s3")
        client.get_object.assert_called_once_with(
            Bucket="private-archive", Key="authors/הרב מחבר/nested/lecture%20name.mp4",
        )
        self.assertEqual(body.read.call_count, 3)
        body.read.assert_called_with(CHUNK_BYTES)
        body.close.assert_called_once_with()

    @staticmethod
    def aws_modules(boto3):
        exceptions = SimpleNamespace(BotoCoreError=FakeAwsError, ClientError=FakeAwsError)
        modules = {"boto3": boto3, "botocore.exceptions": exceptions}
        return patch("sources.importlib.import_module", side_effect=modules.__getitem__)

    def fake_download(self, response):
        client = Mock()
        client.get_object.return_value = response
        return SimpleNamespace(Session=Mock(return_value=SimpleNamespace(client=Mock(return_value=client))))

    def test_s3_default_credential_chain_and_absent_optional_metadata(self):
        boto3 = self.fake_download({"Body": BytesIO(b"audio")})
        with self.aws_modules(boto3), materialize_source("s3://bucket/file") as media:
            self.assertEqual(media.metadata, {"contentLength": 5})
        boto3.Session.assert_called_once_with(profile_name=None)

    def test_s3_archive_punctuation_is_always_literal_key_content(self):
        keys = (
            "authors/מחבר/שיעור#1.mp3",
            "authors/מחבר/שיעור?.mp3",
            "authors/מחבר/שיעור%20ראשון.mp3",
            "authors/מחבר/שיעור?versionId=x#part%20one.mp3",
            "authors/מחבר/שיעור?",
            "authors/מחבר/שיעור#",
        )
        for key in keys:
            boto3 = self.fake_download({"Body": BytesIO(b"audio")})
            with self.subTest(key=key), self.aws_modules(boto3):
                with materialize_source(f"s3://archive/{key}") as media:
                    self.assertEqual(media.filename, key.rsplit("/", 1)[1])
                    self.assertEqual(media.uri, f"s3://archive/{key}")
                client = boto3.Session.return_value.client.return_value
                client.get_object.assert_called_once_with(Bucket="archive", Key=key)

    def test_s3_cleanup_when_consumer_fails(self):
        body = Mock(wraps=BytesIO(b"audio"))
        consumer = Mock(side_effect=ValueError("consumer failed"))
        with self.aws_modules(self.fake_download({"Body": body})):
            with self.assertRaisesRegex(ValueError, "consumer failed"):
                with materialize_source("s3://bucket/file") as media:
                    path = media.path
                    consumer(path)
        consumer.assert_called_once_with(path)
        self.assertFalse(path.parent.exists())
        body.close.assert_called_once_with()

    def test_s3_empty_or_truncated_download_is_rejected_and_closed(self):
        for content, expected in ((b"", 0), (b"short", 10), (b"longer", 2)):
            body = Mock(wraps=BytesIO(content))
            response = {"Body": body, "ContentLength": expected}
            with self.subTest(content=content), self.aws_modules(self.fake_download(response)):
                with self.assertRaises(SourceError):
                    with materialize_source("s3://bucket/file"):
                        self.fail("Incomplete media must not be yielded")
            body.close.assert_called_once_with()

    def test_s3_stream_failure_is_actionable_and_closes_body(self):
        body = Mock()
        body.read.side_effect = FakeAwsError("private credential detail")
        with self.aws_modules(self.fake_download({"Body": body})):
            with self.assertRaisesRegex(SourceError, "finish downloading") as raised:
                with materialize_source("s3://bucket/file"):
                    self.fail("Failed download must not be yielded")
        self.assertNotIn("private credential detail", str(raised.exception))
        body.close.assert_called_once_with()

    def test_s3_access_failure_explains_archive_policy_without_credentials(self):
        session = Mock()
        session.client.return_value.get_object.side_effect = FakeAwsError("secret token")
        boto3 = SimpleNamespace(Session=Mock(return_value=session))
        with self.aws_modules(boto3):
            with self.assertRaisesRegex(SourceError, "#3277.*admin service role") as raised:
                with materialize_source("s3://bucket/file"):
                    self.fail("Denied media must not be yielded")
        self.assertNotIn("secret token", str(raised.exception))

    def test_s3_session_failure_has_same_access_guidance(self):
        boto3 = SimpleNamespace(Session=Mock(side_effect=FakeAwsError("missing profile")))
        with self.aws_modules(boto3), self.assertRaisesRegex(SourceError, "download the file through admin"):
            with materialize_source("s3://bucket/file", aws_profile="absent"):
                self.fail("Missing profile must not be yielded")

    def test_s3_missing_dependency_explains_install(self):
        with patch("sources.importlib.import_module", side_effect=ImportError("boto3")):
            with self.assertRaisesRegex(SourceError, "requires boto3"):
                with materialize_source("s3://bucket/file"):
                    self.fail("Missing dependencies must not proceed")

    def test_invalid_s3_and_other_urls_fail_before_boto3_import(self):
        invalid = (
            "s3://bucket", "s3:///file", "s3://bucket/", "s3://bucket/folder/",
            "s3://user:password@bucket/file", "s3://bucket:443/file",
            "s3://[invalid/file", "s3://bucket/a\nb",
            "s3://bucket/a\tb", "s3://bucket/a\x00b", "https://example.test/media.mp3",
            "file:///tmp/media.mp3", "S3://bucket/file",
        )
        with patch("sources.importlib.import_module") as imported:
            for source in invalid:
                with self.subTest(source=source), self.assertRaises(SourceError):
                    with materialize_source(source):
                        self.fail("Invalid URI must not be yielded")
        imported.assert_not_called()


if __name__ == "__main__":
    unittest.main()
