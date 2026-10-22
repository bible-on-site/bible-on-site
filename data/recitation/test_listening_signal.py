"""Source-inspected candidates retain model evidence and never imply approval."""

from copy import deepcopy
from pathlib import Path
import tempfile
import unittest

from listening_review import digest_file, write_json
from listening_tail import SOURCE_METHOD, verify_corrections
from model_versions import ALIGN_MODEL, ALIGN_REVISION


class SourceProposalTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.root = Path(folder.name)
        self.rows = [{"pasuk": 1, "segment": segment, "text": text,
                      "startMs": start, "endMs": end, "acousticScore": .4}
                     for segment, text, start, end in ((1, "ברא", 100, 300), (2, "אלהים", 600, 900))]
        self.inspection = {"perekId": 1, "sourceAudioSha256": "source", "canonicalTextSha256": "text",
            "model": ALIGN_MODEL, "revision": ALIGN_REVISION, "dtype": "float32", "device": "cpu",
            "diagnosticOnly": True, "originalLetterRowsReproducedExactly": True,
            "contextStartMs": 0, "contextEndMs": 1500, "rows": deepcopy(self.rows),
            "pathEvidence": [{"pasuk": 1, "segment": 1, "followingWordStartMs": 600},
                             {"pasuk": 1, "segment": 2, "precedingWordEndMs": 300, "followingWordStartMs": 1400}]}
        self.feedback = {"perekId": 1, "audioSha256": "source", "textSha256": "text", "verdict": "problem",
            "savedAt": "real saved answer", "candidateWords": deepcopy(self.rows),
            "listenEvidenceReportedByBrowser": {"heardSegments": [1, 2]}}
        self.diagnostic = {"perekId": 1, "sourceAudioSha256": "source", "automaticApproval": False,
            "contextStartSec": 0., "contextEndSec": 1.5, "boundaryMethod": SOURCE_METHOD,
            "letterCandidates": deepcopy(self.rows), "diagnosticCandidates": deepcopy(self.rows),
            "inspectionEvidencePath": str(self.root / "inspection.json"),
            "feedbackEvidencePath": str(self.root / "feedback.json"),
            "boundaryCorrections": [{"pasuk": 1, "segment": 1, "originalStartMs": 100,
                "originalEndMs": 300, "proposedStartMs": 100, "proposedEndMs": 410,
                "sourceObservation": "End of the observed speech decay, before the next onset"}]}
        self.diagnostic["diagnosticCandidates"][0]["endMs"] = 410
        self.save_evidence()

    def save_evidence(self):
        for key, value in (("inspection", self.inspection), ("feedback", self.feedback)):
            path = Path(self.diagnostic[f"{key}EvidencePath"])
            write_json(path, value)
            self.diagnostic[f"{key}EvidenceSha256"] = digest_file(path)

    def test_source_proposal_preserves_unmodified_golden_rows_and_letter_scores(self):
        before = deepcopy(self.diagnostic)
        verify_corrections(self.diagnostic)
        self.assertEqual(self.diagnostic, before)
        self.assertEqual(self.diagnostic["diagnosticCandidates"][1], self.rows[1])
        self.assertEqual(self.diagnostic["diagnosticCandidates"][0]["acousticScore"], .4)
        self.assertNotIn("reviewed", self.diagnostic["diagnosticCandidates"][0])

    def test_changed_score_identity_overlap_unrecorded_or_automatic_approval_rejected(self):
        original = deepcopy(self.diagnostic)
        for mutate in (
                lambda d: d["diagnosticCandidates"][0].update(acousticScore=.9),
                lambda d: d["diagnosticCandidates"][0].update(text="different"),
                lambda d: d["diagnosticCandidates"][1].update(startMs=400),
                lambda d: d["diagnosticCandidates"][0].update(endMs=411),
                lambda d: d["diagnosticCandidates"][0].update(startMs=True),
                lambda d: d.update(automaticApproval=True),
                lambda d: d["boundaryCorrections"].append(deepcopy(d["boundaryCorrections"][0])),
                lambda d: d["boundaryCorrections"][0].update(sourceObservation="")):
            candidate = deepcopy(original)
            mutate(candidate)
            with self.subTest(mutate=mutate), self.assertRaises(ValueError):
                verify_corrections(candidate)

    def test_stale_source_model_context_or_nonexistent_listening_rejected(self):
        before = deepcopy((self.inspection, self.feedback))
        for mutate in (
                lambda: self.inspection.update(sourceAudioSha256="other"),
                lambda: self.inspection.update(revision="other"),
                lambda: self.inspection.update(contextEndMs=1400),
                lambda: self.inspection["rows"][0].update(endMs=301),
                lambda: self.feedback.update(verdict="good"),
                lambda: self.feedback["listenEvidenceReportedByBrowser"].update(heardSegments=[2])):
            self.inspection, self.feedback = deepcopy(before)
            mutate()
            self.save_evidence()
            with self.subTest(mutate=mutate), self.assertRaises(ValueError):
                verify_corrections(self.diagnostic)


if __name__ == "__main__":
    unittest.main()
