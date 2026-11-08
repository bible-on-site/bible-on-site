"""Pool actual direct hearing from different immutable review rounds."""

from copy import deepcopy
from pathlib import Path
import tempfile
import unittest
from listening_review import candidate_digest, digest_file, digest_json, read_json, write_json, validate_decision
from listening_accept import verify_review


class MultipleListeningSourcesTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.case = {
            "id": "1-1",
            "perekId": 1,
            "pasuk": 1,
            "audioSha256": "source",
            "textSha256": "canonical",
            "clipSha256": "pcm",
            "clipStartMs": 0,
            "clipEndMs": 2000,
            "diagnosticSha256": "diagnostic",
            "words": [
                {"pasuk": 1, "segment": s, "text": str(s), "startMs": 100 + 500 * (s - 1), "endMs": 400 + 500 * (s - 1)}
                for s in (1, 2, 3)
            ],
        }
        self.case["candidateSha256"] = candidate_digest(self.case)
        a = self.archive("first", self.case, [1, 2, 3])
        pa = self.root / "first-proof.json"
        write_json(pa, a)
        second = deepcopy(self.case)
        second["words"][0]["endMs"] = 410
        second.update(listeningReusePath=str(pa), listeningReuseSha256=digest_file(pa), reusableHeardSegments=[2, 3])
        second["candidateSha256"] = candidate_digest(second)
        b = self.archive("second", second, [1])
        self.proofs = [a, b]
        self.case = deepcopy(second)
        self.case["words"][2]["endMs"] = 1410
        self.case.update(reusableHeardSegments=[1, 2])
        self.bind(self.proofs)

    def archive(self, label, case, fresh):
        queue = {"cases": [deepcopy(case)], "queueSha256": digest_json([case])}
        payload = {
            "candidateSha256": case["candidateSha256"],
            "verdict": "problem",
            "verseHeard": False,
            "heardSegments": [1, 2, 3],
            "note": "reported changed cut",
        }
        if case.get("listeningReuseSha256"):
            payload["freshHeardSegments"] = fresh
        decision = validate_decision(case, payload)
        decision["queueSha256"] = queue["queueSha256"]
        qp = self.root / (label + "-queue.json")
        rp = self.root / (label + "-reviews.json")
        write_json(qp, queue)
        write_json(rp, {"version": 1, "entries": [decision]})
        return {
            "queuePath": str(qp),
            "queueFileSha256": digest_file(qp),
            "reviewsPath": str(rp),
            "reviewsFileSha256": digest_file(rp),
            "decisionIndex": 0,
            "decision": decision,
        }

    def bind(self, proofs):
        p = self.root / "pooled-proof.json"
        write_json(p, {"sources": proofs})
        self.case.update(listeningReusePath=str(p), listeningReuseSha256=digest_file(p))
        self.case["candidateSha256"] = candidate_digest(self.case)

    def payload(self, fresh=(3,)):
        return {
            "candidateSha256": self.case["candidateSha256"],
            "verdict": "good",
            "verseHeard": False,
            "heardSegments": [1, 2, 3],
            "freshHeardSegments": list(fresh),
            "note": "",
        }

    def test_disjoint_actual_fresh_hearing_reuses_only_unchanged_cuts(self):
        row = validate_decision(self.case, self.payload())
        heard = row["listenEvidenceReportedByBrowser"]
        self.assertEqual(heard["freshHeardSegments"], [3])
        self.assertEqual(heard["reusedHeardSegments"], [1, 2])
        self.assertEqual(len(heard["reuseSource"]["sources"]), 2)
        row["queueSha256"] = "current"
        verify_review(self.case, row, "current")
        with self.assertRaises(ValueError):
            validate_decision(self.case, self.payload(()))

    def test_one_inherited_source_cannot_claim_another_rounds_direct_hearing(self):
        self.bind([self.proofs[1]])
        with self.assertRaises(ValueError):
            validate_decision(self.case, self.payload())

    def test_changed_rows_source_clip_and_false_coverage_rejected(self):
        for mutate in (
            lambda c: c.update(audioSha256="different"),
            lambda c: c.update(clipSha256="different"),
            lambda c: c["words"][1].update(endMs=901),
            lambda c: c.update(reusableHeardSegments=[1, 2, 3]),
        ):
            before = deepcopy(self.case)
            mutate(self.case)
            with self.subTest(mutate=mutate), self.assertRaises(ValueError):
                validate_decision(self.case, self.payload())
            self.case = before

    def test_unsaved_answer_and_mutated_earlier_history_rejected(self):
        proofs = deepcopy(self.proofs)
        proofs[0]["decision"]["note"] = "invented"
        self.bind(proofs)
        with self.assertRaises(ValueError):
            validate_decision(self.case, self.payload())
        self.bind(self.proofs)
        p = Path(self.proofs[0]["reviewsPath"])
        hist = read_json(p)
        hist["entries"][0]["note"] = "later mutation"
        write_json(p, hist)
        with self.assertRaises(ValueError):
            validate_decision(self.case, self.payload())

    def test_empty_duplicate_and_mixed_proof_containers_rejected(self):
        for proofs in ([], [self.proofs[0], self.proofs[0]]):
            self.bind(proofs)
            with self.assertRaises(ValueError):
                validate_decision(self.case, self.payload())
        self.bind(self.proofs)
        p = Path(self.case["listeningReusePath"])
        data = read_json(p)
        data["decision"] = "misleading legacy field"
        write_json(p, data)
        self.case["listeningReuseSha256"] = digest_file(p)
        self.case["candidateSha256"] = candidate_digest(self.case)
        with self.assertRaises(ValueError):
            validate_decision(self.case, self.payload())


if __name__ == "__main__":
    unittest.main()
