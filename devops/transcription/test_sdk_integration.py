"""Opt-in boto3 HTTP transport checks against an isolated loopback S3 fixture."""

# Run with TRANSCRIPTION_TEST_S3=1 and boto3 installed. No production AWS
# identity, configuration, endpoint or recording is used.

from contextlib import contextmanager
import hashlib
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import os
from pathlib import Path
import secrets
import socket
from tempfile import TemporaryDirectory
from threading import Thread
import unittest
from unittest.mock import patch
from urllib.parse import quote

from devops.transcription.model import Segment, Transcript
from devops.transcription.pipeline import run
from devops.transcription.sources import SourceError


@contextmanager
def local_s3_response(directory: Path, body: bytes, status: int = 200):
    """Serve one SDK response using only temporary, fake loopback credentials."""
    requests = []

    class Handler(BaseHTTPRequestHandler):
        """Capture the actual SDK request without logging authentication headers."""

        def do_GET(self):
            requests.append((self.command, self.path))
            self.send_response(status)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Content-Type", "application/octet-stream" if status == 200 else "application/xml")
            self.send_header("ETag", '"fixture-etag"')
            self.send_header("x-amz-version-id", "fixture-version")
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, format, *args):
            """Keep local fixture access and error logs out of test output."""

    with HTTPServer(("127.0.0.1", 0), Handler) as server:
        worker = Thread(target=server.serve_forever, daemon=True)
        worker.start()
        # Replace the environment for this context, including ambient proxy and
        # profile settings. Explicit absent config files and disabled metadata
        # prevent discovery of real credentials even on a developer's machine.
        environment = {
            "AWS_ACCESS_KEY_ID": "transcription-fixture",
            "AWS_SECRET_ACCESS_KEY": secrets.token_hex(20),
            "AWS_DEFAULT_REGION": "us-east-1",
            "AWS_REGION": "us-east-1",
            "AWS_ENDPOINT_URL_S3": f"http://127.0.0.1:{server.server_port}",
            "AWS_CONFIG_FILE": str(directory / "absent-aws-config"),
            "AWS_SHARED_CREDENTIALS_FILE": str(directory / "absent-aws-credentials"),
            "AWS_EC2_METADATA_DISABLED": "true",
            "NO_PROXY": "127.0.0.1,localhost",
        }
        resolve = socket.getaddrinfo

        def loopback_only(host, *args, **kwargs):
            if host != "127.0.0.1":
                raise AssertionError("The SDK fixture attempted a non-loopback connection")
            return resolve(host, *args, **kwargs)

        try:
            with patch.dict(os.environ, environment, clear=True), patch("socket.getaddrinfo", side_effect=loopback_only):
                yield requests
        finally:
            server.shutdown()
            worker.join()


class FixtureTranscriber:
    """Assert the transport delivered original bytes before returning known speech."""

    def __init__(self, expected: bytes):
        """Retain expected bytes without loading any real inference runtime."""
        self.expected = expected
        self.recording_path = None

    def transcribe(self, path: Path) -> Transcript:
        self.recording_path = path
        if path.read_bytes() != self.expected:
            raise AssertionError("The SDK download changed the media bytes")
        return Transcript(
            segments=(Segment(0.0, 1.0, "שלום עולם"),),
            language="he",
            language_probability=1.0,
            duration=2.0,
            model={"model_id": "fixture/local", "revision": "0" * 40},
        )


@unittest.skipUnless(os.environ.get("TRANSCRIPTION_TEST_S3") == "1", "Set TRANSCRIPTION_TEST_S3=1 for local SDK transport checks")
class SdkTransportTests(unittest.TestCase):
    """Validate actual boto3 encoding and errors without a live AWS connection."""

    def test_actual_sdk_exports_exact_hebrew_and_punctuation_archive_key(self):
        recording = b"opaque recording bytes\x00\xff"
        key = "authors/מחבר/תיקייה/שיעור #1? %20.mp3"
        source_uri = f"s3://private-archive/{key}"
        backend = FixtureTranscriber(recording)
        with TemporaryDirectory() as temporary:
            directory = Path(temporary)
            with local_s3_response(directory, recording) as requests:
                result = run(source_uri, directory / "exports", transcriber=backend)
            self.assertEqual(requests, [("GET", f"/private-archive/{quote(key, safe='/')}")])
            manifest = json.loads((result.directory / "transcript.json").read_text(encoding="utf-8"))
            self.assertEqual(manifest["source"], {
                "uri": source_uri,
                "filename": "שיעור #1? %20.mp3",
                "sha256": hashlib.sha256(recording).hexdigest(),
                "metadata": {"contentLength": len(recording), "etag": '"fixture-etag"', "versionId": "fixture-version"},
            })
            self.assertEqual((result.directory / "article.html").read_text(encoding="utf-8"), "<p>שלום עולם</p>\n")
            self.assertFalse(backend.recording_path.exists())

    def test_actual_sdk_access_denial_has_no_export_or_inference(self):
        denied = b"<Error><Code>AccessDenied</Code><Message>Fixture denies access</Message></Error>"
        backend = FixtureTranscriber(b"unused")
        with TemporaryDirectory() as temporary:
            directory = Path(temporary)
            with local_s3_response(directory, denied, status=403) as requests:
                with self.assertRaisesRegex(SourceError, "#3277.*admin service role"):
                    run("s3://private-archive/authors/author/lecture.mp3", directory / "exports", transcriber=backend)
            self.assertEqual(requests, [("GET", "/private-archive/authors/author/lecture.mp3")])
            self.assertIsNone(backend.recording_path)
            self.assertFalse((directory / "exports").exists())


if __name__ == "__main__":
    unittest.main()
