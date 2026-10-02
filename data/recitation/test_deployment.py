import copy
import hashlib
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import tempfile
from threading import Thread
import unittest

from deployment import http_response, verify
from publish import extract


class DeploymentTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.database = Path(self.folder.name) / "perakim.json"
        self.audio = b"original fixture recording"
        self.cors = "*"
        self.mime = "audio/mpeg"
        self.version = "0.2.433"
        self.chapter = {"pesukim": [{"segments": [{"type": "qri", "value": "ברא",
            "recordingTimeFrame": {"from": "00:00:00.101", "to": "00:00:00.599"}}]}],
            "recitation": {"version": 1, "alignmentStatus": "ready", "audioUrl": "https://example.com/1_record.mp3",
                "audioSha256": hashlib.sha256(self.audio).hexdigest(), "textSha256": "canonical", "durationMs": 1000}}
        pending = copy.deepcopy(self.chapter)
        pending["recitation"]["alignmentStatus"] = "pending"
        pending["pesukim"][0]["segments"][0]["recordingTimeFrame"] = {"from": "00:00:00", "to": "00:00:00"}
        self.database.write_text(json.dumps([{"perekFrom": 1, "perakim": [self.chapter, pending]}]), encoding="utf-8")
        self.records = {1: extract(1, self.chapter), 2: extract(2, pending)}
        fixture = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def do_GET(self):
                self.send_response(200)
                if self.path.startswith("/api/recitation/"):
                    pid = int(self.path.split("/")[-1].split("?")[0])
                    self.send_header("X-Website-Version", fixture.version)
                    self.send_header("Content-Type", "application/json")
                    data = {**fixture.records[pid], "audioUrl": f"{fixture.origin}/recordings/{pid}_record.mp3"}
                    body = json.dumps(data).encode()
                else:
                    self.send_header("Content-Type", fixture.mime)
                    if fixture.cors:
                        self.send_header("Access-Control-Allow-Origin", fixture.cors)
                    body = fixture.audio
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.origin = f"http://127.0.0.1:{self.server.server_port}"
        self.thread = Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.folder.cleanup()

    def test_real_http_verification_is_repeatable_without_mutating_data(self):
        before = self.database.read_bytes()
        for _ in range(2):
            verify(self.origin, "0.2.433", self.database, check_audio=True)
        self.assertEqual(self.database.read_bytes(), before)

    def test_file_custom_and_credential_urls_cannot_read_files_or_connect(self):
        for url in (self.database.as_uri(), "ftp://127.0.0.1/recording.mp3", "http://user:password@127.0.0.1/"):
            with self.subTest(url=url), self.assertRaisesRegex(ValueError, "public HTTP"):
                with http_response(url):
                    self.fail("Forbidden scheme reached a response")

    def test_old_running_container_is_not_a_successful_deployment(self):
        self.version = "0.2.432"
        with self.assertRaisesRegex(ValueError, "not serving yet"):
            verify(self.origin, "0.2.433", self.database)

    def test_missing_changed_and_unapproved_word_timings_fail_deployment(self):
        original = copy.deepcopy(self.records)
        for record, change in ((1, "missing"), (1, "changed"), (2, "unapproved")):
            with self.subTest(change=change):
                self.records = copy.deepcopy(original)
                if change == "missing":
                    self.records[record]["words"] = []
                else:
                    self.records[record]["words"][0]["startMs"] = 102
                with self.assertRaisesRegex(ValueError, "intervals differ"):
                    verify(self.origin, "0.2.433", self.database)

    def test_browser_blocked_wrong_type_or_replaced_audio_fails_deployment(self):
        for attribute, value, message in (("cors", None, "CORS"), ("cors", "https://another.example", "CORS"),
                ("mime", "application/octet-stream", "audio/mpeg"), ("audio", b"different recording", "hash differs")):
            with self.subTest(attribute=attribute, value=value):
                original = getattr(self, attribute)
                setattr(self, attribute, value)
                with self.assertRaisesRegex(ValueError, message):
                    verify(self.origin, "0.2.433", self.database, check_audio=True)
                setattr(self, attribute, original)


if __name__ == "__main__":
    unittest.main()
