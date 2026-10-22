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
from listening_review import digest_file, digest_json, read_json, write_json


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
            return {table: db.execute(f"SELECT * FROM {table} ORDER BY rowid").fetchall()
                    for table in ("batch", "candidate", "current_candidate", "history", "entry")}

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


if __name__ == "__main__":
    unittest.main()
