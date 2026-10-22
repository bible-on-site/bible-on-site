"""Persistent accumulated review queue and immutable provenance regressions."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing, contextmanager
from copy import deepcopy
from http.client import HTTPConnection
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

    def status_server(self, path=None):
        server = make_queue_server(self.db, 0, self.root / "session.json", preparation_status=path)
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
