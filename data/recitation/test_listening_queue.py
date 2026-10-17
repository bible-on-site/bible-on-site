"""Persistent accumulated review queue and immutable provenance regressions."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from copy import deepcopy
from http.client import HTTPConnection
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch

from listening_accept import verify_review
from listening_queue import ReviewDatabase, case_key, make_queue_server
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
        connection.request("GET", "/clips/1-1?candidate=wrong&clip=clip")
        response = connection.getresponse()
        self.assertEqual(response.status, 409)
        response.read()


if __name__ == "__main__":
    unittest.main()
