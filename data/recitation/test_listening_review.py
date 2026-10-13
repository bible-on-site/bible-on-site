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
from listening_review import (candidate_digest, digest_file, digest_json, hebrew_number, make_clip, make_server,
                              read_json, ReviewStore, validate_case, validate_decision)
from listening_accept import verify_review


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

    def test_recovery_notification_follows_durable_answer_save(self):
        calls = []
        self.store.on_saved = lambda: calls.append(read_json(self.store.path)["entries"][-1]["verdict"])
        self.store.save(self.case, self.payload)
        self.assertEqual(calls, ["good"])
        with patch("pathlib.Path.replace", side_effect=OSError("disk error")):
            with self.assertRaises(OSError):
                self.store.save(self.case, {**self.payload, "verdict": "problem"})
        self.assertEqual(calls, ["good"])

    def test_failed_atomic_save_keeps_previous_feedback(self):
        self.store.save(self.case, self.payload)
        before = self.store.path.read_bytes()
        with patch("pathlib.Path.replace", side_effect=OSError("disk error")):
            with self.assertRaises(OSError):
                self.store.save(self.case, {**self.payload, "verdict": "skip"})
        self.assertEqual(self.store.path.read_bytes(), before)
        self.assertEqual(self.store.snapshot()["191-15"]["verdict"], "good")

    def prepare_unchanged_cut_reuse(self):
        prior = deepcopy(self.case)
        prior["diagnosticSha256"] = "original diagnostic"
        prior["candidateSha256"] = candidate_digest(prior)
        queue = {"cases": [prior], "queueSha256": digest_json([prior])}
        decision = validate_decision(prior, {**self.payload, "candidateSha256": prior["candidateSha256"],
                                           "verdict": "problem", "note": "first ending is clipped"})
        decision["queueSha256"] = queue["queueSha256"]
        queue_path, reviews_path = self.root / "prior-queue.json", self.root / "prior-reviews.json"
        from listening_review import write_json
        write_json(queue_path, queue)
        write_json(reviews_path, {"version": 1, "entries": [decision]})
        proof_path = self.root / "reuse.json"
        write_json(proof_path, {"queuePath": str(queue_path), "queueFileSha256": digest_file(queue_path),
            "reviewsPath": str(reviews_path), "reviewsFileSha256": digest_file(reviews_path),
            "decisionIndex": 0, "decision": decision})
        self.case = deepcopy(prior)
        self.case["words"][0]["endMs"] = 610
        self.case.update(listeningReusePath=str(proof_path), listeningReuseSha256=digest_file(proof_path),
                         reusableHeardSegments=[3])
        self.case["candidateSha256"] = candidate_digest(self.case)
        self.payload.update(candidateSha256=self.case["candidateSha256"], freshHeardSegments=[1])

    def test_only_identical_heard_cuts_reused_and_new_good_requires_changed_cut(self):
        self.prepare_unchanged_cut_reuse()
        with self.assertRaises(ValueError):
            validate_decision(self.case, {**self.payload, "freshHeardSegments": []})
        row = validate_decision(self.case, self.payload)
        heard = row["listenEvidenceReportedByBrowser"]
        self.assertEqual(heard["freshHeardSegments"], [1])
        self.assertEqual(heard["reusedHeardSegments"], [3])
        self.assertEqual(heard["reuseSource"]["verdict"], "problem")
        row["queueSha256"] = "new queue"
        verify_review(self.case, row, "new queue")
        row["listenEvidenceReportedByBrowser"]["freshHeardSegments"] = []
        with self.assertRaises(ValueError):
            verify_review(self.case, row, "new queue")

    def test_reuse_does_not_cover_changed_words_source_clip_or_unsaved_history(self):
        self.prepare_unchanged_cut_reuse()
        before = deepcopy(self.case)
        for mutate in (
                lambda c: c.update(reusableHeardSegments=[1, 3]),
                lambda c: c.update(audioSha256="different"),
                lambda c: c.update(clipSha256="different"),
                lambda c: c["words"][1].update(endMs=1101),
                lambda c: c.update(listeningReuseSha256="different")):
            case = deepcopy(before)
            mutate(case)
            with self.subTest(mutate=mutate), self.assertRaises(ValueError):
                validate_decision(case, self.payload)
        proof = read_json(Path(self.case["listeningReusePath"]))
        proof["decision"]["note"] = "not the saved answer"
        from listening_review import write_json
        write_json(Path(self.case["listeningReusePath"]), proof)
        self.case["listeningReuseSha256"] = digest_file(Path(self.case["listeningReusePath"]))
        with self.assertRaises(ValueError):
            validate_decision(self.case, self.payload)

    def prepare_fresh_hearing_after_a_reused_round(self):
        self.prepare_unchanged_cut_reuse()
        prior = deepcopy(self.case)
        queue = {"cases": [prior], "queueSha256": digest_json([prior])}
        decision = validate_decision(prior, {**self.payload, "verdict": "problem"})
        decision["queueSha256"] = queue["queueSha256"]
        from listening_review import write_json
        queue_path, reviews_path = self.root / "second-queue.json", self.root / "second-reviews.json"
        write_json(queue_path, queue)
        write_json(reviews_path, {"version": 1, "entries": [decision]})
        proof_path = self.root / "second-reuse.json"
        write_json(proof_path, {"queuePath": str(queue_path), "queueFileSha256": digest_file(queue_path),
            "reviewsPath": str(reviews_path), "reviewsFileSha256": digest_file(reviews_path),
            "decisionIndex": 0, "decision": decision})
        self.case = deepcopy(prior)
        self.case["words"][1]["endMs"] = 1110
        self.case.update(listeningReusePath=str(proof_path), listeningReuseSha256=digest_file(proof_path),
                         reusableHeardSegments=[1])
        self.case["candidateSha256"] = candidate_digest(self.case)
        self.payload.update(candidateSha256=self.case["candidateSha256"], freshHeardSegments=[3])

    def test_direct_fresh_hearing_can_be_reused_after_another_cut_was_reused(self):
        self.prepare_fresh_hearing_after_a_reused_round()
        row = validate_decision(self.case, self.payload)
        heard = row["listenEvidenceReportedByBrowser"]
        self.assertEqual(heard["freshHeardSegments"], [3])
        self.assertEqual(heard["reusedHeardSegments"], [1])
        row["queueSha256"] = "third queue"
        verify_review(self.case, row, "third queue")
        with self.assertRaises(ValueError):
            validate_decision(self.case, {**self.payload, "freshHeardSegments": []})

    def test_inherited_hearing_never_becomes_direct_fresh_hearing(self):
        self.prepare_fresh_hearing_after_a_reused_round()
        self.case["words"][1]["endMs"] = 1100
        self.case["words"][0]["endMs"] = 620
        self.case["reusableHeardSegments"] = [3]
        self.case["candidateSha256"] = candidate_digest(self.case)
        with self.assertRaises(ValueError):
            validate_decision(self.case, {**self.payload, "candidateSha256": self.case["candidateSha256"],
                                          "freshHeardSegments": [1]})

    def test_later_reuse_still_rejects_changed_source_clip_words_and_earlier_history(self):
        self.prepare_fresh_hearing_after_a_reused_round()
        for mutate in (lambda c: c.update(audioSha256="changed source"),
                       lambda c: c.update(clipSha256="changed clip"),
                       lambda c: c["words"][0].update(endMs=611),
                       lambda c: c.update(reusableHeardSegments=[1, 3])):
            case = deepcopy(self.case)
            mutate(case)
            with self.subTest(mutate=mutate), self.assertRaises(ValueError):
                validate_decision(case, self.payload)
        first = read_json(self.root / "reuse.json")
        from listening_review import write_json
        history = read_json(Path(first["reviewsPath"]))
        history["entries"][0]["note"] = "edited after archiving"
        write_json(Path(first["reviewsPath"]), history)
        with self.assertRaises(ValueError):
            validate_decision(self.case, self.payload)

    def test_reused_round_without_saved_fresh_word_evidence_is_rejected(self):
        self.prepare_fresh_hearing_after_a_reused_round()
        proof_path = Path(self.case["listeningReusePath"])
        proof = read_json(proof_path)
        proof["decision"]["listenEvidenceReportedByBrowser"].pop("freshHeardSegments")
        from listening_review import write_json
        write_json(Path(proof["reviewsPath"]), {"version": 1, "entries": [proof["decision"]]})
        proof["reviewsFileSha256"] = digest_file(Path(proof["reviewsPath"]))
        write_json(proof_path, proof)
        self.case["listeningReuseSha256"] = digest_file(proof_path)
        with self.assertRaises(ValueError):
            validate_decision(self.case, self.payload)
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
        self.assertEqual(request("/api/archive"), (200, b"[]"))
        self.assertEqual(request("/archive")[0], 200)
        self.assertEqual(request("/api/recovery"), (200, b"{}"))
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
