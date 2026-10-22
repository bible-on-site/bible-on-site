"""Persistent accumulated review queue and immutable provenance regressions."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing, contextmanager
from copy import deepcopy
from http.client import HTTPConnection
import hashlib
import json
from pathlib import Path
import sqlite3
import tempfile
import threading
import unittest
from unittest.mock import patch
import uuid
import wave

from listening_accept import verify_review
from listening_actions import ActionDatabase, POLICY, task_digest
from listening_files import open_state_text, write_state_json
from listening_queue import ReviewDatabase, case_key, main, make_queue_server
from listening_review import digest_file, digest_json, read_json, validate_decision, write_json


class AccumulatedQueueTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.root = Path(folder.name)
        self.db = ReviewDatabase(self.root / "listening.sqlite")
        self.case = {"id": "1-1", "perekId": 1, "pasuk": 1, "label": "בראשית א א",
                     "audioSha256": "source", "textSha256": "text",
                     "candidateSha256": "candidate", "clipSha256": "clip",
                     "words": [{"pasuk": 1, "segment": 1, "text": "בראשית", "startMs": 10, "endMs": 300}],
                     "diagnosticSha256": "diagnostic", "publicationStatus": "held"}
        self.payload = {"caseId": "1-1", "candidateSha256": "candidate", "clipSha256": "clip",
                        "verdict": "good", "heardSegments": [1], "note": ""}
        self.loader = patch("listening_queue.load_queue", side_effect=read_json)
        self.loader.start()
        self.addCleanup(self.loader.stop)
        self.diagnostic = patch("listening_accept.verify_diagnostic")
        self.diagnostic.start()
        self.addCleanup(self.diagnostic.stop)

    def batch(self, number, case=None, entries=None):
        folder = self.root / str(number)
        folder.mkdir()
        cases = [deepcopy(case or self.case)]
        queue = {"version": 1, "publicationStatus": "held", "canonicalPath": str(self.root / "text.json"),
                 "cases": cases, "queueSha256": digest_json(cases)}
        path, reviews = folder / "queue.json", folder / "reviews.json"
        write_json(path, queue)
        write_json(reviews, {"version": 1, "entries": entries or []})
        return path, reviews, queue

    def typed_case(self):
        clip = self.root / "clip.wav"
        with wave.open(str(clip), "wb") as audio:
            audio.setparams((1, 2, 16000, 0, "NONE", "not compressed"))
            audio.writeframes(bytes([8, 1]) * 16000)
        self.case.update(clipPath=str(clip), clipSha256=digest_file(clip),
                         clipStartMs=0, clipEndMs=1000)
        self.payload["clipSha256"] = self.case["clipSha256"]
        return {**self.payload, "submissionId": "actual-browser-submission-1",
                "timingEdits": [], "heardEditedSegments": []}

    def stored_state(self):
        with closing(sqlite3.connect(self.db.path)) as db:
            return {"batch": db.execute("SELECT * FROM batch ORDER BY rowid").fetchall(),
                    "candidate": db.execute("SELECT * FROM candidate ORDER BY rowid").fetchall(),
                    "current_candidate": db.execute("SELECT * FROM current_candidate ORDER BY rowid").fetchall(),
                    "history": db.execute("SELECT * FROM history ORDER BY rowid").fetchall(),
                    "entry": db.execute("SELECT * FROM entry ORDER BY rowid").fetchall(),
                    "cut_edit": db.execute("SELECT * FROM cut_edit ORDER BY rowid").fetchall(),
                    "word_review": db.execute("SELECT * FROM word_review ORDER BY rowid").fetchall()}

    def status_server(self, path=None, action_store=None):
        server = make_queue_server(self.db, 0, self.root / "session.json", preparation_status=path, action_store=action_store)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        return server

    def get_status(self, server, path="/api/preparation-status", headers=None):
        connection = HTTPConnection("127.0.0.1", server.server_port)
        self.addCleanup(connection.close)
        connection.request("GET", path, headers=headers or {})
        response = connection.getresponse()
        return response.status, json.loads(response.read())

    def test_preparation_status_is_optional_and_requires_an_absolute_configured_path(self):
        server = self.status_server()
        self.assertEqual(self.get_status(server), (404, {"error": "Preparation status not configured"}))
        self.assertEqual(self.get_status(server, headers={"Host": "invalid"})[0], 403)
        with self.assertRaisesRegex(ValueError, "absolute"):
            make_queue_server(self.db, 0, preparation_status=Path("relative-status.json"))

    def test_append_unapproved_fence_blocks_current_typed_good_and_preserves_every_row(self):
        payload = self.typed_case()
        first, _, _ = self.batch(1)
        self.db.append(first)
        self.db.save_word_review(payload)
        before = self.stored_state()
        original_bytes = self.db.path.read_bytes()
        changed = {**self.case, "candidateSha256": "new-machine-candidate"}
        second, _, _ = self.batch(2, changed)
        with self.assertRaisesRegex(ValueError, "approved"):
            self.db.append(second, only_unapproved=True)
        self.assertEqual(self.stored_state(), before)
        self.assertEqual(self.db.path.read_bytes(), original_bytes)
        self.assertEqual(self.db.append(first, only_unapproved=True), 1)
        self.assertEqual(self.stored_state(), before)

    def test_append_unapproved_fence_blocks_legacy_good_but_allows_a_later_current_problem_or_skip(self):
        first, _, _ = self.batch(1)
        self.db.append(first)
        self.db.save(self.case, self.payload)
        changed = {**self.case, "candidateSha256": "new-machine-candidate"}
        second, _, _ = self.batch(2, changed)
        before = self.stored_state()
        with self.assertRaisesRegex(ValueError, "approved"):
            self.db.append(second, only_unapproved=True)
        self.assertEqual(self.stored_state(), before)
        for verdict in ("problem", "skip"):
            with self.subTest(verdict=verdict):
                self.db.save(self.case, {**self.payload, "verdict": verdict, "note": "actual feedback"})
                number = 3 if verdict == "problem" else 4
                next_case = {**self.case, "candidateSha256": "candidate-" + verdict}
                path, _, _ = self.batch(number, next_case)
                self.db.append(path, only_unapproved=True)
                self.case = next_case
                self.payload["candidateSha256"] = next_case["candidateSha256"]
                self.assertEqual(self.db.view()["cases"][0]["candidateSha256"], next_case["candidateSha256"])

    def test_append_unapproved_fence_uses_current_exact_candidate_instead_of_historical_good(self):
        first, _, _ = self.batch(1)
        self.db.append(first)
        self.db.save(self.case, self.payload)
        replacement = {**self.case, "candidateSha256": "human-requested-revision"}
        second, _, _ = self.batch(2, replacement)
        self.db.append(second)
        self.db.save(replacement, {**self.payload, "candidateSha256": replacement["candidateSha256"],
                                   "verdict": "problem", "note": "still needs a genuine fix"})
        newer = {**replacement, "candidateSha256": "new-source-bound-proposal"}
        third, _, _ = self.batch(3, newer)
        self.db.append(third, only_unapproved=True)
        self.assertEqual(self.db.case("1-1", newer["candidateSha256"]), newer)
        self.assertEqual(len(self.db.all_entries()), 2)

    def test_append_fence_and_importer_share_edited_good_vs_later_original_problem_semantics(self):
        from listening_accept import current_review_decisions
        payload = self.typed_case()
        first, _, _ = self.batch(1)
        self.db.append(first)
        edited_good = self.db.save_word_review({
            **payload, "timingEdits": [{"segment": 1, "startMs": 10, "endMs": 350}],
            "heardSegments": [], "heardEditedSegments": [1]})
        self.db.save(self.case, {**self.payload, "verdict": "problem", "note": "later original-cut feedback"})
        feedback = self.root / "actual-feedback.json"
        write_json(feedback, self.db.export_feedback())
        imported = current_review_decisions({"cases": [self.case]}, feedback)
        self.assertEqual(imported["1-1"], edited_good)
        self.assertEqual(self.db.current_decisions(), imported)
        replacement = {**self.case, "candidateSha256": "new-proposal"}
        second, _, _ = self.batch(2, replacement)
        before = self.stored_state()
        with self.assertRaisesRegex(ValueError, "approved"):
            self.db.append(second, only_unapproved=True)
        with self.assertRaisesRegex(ValueError, "already genuinely approved"):
            self.db.action_case({"caseId": self.case["id"], "candidateSha256": self.case["candidateSha256"],
                                 "clipSha256": self.case["clipSha256"]})
        self.assertEqual(self.stored_state(), before)
        self.db.save_word_review({**payload, "submissionId": "actual-later-original-coordinate-good"})
        later_problem = self.db.save(self.case, {**self.payload, "verdict": "problem", "note": "same coordinates now fail"})
        self.assertEqual(self.db.current_decisions()["1-1"], later_problem)
        self.db.append(second, only_unapproved=True)
        self.assertEqual(self.db.case("1-1", replacement["candidateSha256"]), replacement)

    def test_guarded_previous_good_exception_allows_only_the_exact_trusted_old_review(self):
        payload = self.typed_case()
        first, _, _ = self.batch(1)
        self.db.append(first)
        old_good = self.db.save_word_review(payload)
        replacement = {**self.case, "candidateSha256": "new-context-from-validated-concern"}
        second, _, _ = self.batch(2, replacement)
        self.db.append(second, only_unapproved=True, allowed_previous_good={"1-1": digest_json(old_good)})
        self.assertEqual(self.db.case("1-1", replacement["candidateSha256"]), replacement)

    def test_guarded_previous_good_exception_cannot_replace_a_newer_genuine_good(self):
        payload = self.typed_case()
        first, _, _ = self.batch(1)
        self.db.append(first)
        old_good = self.db.save_word_review(payload)
        latest = self.db.save_word_review({**payload, "submissionId": "actual-newer-good-before-append"})
        replacement = {**self.case, "candidateSha256": "obsolete-proposal"}
        second, _, _ = self.batch(2, replacement)
        before = self.stored_state()
        with self.assertRaisesRegex(ValueError, "approved"):
            self.db.append(second, only_unapproved=True, allowed_previous_good={"1-1": digest_json(old_good)})
        self.assertEqual(self.stored_state(), before)
        self.assertEqual(self.db.current_decisions()["1-1"], latest)
        with self.assertRaisesRegex(ValueError, "guarded review hashes"):
            self.db.append(second, allowed_previous_good={"1-1": digest_json(old_good)})

    def test_slow_history_file_read_holds_no_sqlite_write_lock_and_unchanged_poll_does_not_write(self):
        first, first_reviews, first_queue = self.batch(1)
        other_case = {**self.case, "id": "2-1", "perekId": 2, "candidateSha256": "other-candidate"}
        second, second_reviews, _ = self.batch(2, other_case)
        self.db.append(first, first_reviews)
        self.db.append(second, second_reviews)
        actual = validate_decision(self.case, self.payload)
        actual["queueSha256"] = first_queue["queueSha256"]
        write_json(first_reviews, {"version": 1, "entries": [actual]})
        reading, release = threading.Event(), threading.Event()
        failures = []

        def paused_read(path):
            if Path(path) == second_reviews:
                reading.set()
                if not release.wait(2):
                    raise RuntimeError("Fixture reader release deadline exceeded")
            return read_json(path)

        def sync():
            try:
                self.db.sync_histories()
            except BaseException as error:
                failures.append(error)

        with patch("listening_queue.read_json", side_effect=paused_read):
            thread = threading.Thread(target=sync)
            thread.start()
            try:
                self.assertTrue(reading.wait(2))
                with closing(sqlite3.connect(self.db.path, timeout=0.1)) as probe:
                    probe.execute("BEGIN IMMEDIATE")
                    probe.rollback()
            finally:
                release.set()
                thread.join(2)
        self.assertFalse(thread.is_alive())
        self.assertEqual(failures, [])
        self.assertEqual(self.db.all_entries(), [actual])
        before = self.stored_state()
        with patch.object(self.db, "_transaction", side_effect=AssertionError("Unchanged histories must not write")):
            self.db.sync_histories()
        self.assertEqual(self.stored_state(), before)

    def test_unchanged_history_poll_hides_legacy_good_publicly_without_changing_raw_candidates(self):
        path, reviews, _ = self.batch(1)
        self.db.append(path, reviews)
        self.db.save(self.case, self.payload)
        before = self.stored_state()
        self.assertEqual(self.db.view()["cases"], [self.case])
        server = self.status_server()
        self.assertEqual(self.get_status(server, "/api/queue")[1]["cases"], [])
        workload = self.db.preparation_workload()
        self.assertEqual(workload["offeredCaseIds"], ["1-1"])
        self.assertEqual(workload["visibleCaseIds"], [])
        self.assertEqual(self.stored_state(), before)
        self.assertEqual(self.db.view()["cases"], [self.case])
        self.db.save(self.case, {**self.payload, "verdict": "skip", "note": ""})
        self.assertEqual(self.get_status(server, "/api/queue")[1]["cases"][0]["id"], self.case["id"])
        self.assertEqual(self.db.preparation_workload()["visibleCaseIds"], ["1-1"])

    def test_visible_legacy_problem_keeps_current_draft_candidate_in_public_queue_without_writes(self):
        path, reviews, _ = self.batch(1)
        self.db.append(path, reviews)
        actual_problem = self.db.save(self.case, {
            **self.payload, "verdict": "problem",
            "note": "existing actual problem before the unsaved slider draft"})
        before = self.stored_state()
        server = self.status_server()
        with patch.object(self.db, "_transaction",
                          side_effect=AssertionError("An unchanged poll must not write")):
            code, queue = self.get_status(server, "/api/queue")
            workload = self.db.preparation_workload()
        self.assertEqual(code, 200)
        self.assertEqual(queue["cases"], [{k: v for k, v in self.case.items() if not k.endswith("Path")}])
        self.assertEqual(queue["decisions"][case_key(self.case)], actual_problem)
        self.assertEqual(workload["visibleCaseIds"], [self.case["id"]])
        self.assertEqual(workload["visibleWordCuts"], len(self.case["words"]))
        self.assertEqual(self.stored_state(), before)
        self.db.save(self.case, {**self.payload, "verdict": "skip", "note": ""})
        self.assertEqual(self.get_status(server, "/api/queue")[1]["cases"][0]["id"], self.case["id"])
        self.assertEqual(self.db.preparation_workload()["visibleCaseIds"], [self.case["id"]])

    def test_current_public_queue_and_workload_select_review_semantics_in_one_batch(self):
        path, reviews, _ = self.batch(1)
        self.db.append(path, reviews)
        other_case = {**self.case, "id": "2-1", "perekId": 2, "candidateSha256": "other-candidate"}
        other_path, other_reviews, _ = self.batch(2, other_case)
        self.db.append(other_path, other_reviews)
        server = self.status_server()
        from listening_queue import current_bound_reviews
        with patch("listening_queue.current_bound_reviews", wraps=current_bound_reviews) as select:
            code, queue = self.get_status(server, "/api/queue")
            self.assertEqual(code, 200)
            self.assertEqual(select.call_count, 1)
            self.assertEqual([case["id"] for case in select.call_args.args[0]], ["1-1", "2-1"])
        with patch("listening_queue.current_bound_reviews", wraps=current_bound_reviews) as select:
            workload = self.db.preparation_workload()
            self.assertEqual(select.call_count, 1)
            self.assertEqual([case["id"] for case in select.call_args.args[0]], ["1-1", "2-1"])
        self.assertEqual([case["id"] for case in queue["cases"]], workload["visibleCaseIds"])

    def action_fixture(self, kind="locate-source-range", case_ref=None):
        audio = self.root / "1_record.mp3"
        audio.write_bytes(b"immutable-original-source")
        task = {"version": 1, "policy": POLICY, "taskId": "concern-1-1", "kind": kind,
                "perekId": 1, "pasuk": 1, "label": "בראשית א א", "sourceAudioPath": str(audio),
                "audioSha256": hashlib.sha256(audio.read_bytes()).hexdigest(), "textSha256": "a" * 64,
                "sourceFrames": 16000, "sourceSampleRate": 16000, "sourcePcmSha256": "b" * 64,
                "canonicalWords": [{"pasuk": 1, "segment": 1, "text": "בראשית"}],
                "sourceEvidence": {"manifestPath": "private-source-path", "manifestSha256": "c" * 64}}
        if case_ref:
            task["caseRef"] = case_ref
        task["taskSha256"] = task_digest(task)
        store = ActionDatabase(self.root / "actions.sqlite")
        store.seed([task])
        return task, store

    def action_post(self, server, payload, valid=True):
        connection = HTTPConnection("127.0.0.1", server.server_port)
        self.addCleanup(connection.close)
        headers = {"Content-Type": "application/json", "Origin": server.origin,
                   "X-Review-Token": server.token if valid else "invalid-session"}
        connection.request("POST", "/api/action-responses", json.dumps(payload), headers)
        response = connection.getresponse()
        return response.status, json.loads(response.read())

    def test_actions_are_optional_separate_and_public_view_exposes_no_source_paths(self):
        server = self.status_server()
        self.assertEqual(self.get_status(server, "/api/actions")[0], 404)
        self.assertEqual(self.get_status(server, "/api/workflow-status")[0], 404)
        with self.assertRaisesRegex(ValueError, "separate absolute"):
            make_queue_server(self.db, 0, action_store=self.db.path)
        task, actions = self.action_fixture()
        configured = self.status_server(action_store=actions)
        code, view = self.get_status(configured, "/api/actions")
        self.assertEqual((code, view["tasks"][0]["taskId"]), (200, task["taskId"]))
        self.assertNotIn("private", json.dumps(view))
        self.assertNotIn("sourceAudioPath", json.dumps(view))
        self.assertEqual(self.get_status(configured, "/api/actions", {"Host": "external.invalid"})[0], 403)

    def test_action_response_authentication_export_and_original_review_rows_are_preserved(self):
        path, _, _ = self.batch(1)
        self.db.append(path)
        before = self.stored_state()
        legacy = self.db.export_feedback()
        task, actions = self.action_fixture()
        server = self.status_server(action_store=actions)
        payload = {"submissionId": "genuine-fixture-browser-01", "taskId": task["taskId"],
                   "taskSha256": task["taskSha256"], "kind": task["kind"], "audioSha256": task["audioSha256"],
                   "textSha256": task["textSha256"], "startMs": 0, "endMs": 1000,
                   "heardRange": {"startMs": 0, "endMs": 1000, "complete": True}, "note": ""}
        self.assertEqual(self.action_post(server, payload, False)[0], 403)
        self.assertEqual(actions.responses(), [])
        code, saved = self.action_post(server, payload)
        self.assertEqual(code, 200)
        self.assertEqual(self.action_post(server, payload), (200, saved))
        self.assertEqual(self.action_post(server, {**payload, "submissionId": "stale-fixture-browser-02",
                                                 "audioSha256": "d" * 64})[0], 400)
        code, exported = self.get_status(server, "/api/export")
        self.assertEqual(code, 200)
        for key, rows in legacy.items():
            self.assertEqual(exported[key], rows)
        self.assertEqual(exported["actionResponses"], [saved])
        self.assertEqual(self.stored_state(), before)

    def test_action_audio_is_fixed_allowlist_and_rejects_stale_original_bytes(self):
        task, actions = self.action_fixture()
        server = self.status_server(action_store=actions)
        connection = HTTPConnection("127.0.0.1", server.server_port)
        self.addCleanup(connection.close)
        connection.request("GET", "/api/action-audio/" + task["taskId"])
        response = connection.getresponse()
        self.assertEqual(response.status, 200)
        self.assertEqual(response.getheader("Content-Type"), "audio/mpeg")
        self.assertEqual(response.getheader("X-Playback-SHA256"), task["audioSha256"])
        self.assertEqual(response.read(), b"immutable-original-source")
        self.assertEqual(self.get_status(server, "/api/action-audio/unknown")[0], 409)
        self.assertEqual(self.get_status(server, "/api/action-audio/concern-1-1?path=private")[0], 409)
        Path(task["sourceAudioPath"]).write_bytes(b"changed-original")
        self.assertEqual(self.get_status(server, "/api/action-audio/" + task["taskId"])[0], 409)

    def test_action_can_reopen_hidden_problem_but_never_current_good_or_stale_candidate(self):
        self.case.update(candidateSha256="c" * 64, audioSha256=hashlib.sha256(b"immutable-original-source").hexdigest(),
                         textSha256="a" * 64)
        self.payload["candidateSha256"] = self.case["candidateSha256"]
        payload = self.typed_case()
        path, _, _ = self.batch(1)
        self.db.append(path)
        self.db.save_word_review({**payload, "verdict": "problem", "note": "still clipped"})
        ref = {"caseId": "1-1", "candidateSha256": self.case["candidateSha256"],
               "clipSha256": self.case["clipSha256"]}
        task, actions = self.action_fixture("review-cuts", ref)
        server = self.status_server(action_store=actions)
        code, opened = self.get_status(server, "/api/action-case/" + task["taskId"])
        self.assertEqual(code, 200)
        self.assertEqual(opened["decision"]["verdict"], "problem")
        self.assertNotIn("clipPath", opened["case"])
        self.db.save_word_review({**payload, "submissionId": "genuine-fixture-later-good", "verdict": "good"})
        self.assertEqual(self.get_status(server, "/api/action-case/" + task["taskId"])[0], 409)
        code, view = self.get_status(server, "/api/actions")
        self.assertEqual(code, 200)
        self.assertEqual(view["tasks"][0]["state"], "preparing")
        self.assertIs(view["tasks"][0]["cutReviewComplete"], True)
        replacement = {**self.case, "candidateSha256": "e" * 64}
        other, _, _ = self.batch(2, replacement)
        self.db.append(other)
        self.assertEqual(self.get_status(server, "/api/action-case/" + task["taskId"])[0], 409)

    def test_review_cut_action_accepts_new_context_beyond_the_old_clip_with_actual_hearing(self):
        self.case.update(candidateSha256="c" * 64, audioSha256=hashlib.sha256(b"immutable-original-source").hexdigest(),
                         textSha256="a" * 64)
        self.payload["candidateSha256"] = self.case["candidateSha256"]
        payload = self.typed_case()
        path, _, _ = self.batch(1)
        self.db.append(path)
        self.db.save_word_review({**payload, "verdict": "problem", "note": "context is clipped"})
        ref = {"caseId": "1-1", "candidateSha256": self.case["candidateSha256"], "clipSha256": self.case["clipSha256"]}
        original, actions = self.action_fixture("review-cuts", ref)
        task = {**original, "taskId": "review-context-1-1", "sourceFrames": 32000}
        task["taskSha256"] = task_digest(task)
        actions.seed([task])
        server = self.status_server(action_store=actions)
        request = {"submissionId": "actual-review-new-source-range", "taskId": task["taskId"],
                   "taskSha256": task["taskSha256"], "audioSha256": task["audioSha256"],
                   "textSha256": task["textSha256"], "kind": "locate-source-range",
                   "startMs": 100, "endMs": 1900,
                   "heardRange": {"startMs": 100, "endMs": 1900, "complete": True}, "note": ""}
        code, saved = self.action_post(server, request)
        self.assertEqual(code, 200)
        self.assertGreater(saved["endMs"], self.case["clipEndMs"])
        self.assertEqual(actions.task(task["taskId"])["kind"], "review-cuts")
        self.assertEqual(actions.responses(), [saved])
        self.assertEqual(len(self.db.export_feedback()["wordReviews"]), 1)

    def test_only_new_bound_chapter_concern_can_reopen_exact_previous_good(self):
        self.case.update(candidateSha256="c" * 64, audioSha256=hashlib.sha256(b"immutable-original-source").hexdigest(),
                         textSha256="a" * 64)
        self.payload["candidateSha256"] = self.case["candidateSha256"]
        payload = self.typed_case()
        path, _, _ = self.batch(1)
        self.db.append(path)
        old_good = self.db.save_word_review(payload)
        ref = {"caseId": "1-1", "candidateSha256": self.case["candidateSha256"], "clipSha256": self.case["clipSha256"]}
        original, actions = self.action_fixture("review-cuts", ref)
        concern = {"validationSha256": "e" * 64, "previousReviewSha256": digest_json(old_good),
                   "reasonCode": "cross_verse_overlap", "segments": [1]}
        followup = {**original, "taskId": "chapter-check-1-1-validated", "chapterConcern": concern}
        followup["taskSha256"] = task_digest(followup)
        actions.seed([followup])
        server = self.status_server(action_store=actions)
        self.assertEqual(self.get_status(server, "/api/action-case/" + original["taskId"])[0], 409)
        code, reopened = self.get_status(server, "/api/action-case/" + followup["taskId"])
        self.assertEqual(code, 200)
        self.assertEqual(reopened["decision"], old_good)
        self.assertEqual(reopened["decisionSha256"], digest_json(old_good))
        self.assertIs(reopened["chapterConcernConfirmed"], True)
        self.assertEqual(reopened["chapterConcern"], concern)
        code, public = self.get_status(server, "/api/actions")
        self.assertEqual(code, 200)
        self.assertEqual(public["tasks"][1]["state"], "review")
        self.assertNotIn("cutReviewComplete", public["tasks"][1])
        selection = {"submissionId": "actual-chapter-new-range", "taskId": followup["taskId"],
                     "taskSha256": followup["taskSha256"], "audioSha256": followup["audioSha256"],
                     "textSha256": followup["textSha256"], "kind": "locate-source-range",
                     "startMs": 0, "endMs": 1000,
                     "heardRange": {"startMs": 0, "endMs": 1000, "complete": True}, "note": ""}
        self.assertEqual(self.action_post(server, selection)[0], 200)
        actions.record_task_state(followup["taskId"], "review", {"caseRef": ref})
        self.db.save_word_review({**payload, "submissionId": "actual-later-chapter-review"})
        self.assertEqual(self.get_status(server, "/api/action-case/" + followup["taskId"])[0], 409)
        self.assertEqual(self.get_status(server, "/api/actions")[1]["tasks"][1]["state"], "preparing")

    def test_rebound_chapter_concern_opens_only_fresh_new_candidate_without_old_good_restore(self):
        self.case.update(candidateSha256="c" * 64, audioSha256=hashlib.sha256(b"immutable-original-source").hexdigest(),
                         textSha256="a" * 64)
        self.payload["candidateSha256"] = self.case["candidateSha256"]
        payload = self.typed_case()
        path, _, _ = self.batch(1)
        self.db.append(path)
        old_good = self.db.save_word_review(payload)
        initial_ref = {"caseId": "1-1", "candidateSha256": self.case["candidateSha256"],
                       "clipSha256": self.case["clipSha256"]}
        original, actions = self.action_fixture("review-cuts", initial_ref)
        task = {**original, "taskId": "chapter-concern-rebound",
                "chapterConcern": {"validationSha256": "e" * 64, "previousReviewSha256": digest_json(old_good),
                                   "reasonCode": "cross_verse_overlap", "segments": [1]}}
        task["taskSha256"] = task_digest(task)
        actions.seed([task])
        fresh = {**self.case, "candidateSha256": "f" * 64}
        fresh_path, _, _ = self.batch(2, fresh)
        self.db.append(fresh_path, only_unapproved=True, allowed_previous_good={"1-1": digest_json(old_good)})
        fresh_ref = {"caseId": "1-1", "candidateSha256": fresh["candidateSha256"], "clipSha256": fresh["clipSha256"]}
        actions.record_task_state(task["taskId"], "review", {"caseRef": fresh_ref})
        server = self.status_server(action_store=actions)
        code, opened = self.get_status(server, "/api/action-case/" + task["taskId"])
        self.assertEqual(code, 200)
        self.assertEqual(opened["case"]["candidateSha256"], fresh["candidateSha256"])
        self.assertNotIn("decision", opened)
        self.assertNotIn("chapterConcern", opened)
        self.assertNotIn("chapterConcernConfirmed", opened)
        public = next(row for row in actions.tasks() if row["taskId"] == task["taskId"])
        self.assertNotIn("chapterConcern", public)
        self.assertIn("chapterConcern", actions.task(task["taskId"]))

    def test_workflow_status_returns_only_safe_fixed_file_chapter_counters(self):
        _, actions = self.action_fixture()
        server = self.status_server(action_store=actions)
        status = {"state": "waiting_for_review", "totalRecordings": 496, "readyRecordings": 286,
                  "pendingRecordings": 210, "chapters": [{"perekId": 1, "label": "בראשית א",
                  "state": "review", "remainingActions": 2, "readyWords": 0, "reasonCode": "human_review_required"}],
                  "updatedAt": "2026-10-23T00:00:00Z"}
        private = {**status, "token": uuid.uuid4().hex, "error": "private-path",
                   "chapters": [{**status["chapters"][0], "manifestPath": "private-path"}]}
        write_json(actions.path.with_name("workflow-status.json"), private)
        self.assertEqual(self.get_status(server, "/api/workflow-status"), (200, status))
        for change in ({"readyRecordings": True}, {"state": "private/path"}, {"chapters": []},
                       {"updatedAt": "bad-time"}):
            bad = {**private, **change}
            if change == {"chapters": []}:
                bad["chapters"] = [{"perekId": 1, "label": "private/path", "state": "review", "remainingActions": 1}]
            write_json(actions.path.with_name("workflow-status.json"), bad)
            self.assertEqual(self.get_status(server, "/api/workflow-status"),
                             (409, {"error": "Action workflow status unavailable"}))

    def inventory_ledger(self):
        return {"version": 1, "fingerprint": "private-source-fingerprint", "cases": {
            "4-1": {"perekId": 4, "pasuk": 1, "state": "excluded",
                    "reason": "previously_offered_chapter"},
            "2-3": {"perekId": 2, "pasuk": 3, "state": "held",
                    "reason": "chapter_requires_supported_context", "contextReasons": ["private source path"]},
            "1-2": {"perekId": 1, "pasuk": 2, "state": "prepared",
                    "reason": "awaiting_queue_capacity", "case": {"label": "בראשית א ב", "clipPath": "private"}},
            "1-1": {"perekId": 1, "pasuk": 1, "state": "queued",
                    "reason": "awaiting_genuine_human_review", "token": uuid.uuid4().hex}}}

    def test_preparation_inventory_is_optional_and_requires_loopback_host(self):
        server = self.status_server()
        self.assertEqual(self.get_status(server, "/api/preparation-inventory"),
                         (404, {"error": "Preparation inventory not configured"}))
        self.assertEqual(self.get_status(server, "/api/preparation-inventory",
                                         {"Host": "external.invalid"})[0], 403)

    def test_preparation_inventory_returns_all_safe_sorted_classifications_and_fixed_labels(self):
        status = self.root / "configured-status.json"
        ledger = self.inventory_ledger()
        ledger["ledgerPath"] = "C:/private/other-ledger.json"
        ledger["token"] = uuid.uuid4().hex
        write_json(self.root / "ledger.json", ledger)
        write_json(self.root / "inventory-labels.json", {"2-3": "בראשית ב ג", "4-1": "בראשית ד א"})
        server = self.status_server(status)
        before = self.stored_state()
        with patch("listening_queue.read_state_json", wraps=read_json) as reader:
            code, inventory = self.get_status(server, "/api/preparation-inventory")
        self.assertEqual(code, 200)
        self.assertEqual(reader.call_args_list[0].args[0], self.root / "ledger.json")
        self.assertEqual(reader.call_args_list[1].args[0], self.root / "inventory-labels.json")
        self.assertEqual(inventory, {"version": 1, "targetVerses": 4, "recordings": 3,
            "counts": {"prepared": 1, "queued": 1, "held": 1, "excluded": 1},
            "cases": [
                {"id": "1-1", "perekId": 1, "pasuk": 1, "label": "1-1", "state": "queued",
                 "reason": "awaiting_genuine_human_review"},
                {"id": "1-2", "perekId": 1, "pasuk": 2, "label": "בראשית א ב", "state": "prepared",
                 "reason": "awaiting_queue_capacity"},
                {"id": "2-3", "perekId": 2, "pasuk": 3, "label": "בראשית ב ג", "state": "held",
                 "reason": "chapter_requires_supported_context"},
                {"id": "4-1", "perekId": 4, "pasuk": 1, "label": "בראשית ד א", "state": "excluded",
                 "reason": "previously_offered_chapter"}]})
        self.assertNotIn("private", json.dumps(inventory))
        self.assertNotIn(ledger["token"], json.dumps(inventory))
        self.assertEqual(self.stored_state(), before)

    def test_preparation_inventory_without_labels_uses_only_candidate_label_or_identity(self):
        write_json(self.root / "ledger.json", self.inventory_ledger())
        server = self.status_server(self.root / "configured-status.json")
        code, inventory = self.get_status(server, "/api/preparation-inventory")
        self.assertEqual(code, 200)
        self.assertEqual([row["label"] for row in inventory["cases"]],
                         ["1-1", "בראשית א ב", "2-3", "4-1"])

    def test_invalid_preparation_inventory_is_unavailable_without_breaking_actual_queue(self):
        path, _, _ = self.batch(1)
        self.db.append(path)
        before = self.stored_state()
        server = self.status_server(self.root / "configured-status.json")
        failures = [None, [], {}, {"version": 2, "cases": {}}, {"version": 1, "cases": []}]
        for change in ({"perekId": True}, {"perekId": 0}, {"pasuk": False}, {"pasuk": 0},
                       {"state": "unknown"}, {"state": []}, {"reason": "C:/private/path"},
                       {"reason": False}, {"case": []}, {"case": {"label": "<script>private</script>"}}):
            ledger = self.inventory_ledger()
            ledger["cases"]["1-1"].update(change)
            failures.append(ledger)
        for row in ([], None, {"perekId": 1, "pasuk": 2, "state": "held", "reason": "held"}):
            ledger = self.inventory_ledger()
            ledger["cases"]["1-1"] = row
            failures.append(ledger)
        for payload in failures:
            with self.subTest(payload=payload):
                if payload is not None:
                    write_json(self.root / "ledger.json", payload)
                self.assertEqual(self.get_status(server, "/api/preparation-inventory"),
                                 (409, {"error": "Preparation inventory unavailable"}))
                self.assertEqual(self.get_status(server, "/api/queue")[0], 200)
        self.assertEqual(self.stored_state(), before)

    def test_preparation_inventory_rejects_malformed_labels_without_disclosing_paths(self):
        write_json(self.root / "ledger.json", self.inventory_ledger())
        server = self.status_server(self.root / "configured-status.json")
        for labels in ([], None, {"99-1": "בראשית א א"}, {"1-1": 5},
                       {"1-1": "C:/private/path"}, {"1-1": "בראשית\\nא א"},
                       {"1-1": "<img src=private>"}, {"1-1": "א" * 161}):
            with self.subTest(labels=labels):
                write_json(self.root / "inventory-labels.json", labels)
                self.assertEqual(self.get_status(server, "/api/preparation-inventory"),
                                 (409, {"error": "Preparation inventory unavailable"}))

    def test_preparation_status_returns_only_safe_public_counters_and_codes(self):
        status_path = self.root / "preparer-status.json"
        public = {"state": "preparing", "targetVerses": 579, "recordings": 206,
                  "counts": {"prepared": 10, "queued": 20, "held": 177, "excluded": 2},
                  "remainingToPrepare": 370, "machinePreparedVerses": 30,
                  "holdReasons": {"known_original_source_hold": 1, "source_or_full_chapter_guard": 176},
                  "visibleVerses": 11, "visibleWordCuts": 78, "updatedAt": "2026-10-22T12:00:00+00:00"}
        write_json(status_path, public)
        private_values = [uuid.uuid4().hex, uuid.uuid4().hex]
        private_payload = {**public, "token": private_values[0], "proofPath": str(self.root / "proof.json"),
                           "error": "private failure in " + str(status_path),
                           "unknown": {"token": private_values[1]}}
        server = self.status_server(status_path)
        with patch("listening_queue.read_state_json", return_value=private_payload):
            code, response = self.get_status(server)
            self.assertEqual(self.get_status(server, headers={"Host": "localhost.invalid"})[0], 403)
        self.assertEqual((code, response), (200, public))
        for value in private_values:
            self.assertNotIn(value, json.dumps(response))
        write_json(status_path, {"state": "complete", "updatedAt": "2026-10-22T12:05:00Z"})
        self.assertEqual(self.get_status(server), (200, {"state": "complete", "updatedAt": "2026-10-22T12:05:00Z"}))

    def test_bad_preparation_status_never_breaks_the_review_queue_or_exposes_paths(self):
        status_path = self.root / "not-written-yet.json"
        path, _, _ = self.batch(1)
        self.db.append(path)
        before = self.stored_state()
        server = self.status_server(status_path)
        bad = (None, "broken JSON", "[]", "{}", '{"state": "C:/private/path"}',
               '{"state": "preparing", "visibleVerses": true}',
               '{"state": "preparing", "visibleWordCuts": -1}',
               '{"state": "preparing", "counts": []}',
               '{"state": "preparing", "counts": {"held": "private detail"}}',
               '{"state": "preparing", "holdReasons": {"C:/private/path": 1}}',
               '{"state": "preparing", "holdReasons": {"source_hold": false}}',
               '{"state": "preparing", "updatedAt": 12}',
               '{"state": "preparing", "updatedAt": "invalid time"}')
        for raw in bad:
            with self.subTest(raw=raw):
                if raw is not None:
                    status_path.write_text(raw, encoding="utf-8")
                self.assertEqual(self.get_status(server), (409, {"error": "Preparation status unavailable"}))
                code, queue = self.get_status(server, "/api/queue")
                self.assertEqual(code, 200)
                self.assertEqual([case["id"] for case in queue["cases"]], ["1-1"])
        self.assertEqual(self.stored_state(), before)

    def test_status_http_reader_allows_atomic_replacement_while_its_handle_is_open(self):
        path = self.root / "preparer-status.json"
        old = {"state": "preparing", "remainingToPrepare": 2}
        new = {"state": "completed", "remainingToPrepare": 0}
        write_json(path, old)
        server = self.status_server(path)
        read_finished, replaced = threading.Event(), threading.Event()

        @contextmanager
        def hold_reader(source):
            with open_state_text(source) as stream:
                yield stream
                read_finished.set()
                if not replaced.wait(timeout=5):
                    raise AssertionError("The writer could not replace the status while its reader remained open")

        with patch("listening_files.open_state_text", side_effect=hold_reader):
            with ThreadPoolExecutor(max_workers=1) as pool:
                response = pool.submit(self.get_status, server)
                try:
                    self.assertTrue(read_finished.wait(timeout=5))
                    write_state_json(path, new)
                finally:
                    replaced.set()
                self.assertEqual(response.result(timeout=5), (200, old))
        self.assertEqual(self.get_status(server), (200, new))

    def test_only_unseen_cannot_replace_an_active_draft_or_hidden_review(self):
        payload = self.typed_case()
        first, reviews, _ = self.batch(1)
        self.db.append(first, reviews)
        revised = {**self.case, "candidateSha256": "replacement"}
        next_path, next_reviews, _ = self.batch(2, revised)
        for verdict in (None, "good", "problem", "skip"):
            with self.subTest(verdict=verdict):
                if verdict:
                    self.db.save_word_review({**payload, "verdict": verdict,
                                              "submissionId": "actual-browser-submission-" + verdict})
                before = self.stored_state()
                with self.assertRaisesRegex(ValueError, "previously offered"):
                    self.db.append(next_path, next_reviews, only_unseen=True)
                self.assertEqual(self.stored_state(), before)
                self.assertEqual(self.db.case("1-1", "candidate", self.case["clipSha256"]), self.case)

    def test_only_unseen_checks_retired_candidates_and_rolls_back_the_entire_batch(self):
        first, reviews, _ = self.batch(1)
        self.db.append(first, reviews)
        revised = {**self.case, "candidateSha256": "current"}
        second, _, _ = self.batch(2, revised)
        self.db.append(second)
        fresh = {**self.case, "id": "2-1", "perekId": 2}
        third, answers, queue = self.batch(3, fresh)
        queue["cases"].append(deepcopy(self.case))
        queue["queueSha256"] = digest_json(queue["cases"])
        write_json(third, queue)
        row = validate_decision(self.case, self.payload)
        write_json(answers, {"version": 1, "entries": [row]})
        before = self.stored_state()
        with self.assertRaisesRegex(ValueError, "previously offered"):
            self.db.append(third, answers, only_unseen=True)
        self.assertEqual(self.stored_state(), before)
        self.assertEqual(self.db.view()["cases"], [revised])

    def test_only_unseen_retry_of_the_same_immutable_batch_is_idempotent_after_good(self):
        payload = self.typed_case()
        path, reviews, _ = self.batch(1)
        seq = self.db.append(path, reviews, only_unseen=True)
        good = self.db.save_word_review(payload)
        before = self.stored_state()
        self.assertEqual(self.db.append(path, reviews, only_unseen=True), seq)
        self.assertEqual(self.stored_state(), before)
        self.assertEqual(self.db.all_word_reviews(), [good])
        self.assertEqual(self.db.view()["cases"], [])

    def test_cli_unseen_option_preserves_legacy_explicit_revision_behavior(self):
        path, _, _ = self.batch(1)
        arguments = ["listening_queue.py", "--store", str(self.db.path), "append", "--queue", str(path)]
        with patch("sys.argv", [*arguments, "--only-unseen"]), patch("builtins.print"):
            main()
        revised = {**self.case, "candidateSha256": "explicit-revision"}
        replacement, _, _ = self.batch(2, revised)
        arguments[-1] = str(replacement)
        with patch("sys.argv", [*arguments, "--only-unseen"]):
            with self.assertRaisesRegex(ValueError, "previously offered"):
                main()
        self.assertEqual(self.db.view()["cases"], [self.case])
        with patch("sys.argv", arguments), patch("builtins.print"):
            main()
        self.assertEqual(self.db.view()["cases"], [revised])

    def test_explicit_duplicate_batch_does_not_resurrect_a_completed_typed_good(self):
        payload = self.typed_case()
        path, _, _ = self.batch(1)
        self.db.append(path)
        good = self.db.save_word_review(payload)
        duplicate, _, _ = self.batch(2, {**self.case, "correctionNote": "display-only copy"})
        self.db.append(duplicate)
        self.assertEqual(self.db.view()["cases"], [])
        self.assertEqual(self.db.all_word_reviews(), [good])

    def test_only_one_concurrent_unseen_append_can_claim_a_new_verse(self):
        first, _, _ = self.batch(1)
        second, _, _ = self.batch(2)
        barrier = threading.Barrier(2)

        def append(path):
            barrier.wait(timeout=5)
            try:
                return self.db.append(path, only_unseen=True)
            except ValueError as error:
                return str(error)

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(append, (first, second)))
        self.assertEqual(sum(isinstance(value, int) for value in results), 1)
        self.assertEqual(sum("previously offered" in str(value) for value in results), 1)
        self.assertEqual(len(self.stored_state()["batch"]), 1)
        self.assertEqual(self.db.view()["cases"], [self.case])

    def test_good_saved_while_refill_validates_is_never_replaced(self):
        payload = self.typed_case()
        path, _, _ = self.batch(1)
        self.db.append(path)
        replacement, _, _ = self.batch(2, {**self.case, "candidateSha256": "refill"})
        checking, resume = threading.Event(), threading.Event()

        def validate(_case):
            checking.set()
            if not resume.wait(timeout=5):
                raise AssertionError("The concurrent real review did not complete")

        with patch("listening_accept.verify_diagnostic", side_effect=validate):
            with ThreadPoolExecutor(max_workers=1) as pool:
                refill = pool.submit(self.db.append, replacement, only_unseen=True)
                try:
                    self.assertTrue(checking.wait(timeout=5))
                    good = self.db.save_word_review(payload)
                    before = self.stored_state()
                finally:
                    resume.set()
                with self.assertRaisesRegex(ValueError, "previously offered"):
                    refill.result(timeout=5)
        self.assertEqual(self.stored_state(), before)
        self.assertEqual(self.db.all_word_reviews(), [good])
        self.assertEqual(self.db.view()["cases"], [])

    def test_append_survives_restart_and_never_changes_original_queue(self):
        path, reviews, queue = self.batch(1)
        original = path.read_bytes()
        self.db.append(path, reviews)
        row = self.db.save(self.case, self.payload)
        self.assertEqual(row["queueSha256"], queue["queueSha256"])
        verify_review(self.case, row, queue["queueSha256"])
        resumed = ReviewDatabase(self.db.path)
        self.assertEqual(resumed.snapshot()[case_key(self.case)], row)
        self.assertEqual(path.read_bytes(), original)
        self.assertEqual(self.db.append(path, reviews), 1)
        self.assertEqual(len(resumed.view()["cases"]), 1)

    def test_next_batch_accumulates_instead_of_replacing_current(self):
        a, reviews, _ = self.batch(1)
        self.db.append(a, reviews)
        other = {**self.case, "id": "2-1", "perekId": 2}
        b, reviews, _ = self.batch(2, other)
        self.db.append(b, reviews)
        self.assertEqual([c["id"] for c in self.db.view()["cases"]], ["1-1", "2-1"])

    def test_changed_candidate_keeps_old_hearing_separate_and_old_draft_can_save(self):
        a, reviews, _ = self.batch(1)
        self.db.append(a, reviews)
        changed = {**self.case, "candidateSha256": "new", "words": [
            {**self.case["words"][0], "endMs": 340}]}
        b, reviews, queue = self.batch(2, changed)
        self.db.append(b, reviews)
        old = self.db.save(self.case, self.payload)
        self.assertIn(case_key(self.case), self.db.snapshot())
        self.assertNotIn(case_key(changed), self.db.snapshot())
        self.assertEqual(self.db.view()["cases"], [changed])
        self.assertEqual(self.db.view()["retiredCases"], [self.case])
        with self.assertRaises(ValueError):
            verify_review(changed, old, queue["queueSha256"])

    def test_genuine_later_answers_on_old_page_are_imported_exactly(self):
        path, reviews, queue = self.batch(1)
        self.db.append(path, reviews)
        row = validate_decision(self.case, self.payload)
        row["queueSha256"] = queue["queueSha256"]
        write_json(reviews, {"version": 1, "entries": [row]})
        self.db.sync_histories()
        self.db.sync_histories()
        self.assertEqual(list(self.db.snapshot().values()), [row])
        altered = {**row, "note": "rewritten"}
        write_json(reviews, {"version": 1, "entries": [altered]})
        with self.assertRaisesRegex(ValueError, "rewritten"):
            self.db.sync_histories()
        self.assertEqual(list(self.db.snapshot().values()), [row])

    def test_mutated_queue_or_candidate_rolls_back_append(self):
        path, reviews, _ = self.batch(1)
        self.db.append(path, reviews)
        changed = read_json(path)
        changed["label"] = "changed"
        write_json(path, changed)
        with self.assertRaisesRegex(ValueError, "immutable"):
            self.db.append(path)
        with self.assertRaisesRegex(ValueError, "immutable"):
            self.db.sync_histories()

    def test_duplicate_bound_candidate_with_modified_metadata_is_rejected(self):
        path, reviews, _ = self.batch(1)
        self.db.append(path, reviews)
        b, _, _ = self.batch(2, {**self.case, "words": []})
        with self.assertRaisesRegex(ValueError, "modified"):
            self.db.append(b)
        self.assertEqual(self.db.view()["cases"], [self.case])

    def test_identical_relocated_clip_and_display_hints_keep_original_evidence(self):
        a, reviews, queue = self.batch(1)
        self.db.append(a, reviews)
        b, reviews, _ = self.batch(2, {**self.case, "clipPath": "copied.wav",
                                      "reviewKind": "remaining", "changedSegments": []})
        self.db.append(b, reviews)
        row = self.db.save(self.case, self.payload)
        self.assertEqual(row["queueSha256"], queue["queueSha256"])
        self.assertEqual(self.db.case("1-1", "candidate", "clip"), self.case)

    def test_diagnostic_rejection_never_adds_a_batch(self):
        path, reviews, _ = self.batch(1)
        with patch("listening_accept.verify_diagnostic", side_effect=ValueError("source changed")):
            with self.assertRaises(ValueError):
                self.db.append(path, reviews)
        self.assertEqual(self.db.view()["cases"], [])

    def test_partial_or_wrong_cut_cannot_be_good(self):
        path, reviews, _ = self.batch(1)
        self.db.append(path, reviews)
        for change in ({"heardSegments": []}, {"candidateSha256": "wrong"}, {"clipSha256": "wrong"}):
            with self.assertRaises(ValueError):
                self.db.save(self.case, {**self.payload, **change})
        self.assertEqual(self.db.snapshot(), {})

    def test_concurrent_saves_keep_every_real_edit(self):
        path, reviews, _ = self.batch(1)
        self.db.append(path, reviews)
        with ThreadPoolExecutor(max_workers=4) as pool:
            rows = list(pool.map(lambda n: self.db.save(self.case, {**self.payload, "note": str(n)}), range(12)))
        self.assertEqual(len(self.db.snapshot()), 1)
        with closing(__import__("sqlite3").connect(self.db.path)) as connection:
            self.assertEqual(connection.execute("SELECT count(*) FROM entry").fetchone()[0], len(rows))

    def test_seed_keeps_all_actual_answers_without_reoffering_reviewed_cases(self):
        row = validate_decision(self.case, self.payload)
        a, reviews, queue = self.batch(1)
        row["queueSha256"] = queue["queueSha256"]
        write_json(reviews, {"version": 1, "entries": [row]})
        sources = [{"queue": str(a), "reviews": str(reviews), "queueSha256": digest_file(a)}]
        self.db.seed(sources)
        self.assertEqual(self.db.view()["cases"], [])
        self.assertEqual(list(self.db.snapshot().values()), [row])
        with self.assertRaisesRegex(ValueError, "empty"):
            self.db.seed(sources)

    def test_export_preserves_queue_bytes_and_all_decision_fields(self):
        a, reviews, _ = self.batch(1)
        self.db.append(a, reviews)
        row = self.db.save(self.case, self.payload)
        queue, answers, _text = self.db.export(self.root / "snapshot")
        archive = Path(read_json(queue)["archivedQueues"][0]["path"])
        self.assertEqual(archive.read_bytes(), a.read_bytes())
        self.assertEqual(read_json(answers)["entries"], [row])
        self.assertEqual(read_json(queue)["cases"], [])
        with self.assertRaises(ValueError):
            ReviewDatabase(self.root / "recitation-working.sqlite")
        with self.assertRaises(ValueError):
            ReviewDatabase(self.root / "recitation.sqlite")

    def test_export_preserves_repeated_edits_including_empty_good_note(self):
        a, reviews, _ = self.batch(1)
        self.db.append(a, reviews)
        good = self.db.save(self.case, self.payload)
        problem = self.db.save(self.case, {**self.payload, "verdict": "problem", "note": "still long"})
        _queue, answers, _text = self.db.export(self.root / "edits")
        self.assertEqual(read_json(answers)["entries"], [good, problem])
        self.assertEqual(self.db.all_entries(), [good, problem])
        self.assertEqual(len(self.db.snapshot()), 1)
        self.assertEqual(good["note"], "")

    def test_feedback_export_preserves_all_typed_fields_and_stream_order(self):
        rows = [{"savedAt": "2026-10-22T12:00:00+00:00", "note": "", "unknown": {"keep": [1, False]}},
                {"savedAt": "2026-10-22T11:00:00+00:00", "note": "first", "unknown": None}]
        with self.db._transaction() as db:
            self.db._insert_entries(db, rows)
            for number, row in enumerate(rows):
                db.execute("INSERT INTO cut_edit VALUES (?,?,?)",
                           (str(number), json.dumps(row), row["savedAt"]))
                db.execute("INSERT INTO word_review VALUES (?,?,?,?)",
                           (str(number), "original-request", json.dumps(row), row["savedAt"]))
        exported = self.db.export_feedback()
        for field in ("entries", "timingEdits", "wordReviews"):
            self.assertEqual(exported[field], list(reversed(rows)))
        self.assertEqual(self.db.all_cut_edits(), exported["timingEdits"])
        self.assertEqual(self.db.all_word_reviews(), exported["wordReviews"])
        # Distinct actual typed saves with the same timestamp keep their saved insertion order.
        tied = {**rows[0], "note": "same-time later edit"}
        with self.db._transaction() as db:
            db.execute("INSERT INTO word_review VALUES (?,?,?,?)",
                       ("later", "request-later", json.dumps(tied), tied["savedAt"]))
        self.assertEqual(self.db.export_feedback()["wordReviews"], [rows[1], rows[0], tied])

    def test_feedback_export_is_one_snapshot_when_a_writer_saves_between_streams(self):
        first_read, written = threading.Event(), threading.Event()
        original_entries = self.db._entries
        row = {"savedAt": "2026-10-22T12:00:00+00:00", "note": "atomic actual fields"}

        def entries(db):
            result = original_entries(db)
            first_read.set()
            if not written.wait(timeout=5):
                raise AssertionError("Concurrent feedback save did not commit")
            return result

        def save():
            if not first_read.wait(timeout=5):
                raise AssertionError("Feedback export did not establish its snapshot")
            with self.db._transaction() as db:
                self.db._insert_entries(db, [row])
                db.execute("INSERT INTO cut_edit VALUES (?,?,?)", ("proposal", json.dumps(row), row["savedAt"]))
                db.execute("INSERT INTO word_review VALUES (?,?,?,?)",
                           ("submission", "request", json.dumps(row), row["savedAt"]))
            written.set()

        with ThreadPoolExecutor(max_workers=1) as pool:
            writer = pool.submit(save)
            with patch.object(self.db, "_entries", side_effect=entries):
                exported = self.db.export_feedback()
            writer.result(timeout=5)
        self.assertEqual(exported, {"entries": [], "timingEdits": [], "wordReviews": []})
        self.assertEqual(self.db.export_feedback(), {"entries": [row], "timingEdits": [row], "wordReviews": [row]})
        # The export connection is closed, so a subsequent exclusive writer is not held open.
        with self.db._transaction() as db:
            db.execute("BEGIN EXCLUSIVE")

    def test_preparation_workload_counts_all_offered_ids_but_only_visible_current_words(self):
        payload = self.typed_case()
        path, _, _ = self.batch(1)
        self.db.append(path)
        initial = self.db.preparation_workload()
        self.assertEqual(initial["offeredCaseIds"], ["1-1"])
        self.assertEqual(initial["visibleCaseIds"], ["1-1"])
        self.assertEqual(initial["visibleWordCuts"], 1)
        self.db.save_word_review(payload)
        hidden = self.db.preparation_workload()
        self.assertEqual(hidden["offeredCaseIds"], ["1-1"])
        self.assertEqual((hidden["visibleCaseIds"], hidden["visibleWordCuts"]), ([], 0))
        self.assertNotEqual(hidden["revision"], initial["revision"])
        revised = {**self.case, "candidateSha256": "new-current", "words": [*self.case["words"],
                   {**self.case["words"][0], "segment": 2, "startMs": 400, "endMs": 500}]}
        second, _, _ = self.batch(2, revised)
        self.db.append(second)
        other = {**self.case, "id": "2-1", "perekId": 2}
        third, _, _ = self.batch(3, other)
        self.db.append(third)
        visible = self.db.preparation_workload()
        self.assertEqual(visible["offeredCaseIds"], ["1-1", "2-1"])
        self.assertEqual(visible["visibleCaseIds"], ["1-1", "2-1"])
        self.assertEqual(visible["visibleWordCuts"], 3)
        self.assertEqual(self.db.preparation_workload(), visible)

    def test_http_requires_local_session_and_exact_candidate(self):
        a, reviews, _ = self.batch(1)
        self.db.append(a, reviews)
        server = make_queue_server(self.db, 0, self.root / "session.json")
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        connection = HTTPConnection("127.0.0.1", server.server_port)
        self.addCleanup(connection.close)
        connection.request("GET", "/api/queue")
        response = connection.getresponse()
        view = json.loads(response.read())
        self.assertTrue(view["persistentQueue"])
        self.assertNotIn(view["token"], server.template.decode())
        headers = {"Origin": server.origin, "X-Review-Token": "invalid", "Content-Type": "application/json"}
        connection.request("POST", "/api/reviews", json.dumps(self.payload), headers)
        response = connection.getresponse()
        self.assertEqual(response.status, 403)
        response.read()
        headers["X-Review-Token"] = view["token"]
        connection.request("POST", "/api/reviews", json.dumps(self.payload), headers)
        response = connection.getresponse()
        self.assertEqual(response.status, 200)
        row = json.loads(response.read())
        self.assertEqual(row["candidateWords"], self.case["words"])
        self.assertEqual(row["note"], "")
        connection.request("GET", "/api/export")
        response = connection.getresponse()
        self.assertEqual(json.loads(response.read()), {"version": 1, **self.db.export_feedback(),
                                                       "publicationStatus": "held"})
        connection.request("GET", "/api/preparation-workload")
        response = connection.getresponse()
        workload = json.loads(response.read())
        self.assertEqual(workload, self.db.preparation_workload())
        self.assertNotIn("token", workload)
        connection.request("GET", "/api/preparation-workload", headers={"Host": "invalid"})
        response = connection.getresponse()
        self.assertEqual(response.status, 403)
        response.read()
        connection.request("GET", "/clips/1-1?candidate=wrong&clip=clip")
        response = connection.getresponse()
        self.assertEqual(response.status, 409)
        response.read()


if __name__ == "__main__":
    unittest.main()
