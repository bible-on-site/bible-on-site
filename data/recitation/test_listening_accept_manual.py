"""Typed slider reviews approve only real heard coordinates and unchanged remainder."""

from contextlib import closing
from copy import deepcopy
import json
import sqlite3
import unittest
from unittest.mock import patch
import wave

from listening_accept import approve_chapter, current_review_decisions, stage_reviews
from listening_edits import validate_word_review
from listening_review import digest_file, validate_decision, write_json
from recite import export_database
import test_listening_accept as legacy_tests
from trusted import AUDIO_BASE


class ManualListeningAcceptanceTests(unittest.TestCase):
    setUp = legacy_tests.ListeningAcceptanceTests.setUp

    def manual_fixture(self):
        clip = self.root / "original-context.wav"
        with wave.open(str(clip), "wb") as audio:
            audio.setparams((1, 2, 16000, 0, "NONE", "not compressed"))
            audio.writeframes(b"\x00\x01" * 16000)
        self.case.update(clipPath=str(clip), clipSha256=digest_file(clip))
        self.decision = validate_decision(self.case, {
            "candidateSha256": "candidate", "verdict": "good", "verseHeard": False,
            "heardSegments": [1, 2], "note": ""})
        self.decision.update(queueSha256="queue", savedAt="2026-10-22T10:00:00+00:00")

    def typed_review(self, verdict="good", **changes):
        payload = {"caseId": "1-1", "submissionId": "actual-human-save-0001",
            "candidateSha256": self.case["candidateSha256"],
            "clipSha256": self.case["clipSha256"], "verdict": verdict,
            "timingEdits": [{"segment": 1, "startMs": 100, "endMs": 420}],
            "heardSegments": [2], "heardEditedSegments": [1], "note": ""}
        payload.update(changes)
        row = validate_word_review(self.case, payload)
        return {**row, "queueSha256": "queue", "savedAt": "2026-10-22T11:00:00+00:00"}

    def accept(self, decision):
        return approve_chapter(self.manifest, self.report, self.cached, self.words,
            self.audio, 2000, [self.case], {"1-1": decision}, "queue")

    def stage_fixture(self):
        canonical = self.root / "canonical.json"
        chapter = {"pesukim": [{"segments": [{"type": "qri", "value": "בראשית"},
            {"type": "qri", "value": "ברא"}]},
            {"segments": [{"type": "qri", "value": "ויאמר"}]}]}
        write_json(canonical, [{"perekFrom": 1, "perakim": [chapter, deepcopy(chapter)]}])
        manifests = self.root / "alignments"
        write_json(manifests / "1.json", self.manifest)
        write_json(self.root / "1.review.json", self.report)
        write_json(self.root / "1.asr.json", self.cached)
        prior = self.accept(self.decision)
        prior.update(perekId=2, audioUrl=f"{AUDIO_BASE}/2_record.mp3", reviewMethod="manual")
        write_json(manifests / "2.json", prior)
        database = self.root / "recitation.sqlite"
        export_database(manifests, database)
        self.case.update(manifestPath=str(manifests / "1.json"), audioPath=str(self.audio))
        queue = {"cases": [self.case], "queueSha256": "queue"}
        return canonical, database, queue

    def test_real_manual_good_preserves_raw_parent_and_automatic_remainder(self):
        self.manual_fixture()
        row = self.typed_review()
        before = deepcopy((self.manifest, self.report, self.study, self.case, row))
        accepted = self.accept(row)
        self.assertEqual(accepted["alignmentStatus"], "ready")
        self.assertEqual(accepted["words"][0]["endMs"], 420)
        self.assertEqual(accepted["words"][-1], self.auto)
        self.assertEqual(accepted["acceptancePolicy"]["humanReviews"], [row])
        self.assertEqual(accepted["acceptancePolicy"]["automaticPesukim"], [2])
        self.assertEqual(accepted["acceptancePolicy"]["humanReviewedPesukim"], [1])
        self.assertEqual((self.manifest, self.report, self.study, self.case, row), before)
        self.assertEqual(self.study["cases"][0]["diagnosticCandidates"][0]["endMs"], 400)
        self.assertNotEqual(row["reviewMethod"], self.decision["reviewMethod"])

    def test_manual_edit_can_be_heard_without_claiming_original_edited_word_hearing(self):
        self.manual_fixture()
        row = self.typed_review()
        heard = row["listenEvidenceReportedByBrowser"]
        self.assertEqual(heard["heardSegments"], [2])
        self.assertEqual(heard["heardEditedSegments"], [1])
        self.assertEqual(self.accept(row)["words"][0]["endMs"], 420)

    def test_changed_clip_parent_bounds_scores_digest_or_unheard_rows_rejected(self):
        self.manual_fixture()
        original = self.typed_review()
        mutations = [
            lambda row: row.update(clipSha256="different"),
            lambda row: row.update(candidateSha256="stale-parent"),
            lambda row: row["timingEdits"][0].update(endMs=1100),
            lambda row: row["candidateWords"][0].update(acousticScore=.99),
            lambda row: row.update(editedCandidateSha256="different"),
            lambda row: row["listenEvidenceReportedByBrowser"].update(heardEditedSegments=[]),
            lambda row: row["listenEvidenceReportedByBrowser"].update(heardSegments=[]),
            lambda row: row["clipEvidence"].update(pcmSha256="different"),
            lambda row: row.update(diagnosticSha256="different"),
        ]
        for index, mutation in enumerate(mutations):
            row = deepcopy(original)
            mutation(row)
            with self.subTest(index=index), self.assertRaises(ValueError):
                self.accept(row)

    def test_changed_parent_diagnostic_is_not_validated_against_human_coordinates(self):
        self.manual_fixture()
        row = self.typed_review()
        self.study["cases"][0]["diagnosticCandidates"][0]["endMs"] = 420
        write_json(self.diagnostic, self.study)
        self.case["diagnosticSha256"] = digest_file(self.diagnostic)
        row["diagnosticSha256"] = self.case["diagnosticSha256"]
        with self.assertRaisesRegex(ValueError, "differs from actual acoustic"):
            self.accept(row)

    def test_typed_history_does_not_synthesize_legacy_entries_and_later_problem_withdraws(self):
        self.manual_fixture()
        canonical, database, queue = self.stage_fixture()
        reviews, output = self.root / "actual-reviews.json", self.root / "accepted"
        good = self.typed_review()
        write_json(reviews, {"version": 1, "entries": [], "wordReviews": [good]})
        with closing(sqlite3.connect(database)) as db:
            untouched = db.execute("SELECT * FROM recitation_track WHERE perek_id=2").fetchone()
            untouched_words = db.execute("SELECT * FROM recitation_word WHERE perek_id=2").fetchall()

        def stage():
            with patch("listening_round.load_queue", return_value=queue), patch("listening_accept.duration", return_value=2000):
                return stage_reviews(self.root / "queue.json", reviews, canonical, output, database)
        self.assertEqual(stage()["accepted"], [1])
        stable = database.read_bytes()
        self.assertEqual(stage()["alreadyAccepted"], [1])
        self.assertEqual(database.read_bytes(), stable)
        self.assertEqual(json.loads(reviews.read_text(encoding="utf-8"))["entries"], [])
        problem = self.typed_review("problem", note="Still clipped", submissionId="actual-human-save-0002")
        problem["savedAt"] = "2026-10-22T12:00:00+00:00"
        self.assertEqual(problem["editedCandidateSha256"], good["editedCandidateSha256"])
        write_json(reviews, {"version": 1, "entries": [self.decision], "wordReviews": [good, problem]})
        self.assertEqual(stage()["withdrawn"], [1])
        with closing(sqlite3.connect(database)) as db:
            self.assertEqual(db.execute("SELECT alignment_status FROM recitation_track WHERE perek_id=1").fetchone()[0], "needs_review")
            self.assertEqual(db.execute("SELECT count(*) FROM recitation_word WHERE perek_id=1").fetchone()[0], 0)
            self.assertEqual(db.execute("SELECT * FROM recitation_track WHERE perek_id=2").fetchone(), untouched)
            self.assertEqual(db.execute("SELECT * FROM recitation_word WHERE perek_id=2").fetchall(), untouched_words)
            provenance = json.loads(db.execute("SELECT provenance_json FROM recitation_track WHERE perek_id=1").fetchone()[0])
            self.assertEqual(provenance["acceptancePolicy"]["latestHumanReviews"], [problem])

    def test_later_legacy_original_coordinates_do_not_overrule_manual_version(self):
        self.manual_fixture()
        reviews = self.root / "actual-reviews.json"
        row = self.typed_review()
        for verdict in ("good", "problem", "skip"):
            self.decision.update(verdict=verdict, savedAt="2026-10-22T12:00:00+00:00")
            write_json(reviews, {"version": 1, "entries": [self.decision], "wordReviews": [row]})
            selected = current_review_decisions({"cases": [self.case]}, reviews)["1-1"]
            self.assertEqual(selected, row)
            self.assertEqual(self.accept(selected)["words"][0]["endMs"], 420)

    def test_later_legacy_same_coordinates_problem_keeps_normal_withdrawal_ordering(self):
        self.manual_fixture()
        reviews = self.root / "actual-reviews.json"
        row = self.typed_review(timingEdits=[], heardSegments=[1, 2], heardEditedSegments=[])
        self.decision.update(verdict="problem", note="Original remains clipped", savedAt="2026-10-22T12:00:00+00:00")
        write_json(reviews, {"version": 1, "entries": [self.decision], "wordReviews": [row]})
        selected = current_review_decisions({"cases": [self.case]}, reviews)["1-1"]
        self.assertEqual(selected, self.decision)
        with self.assertRaisesRegex(ValueError, "remains problem"):
            self.accept(selected)

    def test_older_or_different_parent_manual_good_cannot_override_latest_problem(self):
        self.manual_fixture()
        reviews = self.root / "actual-reviews.json"
        row = self.typed_review()
        self.decision.update(verdict="problem", note="Original remains clipped", savedAt="2026-10-22T12:00:00+00:00")
        typed = {**row, "candidateSha256": "old-parent"}
        write_json(reviews, {"version": 1, "entries": [self.decision], "wordReviews": [typed]})
        selected = current_review_decisions({"cases": [self.case]}, reviews)["1-1"]
        self.assertEqual(selected, self.decision)
        with self.assertRaisesRegex(ValueError, "remains problem"):
            self.accept(selected)

    def test_historical_same_parent_other_clip_cannot_override_current_manual_good(self):
        self.manual_fixture()
        current = self.typed_review()
        old_clip = {**self.typed_review("problem", note="Different historic playback"),
                    "clipSha256": "older-clip", "savedAt": "2026-10-22T12:00:00+00:00"}
        reviews = self.root / "actual-reviews.json"
        write_json(reviews, {"version": 1, "entries": [], "wordReviews": [current, old_clip]})
        selected = current_review_decisions({"cases": [self.case]}, reviews)["1-1"]
        self.assertEqual(selected, current)
        self.assertEqual(self.accept(selected)["words"][0]["endMs"], 420)


if __name__ == "__main__":
    unittest.main()
