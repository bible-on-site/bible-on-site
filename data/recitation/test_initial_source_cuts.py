"""Initial source inspection proposes cuts; only fresh real review can approve."""

from copy import deepcopy
from pathlib import Path
import unittest
from listening_review import digest_file, write_json, validate_decision
from listening_tail import INITIAL_SOURCE_METHOD, verify_corrections
from listening_accept import verify_diagnostic, approve_chapter
import test_listening_signal as source_tests
import test_listening_accept as acceptance_tests
from model_versions import ALIGN_MODEL, ALIGN_REVISION


class InitialSourceTests(unittest.TestCase):
    def source_fixture(self):
        f = source_tests.SourceProposalTests()
        f.setUp()
        self.addCleanup(f.doCleanups)
        d = f.diagnostic
        d["boundaryMethod"] = INITIAL_SOURCE_METHOD
        d["canonicalTextSha256"] = "text"
        d.pop("feedbackEvidencePath")
        d.pop("feedbackEvidenceSha256")
        raw = {
            "diagnosticOnly": True,
            "device": "cpu",
            "threads": 2,
            "dtype": "float32",
            "model": ALIGN_MODEL,
            "revision": ALIGN_REVISION,
            "cases": [
                {
                    "perekId": 1,
                    "sourceAudioSha256": "source",
                    "contextStartSec": 0.0,
                    "contextEndSec": 1.5,
                    "letterCandidates": deepcopy(f.rows),
                    "diagnosticCandidates": deepcopy(f.rows),
                    "boundaryCorrections": [],
                }
            ],
        }
        path = f.root / "raw.json"
        write_json(path, raw)
        spectrum = f.root / "spectrum.png"
        spectrum.write_bytes(b"original source spectrum")
        f.inspection.update(
            sourceSpectrumEvidence=str(spectrum),
            sourceSpectrumSha256=digest_file(spectrum),
            sourceInspectionPurpose="initial-listening-candidate",
            threads=2,
            rawDiagnosticPath=str(path),
            rawDiagnosticSha256=digest_file(path),
        )
        write_json(Path(d["inspectionEvidencePath"]), f.inspection)
        d["inspectionEvidenceSha256"] = digest_file(Path(d["inspectionEvidencePath"]))
        return f, raw, path

    def test_initial_inspection_needs_no_invented_problem_answer(self):
        f, _, _ = self.source_fixture()
        before = deepcopy(f.diagnostic)
        verify_corrections(f.diagnostic)
        self.assertEqual(before, f.diagnostic)
        self.assertEqual(f.diagnostic["diagnosticCandidates"][1], f.rows[1])
        self.assertNotIn("reviewed", f.diagnostic["diagnosticCandidates"][0])
        f.diagnostic["feedbackEvidencePath"] = "invented"
        self.assertRaises(ValueError, verify_corrections, f.diagnostic)

    def test_rehashed_raw_source_model_context_or_rows_cannot_be_substituted(self):
        f, raw, path = self.source_fixture()
        original = deepcopy(raw)
        for mutate in (
            lambda r: r.update(revision="other"),
            lambda r: r.update(dtype="float16"),
            lambda r: r["cases"][0].update(sourceAudioSha256="other"),
            lambda r: r["cases"][0].update(contextEndSec=1.4),
            lambda r: r["cases"][0]["letterCandidates"][0].update(endMs=301),
        ):
            candidate = deepcopy(original)
            mutate(candidate)
            write_json(path, candidate)
            f.inspection["rawDiagnosticSha256"] = digest_file(path)
            write_json(Path(f.diagnostic["inspectionEvidencePath"]), f.inspection)
            f.diagnostic["inspectionEvidenceSha256"] = digest_file(
                Path(f.diagnostic["inspectionEvidencePath"])
            )
            self.assertRaises(ValueError, verify_corrections, f.diagnostic)

    def test_initial_candidates_keep_identity_scores_geometry_and_no_approval(self):
        f, _, _ = self.source_fixture()
        original = deepcopy(f.diagnostic)
        for mutate in (
            lambda d: d.update(automaticApproval=True),
            lambda d: d["diagnosticCandidates"][0].update(acousticScore=0.9),
            lambda d: d["diagnosticCandidates"][0].update(text="other"),
            lambda d: d["diagnosticCandidates"][0].update(endMs=610),
            lambda d: d["boundaryCorrections"][0].update(sourceObservation=""),
        ):
            d = deepcopy(original)
            mutate(d)
            self.assertRaises(ValueError, verify_corrections, d)

    def test_changed_source_spectrum_or_inspection_precision_is_rejected(self):
        f, _, _ = self.source_fixture()
        Path(f.inspection["sourceSpectrumEvidence"]).write_bytes(b"changed spectrum")
        self.assertRaises(ValueError, verify_corrections, f.diagnostic)
        Path(f.inspection["sourceSpectrumEvidence"]).write_bytes(b"original source spectrum")
        f.inspection["dtype"] = "float16"
        write_json(Path(f.diagnostic["inspectionEvidencePath"]), f.inspection)
        f.diagnostic["inspectionEvidenceSha256"] = digest_file(
            Path(f.diagnostic["inspectionEvidencePath"])
        )
        self.assertRaises(ValueError, verify_corrections, f.diagnostic)

    def acceptance_fixture(self):
        f = acceptance_tests.ListeningAcceptanceTests()
        f.setUp()
        self.addCleanup(f.doCleanups)
        raw = deepcopy(f.study)
        raw.update(device="cpu", threads=2)
        raw["cases"][0].update(letterCandidates=deepcopy(f.candidate), boundaryCorrections=[])
        raw_path = f.root / "raw.json"
        write_json(raw_path, raw)
        original = deepcopy(f.candidate)
        f.candidate[0]["endMs"] = 450
        spectrum = f.root / "spectrum.png"
        spectrum.write_bytes(b"original source spectrum")
        inspection = {
            "sourceSpectrumEvidence": str(spectrum),
            "sourceSpectrumSha256": digest_file(spectrum),
            "perekId": 1,
            "sourceAudioSha256": f.case["audioSha256"],
            "canonicalTextSha256": f.case["textSha256"],
            "dtype": "float32",
            "device": "cpu",
            "threads": 2,
            "model": ALIGN_MODEL,
            "revision": ALIGN_REVISION,
            "diagnosticOnly": True,
            "sourceInspectionPurpose": "initial-listening-candidate",
            "originalLetterRowsReproducedExactly": True,
            "contextStartMs": 0,
            "contextEndMs": 1000,
            "rows": original,
            "pathEvidence": [
                {"pasuk": 1, "segment": 1, "followingWordStartMs": 500},
                {"pasuk": 1, "segment": 2, "precedingWordEndMs": 400, "followingWordStartMs": 1000},
            ],
            "rawDiagnosticPath": str(raw_path),
            "rawDiagnosticSha256": digest_file(raw_path),
        }
        ip = f.root / "inspection.json"
        write_json(ip, inspection)
        f.study["cases"][0].update(
            boundaryMethod=INITIAL_SOURCE_METHOD,
            canonicalTextSha256=f.case["textSha256"],
            automaticApproval=False,
            letterCandidates=original,
            diagnosticCandidates=deepcopy(f.candidate),
            inspectionEvidencePath=str(ip),
            inspectionEvidenceSha256=digest_file(ip),
            boundaryCorrections=[
                {
                    "pasuk": 1,
                    "segment": 1,
                    "originalStartMs": 100,
                    "originalEndMs": 400,
                    "proposedStartMs": 100,
                    "proposedEndMs": 450,
                    "sourceObservation": "Observed final vowel decay before the next onset",
                }
            ],
        )
        write_json(f.diagnostic, f.study)
        f.case.update(
            words=deepcopy(f.candidate),
            reviewKind="missing",
            candidateSha256="source-inspected",
            diagnosticSha256=digest_file(f.diagnostic),
        )
        return f

    def test_source_inspection_alone_never_approves_or_changes_automatic_remainder(self):
        f = self.acceptance_fixture()
        verify_diagnostic(f.case)
        self.assertRaises(
            ValueError,
            approve_chapter,
            f.manifest,
            f.report,
            f.cached,
            f.words,
            f.audio,
            2000,
            [f.case],
            {},
            "queue",
        )
        f.decision = validate_decision(
            f.case,
            {
                "candidateSha256": "source-inspected",
                "verdict": "good",
                "verseHeard": False,
                "heardSegments": [1, 2],
                "note": "",
            },
        )
        f.decision["queueSha256"] = "queue"
        result = f.accept()
        self.assertEqual(result["words"][-1], f.auto)
        self.assertEqual(result["words"][0]["endMs"], 450)
        self.assertTrue(all("reviewed" not in w for w in result["words"]))

    def test_stale_good_partial_or_inherited_listening_stays_held(self):
        f = self.acceptance_fixture()
        self.assertRaises(ValueError, f.accept)
        self.assertRaises(
            ValueError,
            validate_decision,
            f.case,
            {
                "candidateSha256": "source-inspected",
                "verdict": "good",
                "verseHeard": False,
                "heardSegments": [1],
                "note": "",
            },
        )
        for values in (
            {"reviewKind": "reported"},
            {"reusableHeardSegments": [2]},
            {"listeningReusePath": "old.json"},
        ):
            case = {**f.case, **values}
            self.assertRaises(ValueError, verify_diagnostic, case)


if __name__ == "__main__":
    unittest.main()
