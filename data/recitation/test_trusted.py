from contextlib import closing
from copy import deepcopy
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import Mock, patch

from alignment import text_hash, words_for
from awake import CONTINUOUS, SYSTEM_REQUIRED, keep_awake
from recite import audio_hash, export_database, write_json
from trusted import AUDIO_BASE, SOFT_WARNING, TRUSTED_PIPELINE, accept_trusted, stage_completed


class TrustedTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.audio = self.root / "1_record.mp3"
        self.audio.write_bytes(b"original recording")
        self.chapter = {"pesukim": [{"segments": [
            {"type": "qri", "value": "בראשית"}, {"type": "qri", "value": "ברא"}]}]}
        self.words = words_for(self.chapter)
        self.rows = [
            {"pasuk": 1, "segment": 1, "text": "בראשית", "startMs": 100, "endMs": 450,
             "acousticScore": .35, "textScore": 1.0},
            {"pasuk": 1, "segment": 2, "text": "ברא", "startMs": 500, "endMs": 900,
             "acousticScore": .9, "textScore": 1.0},
        ]
        self.manifest = {"version": 1, "perekId": 1, "audioUrl": f"{AUDIO_BASE}/1_record.mp3",
            "audioSha256": audio_hash(self.audio), "textSha256": text_hash(self.words),
            "durationMs": 1000, "alignmentStatus": "needs_review", "pipeline": deepcopy(TRUSTED_PIPELINE),
            "words": deepcopy(self.rows)}
        self.report = {key: deepcopy(self.manifest[key]) for key in
                       ("perekId", "audioSha256", "textSha256", "pipeline", "words")}
        self.report.update(totalWords=2, review=[{"pasuk": 1, "reason": SOFT_WARNING,
            "anchorCoverage": 1.0, "suspectWords": [deepcopy(self.rows[0])], "candidateWords": deepcopy(self.rows)}])
        self.cached = {"audioSha256": self.manifest["audioSha256"], "model": TRUSTED_PIPELINE["asrModel"],
            "revision": TRUSTED_PIPELINE["asrRevision"], "words": [
                {"text": "בראשית", "start": .1, "end": .45}, {"text": "ברא", "start": .5, "end": .9}]}

    def accept(self):
        return accept_trusted(self.manifest, self.report, self.cached, self.words, self.audio, 1000)

    def test_low_score_is_preserved_without_implying_listening_or_changing_boundaries(self):
        before = deepcopy(self.manifest)
        accepted = self.accept()
        self.assertEqual(self.manifest, before)
        self.assertEqual(accepted["words"], self.rows)
        self.assertEqual(accepted["alignmentStatus"], "ready")
        self.assertEqual(accepted["reviewMethod"], "trusted-process")
        self.assertEqual(accepted["acceptancePolicy"]["diagnostics"], self.report["review"])
        self.assertTrue(all("reviewed" not in row for row in accepted["words"]))

    def test_missing_overlapping_stale_duplicate_or_implausible_intervals_are_held(self):
        mutations = [
            lambda rows: rows[0].update(startMs=None),
            lambda rows: rows[1].update(startMs=400),
            lambda rows: rows[0].update(text="שונה"),
            lambda rows: rows[1].update(segment=1),
            lambda rows: rows[0].update(endMs=120),
            lambda rows: rows.pop(),
        ]
        original = deepcopy(self.manifest)
        for mutation in mutations:
            with self.subTest(mutation=mutation):
                self.manifest = deepcopy(original)
                mutation(self.manifest["words"])
                self.report["words"] = deepcopy(self.manifest["words"])
                with self.assertRaises(ValueError):
                    self.accept()

    def test_changed_sources_model_snapshots_or_reports_are_held(self):
        original = deepcopy(self.manifest)
        for key, value in (("audioSha256", "other"), ("textSha256", "other"),
                           ("audioUrl", "https://example.com/other.mp3"), ("durationMs", 2000),
                           ("pipeline", {**TRUSTED_PIPELINE, "version": 2})):
            with self.subTest(key=key):
                self.manifest = {**deepcopy(original), key: value}
                with self.assertRaises(ValueError):
                    self.accept()
        self.manifest = original
        self.report["words"][0]["startMs"] = 110
        with self.assertRaisesRegex(ValueError, "Diagnostic report differs"):
            self.accept()

    def test_hard_warnings_invalid_scores_and_insufficient_asr_evidence_are_held(self):
        self.report["review"][0]["reason"] = "verse timings still overlap after joint alignment"
        with self.assertRaisesRegex(ValueError, "Unresolved alignment failure"):
            self.accept()
        self.report["review"][0]["reason"] = SOFT_WARNING
        self.manifest["words"][0]["acousticScore"] = float("nan")
        self.report["words"] = deepcopy(self.manifest["words"])
        with self.assertRaises(ValueError):
            self.accept()
        self.manifest["words"] = deepcopy(self.rows)
        self.report["words"] = deepcopy(self.rows)
        self.cached["revision"] = "changed"
        with self.assertRaisesRegex(ValueError, "ASR evidence"):
            self.accept()
        self.cached["revision"] = TRUSTED_PIPELINE["asrRevision"]
        self.cached["words"] = [{"text": "אחר", "start": .1, "end": .9}]
        with self.assertRaisesRegex(ValueError, "Insufficient ASR anchors"):
            self.accept()

    def test_incremental_publication_is_idempotent_and_ignores_stale_staging(self):
        from audit import audit
        from publish import publish
        manifests, output = self.root / "manifests", self.root / "staged"
        database, canonical = self.root / "recitation.sqlite", self.root / "perakim.json"
        write_json(canonical, [{"perekFrom": 1, "perakim": [self.chapter, deepcopy(self.chapter)]}])
        pending = deepcopy(self.manifest)
        pending.update(perekId=2, audioUrl=f"{AUDIO_BASE}/2_record.mp3", alignmentStatus="pending")
        pending["words"] = [{**row, "startMs": None, "endMs": None} for row in self.rows]
        write_json(manifests / "1.json", {**self.manifest, "alignmentStatus": "pending"})
        write_json(manifests / "2.json", pending)
        export_database(manifests, database)
        write_json(manifests / "1.json", self.manifest)
        write_json(self.root / "1.review.json", self.report)
        write_json(self.root / "1.asr.json", self.cached)
        # A leftover stage file must never enable another chapter.
        write_json(output / "2.json", {**pending, "alignmentStatus": "ready", "words": self.rows})
        with patch("trusted.duration", return_value=1000):
            first = stage_completed(manifests, self.root, self.root, canonical, output, database)
            self.assertEqual(first["accepted"], [1])
            before = database.read_bytes()
            second = stage_completed(manifests, self.root, self.root, canonical, output, database)
            self.assertEqual(second["alreadyPublished"], [1])
            self.assertEqual(second["accepted"], [])
            self.assertEqual(database.read_bytes(), before)
        publish(database, canonical)
        audit(database, canonical)
        with closing(sqlite3.connect(database)) as db:
            self.assertEqual(db.execute("SELECT perek_id,alignment_status FROM recitation_track ORDER BY perek_id").fetchall(),
                             [(1, "ready"), (2, "pending")])
            self.assertEqual(db.execute("SELECT count(*) FROM recitation_word WHERE perek_id=2").fetchone()[0], 0)
            provenance = json.loads(db.execute("SELECT provenance_json FROM recitation_track WHERE perek_id=1").fetchone()[0])
            self.assertEqual(provenance["reviewMethod"], "trusted-process")


class AwakeTests(unittest.TestCase):
    def test_sleep_request_is_released_on_success_and_failure(self):
        for fail in (False, True):
            api = Mock()
            api.SetThreadExecutionState.return_value = 1
            try:
                with keep_awake(api):
                    if fail:
                        raise RuntimeError("inference failed")
            except RuntimeError:
                pass
            self.assertEqual([call.args[0] for call in api.SetThreadExecutionState.call_args_list],
                             [CONTINUOUS | SYSTEM_REQUIRED, CONTINUOUS])


if __name__ == "__main__":
    unittest.main()
