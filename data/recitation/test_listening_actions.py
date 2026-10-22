"""Append-only source actions, true PCM range and publication separation regressions."""
from contextlib import closing
import hashlib
import json
from pathlib import Path
import sqlite3
import struct
import tempfile
import unittest

from listening_actions import ActionDatabase, POLICY, task_digest, validate_response
from listening_review import digest_json


class ActionStoreTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.audio = self.root / "90_record.mp3"
        self.audio.write_bytes(b"immutable-original-mp3")
        self.frames = 32000
        self.pcm = struct.pack("<f", 0.125) * self.frames
        self.playback = self.root / "90-source.wav"
        self.wav(self.playback, self.pcm)
        self.store = ActionDatabase(self.root / "actions.sqlite")
        self.definition = {
            "version": 1, "policy": POLICY, "taskId": "concern-90-1", "kind": "locate-source-range",
            "perekId": 90, "pasuk": 1, "label": "ויקרא א א",
            "sourceAudioPath": str(self.audio), "audioSha256": hashlib.sha256(self.audio.read_bytes()).hexdigest(),
            "textSha256": "a" * 64, "sourceFrames": self.frames, "sourceSampleRate": 16000,
            "sourcePcmSha256": hashlib.sha256(self.pcm).hexdigest(),
            "sourcePlaybackPath": str(self.playback), "playbackSha256": hashlib.sha256(self.playback.read_bytes()).hexdigest(),
            "canonicalWords": [{"pasuk": 1, "segment": 1, "text": "ויקרא"}],
            "sourceEvidence": {"manifestPath": "private-source-path", "manifestSha256": "b" * 64}}
        self.definition["taskSha256"] = task_digest(self.definition)
        self.payload = {"submissionId": "real-browser-submission-01", "taskId": self.definition["taskId"],
                        "taskSha256": self.definition["taskSha256"], "kind": "locate-source-range",
                        "audioSha256": self.definition["audioSha256"], "textSha256": self.definition["textSha256"],
                        "startMs": 0, "endMs": 2000,
                        "heardRange": {"startMs": 0, "endMs": 2000, "complete": True}, "note": ""}

    def wav(self, path, pcm):
        fmt = struct.pack("<HHIIHH", 3, 1, 16000, 64000, 4, 32)
        body = b"WAVEfmt " + struct.pack("<I", len(fmt)) + fmt + b"data" + struct.pack("<I", len(pcm)) + pcm
        path.write_bytes(b"RIFF" + struct.pack("<I", len(body)) + body)

    def seed(self, **changes):
        task = {**self.definition, **changes}
        task["taskSha256"] = task_digest(task)
        self.store.seed([task])
        return task

    def test_definitions_are_source_bound_immutable_idempotent_and_private(self):
        self.assertEqual(self.store.seed([self.definition]), 1)
        self.assertEqual(self.store.seed([self.definition]), 0)
        self.assertEqual(self.store.tasks(private=True), [self.definition])
        public = self.store.public_view()
        self.assertEqual(public["tasks"][0]["state"], "pending")
        self.assertEqual(public["tasks"][0]["sourceDurationMs"], 2000)
        self.assertNotIn("private", json.dumps(public))
        self.assertNotIn("Path", json.dumps(public))
        self.assertEqual(self.store.responses(), [])
        changed = {**self.definition, "label": "ויקרא א ב"}
        changed["taskSha256"] = task_digest(changed)
        with self.assertRaisesRegex(ValueError, "immutable"):
            self.store.seed([changed])
        self.assertEqual(self.store.tasks(private=True), [self.definition])

    def test_sparse_canonical_segments_keep_their_original_identities(self):
        words = [{"pasuk": 1, "segment": 1, "text": "א"}, {"pasuk": 1, "segment": 3, "text": "ב"}]
        self.seed(canonicalWords=words)
        self.assertEqual(self.store.tasks(private=True)[0]["canonicalWords"], words)
        self.assertEqual(self.store.tasks()[0]["canonicalWords"], words)

    def test_canonical_display_neighbors_are_not_target_words_or_paths(self):
        neighbors = [{"pasuk": 2, "segment": 1, "text": "ויקרא"}]
        self.seed(neighborWords=neighbors)
        self.assertEqual(self.store.tasks()[0]["neighborWords"], neighbors)
        self.assertEqual(len(self.store.tasks()[0]["canonicalWords"]), 1)

    def test_resolved_good_cannot_be_overwritten_by_a_stale_location_submission(self):
        self.seed()
        saved = self.store.save_response(self.payload)
        self.store.record_task_state(self.definition["taskId"], "resolved", {
            "genuineGoodValidated": True, "chapterValidated": True,
            "reviewSha256": "c" * 64, "chapterValidationSha256": "d" * 64})
        self.assertEqual(self.store.save_response(self.payload), saved)
        with self.assertRaisesRegex(ValueError, "validated genuine GOOD"):
            self.store.save_response({**self.payload, "submissionId": "stale-new-location-response"})
        self.assertEqual(self.store.responses(), [saved])

    def test_chapter_concern_is_bound_to_actual_previous_good_and_exact_affected_segments(self):
        ref = {"caseId": "90-1", "candidateSha256": "c" * 64, "clipSha256": "d" * 64}
        concern = {"validationSha256": "e" * 64, "previousReviewSha256": "f" * 64,
                   "reasonCode": "cross_verse_overlap", "segments": [1]}
        self.seed(kind="review-cuts", caseRef=ref, chapterConcern=concern)
        self.assertEqual(self.store.tasks()[0]["chapterConcern"], concern)
        for change in ({"segments": [2]}, {"segments": [1, 1]}, {"segments": [True]},
                       {"previousReviewSha256": "bad"}, {"validationSha256": "bad"},
                       {"reasonCode": "unverified"}, {"privatePath": "secret"}):
            task = {**self.definition, "kind": "review-cuts", "caseRef": ref,
                    "chapterConcern": {**concern, **change}}
            task["taskSha256"] = task_digest(task)
            with self.assertRaises(ValueError):
                ActionDatabase(self.root / "invalid-actions.sqlite").seed([task])

    def test_seed_computes_absent_hash_and_rejects_duplicate_or_changed_source(self):
        definition = {key: value for key, value in self.definition.items() if key != "taskSha256"}
        self.assertEqual(self.store.seed([definition]), 1)
        self.assertEqual(self.store.tasks(private=True), [self.definition])
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            self.store.seed([self.definition, self.definition])
        self.audio.write_bytes(b"changed-original")
        with self.assertRaisesRegex(ValueError, "audio changed"):
            self.store.seed([self.definition])

    def test_definition_validation_rejects_unbound_profiles_and_malformed_canonical_identity(self):
        bad = ({"policy": "fake"}, {"taskSha256": "x"}, {"taskId": "../private"},
               {"version": True}, {"perekId": False}, {"pasuk": 0}, {"kind": "good"}, {"label": "<script>"},
               {"sourceFrames": True}, {"sourceFrames": 0}, {"sourceSampleRate": 48000},
               {"sourcePcmSha256": "missing"}, {"sourceAudioPath": "relative.mp3"},
               {"sourceAudioPath": str(self.root / "private.txt")}, {"canonicalWords": []},
               {"canonicalWords": [{"pasuk": 2, "segment": 1, "text": "א"}]},
               {"canonicalWords": [{"pasuk": 1, "segment": 0, "text": "א"}]},
               {"canonicalWords": [{"pasuk": 1, "segment": 3, "text": "א"},
                                   {"pasuk": 1, "segment": 1, "text": "ב"}]},
               {"canonicalWords": [{"pasuk": 1, "segment": 1, "text": "א", "privatePath": "secret"}]},
               {"sourceEvidence": {}}, {"sourcePlaybackPath": "relative.wav"},
               {"playbackSha256": "missing"}, {"kind": "review-cuts"},
               {"issueUrl": "https://private.invalid/credential"})
        for change in bad:
            with self.subTest(change=change):
                task = {**self.definition, **change}
                if "taskSha256" not in change:
                    task["taskSha256"] = task_digest(task)
                with self.assertRaises(ValueError):
                    self.store.seed([task])
        self.assertEqual(self.store.tasks(private=True), [])

    def test_exact_complete_source_range_is_typed_input_never_good_or_word_hearing(self):
        self.seed()
        row = self.store.save_response(self.payload)
        self.assertEqual(self.store.save_response(self.payload), row)
        self.assertEqual(row["reviewMethod"], "human-source-range-selection")
        self.assertEqual(row["publicationStatus"], "held")
        self.assertIs(row["automaticApproval"], False)
        self.assertNotIn("verdict", row)
        self.assertNotIn("heardSegments", row)
        self.assertEqual(row["responseSha256"], digest_json({key: value for key, value in row.items()
                                                            if key != "responseSha256"}))
        self.assertEqual(self.store.responses(), [row])
        self.assertEqual(self.store.tasks()[0]["state"], "context_queued")
        changed = {**self.payload, "note": "another actual answer"}
        with self.assertRaisesRegex(ValueError, "already belongs"):
            self.store.save_response(changed)

    def test_review_cuts_can_request_real_new_source_range_without_mutating_the_original_task(self):
        task = self.seed(kind="review-cuts",
                         caseRef={"caseId": "90-1", "candidateSha256": "c" * 64, "clipSha256": "d" * 64})
        payload = {**self.payload, "taskSha256": task["taskSha256"]}
        saved = self.store.save_response(payload)
        self.assertEqual(saved["kind"], "locate-source-range")
        self.assertEqual(self.store.task(task["taskId"]), task)
        self.assertEqual(self.store.tasks()[0]["state"], "context_queued")
        source = {**task, "kind": "source-remediation"}
        source["taskSha256"] = task_digest(source)
        with self.assertRaises(ValueError):
            validate_response(source, {**payload, "taskSha256": source["taskSha256"]})

    def test_source_range_can_exceed_old_diagnostic_context_limit_without_approval(self):
        task = {**self.definition, "sourceFrames": 16000 * 60}
        task.pop("sourcePlaybackPath")
        task.pop("playbackSha256")
        task["taskSha256"] = task_digest(task)
        self.store.seed([task])
        payload = {**self.payload, "taskSha256": task["taskSha256"], "endMs": 60000,
                   "heardRange": {"startMs": 0, "endMs": 60000, "complete": True}}
        self.assertEqual(self.store.save_response(payload)["endMs"], 60000)

    def test_stale_or_unheard_or_null_or_out_of_source_range_is_never_saved(self):
        self.seed()
        bad = ({"taskSha256": "c" * 64}, {"audioSha256": "c" * 64}, {"textSha256": "c" * 64},
               {"taskId": "unknown-task"}, {"taskId": []}, {"submissionId": []}, {"submissionId": "short"}, {"startMs": None},
               {"startMs": True}, {"startMs": -1}, {"startMs": 2000}, {"endMs": 2001},
               {"endMs": False}, {"heardRange": None}, {"heardRange": {"startMs": 0, "endMs": 2000, "complete": False}},
               {"heardRange": {"startMs": 1, "endMs": 2000, "complete": True}},
               {"heardRange": {"startMs": 0, "endMs": 2000, "complete": 1}},
               {"heardRange": {"startMs": 0, "endMs": 2000, "complete": True, "heardSegments": [1]}},
               {"verdict": "good"}, {"note": "x" * 2001}, {"note": 1}, {"kind": "review-cuts"})
        for change in bad:
            with self.subTest(change=change), self.assertRaises(ValueError):
                self.store.save_response({**self.payload, **change})
        self.assertEqual(self.store.responses(), [])

    def test_source_problem_is_concrete_action_and_preserves_earlier_actual_location(self):
        self.seed()
        first = self.store.save_response(self.payload)
        problem = {key: value for key, value in self.payload.items() if key not in ("startMs", "endMs", "heardRange")}
        problem.update(submissionId="real-browser-submission-02", kind="source-remediation",
                       decision="cannot_locate", note="  original exact note  ")
        row = self.store.save_response(problem)
        self.assertEqual(row["note"], "  original exact note  ")
        self.assertEqual(self.store.responses(), [first, row])
        self.assertEqual(self.store.tasks()[0]["state"], "needs_source")
        for change in ({"decision": "good"}, {"note": ""}, {"note": " "}, {"startMs": 0}):
            with self.assertRaises(ValueError):
                self.store.save_response({**problem, "submissionId": "another-browser-response", **change})

    def test_outcomes_are_distinct_idempotent_and_resolution_requires_chapter_validation(self):
        self.seed()
        with self.assertRaisesRegex(ValueError, "actual action response"):
            self.store.record_outcome("fake-submission", "preparing", {})
        self.store.save_response(self.payload)
        event = self.store.record_outcome(self.payload["submissionId"], "preparing", {"actual": "worker-proof"})
        self.assertEqual(self.store.record_outcome(self.payload["submissionId"], "preparing",
                                                   {"actual": "worker-proof"}), event)
        ref = {"caseId": "90-1", "candidateSha256": "c" * 64, "clipSha256": "d" * 64}
        self.store.record_outcome(self.payload["submissionId"], "review", {"caseRef": ref})
        self.assertEqual(self.store.tasks()[0]["caseRef"], ref)
        self.assertEqual(self.store.tasks()[0]["state"], "review")
        with self.assertRaisesRegex(ValueError, "genuine GOOD"):
            self.store.record_task_state(self.definition["taskId"], "resolved", {})
        proof = {"genuineGoodValidated": True, "chapterValidated": True, "reviewSha256": "e" * 64,
                 "chapterValidationSha256": "f" * 64}
        resolved = self.store.record_task_state(self.definition["taskId"], "resolved", proof)
        self.assertEqual(resolved["actor"], "chapter-workflow")
        self.assertEqual(self.store.tasks()[0]["state"], "resolved")
        self.assertEqual(len(self.store.responses()), 1)
        self.assertEqual(self.store.outcome_for(self.definition["taskId"]), resolved)

    def test_older_response_processing_cannot_overwrite_later_real_source_problem(self):
        self.seed()
        self.store.save_response(self.payload)
        problem = {key: value for key, value in self.payload.items() if key not in ("startMs", "endMs", "heardRange")}
        problem.update(submissionId="later-browser-submission", kind="source-remediation",
                       decision="source_problem", note="actual missing text")
        self.store.save_response(problem)
        self.store.record_outcome(self.payload["submissionId"], "review",
                                 {"caseRef": {"caseId": "90-1", "candidateSha256": "c" * 64, "clipSha256": "d" * 64}})
        self.assertEqual(self.store.tasks()[0]["state"], "needs_source")
        self.assertNotIn("caseRef", self.store.tasks()[0])

    def test_original_and_full_source_wav_must_remain_exact_and_complete(self):
        self.seed()
        self.assertEqual(self.store.audio(self.definition["taskId"]), self.playback.read_bytes())
        self.playback.write_bytes(self.playback.read_bytes()[:-4])
        with self.assertRaisesRegex(ValueError, "playback changed"):
            self.store.audio(self.definition["taskId"])
        wrong = {**self.definition, "playbackSha256": hashlib.sha256(self.playback.read_bytes()).hexdigest()}
        wrong["taskSha256"] = task_digest(wrong)
        other = ActionDatabase(self.root / "other-actions.sqlite")
        with self.assertRaises(ValueError):
            other.seed([wrong])
        self.wav(self.playback, self.pcm[:-4])
        wrong.update(playbackSha256=hashlib.sha256(self.playback.read_bytes()).hexdigest())
        wrong["taskSha256"] = task_digest(wrong)
        with self.assertRaisesRegex(ValueError, "complete original decoded PCM"):
            other.seed([wrong])
        self.audio.write_bytes(b"changed-original")
        with self.assertRaisesRegex(ValueError, "original audio changed"):
            self.store.audio(self.definition["taskId"])

    def test_action_store_refuses_original_review_schema_without_changing_bytes(self):
        original = self.root / "original-listening.sqlite"
        with closing(sqlite3.connect(original)) as db:
            with db:
                db.execute("CREATE TABLE candidate (body TEXT)")
                db.execute("INSERT INTO candidate VALUES ('original actual row')")
        before = original.read_bytes()
        with self.assertRaisesRegex(ValueError, "existing review"):
            ActionDatabase(original)
        self.assertEqual(original.read_bytes(), before)
        for path in (Path("relative.sqlite"), self.root / "reviews.sqlite", self.root / "recitation.sqlite"):
            with self.assertRaisesRegex(ValueError, "separate absolute"):
                ActionDatabase(path)

    def test_review_cuts_and_known_source_actions_have_exact_references_and_safe_issue_links(self):
        ref = {"caseId": "90-1", "candidateSha256": "c" * 64, "clipSha256": "d" * 64}
        self.seed(kind="review-cuts", caseRef=ref)
        self.assertEqual(self.store.tasks()[0]["state"], "review")
        self.assertEqual(self.store.tasks()[0]["caseRef"], ref)
        other = ActionDatabase(self.root / "source-actions.sqlite")
        source = {**self.definition, "kind": "source-remediation",
                  "issueUrl": "https://github.com/bible-on-site/bible-on-site/issues/2223"}
        source["taskSha256"] = task_digest(source)
        other.seed([source])
        self.assertEqual(other.tasks()[0]["state"], "needs_source")
        self.assertEqual(other.tasks()[0]["issueURL"], source["issueUrl"])


if __name__ == "__main__":
    unittest.main()
