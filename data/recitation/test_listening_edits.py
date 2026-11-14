"""Held timing proposal API: exact audio, truthful hearing, immutable history and safe geometry."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from copy import deepcopy
from http.client import HTTPConnection
import json
from pathlib import Path
import sqlite3
import tempfile
import threading
import unittest
from unittest.mock import patch
import wave

from listening_queue import ReviewDatabase, make_queue_server
from listening_edits import verify_word_review
from listening_review import (ReviewStore, candidate_digest, digest_file, digest_json, make_server,
                              read_json, validate_decision, write_json)


class CutEditTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.root = Path(folder.name)
        self.clip = self.root / "original.wav"
        with wave.open(str(self.clip), "wb") as audio:
            audio.setparams((1, 2, 16000, 0, "NONE", "not compressed"))
            audio.writeframes(bytes([8, 1]) * 32000)
        self.case = {"id": "1-1", "perekId": 1, "pasuk": 1, "label": "בראשית א א",
                     "audioSha256": "unchanged-original-source", "textSha256": "canonical-text",
                     "candidateSha256": "exact-candidate", "clipSha256": digest_file(self.clip),
                     "clipPath": str(self.clip), "clipStartMs": 1000, "clipEndMs": 3000,
                     "diagnosticSha256": "pinned-diagnostic", "publicationStatus": "held",
                     "words": [{"pasuk": 1, "segment": segment, "text": text,
                                "startMs": start, "endMs": end, "score": score}
                               for segment, text, start, end, score in
                               ((1, "בראשית", 1100, 1400, 0.71), (3, "ברא", 1500, 1800, 0.52),
                                (4, "אלהים", 1900, 2200, 0.83))]}
        self.payload = {"caseId": "1-1", "candidateSha256": "exact-candidate",
                        "clipSha256": self.case["clipSha256"],
                        "timingEdits": [{"segment": 3, "startMs": 1500, "endMs": 1812}],
                        "heardEditedSegments": [3], "heardSegments": [1, 3, 4],
                        "note": "  הסוף נשמע מלא עכשיו  "}
        self.db = ReviewDatabase(self.root / "listening.sqlite")
        self.loader = patch("listening_queue.load_queue", side_effect=read_json)
        self.loader.start()
        self.addCleanup(self.loader.stop)
        self.diagnostic = patch("listening_accept.verify_diagnostic")
        self.diagnostic.start()
        self.addCleanup(self.diagnostic.stop)
        self.queue = self.append_batch(1)

    def append_batch(self, number, case=None):
        folder = self.root / f"batch-{number}"
        folder.mkdir()
        cases = [deepcopy(case or self.case)]
        path = folder / "queue.json"
        write_json(path, {"version": 1, "publicationStatus": "held", "cases": cases,
                          "canonicalPath": str(self.root / "canonical.json"),
                          "queueSha256": digest_json(cases)})
        self.db.append(path)
        return path

    def unchanged_state(self):
        with closing(sqlite3.connect(self.db.path)) as db:
            return {
                "batch": db.execute("SELECT * FROM batch ORDER BY rowid").fetchall(),
                "candidate": db.execute("SELECT * FROM candidate ORDER BY rowid").fetchall(),
                "current_candidate": db.execute("SELECT * FROM current_candidate ORDER BY rowid").fetchall(),
                "history": db.execute("SELECT * FROM history ORDER BY rowid").fetchall(),
                "entry": db.execute("SELECT * FROM entry ORDER BY rowid").fetchall(),
            }

    def test_saving_preserves_source_scores_candidate_and_all_real_reviews(self):
        real = self.db.save(self.case, {"candidateSha256": self.case["candidateSha256"],
                                       "clipSha256": self.case["clipSha256"], "verdict": "problem",
                                       "heardSegments": [1, 3], "note": "צריך סוף מאוחר יותר"})
        before, queue_bytes = self.unchanged_state(), self.queue.read_bytes()
        row = self.db.save_cut_edits(self.payload)
        self.assertEqual(self.unchanged_state(), before)
        self.assertEqual(self.queue.read_bytes(), queue_bytes)
        self.assertEqual(self.db.all_entries(), [real])
        self.assertEqual(row["words"][0], self.case["words"][0])
        self.assertEqual(row["words"][2], self.case["words"][2])
        self.assertEqual(row["words"][1], {**self.case["words"][1], "endMs": 1812})
        self.assertEqual(row["note"], self.payload["note"])
        self.assertEqual(row["changedSegments"], [3])
        self.assertEqual(row["kind"], "manual-cut-proposal")
        self.assertEqual(row["publicationStatus"], "held")
        self.assertIs(row["automaticApproval"], False)
        self.assertNotIn("verdict", row)
        self.assertEqual(row["clipEvidence"]["frameCount"], 32000)
        self.assertEqual(row["queueSha256"], read_json(self.queue)["queueSha256"])
        self.assertEqual(ReviewDatabase(self.db.path).all_cut_edits(), [row])

    def test_exact_retry_and_concurrent_retry_return_the_original_append(self):
        row = self.db.save_cut_edits(self.payload)
        with ThreadPoolExecutor(max_workers=4) as pool:
            repeated = list(pool.map(lambda _: self.db.save_cut_edits(deepcopy(self.payload)), range(8)))
        self.assertEqual(repeated, [row] * 8)
        self.assertEqual(self.db.all_cut_edits(), [row])
        second = self.db.save_cut_edits({**self.payload, "note": "נבדק שוב"})
        self.assertNotEqual(second["proposalSha256"], row["proposalSha256"])
        self.assertEqual(self.db.all_cut_edits(), [row, second])

    def test_stale_revision_is_rejected_even_though_archived_candidate_remains(self):
        revised = {**self.case, "candidateSha256": "new-candidate"}
        self.append_batch(2, revised)
        before = self.unchanged_state()
        with self.assertRaisesRegex(ValueError, "replaced"):
            self.db.save_cut_edits(self.payload)
        self.assertEqual(self.db.case("1-1", "exact-candidate", self.case["clipSha256"]), self.case)
        self.assertEqual(self.unchanged_state(), before)
        self.assertEqual(self.db.all_cut_edits(), [])

    def test_changed_geometry_does_not_inherit_original_cut_hearing(self):
        for heard in ([], [1], [3, 3], [True], [3, 4]):
            with self.subTest(heard=heard), self.assertRaises(ValueError):
                self.db.save_cut_edits({**self.payload, "heardEditedSegments": heard})
        self.assertEqual(self.db.all_cut_edits(), [])

    def test_geometry_uses_actual_clip_and_never_clamps_or_moves_neighbors(self):
        for start, end in ((999, 1812), (1500, 3001), (1500, 1500), (1500, 1539),
                           (1399, 1812), (1500, 1901), (1500.1, 1812), (True, 1812)):
            with self.subTest(start=start, end=end), self.assertRaises(ValueError):
                self.db.save_cut_edits({**self.payload, "timingEdits": [
                    {"segment": 3, "startMs": start, "endMs": end}]})
        row = self.db.save_cut_edits({**self.payload, "timingEdits": [
            {"segment": 3, "startMs": 1400, "endMs": 1900}]})
        self.assertEqual(row["words"][0], self.case["words"][0])
        self.assertEqual(row["words"][2], self.case["words"][2])

    def test_only_known_sparse_word_identities_and_changed_integer_fields_are_accepted(self):
        invalid = ([], [{"segment": 2, "startMs": 1500, "endMs": 1812}],
                   [{"segment": 3, "startMs": 1500, "endMs": 1800}],
                   self.payload["timingEdits"] * 2,
                   [{**self.payload["timingEdits"][0], "score": 1}],
                   [{"segment": True, "startMs": 1500, "endMs": 1812}])
        for edits in invalid:
            with self.subTest(edits=edits), self.assertRaises(ValueError):
                self.db.save_cut_edits({**self.payload, "timingEdits": edits})
        for field, value in (("heardSegments", [2]), ("heardSegments", [1, 1]),
                             ("note", "x" * 2001), ("note", {}), ("clipSha256", "other")):
            with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                self.db.save_cut_edits({**self.payload, field: value})
        self.assertEqual(self.db.all_cut_edits(), [])

    def test_tampered_audio_and_truncated_pcm_cannot_receive_a_saved_proposal(self):
        self.clip.write_bytes(self.clip.read_bytes()[:-2])
        with self.assertRaisesRegex(ValueError, "changed"):
            self.db.save_cut_edits(self.payload)
        bad_case = {**self.case, "candidateSha256": "truncated-candidate", "clipSha256": digest_file(self.clip)}
        self.append_batch(2, bad_case)
        with self.assertRaisesRegex(ValueError, "truncated"):
            self.db.save_cut_edits({**self.payload, "candidateSha256": bad_case["candidateSha256"],
                                     "clipSha256": bad_case["clipSha256"]})
        self.assertEqual(self.db.all_cut_edits(), [])

    def test_container_duration_metadata_is_not_used_as_pcm_bounds(self):
        bad_case = {**self.case, "candidateSha256": "wrong-duration", "clipEndMs": 3001}
        self.append_batch(2, bad_case)
        with self.assertRaisesRegex(ValueError, "PCM frame bounds"):
            self.db.save_cut_edits({**self.payload, "candidateSha256": bad_case["candidateSha256"]})
        self.assertEqual(self.db.all_cut_edits(), [])

    def test_long_human_selected_context_requires_exact_pcm_and_actual_edited_hearing(self):
        path = self.root / "genuine-long-verse.wav"
        with wave.open(str(path), "wb") as audio:
            audio.setparams((1, 2, 16000, 0, "NONE", "not compressed"))
            audio.writeframes(b"\0\0" * (70000 * 16))
        case = {**self.case, "candidateSha256": "long-human-selected-context", "clipPath": str(path),
                "clipSha256": digest_file(path), "clipStartMs": 1000, "clipEndMs": 71000,
                "preparationKind": "human-selected-context-v1", "manualSourceInspection": False,
                "requiresFreshHumanCutReview": True}
        self.append_batch(2, case)
        payload = {**self.payload, "submissionId": "long-context-real-fixture-1", "verdict": "good",
                   "candidateSha256": case["candidateSha256"], "clipSha256": case["clipSha256"]}
        with self.assertRaisesRegex(ValueError, "every exact edited cut"):
            self.db.save_word_review({**payload, "heardEditedSegments": []})
        with self.assertRaisesRegex(ValueError, "every unchanged exact word cut"):
            self.db.save_word_review({**payload, "heardSegments": [3]})
        row = self.db.save_word_review(payload)
        self.assertEqual(row["verdict"], "good")
        self.assertEqual(row["clipEvidence"]["frameCount"], 70000 * 16)
        self.assertEqual(row["changedSegments"], [3])
        self.assertFalse(row["automaticApproval"])
        verify_word_review(case, row, row["queueSha256"])
        changed = deepcopy(row)
        changed["listenEvidenceReportedByBrowser"]["heardEditedSegments"] = []
        with self.assertRaises(ValueError):
            verify_word_review(case, changed, row["queueSha256"])

    def test_long_clip_does_not_relax_the_existing_automatic_context_policy(self):
        path = self.root / "old-context-too-long.wav"
        with wave.open(str(path), "wb") as audio:
            audio.setparams((1, 2, 16000, 0, "NONE", "not compressed"))
            audio.writeframes(b"\0\0" * (70000 * 16))
        case = {**self.case, "candidateSha256": "old-automatic-context", "clipPath": str(path),
                "clipSha256": digest_file(path), "clipStartMs": 1000, "clipEndMs": 71000}
        self.append_batch(2, case)
        with self.assertRaisesRegex(ValueError, "PCM frame bounds"):
            self.db.save_cut_edits({**self.payload, "candidateSha256": case["candidateSha256"],
                                     "clipSha256": case["clipSha256"]})

    def server(self):
        server = make_queue_server(self.db, 0, self.root / "session.json")
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        return server

    def request(self, server, method, path, body=None, headers=None):
        connection = HTTPConnection("127.0.0.1", server.server_port)
        self.addCleanup(connection.close)
        connection.request(method, path, body, headers or {})
        response = connection.getresponse()
        raw = response.read()
        return response.status, json.loads(raw)

    def test_http_authentication_and_export_separate_proposals_from_real_verdicts(self):
        server = self.server()
        headers = {"Origin": server.origin, "X-Review-Token": server.token, "Content-Type": "application/json"}
        for mutation in ({"X-Review-Token": "invalid"}, {"Origin": "https://elsewhere.example"},
                         {"Origin": ""}, {"Host": "localhost.invalid"}):
            status, _ = self.request(server, "POST", "/api/cut-edits", json.dumps(self.payload),
                                     {**headers, **mutation})
            self.assertEqual(status, 403)
        self.assertEqual(self.db.all_cut_edits(), [])
        status, row = self.request(server, "POST", "/api/cut-edits", json.dumps(self.payload), headers)
        self.assertEqual(status, 200)
        self.assertEqual(row["words"][1]["endMs"], 1812)
        status, exported = self.request(server, "GET", "/api/export")
        self.assertEqual(status, 200)
        self.assertEqual(exported["entries"], [])
        self.assertEqual(exported["timingEdits"], [row])
        self.assertEqual(exported["publicationStatus"], "held")
        status, proposals = self.request(server, "GET", "/api/cut-edits")
        self.assertEqual((status, proposals), (200, {"entries": [row]}))
        self.assertEqual(self.request(server, "GET", "/api/cut-edits", headers={"Host": "invalid"})[0], 403)

    def test_http_bounded_json_and_stale_candidate_fail_without_any_proposal(self):
        server = self.server()
        headers = {"Origin": server.origin, "X-Review-Token": server.token, "Content-Type": "application/json"}
        for body, changes in ((" " * 16385, {}), ("[]", {}), ("broken", {}),
                              (json.dumps(self.payload), {"Content-Type": "text/plain"})):
            with self.subTest(body=body[:20]):
                self.assertEqual(self.request(server, "POST", "/api/cut-edits", body,
                                              {**headers, **changes})[0], 400)
        revised = {**self.case, "candidateSha256": "new-current"}
        self.append_batch(2, revised)
        self.assertEqual(self.request(server, "POST", "/api/cut-edits", json.dumps(self.payload), headers)[0], 400)
        self.assertEqual(self.db.all_cut_edits(), [])
        self.assertEqual(self.db.all_entries(), [])


class WordReviewTests(unittest.TestCase):
    """One explicit action saves all current coordinates and advances atomically."""

    setUp = CutEditTests.setUp
    append_batch = CutEditTests.append_batch
    server = CutEditTests.server
    request = CutEditTests.request

    def review(self, **changes):
        return {**self.payload, "submissionId": "actual-browser-submission-1", "verdict": "good", **changes}

    def test_good_saves_all_current_words_and_finishes_only_this_work_item(self):
        other = {**self.case, "id": "2-1", "perekId": 2}
        self.append_batch(2, other)
        old = self.db.save(self.case, {**self.payload, "timingEdits": [], "heardEditedSegments": [],
                                       "verdict": "problem", "note": "old actual problem"})
        proposal = self.db.save_cut_edits(self.payload)
        original_queue = self.queue.read_bytes()
        revision = self.db.view()["revision"]
        row = self.db.save_word_review(self.review())
        self.assertEqual(row["candidateWords"], [self.case["words"][0],
            {**self.case["words"][1], "endMs": 1812}, self.case["words"][2]])
        self.assertEqual(row["candidateSha256"], self.case["candidateSha256"])
        self.assertEqual(row["editedCandidateSha256"], digest_json({
            "candidateSha256": self.case["candidateSha256"], "clipSha256": self.case["clipSha256"],
            "words": row["candidateWords"]}))
        self.assertEqual(row["note"], "")
        self.assertIs(row["automaticApproval"], False)
        self.assertEqual(self.db.view()["cases"], [other])
        self.assertNotEqual(self.db.view()["revision"], revision)
        key = ":".join((row["caseId"], row["candidateSha256"], row["clipSha256"]))
        self.assertEqual(self.db.view()["wordReviewDecisions"], {key: row})
        self.assertEqual(self.db.all_entries(), [old])
        self.assertEqual(self.db.all_cut_edits(), [proposal])
        self.assertEqual(self.queue.read_bytes(), original_queue)
        verify_word_review(self.case, row, read_json(self.queue)["queueSha256"])

    def test_whole_verse_good_without_edits_and_problem_skip_finish_current_item(self):
        row = self.db.save_word_review(self.review(timingEdits=[], heardEditedSegments=[]))
        self.assertEqual(row["candidateWords"], self.case["words"])
        self.assertEqual(row["changedSegments"], [])
        self.assertEqual(self.db.view()["cases"], [])
        for verdict in ("problem", "skip"):
            with self.subTest(verdict=verdict):
                # A distinct actual action is retained, even after a prior GOOD.
                next_row = self.db.save_word_review(self.review(
                    submissionId="actual-browser-" + verdict, verdict=verdict,
                    heardSegments=[], heardEditedSegments=[], note="  current problem  "))
                self.assertEqual(next_row["note"], "current problem" if verdict == "problem" else "")
                self.assertEqual(self.db.view()["cases"], [])
        self.assertEqual(len(self.db.all_word_reviews()), 3)
        self.assertEqual(self.db.all_entries(), [])

    def test_good_requires_fresh_exact_edited_hearing_and_every_unchanged_word(self):
        for changes in ({"heardEditedSegments": []}, {"heardSegments": [3, 4]},
                        {"heardSegments": [1, 3]}, {"heardSegments": [1, 3, 4, 4]},
                        {"heardEditedSegments": [1, 3]}, {"heardEditedSegments": [True]}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                self.db.save_word_review(self.review(**changes))
        self.assertEqual(self.db.all_word_reviews(), [])
        self.assertEqual(self.db.view()["cases"], [self.case])
        # Hearing an edited word does not require claiming its OLD coordinates heard.
        row = self.db.save_word_review(self.review(heardSegments=[1, 4]))
        self.assertEqual(row["listenEvidenceReportedByBrowser"]["heardSegments"], [1, 4])
        self.assertEqual(row["listenEvidenceReportedByBrowser"]["heardEditedSegments"], [3])

    def test_retry_is_idempotent_after_response_loss_restart_and_current_replacement(self):
        payload = self.review()
        row = self.db.save_word_review(payload)
        with ThreadPoolExecutor(max_workers=4) as pool:
            self.assertEqual(list(pool.map(lambda _: self.db.save_word_review(deepcopy(payload)), range(8))), [row] * 8)
        resumed = ReviewDatabase(self.db.path)
        self.assertEqual(resumed.save_word_review(payload), row)
        revised = {**self.case, "candidateSha256": "new-exact-current-candidate"}
        self.append_batch(2, revised)
        self.assertEqual(self.db.save_word_review(payload), row)
        with self.assertRaisesRegex(ValueError, "different review"):
            self.db.save_word_review({**payload, "verdict": "problem"})
        with self.assertRaisesRegex(ValueError, "replaced"):
            self.db.save_word_review({**payload, "submissionId": "new-browser-submission-2"})
        self.assertEqual(self.db.all_word_reviews(), [row])
        self.assertEqual(self.db.view()["cases"], [revised])

    def test_failed_whole_review_never_partially_hides_or_appends(self):
        for change in ({"submissionId": "bad"}, {"verdict": "unknown"}, {"clipSha256": "wrong"},
                       {"timingEdits": [{"segment": 3, "startMs": 1500, "endMs": 1901}]},
                       {"timingEdits": [{"segment": 3, "startMs": 1500, "endMs": 1539}]}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                self.db.save_word_review(self.review(**change))
        self.assertEqual(self.db.view()["cases"], [self.case])
        self.assertEqual(self.db.all_word_reviews(), [])

    def test_verifier_rejects_changed_saved_words_verdict_note_or_hearing(self):
        row = self.db.save_word_review(self.review())
        queue_sha = read_json(self.queue)["queueSha256"]
        for change in ({"note": "old problem"}, {"verdict": "problem"},
                       {"candidateWords": self.case["words"]}, {"editedCandidateSha256": "other"},
                       {"listenEvidenceReportedByBrowser": {"heardSegments": [1, 4], "heardEditedSegments": [], "verseHeard": False}},
                       {"queueSha256": "other"}, {"savedAt": ""}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                verify_word_review(self.case, {**row, **change}, queue_sha)

    def test_export_preserves_typed_reviews_separately_from_legacy_and_proposals(self):
        row = self.db.save_word_review(self.review())
        _queue, path, _canonical = self.db.export(self.root / "snapshot")
        self.assertEqual(read_json(path), {"version": 1, "entries": [], "wordReviews": [row]})
        server = self.server()
        status, exported = self.request(server, "GET", "/api/export")
        self.assertEqual(status, 200)
        self.assertEqual(exported["entries"], [])
        self.assertEqual(exported["timingEdits"], [])
        self.assertEqual(exported["wordReviews"], [row])

    def test_archive_includes_actual_manual_review_without_rewriting_legacy_history(self):
        legacy = self.db.save(self.case, {**self.payload, "timingEdits": [], "heardEditedSegments": [],
                                          "verdict": "problem", "note": "old actual note"})
        manual = self.db.save_word_review(self.review())
        later_legacy = self.db.save(self.case, {**self.payload, "timingEdits": [], "heardEditedSegments": [],
                                                "verdict": "skip", "note": "actual old-tab note"})
        server = self.server()
        status, archive = self.request(server, "GET", "/api/archive")
        self.assertEqual(status, 200)
        self.assertEqual(archive[0]["caseCount"], 3)
        self.assertEqual([case["decision"] for case in archive[0]["cases"]],
                         [legacy, manual, later_legacy])
        self.assertEqual(archive[0]["cases"][1]["decision"]["kind"], "manual-word-review")
        self.assertEqual(archive[0]["cases"][1]["decision"]["candidateWords"][1]["endMs"], 1812)
        self.assertEqual(self.db.all_entries(), [legacy, later_legacy])
        self.assertEqual(self.db.all_word_reviews(), [manual])

    def test_unchanged_prior_direct_hearing_stays_distinct_from_fresh_edited_hearing(self):
        prior = deepcopy(self.case)
        prior["candidateSha256"] = candidate_digest(prior)
        original = validate_decision(prior, {"candidateSha256": prior["candidateSha256"],
            "verdict": "problem", "heardSegments": [1, 4], "note": "word 3 needs adjustment"})
        prior_queue = {"cases": [prior], "queueSha256": digest_json([prior])}
        original["queueSha256"] = prior_queue["queueSha256"]
        queue_path, review_path = self.root / "actual-prior-queue.json", self.root / "actual-prior-reviews.json"
        write_json(queue_path, prior_queue)
        write_json(review_path, {"entries": [original]})
        proof = {"queuePath": str(queue_path), "queueFileSha256": digest_file(queue_path),
                 "reviewsPath": str(review_path), "reviewsFileSha256": digest_file(review_path),
                 "decisionIndex": 0, "decision": original}
        proof_path = self.root / "actual-direct-hearing.json"
        write_json(proof_path, proof)
        current = {**self.case, "listeningReusePath": str(proof_path),
                   "listeningReuseSha256": digest_file(proof_path), "reusableHeardSegments": [1, 4]}
        current["candidateSha256"] = candidate_digest(current)
        self.append_batch(2, current)
        payload = self.review(candidateSha256=current["candidateSha256"], heardSegments=[1, 4],
                              freshHeardSegments=[])
        row = self.db.save_word_review(payload)
        evidence = row["listenEvidenceReportedByBrowser"]
        self.assertEqual(evidence["reusedHeardSegments"], [1, 4])
        self.assertEqual(evidence["freshHeardSegments"], [])
        self.assertEqual(evidence["heardEditedSegments"], [3])
        verify_word_review(current, row, row["queueSha256"])
        # Editing a reused cut invalidates that prior hearing for the edited cut.
        with self.assertRaisesRegex(ValueError, "every exact edited"):
            self.db.save_word_review({**payload, "submissionId": "different-actual-browser-review",
                "timingEdits": payload["timingEdits"] + [{"segment": 1, "startMs": 1100, "endMs": 1410}]})

    def test_invalid_identity_types_and_bounded_http_body_are_rejected_without_save(self):
        server = self.server()
        headers = {"Origin": server.origin, "X-Review-Token": server.token, "Content-Type": "application/json"}
        for change in ({"submissionId": []}, {"caseId": []}, {"candidateSha256": {}}, {"clipSha256": []}):
            self.assertEqual(self.request(server, "POST", "/api/word-reviews",
                                          json.dumps(self.review(**change)), headers)[0], 400)
        for body, changes in ((" " * 16385, {}), ("[]", {}), ("invalid", {}),
                              (json.dumps(self.review()), {"Content-Type": "text/plain"})):
            self.assertEqual(self.request(server, "POST", "/api/word-reviews", body,
                                          {**headers, **changes})[0], 400)
        self.assertEqual(self.db.all_word_reviews(), [])
        self.assertEqual(self.db.view()["cases"], [self.case])

    def test_http_requires_loopback_session_and_saves_exact_full_verse(self):
        server = self.server()
        payload = json.dumps(self.review())
        headers = {"Origin": server.origin, "X-Review-Token": server.token, "Content-Type": "application/json"}
        for mutation in ({"X-Review-Token": "invalid"}, {"Origin": "https://untrusted.example"},
                         {"Host": "other.invalid"}):
            self.assertEqual(self.request(server, "POST", "/api/word-reviews", payload,
                                          {**headers, **mutation})[0], 403)
        self.assertEqual(self.db.all_word_reviews(), [])
        status, row = self.request(server, "POST", "/api/word-reviews", payload, headers)
        self.assertEqual(status, 200)
        self.assertEqual(row["candidateWords"][1]["endMs"], 1812)
        self.assertEqual(self.request(server, "POST", "/api/word-reviews", payload, headers), (200, row))
        status, view = self.request(server, "GET", "/api/queue")
        self.assertEqual(status, 200)
        self.assertEqual(view["cases"], [])
        self.assertEqual(list(view["wordReviewDecisions"].values()), [row])

    def test_legacy_route_cannot_approve_original_coordinates_from_an_edited_historical_draft(self):
        revised = {**self.case, "candidateSha256": "new-current-after-old-draft"}
        self.append_batch(2, revised)
        server = self.server()
        headers = {"Origin": server.origin, "X-Review-Token": server.token, "Content-Type": "application/json"}
        # An old visible draft still binds to its original candidate, but the
        # user has heard and selected different slider coordinates in that draft.
        status, answer = self.request(server, "POST", "/api/reviews", json.dumps(self.review()), headers)
        self.assertEqual(status, 400)
        self.assertIn("current whole-verse timing review", answer["error"])
        self.assertEqual(self.db.all_entries(), [])
        self.assertEqual(self.db.all_word_reviews(), [])
        self.assertEqual(self.db.view()["cases"], [revised])
        # Actual old nonediting pages can still save their genuine original-cut answer.
        original_payload = {**self.review(), "timingEdits": [], "heardEditedSegments": []}
        status, original = self.request(server, "POST", "/api/reviews", json.dumps(original_payload), headers)
        self.assertEqual(status, 200)
        self.assertEqual(original["candidateWords"], self.case["words"])
        self.assertEqual(self.db.all_entries(), [original])


class StandaloneWordReviewTests(unittest.TestCase):
    """The shared editor also durably saves typed reviews on standalone JSON stores."""

    def setUp(self):
        CutEditTests.setUp(self)
        self.standalone_queue = read_json(self.queue)
        self.store_path = self.root / "standalone-reviews.json"
        self.extra = {"sourceMetadata": {"labels": ["preserved", "עברית"], "revision": 7},
                      "otherHistory": [{"actual": "unchanged"}]}
        write_json(self.store_path, {"version": 1, "entries": [], **self.extra})
        self.store = ReviewStore(self.store_path, self.standalone_queue)

    append_batch = CutEditTests.append_batch
    request = CutEditTests.request
    review = WordReviewTests.review

    def server(self):
        server = make_server(self.standalone_queue, self.store, 0)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        return server

    def legacy(self, verdict="problem"):
        return {**self.payload, "verdict": verdict, "timingEdits": [], "heardEditedSegments": [],
                "note": "actual legacy answer"}

    def test_shared_ui_endpoint_saves_typed_good_and_updates_queue_export_archive(self):
        legacy = self.store.save(self.case, self.legacy())
        server = self.server()
        headers = {"Origin": server.origin, "X-Review-Token": server.token, "Content-Type": "application/json"}
        payload = json.dumps(self.review())
        status, row = self.request(server, "POST", "/api/word-reviews", payload, headers)
        self.assertEqual(status, 200)
        self.assertEqual(row["candidateWords"][1]["endMs"], 1812)
        verify_word_review(self.case, row, self.standalone_queue["queueSha256"])
        saved_bytes = self.store_path.read_bytes()
        self.assertEqual(self.request(server, "POST", "/api/word-reviews", payload, headers), (200, row))
        self.assertEqual(self.store_path.read_bytes(), saved_bytes)
        status, view = self.request(server, "GET", "/api/queue")
        self.assertEqual(status, 200)
        self.assertEqual(view["cases"], [])
        self.assertEqual(list(view["wordReviewDecisions"].values()), [row])
        status, exported = self.request(server, "GET", "/api/export")
        self.assertEqual(status, 200)
        self.assertEqual(exported["entries"], [legacy])
        self.assertEqual(exported["wordReviews"], [row])
        self.assertEqual(exported["decisions"], {self.case["id"]: legacy})
        status, archive = self.request(server, "GET", "/api/archive")
        self.assertEqual(status, 200)
        self.assertEqual(archive[-1]["caseCount"], 1)
        self.assertEqual(archive[-1]["cases"][0]["decision"], row)
        status, typed = self.request(server, "GET", "/api/word-reviews")
        self.assertEqual((status, typed), (200, {"entries": [row]}))
        for key, value in self.extra.items():
            self.assertEqual(read_json(self.store_path)[key], value)

    def test_standalone_legacy_append_keeps_typed_history_retry_records_and_unknown_fields(self):
        manual = self.store.save_word_review(self.review())
        original = read_json(self.store_path)
        legacy = self.store.save(self.case, self.legacy("skip"))
        saved = read_json(self.store_path)
        self.assertEqual(saved["entries"], [legacy])
        self.assertEqual(saved["wordReviews"], [manual])
        self.assertEqual(saved["wordReviewRequests"], original["wordReviewRequests"])
        for key, value in self.extra.items():
            self.assertEqual(saved[key], value)
        resumed = ReviewStore(self.store_path, self.standalone_queue)
        self.assertEqual(resumed.save_word_review(self.review()), manual)
        self.assertEqual(resumed.snapshot(), {self.case["id"]: legacy})
        self.assertEqual(resumed.export_feedback(), {"entries": [legacy], "wordReviews": [manual]})

    def test_failed_atomic_standalone_typed_save_keeps_prior_file_and_in_memory_visibility(self):
        self.store.save(self.case, self.legacy())
        before = self.store_path.read_bytes()
        calls = []
        self.store.on_saved = lambda: calls.append("saved")
        with patch("pathlib.Path.replace", side_effect=OSError("disk failure")):
            with self.assertRaises(OSError):
                self.store.save_word_review(self.review())
        self.assertEqual(self.store_path.read_bytes(), before)
        self.assertEqual(self.store.word_review_snapshot(), {})
        self.assertEqual(self.store.word_reviews, [])
        self.assertEqual(calls, [])
        self.store.save_word_review(self.review())
        self.assertEqual(calls, ["saved"])

    def test_concurrent_standalone_retry_is_single_append_and_changed_request_conflicts(self):
        payload = self.review()
        with ThreadPoolExecutor(max_workers=4) as pool:
            rows = list(pool.map(lambda _: self.store.save_word_review(deepcopy(payload)), range(8)))
        self.assertEqual(rows, [rows[0]] * 8)
        self.assertEqual(read_json(self.store_path)["wordReviews"], [rows[0]])
        with self.assertRaisesRegex(ValueError, "different review"):
            self.store.save_word_review({**payload, "verdict": "problem"})
        resumed = ReviewStore(self.store_path, self.standalone_queue)
        self.assertEqual(resumed.save_word_review(payload), rows[0])

    def test_partial_problem_skip_are_typed_and_never_approve_unheard_edits(self):
        problem = self.store.save_word_review(self.review(
            verdict="problem", heardSegments=[], heardEditedSegments=[], note="  actual problem  "))
        skip = self.store.save_word_review(self.review(submissionId="actual-standalone-skip-review",
            verdict="skip", heardSegments=[], heardEditedSegments=[], note="old note is not this verdict"))
        self.assertEqual(problem["note"], "actual problem")
        self.assertEqual(skip["note"], "")
        self.assertEqual(problem["listenEvidenceReportedByBrowser"]["heardEditedSegments"], [])
        self.assertEqual(self.store.export_feedback()["entries"], [])
        with self.assertRaises(ValueError):
            self.store.save_word_review(self.review(submissionId="actual-incomplete-good-review",
                heardEditedSegments=[]))
        self.assertEqual(self.store.word_reviews, [problem, skip])

    def test_standalone_session_source_binding_and_legacy_edited_draft_rejection(self):
        server = self.server()
        headers = {"Origin": server.origin, "X-Review-Token": server.token, "Content-Type": "application/json"}
        for mutation in ({"Host": "untrusted.invalid"}, {"Origin": "https://untrusted.invalid"},
                         {"X-Review-Token": "invalid"}):
            self.assertEqual(self.request(server, "POST", "/api/word-reviews", json.dumps(self.review()),
                                          {**headers, **mutation})[0], 403)
        for mutation in ({"candidateSha256": "old"}, {"clipSha256": "different"}, {"caseId": "other"}):
            self.assertEqual(self.request(server, "POST", "/api/word-reviews",
                                          json.dumps(self.review(**mutation)), headers)[0], 400)
        self.assertEqual(self.request(server, "POST", "/api/reviews", json.dumps(self.review()), headers)[0], 400)
        self.assertEqual(self.store.export_feedback(), {"entries": [], "wordReviews": []})
        self.assertEqual(self.request(server, "POST", "/api/reviews", json.dumps(self.legacy()), headers)[0], 200)

    def test_completed_old_parent_never_hides_a_replacement_candidate(self):
        manual = self.store.save_word_review(self.review())
        changed = deepcopy(self.standalone_queue)
        changed["cases"][0]["candidateSha256"] = "new-standalone-candidate"
        self.standalone_queue = changed
        self.store = ReviewStore(self.store_path, changed)
        server = self.server()
        status, view = self.request(server, "GET", "/api/queue")
        self.assertEqual(status, 200)
        self.assertEqual(view["cases"][0]["candidateSha256"], "new-standalone-candidate")
        self.assertEqual(self.store.save_word_review(self.review()), manual)
        with self.assertRaises(ValueError):
            self.store.save_word_review(self.review(submissionId="new-stale-standalone-submission"))


if __name__ == "__main__":
    unittest.main()
