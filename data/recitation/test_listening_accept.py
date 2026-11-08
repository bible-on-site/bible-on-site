"""Targeted human acceptance must not invent whole-chapter listening approval."""

from copy import deepcopy
from pathlib import Path
from contextlib import closing
import json
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

from alignment import Word, text_hash
from listening_accept import approve_chapter, stage_reviews
from listening_review import digest_file, validate_decision, write_json
from model_versions import ALIGN_MODEL, ALIGN_REVISION
from recite import audio_hash, export_database
from trusted import AUDIO_BASE, SOFT_WARNING, TRUSTED_PIPELINE, approve_alignment


class ListeningAcceptanceTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.audio = self.root / "1_record.mp3"
        self.audio.write_bytes(b"original recording")
        self.words = [Word(1, 1, "בראשית"), Word(1, 2, "ברא"), Word(2, 1, "ויאמר")]
        self.candidate = [{"pasuk": 1, "segment": w.segment, "text": w.text,
                           "startMs": start, "endMs": end, "acousticScore": .4}
                          for w, start, end in zip(self.words[:2], (100, 500), (400, 800))]
        self.auto = {"pasuk": 2, "segment": 1, "text": "ויאמר", "startMs": 1000, "endMs": 1300,
                     "textScore": .625, "acousticScore": .9}
        self.manifest = {"version": 1, "perekId": 1, "audioUrl": f"{AUDIO_BASE}/1_record.mp3",
            "audioSha256": audio_hash(self.audio), "textSha256": text_hash(self.words),
            "durationMs": 2000, "alignmentStatus": "needs_review", "pipeline": deepcopy(TRUSTED_PIPELINE),
            "words": [{**r, "startMs": None, "endMs": None, "textScore": 0.} for r in self.candidate] + [self.auto],
            "executionProfile": {"precision": "float32", "inference": "original-full-track"}}
        self.report = {key: deepcopy(self.manifest[key]) for key in
                       ("perekId", "audioSha256", "textSha256", "pipeline", "words")}
        self.report.update(totalWords=3, review=[{"pasuk": 1, "reason": "insufficient ASR agreement", "anchorCoverage": 0.}])
        self.cached = {"audioSha256": self.manifest["audioSha256"], "model": TRUSTED_PIPELINE["asrModel"],
                       "revision": TRUSTED_PIPELINE["asrRevision"],
                       "words": [{"text": "ויאמר", "start": 1., "end": 1.3}]}
        self.diagnostic = self.root / "diagnostic.json"
        self.study = {"diagnosticOnly": True, "model": ALIGN_MODEL, "revision": ALIGN_REVISION,
                      "dtype": "float32", "cases": [{"perekId": 1,
                        "sourceAudioSha256": self.manifest["audioSha256"], "contextStartSec": 0.,
                        "contextEndSec": 1., "diagnosticCandidates": deepcopy(self.candidate)}]}
        write_json(self.diagnostic, self.study)
        self.case = {"id": "1-1", "perekId": 1, "pasuk": 1,
            "audioSha256": self.manifest["audioSha256"], "textSha256": self.manifest["textSha256"],
            "words": deepcopy(self.candidate), "clipStartMs": 0, "clipEndMs": 1000,
            "candidateSha256": "candidate", "clipSha256": "clip", "diagnosticPath": str(self.diagnostic),
            "diagnosticSha256": digest_file(self.diagnostic)}
        self.decision = validate_decision(self.case, {"candidateSha256": "candidate", "verdict": "good",
             "verseHeard": False, "heardSegments": [1, 2], "note": ""})
        self.decision["queueSha256"] = "queue"

    def accept(self):
        return approve_chapter(self.manifest, self.report, self.cached, self.words, self.audio, 2000,
                               [self.case], {"1-1": self.decision}, "queue")

    def test_real_good_recovers_missing_anchor_without_changing_automatic_words(self):
        before = deepcopy((self.manifest, self.report, self.cached, self.case, self.decision))
        result = self.accept()
        self.assertEqual(result["alignmentStatus"], "ready")
        self.assertEqual(result["words"][-1], self.auto)
        self.assertEqual(result["executionProfile"], self.manifest["executionProfile"])
        self.assertEqual(result["acceptancePolicy"]["humanReviewedPesukim"], [1])
        self.assertEqual(result["acceptancePolicy"]["automaticPesukim"], [2])
        self.assertEqual(result["acceptancePolicy"]["diagnostics"], self.report["review"])
        self.assertFalse(result["acceptancePolicy"]["humanReviews"][0]["listenEvidenceReportedByBrowser"]["verseHeard"])
        self.assertTrue(all("reviewed" not in row for row in result["words"]))
        self.assertEqual((self.manifest, self.report, self.cached, self.case, self.decision), before)
        for candidate, actual in zip(self.candidate, result["words"]):
            self.assertEqual((actual["startMs"], actual["endMs"]), (candidate["startMs"], candidate["endMs"]))

    def test_old_automatic_importer_still_rejects_same_held_chapter(self):
        with self.assertRaises(ValueError):
            approve_alignment(self.manifest, self.report, self.cached, self.words, self.audio, 2000)
        self.accept()

    def test_problem_skip_partial_and_stale_answers_cannot_approve(self):
        original = deepcopy(self.decision)
        for changes in ({"verdict": "problem"}, {"verdict": "skip"}, {"candidateSha256": "new"},
                        {"queueSha256": "old"}, {"candidateWords": []}, {"audioSha256": "other"},
                        {"listenEvidenceReportedByBrowser": {"verseHeard": True, "heardSegments": [1]}}):
            self.decision = {**deepcopy(original), **changes}
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                self.accept()

    def test_unreviewed_failures_are_never_covered_by_review_of_another_verse(self):
        self.report["review"].append({"pasuk": 2, "reason": "insufficient ASR agreement"})
        with self.assertRaisesRegex(ValueError, "Unreviewed held pasuk"):
            self.accept()

    def test_unreviewed_anchors_scores_and_durations_keep_original_gates(self):
        original = deepcopy((self.manifest, self.report, self.cached))
        for mutation in (
                lambda: self.cached.update(words=[]),
                lambda: self.manifest["words"][-1].update(textScore=.5),
                lambda: self.manifest["words"][-1].update(endMs=1020),
                lambda: self.manifest["words"][-1].update(acousticScore=float("nan"))):
            self.manifest, self.report, self.cached = deepcopy(original)
            mutation()
            self.report["words"] = deepcopy(self.manifest["words"])
            with self.assertRaises((ValueError, KeyError)):
                self.accept()

    def test_changed_source_report_pipeline_or_diagnostic_stays_held(self):
        original = deepcopy((self.manifest, self.report, self.cached, self.study))
        for mutation in (
                lambda: self.manifest.update(audioSha256="stale"),
                lambda: self.manifest.update(textSha256="stale"),
                lambda: self.report.update(totalWords=4),
                lambda: self.report.update(words=[]),
                lambda: self.cached.update(revision="different"),
                lambda: self.manifest["pipeline"].update(minCoverage=.5),
                lambda: self.study.update(revision="different"),
                lambda: self.study["cases"][0]["diagnosticCandidates"][0].update(endMs=450)):
            self.manifest, self.report, self.cached, self.study = deepcopy(original)
            mutation()
            write_json(self.diagnostic, self.study)
            # Even a newly hashed diagnostic must match the exact heard candidate.
            self.case["diagnosticSha256"] = digest_file(self.diagnostic)
            self.decision["diagnosticSha256"] = self.case["diagnosticSha256"]
            with self.assertRaises(ValueError):
                self.accept()

    def test_complete_global_geometry_still_required(self):
        self.manifest["words"][-1].update(startMs=750)
        self.report["words"] = deepcopy(self.manifest["words"])
        with self.assertRaisesRegex(ValueError, "Overlapping"):
            self.accept()

    def test_original_soft_warning_policy_is_preserved_in_unreviewed_verse(self):
        self.manifest["words"][-1]["acousticScore"] = .35
        self.report["words"] = deepcopy(self.manifest["words"])
        row = self.manifest["words"][-1]
        warning = {"pasuk": 2, "reason": SOFT_WARNING, "anchorCoverage": 1.,
                   "suspectWords": [deepcopy(row)], "candidateWords": [deepcopy(row)]}
        self.report["review"].append(warning)
        self.assertEqual(self.accept()["words"][-1], row)
        warning["anchorCoverage"] = .5
        with self.assertRaises(ValueError):
            self.accept()

    def test_database_overlay_preserves_prior_acceptance_and_ignores_stale_output(self):
        canonical = self.root / "canonical.json"
        chapter = {"pesukim": [{"segments": [{"type": "qri", "value": "בראשית"},
                                             {"type": "qri", "value": "ברא"}]},
                              {"segments": [{"type": "qri", "value": "ויאמר"}]}]}
        write_json(canonical, [{"perekFrom": 1, "perakim": [chapter, deepcopy(chapter)]}])
        manifests = self.root / "alignments"
        write_json(manifests / "1.json", self.manifest)
        write_json(self.root / "1.review.json", self.report)
        write_json(self.root / "1.asr.json", self.cached)
        prior = self.accept()
        prior.update(perekId=2, audioUrl=f"{AUDIO_BASE}/2_record.mp3", reviewMethod="manual")
        write_json(manifests / "2.json", prior)
        database = self.root / "recitation.sqlite"
        export_database(manifests, database)
        self.case.update(manifestPath=str(manifests / "1.json"), audioPath=str(self.audio))
        queue = {"cases": [self.case], "queueSha256": "queue"}
        reviews = self.root / "reviews.json"
        write_json(reviews, {"version": 1, "entries": [self.decision]})
        original_reviews = reviews.read_bytes()
        output = self.root / "accepted"
        write_json(output / "3.json", {**prior, "perekId": 3})
        with patch("listening_round.load_queue", return_value=queue), patch("listening_accept.duration", return_value=2000):
            first = stage_reviews(self.root / "queue.json", reviews, canonical, output, database)
            self.assertEqual(first["accepted"], [1])
            self.assertEqual(first["words"], 3)
            before = database.read_bytes()
            second = stage_reviews(self.root / "queue.json", reviews, canonical, output, database)
            self.assertEqual(second["accepted"], [])
            self.assertEqual(second["alreadyAccepted"], [1])
            self.assertEqual(database.read_bytes(), before)
            problem = {**deepcopy(self.decision), "verdict": "problem", "note": "ending is clipped"}
            write_json(reviews, {"version": 1, "entries": [self.decision, problem]})
            third = stage_reviews(self.root / "queue.json", reviews, canonical, output, database)
            self.assertEqual(third["withdrawn"], [1])
            with closing(sqlite3.connect(database)) as db:
                self.assertEqual(db.execute("SELECT alignment_status FROM recitation_track WHERE perek_id=1").fetchone()[0], "needs_review")
                self.assertEqual(db.execute("SELECT count(*) FROM recitation_word WHERE perek_id=1").fetchone()[0], 0)
                self.assertEqual(db.execute("SELECT alignment_status FROM recitation_track WHERE perek_id=2").fetchone()[0], "ready")
            self.assertEqual(len(json.loads(reviews.read_text(encoding="utf-8"))["entries"]), 2)
            write_json(reviews, {"version": 1, "entries": [self.decision, problem, self.decision]})
            fourth = stage_reviews(self.root / "queue.json", reviews, canonical, output, database)
            self.assertEqual(fourth["accepted"], [1])
            write_json(reviews, {"version": 1, "entries": [self.decision]})
        self.assertEqual(reviews.read_bytes(), original_reviews)
        with closing(sqlite3.connect(database)) as db:
            self.assertEqual(db.execute("SELECT perek_id,alignment_status FROM recitation_track ORDER BY perek_id").fetchall(),
                             [(1, "ready"), (2, "ready")])
            provenance = json.loads(db.execute("SELECT provenance_json FROM recitation_track WHERE perek_id=2").fetchone()[0])
            self.assertEqual(provenance["reviewMethod"], "manual")

    def test_unsupported_failures_are_not_overridden_by_listening(self):
        self.report["review"][0]["reason"] = "source recording is truncated"
        with self.assertRaisesRegex(ValueError, "Unsupported failure"):
            self.accept()


if __name__ == "__main__":
    unittest.main()
