"""Source-bound listening and truthful verse-only feedback regression tests."""

from copy import deepcopy
from http.client import HTTPConnection
import json
from pathlib import Path
import shutil
import subprocess  # nosec B404: fixed fixture argv with no shell.
import tempfile
import threading
import unittest
from unittest.mock import patch
import wave

from alignment import Word, text_hash
from listening_review import (digest_file, hebrew_number, make_clip, make_server,
                              read_json, ReviewStore, validate_case, validate_decision)


class ListeningReviewTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.words = [Word(15, 1, "ויאמר"), Word(15, 3, "יהוה")]
        self.case = {
            "id": "191-15", "perekId": 191, "pasuk": 15, "label": "יהושע ד טו",
            "audioSha256": "audio", "textSha256": text_hash(self.words),
            "candidateSha256": "candidate", "clipSha256": "clip",
            "clipStartMs": 100, "clipEndMs": 1200,
            "words": [{"pasuk": 15, "segment": word.segment, "text": word.text,
                       "startMs": start, "endMs": end}
                      for word, start, end in zip(self.words, (200, 700), (600, 1100))],
            "audioPath": "private.mp3", "clipPath": str(self.root / "clip.wav"),
            "publicationStatus": "held",
        }
        self.manifest = {"audioSha256": "audio", "durationMs": 2000}
        self.queue = {"cases": [self.case], "queueSha256": "queue"}
        self.payload = {"caseId": "191-15", "candidateSha256": "candidate", "verdict": "good",
                        "verseHeard": True, "heardSegments": [1, 3], "note": ""}
        self.store = ReviewStore(self.root / "reviews.json", self.queue)

    def test_exact_canonical_candidates_only(self):
        validate_case(self.case, self.words, self.manifest)
        for mutate in (
                lambda case: case["words"].pop(),
                lambda case: case["words"][0].update(text="different"),
                lambda case: case["words"][1].update(startMs=500),
                lambda case: case.update(audioSha256="stale"),
                lambda case: case.update(textSha256="stale"),
                lambda case: case.update(clipEndMs=900),
                lambda case: case["words"][0].update(endMs=220)):
            case = deepcopy(self.case)
            mutate(case)
            with self.assertRaises(ValueError):
                validate_case(case, self.words, self.manifest)

    def test_good_requires_every_exact_cut(self):
        for change in ({"heardSegments": [1]},
                       {"heardSegments": [1, 1, 3]}, {"heardSegments": [True, 3]},
                       {"heardSegments": [1, 4]}, {"candidateSha256": "other"},
                       {"note": "x" * 2001}):
            with self.assertRaises(ValueError):
                validate_decision(self.case, {**self.payload, **change})

    def test_all_word_cuts_unlock_good_without_separate_verse_playback(self):
        row = self.store.save(self.case, {**self.payload, "verseHeard": False})
        self.assertFalse(row["listenEvidenceReportedByBrowser"]["verseHeard"])
        self.assertEqual(row["listenEvidenceReportedByBrowser"]["heardSegments"], [1, 3])
        self.assertEqual(row["verdict"], "good")
        self.assertEqual(row["publicationStatus"], "held")

    def test_problem_can_save_partial_listening_without_approval(self):
        row = validate_decision(self.case, {**self.payload, "verdict": "problem",
                                           "verseHeard": False, "heardSegments": [3]})
        self.assertEqual(row["publicationStatus"], "held")
        self.assertEqual(row["scope"], "one-verse-candidate")
        self.assertEqual(row["listenEvidenceReportedByBrowser"]["heardSegments"], [3])
        self.assertNotIn("reviewed", json.dumps(row))
        self.assertNotIn("alignmentStatus", row)

    def test_save_resume_history_preserve_inputs_and_stale_candidates_do_not_resume(self):
        original = deepcopy(self.queue)
        self.store.save(self.case, self.payload)
        self.store.save(self.case, {**self.payload, "verdict": "problem", "note": "cut too short"})
        resumed = ReviewStore(self.store.path, self.queue)
        self.assertEqual(resumed.snapshot()["191-15"]["verdict"], "problem")
        self.assertEqual(len(read_json(self.store.path)["entries"]), 2)
        self.assertEqual(self.queue, original)
        changed = deepcopy(self.queue)
        changed["cases"][0]["candidateSha256"] = "new"
        self.assertEqual(ReviewStore(self.store.path, changed).snapshot(), {})

    def test_failed_atomic_save_keeps_previous_feedback(self):
        self.store.save(self.case, self.payload)
        before = self.store.path.read_bytes()
        with patch("pathlib.Path.replace", side_effect=OSError("disk error")):
            with self.assertRaises(OSError):
                self.store.save(self.case, {**self.payload, "verdict": "skip"})
        self.assertEqual(self.store.path.read_bytes(), before)
        self.assertEqual(self.store.snapshot()["191-15"]["verdict"], "good")

    def test_hebrew_references_have_plain_letters(self):
        self.assertEqual(hebrew_number(15), "טו")
        self.assertEqual(hebrew_number(16), "טז")
        self.assertEqual(hebrew_number(42), "מב")

    def test_loopback_only_routes_and_source_hashes(self):
        Path(self.case["clipPath"]).write_bytes(b"audio clip")
        self.case["clipSha256"] = digest_file(Path(self.case["clipPath"]))
        server = make_server(self.queue, self.store, 0)
        self.addCleanup(server.server_close)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.shutdown)

        def request(path, payload=None, headers=None):
            connection = HTTPConnection("127.0.0.1", server.server_port, timeout=5)
            try:
                body = json.dumps(payload) if payload is not None else None
                connection.request("POST" if body else "GET", path, body, headers or {})
                response = connection.getresponse()
                return response.status, response.read()
            finally:
                connection.close()

        status, body = request("/api/queue")
        self.assertEqual(status, 200)
        public = json.loads(body)
        self.assertNotIn("audioPath", public["cases"][0])
        headers = {"Content-Type": "application/json", "Origin": server.origin,
                   "X-Review-Token": public["token"]}
        for change in ({"Origin": "https://foreign.example"}, {"X-Review-Token": "invalid"},
                       {"Host": "foreign.example"}):
            self.assertEqual(request("/api/reviews", self.payload, {**headers, **change})[0], 403)
        status, body = request("/api/reviews", self.payload, headers)
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["publicationStatus"], "held")
        self.assertEqual(request("/clips/191-15"), (200, b"audio clip"))
        Path(self.case["clipPath"]).write_bytes(b"changed")
        self.assertEqual(request("/clips/191-15")[0], 409)
        self.assertEqual(request("/clips/../private.mp3")[0], 404)

    @unittest.skipUnless(shutil.which("ffmpeg"), "FFmpeg not installed")
    def test_exact_pcm_indices_across_midstream_rate_change(self):
        paths = []
        for rate in (44100, 32000):
            path = self.root / f"{rate}.mp3"
            subprocess.run([  # nosec B603: resolved FFmpeg, fixed fixture argv.  # nosemgrep
                            shutil.which("ffmpeg"), "-loglevel", "error", "-f", "lavfi", "-i",
                            f"sine=frequency=440:sample_rate={rate}:duration=2",
                            "-c:a", "libmp3lame", "-b:a", "48k", "-write_xing", "0",
                            str(path)], check=True, capture_output=True)  # nosec B603: resolved FFmpeg, fixed fixture argv.  # nosemgrep
            paths.append(path)
        original = self.root / "mixed.mp3"
        original.write_bytes(b"".join(path.read_bytes() for path in paths))
        before = digest_file(original)
        clip = self.root / "clip.wav"
        make_clip(original, clip, 500, 3500)
        full = subprocess.run([  # nosec B603: resolved FFmpeg, fixed fixture argv.  # nosemgrep
                            shutil.which("ffmpeg"), "-loglevel", "error", "-i", str(original),
                            "-ar", "16000", "-ac", "1", "-f", "s32le", "pipe:1"],
                              check=True, capture_output=True).stdout  # nosec B603: resolved FFmpeg, fixed fixture argv.  # nosemgrep
        with wave.open(str(clip), "rb") as stream:
            self.assertEqual(stream.getframerate(), 16000)
            self.assertEqual(stream.getnframes(), 48000)
            self.assertEqual(stream.readframes(48000), full[500*16*4:3500*16*4])
        self.assertEqual(digest_file(original), before)


if __name__ == "__main__":
    unittest.main()
