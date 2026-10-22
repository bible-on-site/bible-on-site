"""Machine proposals preserve evidence and require genuine fresh human approval."""

from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from alignment import load_chapters, text_hash, words_for
from listening_accept import approve_chapter, verify_diagnostic
from listening_machine import (MACHINE_METHOD, build_machine_study, canonical_words,
                               verify_machine_proposals)
from listening_review import digest_file, validate_decision, write_json
from listening_tail import verify_corrections
from model_versions import ALIGN_MODEL, ALIGN_REVISION, ASR_MODEL, ASR_REVISION
from trusted import AUDIO_BASE, TRUSTED_PIPELINE


class MachineProposalTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.source = self.root / "source"
        (self.source / "alignments").mkdir(parents=True)
        self.canonical = self.root / "canonical.json"

        def verse(items):
            return {"segments": [{"type": kind, "value": value} for kind, value in items]}

        write_json(self.canonical, [{"perekFrom": 1, "perakim": [{"perekId": 1, "pesukim": [
            verse([("qri", "ויאמר")]),
            verse([("qri", "בראשית"), ("note", "ignored"), ("qri", "ברא")]),
            verse([("qri", "אור")])]}]}])
        self.words = words_for(load_chapters(self.canonical)[1])
        self.recording = self.root / "1_record.mp3"
        self.recording.write_bytes(b"the exact original source")
        self.rows = [{"pasuk": 2, "segment": segment, "text": text,
                      "startMs": start, "endMs": end, "acousticScore": .4}
                     for segment, text, start, end in ((1, "בראשית", 500, 700), (3, "ברא", 900, 1100))]
        self.auto = [{"pasuk": 1, "segment": 1, "text": "ויאמר", "startMs": 100, "endMs": 200,
                      "textScore": 1., "acousticScore": .9},
                     {"pasuk": 3, "segment": 1, "text": "אור", "startMs": 1400, "endMs": 1500,
                      "textScore": 1., "acousticScore": .9}]
        public_pipeline = {"version": 3, "asrModel": ASR_MODEL, "asrRevision": ASR_REVISION,
                           "alignModel": ALIGN_MODEL, "alignRevision": ALIGN_REVISION,
                           "minTextScore": .6, "minAcousticScore": .5, "minCoverage": .85}
        self.assertEqual(public_pipeline, TRUSTED_PIPELINE)
        self.manifest = {"version": 1, "perekId": 1, "alignmentStatus": "needs_review",
                         "pipeline": public_pipeline, "durationMs": 2000,
                         "audioUrl": f"{AUDIO_BASE}/1_record.mp3", "audioSha256": digest_file(self.recording),
                         "textSha256": text_hash(self.words), "words": [self.auto[0]] + [
                             {**row, "startMs": None, "endMs": None, "textScore": 0.} for row in self.rows
                         ] + [self.auto[1]]}
        self.report = {key: deepcopy(self.manifest[key]) for key in
                       ("perekId", "audioSha256", "textSha256", "pipeline", "words")}
        self.report.update(totalWords=4, review=[{"pasuk": 2, "reason": "insufficient ASR agreement"}])
        self.asr = {"audioSha256": self.manifest["audioSha256"], "model": ASR_MODEL,
                    "revision": ASR_REVISION, "words": [
                        {"text": word.speech, "start": 0., "end": .1} for word in self.words]}
        for path, value in ((self.source / "alignments/1.json", self.manifest),
                            (self.source / "1.review.json", self.report), (self.source / "1.asr.json", self.asr)):
            write_json(path, value)
        self.pcm = b"\0" * (32000 * 4)
        self.raw = {"perekId": 1, "pasuk": 2, "sourceAudioSha256": self.manifest["audioSha256"],
                    "canonicalTextSha256": self.manifest["textSha256"], "sourceEvidenceHashes": {
                        name: digest_file(self.source / name)
                        for name in ("alignments/1.json", "1.review.json", "1.asr.json")},
                    "device": "cuda", "dtype": "float32", "model": ALIGN_MODEL, "revision": ALIGN_REVISION,
                    "threads": 2, "contextStartMs": 100, "contextEndMs": 1500,
                    "completeDecodedSourceFrames": 32000,
                    "contextPcmSha256": hashlib.sha256(self.pcm[100 * 64:1500 * 64]).hexdigest(),
                    "contextWordIdentities": [{"pasuk": w.pasuk, "segment": w.segment} for w in self.words],
                    "rawLetterRows": deepcopy(self.rows), "pathEvidence": [
                        {"pasuk": 2, "segment": 1, "letterStartMs": 500, "letterEndMs": 700,
                         "letterAcousticScore": .4, "precedingWordEndMs": 200,
                         "precedingSeparatorStartMs": 250, "precedingSeparatorEndMs": 300,
                         "separatorStartMs": 750, "separatorEndMs": 800, "followingWordStartMs": 900},
                        {"pasuk": 2, "segment": 3, "letterStartMs": 900, "letterEndMs": 1100,
                         "letterAcousticScore": .4, "precedingWordEndMs": 700,
                         "precedingSeparatorStartMs": 750, "precedingSeparatorEndMs": 800,
                         "separatorStartMs": 1200, "separatorEndMs": 1300, "followingWordStartMs": 1400}],
                    "originalReasons": ["insufficient ASR agreement"], "sameContextReplayTwiceExactly": True,
                    "diagnosticOnly": True, "automaticApproval": False,
                    "requiresIndividualSourceInspectionAndGenuineHumanHearing": True}
        self.raw_path = self.root / "raw.json"
        self.summary_path = self.root / "summary.json"
        self.plan_path = self.root / "plan.json"
        self.rebind()
        mock_duration = patch("listening_machine.duration", return_value=2000)
        mock_decode = patch("listening_machine._decoded_source", return_value=self.pcm)
        mock_duration.start()
        mock_decode.start()
        self.addCleanup(mock_duration.stop)
        self.addCleanup(mock_decode.stop)

    def rebind(self):
        write_json(self.raw_path, self.raw)
        self.expected = digest_file(self.raw_path)
        self.summary = {"perekId": 1, "sourceEvidenceHashes": deepcopy(self.raw["sourceEvidenceHashes"]),
                        "diagnostics": [{"pasuk": 2, "path": str(self.raw_path), "sha256": self.expected}]}
        self.plan = {"targets": [{"perekId": 1, "pasuk": 2, "knownSourceDefectHold": False,
                                 "contextHoldReason": None, "missingBoundarySegments": [1, 3],
                                 "invalidDurationWords": [], "rawDiagnostic": self.summary["diagnostics"][0]}]}
        write_json(self.summary_path, self.summary)
        write_json(self.plan_path, self.plan)

    def build(self, **kwargs):
        return build_machine_study(self.raw_path, self.expected, self.summary_path, self.source,
                                   self.canonical, self.recording, **kwargs, plan_path=self.plan_path)

    def case(self, study):
        path = self.root / "study.json"
        write_json(path, study)
        return {"id": "1-2", "perekId": 1, "pasuk": 2, "audioSha256": self.manifest["audioSha256"],
                "textSha256": self.manifest["textSha256"], "words": deepcopy(study["cases"][0]["diagnosticCandidates"]),
                "clipStartMs": 100, "clipEndMs": 1500, "candidateSha256": "exact-machine-candidate",
                "clipSha256": "exact-listening-clip", "diagnosticPath": str(path),
                "diagnosticSha256": digest_file(path), "reviewKind": "missing"}

    def test_exact_cuda_rows_are_unapproved_and_not_claimed_as_source_inspected(self):
        before = self.raw_path.read_bytes()
        study = self.build(decoded_pcm=self.pcm)
        diagnostic = study["cases"][0]
        self.assertEqual(study["device"], "cuda")
        self.assertEqual(diagnostic["boundaryMethod"], MACHINE_METHOD)
        self.assertEqual(diagnostic["diagnosticCandidates"], self.rows)
        self.assertEqual(diagnostic["boundaryCorrections"], [])
        self.assertIs(diagnostic["automaticApproval"], False)
        self.assertIs(diagnostic["sourceInspectionPerformed"], False)
        self.assertNotIn("inspectionEvidencePath", diagnostic)
        self.assertEqual(self.raw_path.read_bytes(), before)
        verify_corrections(diagnostic)
        verify_diagnostic(self.case(study))

    def test_canonical_words_parse_once_and_expose_only_frozen_word_tuples(self):
        expected = digest_file(self.canonical)
        original_loads = json.loads
        with patch("listening_machine.json.loads", wraps=original_loads) as parse:
            first = canonical_words(self.canonical, expected, 1)
            second = canonical_words(self.canonical, expected, 1)
        self.assertEqual(parse.call_count, 1)
        self.assertIs(first, second)
        self.assertIsInstance(first, tuple)
        with self.assertRaises(AttributeError):
            first.append(first[0])
        with self.assertRaises(AttributeError):
            first[0].segment = 999

    def test_cached_canonical_checks_actual_bytes_even_with_same_size_and_mtime(self):
        expected = digest_file(self.canonical)
        canonical_words(self.canonical, expected, 1)
        before = self.canonical.stat()
        raw = self.canonical.read_bytes()
        changed = raw.replace("ויאמר".encode(), "ויאכל".encode(), 1)
        self.assertEqual(len(raw), len(changed))
        self.canonical.write_bytes(changed)
        os.utime(self.canonical, ns=(before.st_atime_ns, before.st_mtime_ns))
        self.assertEqual(self.canonical.stat().st_mtime_ns, before.st_mtime_ns)
        with self.assertRaisesRegex(ValueError, "Canonical source changed"):
            canonical_words(self.canonical, expected, 1)

    def test_neither_machine_evidence_nor_partial_hearing_can_approve(self):
        case = self.case(self.build())
        with self.assertRaises(ValueError):
            approve_chapter(self.manifest, self.report, self.asr, self.words, self.recording,
                            2000, [case], {}, "queue")
        with self.assertRaises(ValueError):
            validate_decision(case, {"candidateSha256": case["candidateSha256"], "verdict": "good",
                                     "verseHeard": False, "heardSegments": [1], "note": ""})
        answer = validate_decision(case, {"candidateSha256": case["candidateSha256"], "verdict": "good",
                                          "verseHeard": False, "heardSegments": [1, 3], "note": ""})
        answer["queueSha256"] = "queue"
        accepted = approve_chapter(self.manifest, self.report, self.asr, self.words, self.recording,
                                   2000, [case], {"1-2": answer}, "queue")
        self.assertEqual(accepted["words"][0], self.auto[0])
        self.assertEqual(accepted["words"][-1], self.auto[-1])
        self.assertEqual(accepted["words"][1]["endMs"], self.rows[0]["endMs"])

    def test_initial_machine_candidates_cannot_inherit_hearing(self):
        case = self.case(self.build())
        for changes in ({"reviewKind": "reported"}, {"reusableHeardSegments": [1]},
                        {"listeningReusePath": "old.json"}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                verify_diagnostic({**case, **changes})

    def test_no_plan_or_stale_plan_summary_and_raw_are_rejected(self):
        with self.assertRaises(ValueError):
            build_machine_study(self.raw_path, self.expected, self.summary_path, self.source,
                                self.canonical, self.recording)
        for path in (self.raw_path, self.summary_path, self.plan_path):
            study = self.build()
            prior = path.read_bytes()
            path.write_bytes(prior + b" ")
            with self.subTest(path=path), self.assertRaises(ValueError):
                verify_machine_proposals(study["cases"][0])
            path.write_bytes(prior)

    def test_rehashed_raw_is_still_bound_to_actual_plan_and_summary(self):
        self.raw["rawLetterRows"][0]["endMs"] += 1
        write_json(self.raw_path, self.raw)
        with self.assertRaises(ValueError):
            build_machine_study(self.raw_path, digest_file(self.raw_path), self.summary_path, self.source,
                                self.canonical, self.recording, plan_path=self.plan_path)

    def test_cpu_precision_revision_and_failed_replay_are_not_relabelled(self):
        original = deepcopy(self.raw)
        for changes in ({"device": "cpu"}, {"dtype": "float16"}, {"revision": "other"},
                        {"model": "other"}, {"threads": 1}, {"sameContextReplayTwiceExactly": False},
                        {"automaticApproval": True}):
            self.raw = {**deepcopy(original), **changes}
            self.rebind()
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                self.build()

    def test_known_source_hold_unsupported_context_or_score_only_is_not_selected(self):
        for changes in ({"knownSourceDefectHold": True}, {"contextHoldReason": "no real context"},
                        {"missingBoundarySegments": [], "invalidDurationWords": []}):
            self.rebind()
            self.plan["targets"][0].update(changes)
            write_json(self.plan_path, self.plan)
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                self.build()

    def test_source_canonical_report_asr_and_complete_pcm_cannot_change(self):
        for path in (self.recording, self.canonical, self.source / "1.review.json", self.source / "1.asr.json"):
            study = self.build()
            prior = path.read_bytes()
            path.write_bytes(prior + b" ")
            with self.subTest(path=path), self.assertRaises(ValueError):
                verify_machine_proposals(study["cases"][0])
            path.write_bytes(prior)
        for pcm in (self.pcm[:-4], self.pcm[:10000] + b"\1\0\0\0" + self.pcm[10004:]):
            with self.subTest(pcm_length=len(pcm)), self.assertRaises(ValueError):
                self.build(decoded_pcm=pcm)

    def test_path_model_rows_geometry_and_sparse_word_ids_are_not_substituted(self):
        original = deepcopy(self.raw)
        mutations = (lambda r: r["pathEvidence"][0].update(letterEndMs=701),
                     lambda r: r["pathEvidence"][0].pop("followingWordStartMs"),
                     lambda r: r["pathEvidence"][1].update(precedingWordEndMs=701),
                     lambda r: r["rawLetterRows"][0].update(endMs=950),
                     lambda r: r["rawLetterRows"][0].update(startMs=True),
                     lambda r: r["rawLetterRows"][1].update(segment=2),
                     lambda r: r["rawLetterRows"][0].update(acousticScore=float("nan")),
                     lambda r: r.update(contextWordIdentities=[]),
                     lambda r: r.update(completeDecodedSourceFrames=32001))
        for mutate in mutations:
            self.raw = deepcopy(original)
            mutate(self.raw)
            self.rebind()
            with self.subTest(mutation=mutate), self.assertRaises(ValueError):
                self.build()

    def test_adapter_cannot_invent_boundaries_observations_or_approval(self):
        original = self.build()["cases"][0]
        mutations = (lambda d: d["diagnosticCandidates"][0].update(endMs=705),
                     lambda d: d.update(automaticApproval=True),
                     lambda d: d.update(sourceInspectionPerformed=True),
                     lambda d: d.update(boundaryCorrections=[{"sourceObservation": "invented"}]),
                     lambda d: d.update(inspectionEvidencePath="invented"),
                     lambda d: d.update(feedbackEvidencePath="invented"))
        for mutate in mutations:
            diagnostic = deepcopy(original)
            mutate(diagnostic)
            with self.subTest(mutation=mutate), self.assertRaises(ValueError):
                verify_machine_proposals(diagnostic)


if __name__ == "__main__":
    unittest.main()
